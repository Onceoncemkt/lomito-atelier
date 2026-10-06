import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { parse, notFound, conflict, badRequest } from "../lib/errors.js";
import { allow } from "../lib/auth.js";
import { normalizePhone } from "../lib/booking.js";
import { logActivity, pesos } from "../lib/activity.js";
import { SIZES } from "./public.js";

/** Ajustes del negocio. Sólo la dueña. */
export const settingsRouter = Router();
settingsRouter.use("/settings", allow("OWNER"));

const id = (v: unknown) => String(v);
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

settingsRouter.get("/settings", async (req, res) => {
  const businessId = req.user!.businessId;
  const [business, services, addOns, products, groomers, users] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.service.findMany({ where: { businessId }, include: { prices: true }, orderBy: { sortOrder: "asc" } }),
    prisma.addOn.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.groomer.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
  ]);
  res.json({
    business: {
      name: business.name,
      slug: business.slug,
      phone: business.phone,
      openingHours: business.openingHours,
      commissionPct: business.commissionPct,
      slotMinutes: business.slotMinutes,
    },
    services: services.map((s) => ({
      ...s,
      prices: Object.fromEntries(s.prices.map((p) => [p.size, { price: p.price, durationMin: p.durationMin }])),
    })),
    addOns,
    products,
    groomers,
    users: users.map(({ passwordHash: _p, ...u }) => ({ ...u, isMe: u.id === req.user!.id })),
  });
});

// ---------- negocio
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayHours = z.object({ open: z.string().regex(HM), close: z.string().regex(HM) }).nullable();
const businessBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().nullable().optional(),
  commissionPct: z.number().int().min(0).max(100).optional(),
  openingHours: z
    .record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), dayHours)
    .refine((h) => Object.values(h).every((d) => !d || d.open < d.close), "La hora de cierre debe ser después de la de apertura")
    .optional(),
});

settingsRouter.patch("/settings/business", async (req, res) => {
  const body = parse(businessBody, req.body);
  const phone = body.phone === undefined ? undefined : body.phone ? normalizePhone(body.phone) : null;
  const b = await prisma.business.update({
    where: { id: req.user!.businessId },
    data: { ...body, phone, openingHours: body.openingHours },
  });
  await logActivity(prisma, b.id, "settings.business", "Ajustes del negocio actualizados", { userId: req.user!.id });
  res.json({ name: b.name, phone: b.phone, commissionPct: b.commissionPct, openingHours: b.openingHours });
});

// ---------- servicios
const priceRow = z.object({ price: z.number().int().min(0), durationMin: z.number().int().min(15).max(480) });
const serviceBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  prices: z.partialRecord(z.enum(SIZES), priceRow.nullable()).optional(),
});

async function savePrices(serviceId: string, prices: Partial<Record<(typeof SIZES)[number], { price: number; durationMin: number } | null>>) {
  for (const size of SIZES) {
    const v = prices[size];
    if (v === undefined) continue;
    if (v === null) await prisma.servicePrice.deleteMany({ where: { serviceId, size } });
    else
      await prisma.servicePrice.upsert({
        where: { serviceId_size: { serviceId, size } },
        create: { serviceId, size, ...v },
        update: v,
      });
  }
}

settingsRouter.post("/settings/services", async (req, res) => {
  const body = parse(serviceBody, req.body);
  const businessId = req.user!.businessId;
  if (!body.prices || !Object.values(body.prices).some(Boolean)) throw badRequest("Pon precio al menos para un tamaño");
  let code = slugify(body.name);
  if (await prisma.service.findUnique({ where: { businessId_code: { businessId, code } } })) code = `${code}-${Date.now().toString(36)}`;
  const max = await prisma.service.aggregate({ where: { businessId }, _max: { sortOrder: true } });
  const s = await prisma.service.create({
    data: { businessId, code, name: body.name, description: body.description ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1, active: body.active ?? true },
  });
  await savePrices(s.id, body.prices);
  await logActivity(prisma, businessId, "settings.service", `Servicio nuevo · ${s.name}`, { userId: req.user!.id });
  res.status(201).json(s);
});

settingsRouter.patch("/settings/services/:id", async (req, res) => {
  const body = parse(serviceBody.partial(), req.body);
  const businessId = req.user!.businessId;
  const s = await prisma.service.findFirst({ where: { id: id(req.params.id), businessId }, include: { prices: true } });
  if (!s) throw notFound("Servicio");
  const { prices, ...rest } = body;
  if (prices) {
    const remaining = SIZES.filter((z) => (prices[z] === undefined ? s.prices.some((p) => p.size === z) : !!prices[z]));
    if (!remaining.length) throw badRequest("El servicio debe tener precio al menos para un tamaño");
  }
  await prisma.service.update({ where: { id: s.id }, data: rest });
  if (prices) await savePrices(s.id, prices);
  const changes: string[] = [];
  if (prices) {
    for (const z of SIZES) {
      const before = s.prices.find((p) => p.size === z);
      const after = prices[z];
      if (after && before && after.price !== before.price) changes.push(`${z.toLowerCase()} ${pesos(before.price)}→${pesos(after.price)}`);
    }
  }
  await logActivity(prisma, businessId, "settings.service", `Servicio ${s.name} actualizado${changes.length ? ` · ${changes.join(", ")}` : ""}`, { userId: req.user!.id });
  res.json({ ok: true });
});

// ---------- extras
const addOnBody = z.object({
  name: z.string().trim().min(2).max(60),
  price: z.number().int().min(0),
  durationMin: z.number().int().min(0).max(240).default(0),
  active: z.boolean().optional(),
});

settingsRouter.post("/settings/addons", async (req, res) => {
  const body = parse(addOnBody, req.body);
  const businessId = req.user!.businessId;
  let code = slugify(body.name);
  if (await prisma.addOn.findUnique({ where: { businessId_code: { businessId, code } } })) code = `${code}-${Date.now().toString(36)}`;
  res.status(201).json(await prisma.addOn.create({ data: { ...body, businessId, code } }));
});

settingsRouter.patch("/settings/addons/:id", async (req, res) => {
  const body = parse(addOnBody.partial(), req.body);
  const a = await prisma.addOn.findFirst({ where: { id: id(req.params.id), businessId: req.user!.businessId } });
  if (!a) throw notFound("Extra");
  res.json(await prisma.addOn.update({ where: { id: a.id }, data: body }));
});

// ---------- usuarios
const userPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(["OWNER", "RECEPTION", "GROOMER"]).optional(),
  groomerId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").optional(),
});

settingsRouter.patch("/settings/users/:id", async (req, res) => {
  const body = parse(userPatch, req.body);
  const businessId = req.user!.businessId;
  const u = await prisma.user.findFirst({ where: { id: id(req.params.id), businessId } });
  if (!u) throw notFound("Usuario");
  const losingOwner = u.role === "OWNER" && ((body.role && body.role !== "OWNER") || body.active === false);
  if (losingOwner) {
    const owners = await prisma.user.count({ where: { businessId, role: "OWNER", active: true } });
    if (owners <= 1) throw badRequest("Debe quedar al menos una dueña activa");
  }
  if (body.groomerId) {
    if (!(await prisma.groomer.findFirst({ where: { id: body.groomerId, businessId } }))) throw notFound("Estilista");
    const taken = await prisma.user.findFirst({ where: { groomerId: body.groomerId, id: { not: u.id } } });
    if (taken) throw conflict("Esa estilista ya tiene otro usuario");
  }
  const { password, ...rest } = body;
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
  });
  if (password) await logActivity(prisma, businessId, "settings.user", `Contraseña restablecida para ${u.email}`, { userId: req.user!.id });
  const { passwordHash: _p, ...safe } = updated;
  res.json(safe);
});
