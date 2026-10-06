import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { parse, notFound, conflict, badRequest } from "../lib/errors.js";
import { allow } from "../lib/auth.js";
import { dayBounds, DATE_RE } from "../lib/time.js";
import { logActivity, pesos } from "../lib/activity.js";

export const adminRouter = Router();
const owner = allow("OWNER");

/** Catálogo para recepción: servicios, extras, productos y groomers. */
adminRouter.get("/catalog", async (req, res) => {
  const businessId = req.user!.businessId;
  const [services, addOns, products, groomers] = await Promise.all([
    prisma.service.findMany({ where: { businessId, active: true }, include: { prices: true }, orderBy: { sortOrder: "asc" } }),
    prisma.addOn.findMany({ where: { businessId, active: true }, orderBy: { price: "desc" } }),
    prisma.product.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.groomer.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json({
    services: services.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      prices: Object.fromEntries(s.prices.map((p) => [p.size, { price: p.price, durationMin: p.durationMin }])),
    })),
    addOns,
    products,
    groomers,
  });
});

const productBody = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.number().int().min(0),
  stock: z.number().int().min(0).default(0),
  active: z.boolean().optional(),
});

adminRouter.post("/products", owner, async (req, res) => {
  const body = parse(productBody, req.body);
  const dup = await prisma.product.findFirst({ where: { businessId: req.user!.businessId, name: { equals: body.name, mode: "insensitive" } } });
  if (dup) throw conflict(`Ya existe "${dup.name}" en la boutique`);
  const p = await prisma.product.create({ data: { ...body, businessId: req.user!.businessId } });
  await logActivity(prisma, p.businessId, "product.created", `Producto nuevo · ${p.name} · ${pesos(p.price)}`, { userId: req.user!.id });
  res.status(201).json(p);
});

adminRouter.patch("/products/:id", owner, async (req, res) => {
  const body = parse(productBody.partial().extend({ addStock: z.number().int().optional() }), req.body);
  const p = await prisma.product.findFirst({ where: { id: String(req.params.id), businessId: req.user!.businessId } });
  if (!p) throw notFound("Producto");
  const { addStock, ...rest } = body;
  if (addStock && p.stock + addStock < 0) throw badRequest("El stock no puede quedar negativo");
  const updated = await prisma.product.update({
    where: { id: p.id },
    data: { ...rest, ...(addStock ? { stock: { increment: addStock } } : {}) },
  });
  if (addStock) {
    await logActivity(prisma, p.businessId, "product.stock", `Inventario · ${p.name} ${addStock > 0 ? "+" : ""}${addStock} (quedan ${updated.stock})`, {
      userId: req.user!.id,
    });
  }
  res.json(updated);
});

const groomerBody = z.object({
  name: z.string().trim().min(1).max(60),
  commissionPct: z.number().int().min(0).max(100).nullable().optional(),
  active: z.boolean().optional(),
});

adminRouter.post("/groomers", owner, async (req, res) => {
  const body = parse(groomerBody, req.body);
  res.status(201).json(await prisma.groomer.create({ data: { ...body, businessId: req.user!.businessId } }));
});

adminRouter.patch("/groomers/:id", owner, async (req, res) => {
  const body = parse(groomerBody.partial(), req.body);
  const g = await prisma.groomer.findFirst({ where: { id: String(req.params.id), businessId: req.user!.businessId } });
  if (!g) throw notFound("Groomer");
  res.json(await prisma.groomer.update({ where: { id: g.id }, data: body }));
});

const userBody = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  role: z.enum(["OWNER", "RECEPTION", "GROOMER"]),
  groomerId: z.string().nullable().optional(),
});

adminRouter.get("/users", owner, async (req, res) => {
  const users = await prisma.user.findMany({ where: { businessId: req.user!.businessId }, orderBy: { createdAt: "asc" } });
  res.json(users.map(({ passwordHash: _p, ...u }) => u));
});

adminRouter.post("/users", owner, async (req, res) => {
  const body = parse(userBody, req.body);
  const businessId = req.user!.businessId;
  const email = body.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { businessId_email: { businessId, email } } })) throw conflict("Ese correo ya tiene usuario");
  if (body.groomerId && !(await prisma.groomer.findFirst({ where: { id: body.groomerId, businessId } }))) throw notFound("Groomer");
  const u = await prisma.user.create({
    data: {
      businessId,
      email,
      name: body.name,
      role: body.role,
      groomerId: body.groomerId ?? null,
      passwordHash: await bcrypt.hash(body.password, 10),
    },
  });
  const { passwordHash: _p, ...safe } = u;
  res.status(201).json(safe);
});

const rangeQ = z.object({ from: z.string().regex(DATE_RE), to: z.string().regex(DATE_RE) });

/** Comisiones: % sobre servicios terminados (servicio + extras). La boutique no paga comisión. */
adminRouter.get("/commissions", owner, async (req, res) => {
  const { from, to } = parse(rangeQ, req.query);
  const b = await prisma.business.findUniqueOrThrow({ where: { id: req.user!.businessId } });
  const start = dayBounds(from, b.timezone).start;
  const end = dayBounds(to, b.timezone).end;
  if (end <= start) throw badRequest("Rango de fechas inválido");
  const [groomers, appts] = await Promise.all([
    prisma.groomer.findMany({ where: { businessId: b.id }, orderBy: { createdAt: "asc" } }),
    prisma.appointment.findMany({
      where: { businessId: b.id, status: "DONE", startsAt: { gte: start, lt: end } },
      select: { groomerId: true, price: true, paidAt: true },
    }),
  ]);
  const rows = groomers
    .map((g) => {
      const mine = appts.filter((a) => a.groomerId === g.id);
      const pct = g.commissionPct ?? b.commissionPct;
      const base = mine.reduce((t, a) => t + a.price, 0);
      return {
        groomerId: g.id,
        name: g.name,
        active: g.active,
        services: mine.length,
        unpaidServices: mine.filter((a) => !a.paidAt).length,
        base,
        pct,
        commission: Math.round((base * pct) / 100),
      };
    })
    .filter((r) => r.active || r.services > 0);
  res.json({ from, to, rows, total: rows.reduce((t, r) => t + r.commission, 0) });
});
