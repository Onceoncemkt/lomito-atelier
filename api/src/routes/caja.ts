import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { parse, badRequest, conflict, notFound } from "../lib/errors.js";
import { allow, STAFF } from "../lib/auth.js";
import { dayBounds, parseDay, localTime } from "../lib/time.js";
import { logActivity, pesos } from "../lib/activity.js";

export const cajaRouter = Router();
cajaRouter.use(allow(...STAFF));

const METHOD_LABEL = { CASH: "efectivo", CARD: "tarjeta", TRANSFER: "transferencia" } as const;

const saleBody = z.object({
  items: z
    .array(
      z.union([
        z.object({ appointmentId: z.string() }),
        z.object({ productId: z.string(), qty: z.number().int().min(1).max(99).default(1) }),
      ]),
    )
    .min(1),
  method: z.enum(["CASH", "CARD", "TRANSFER"]),
  received: z.number().int().min(0).optional(),
  clientId: z.string().optional(),
});

cajaRouter.post("/sales", async (req, res) => {
  const body = parse(saleBody, req.body);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const today = DateTime.now().setZone(b.timezone).toISODate()!;
  const closed = await prisma.cashClosing.findUnique({ where: { businessId_date: { businessId: b.id, date: today } } });
  if (closed) throw conflict("La caja de hoy ya se cerró");

  const sale = await prisma.$transaction(async (tx) => {
    const items: { kind: "SERVICE" | "PRODUCT"; name: string; qty: number; unitPrice: number; appointmentId?: string; productId?: string }[] = [];
    let clientId = body.clientId ?? null;
    const now = new Date();
    for (const it of body.items) {
      if ("appointmentId" in it) {
        const a = await tx.appointment.findFirst({
          where: { id: it.appointmentId, businessId: b.id },
          include: { pet: true, service: true },
        });
        if (!a) throw notFound("Cita");
        if (a.status === "CANCELLED" || a.status === "NO_SHOW") throw badRequest(`La cita de ${a.pet.name} está cancelada`);
        const r = await tx.appointment.updateMany({
          where: { id: a.id, paidAt: null },
          data: { paidAt: now, ...(a.status === "BOOKED" ? { status: "DONE" } : {}) },
        });
        if (r.count !== 1) throw conflict(`La cita de ${a.pet.name} ya estaba cobrada`);
        clientId ??= a.clientId;
        items.push({ kind: "SERVICE", name: `${a.pet.name} · ${a.service.name}`, qty: 1, unitPrice: a.price, appointmentId: a.id });
      } else {
        const p = await tx.product.findFirst({ where: { id: it.productId, businessId: b.id, active: true } });
        if (!p) throw notFound("Producto");
        const r = await tx.product.updateMany({
          where: { id: p.id, stock: { gte: it.qty } },
          data: { stock: { decrement: it.qty } },
        });
        if (r.count !== 1) throw conflict(`No hay suficiente ${p.name} (quedan ${p.stock})`);
        items.push({ kind: "PRODUCT", name: p.name, qty: it.qty, unitPrice: p.price, productId: p.id });
      }
    }
    const total = items.reduce((t, i) => t + i.qty * i.unitPrice, 0);
    if (body.method === "CASH" && body.received !== undefined && body.received < total) {
      throw badRequest("El efectivo recibido no alcanza");
    }
    const s = await tx.sale.create({
      data: {
        businessId: b.id,
        clientId,
        method: body.method,
        total,
        received: body.method === "CASH" ? body.received ?? null : null,
        userId: u.id,
        items: { create: items },
      },
      include: { items: true },
    });
    await logActivity(
      tx,
      b.id,
      "sale.created",
      `Cobro de ${pesos(total)} en ${METHOD_LABEL[body.method]} · ${items.map((i) => (i.qty > 1 ? `${i.qty}× ` : "") + i.name).join(", ")}`,
      { userId: u.id, meta: { saleId: s.id } },
    );
    return s;
  });
  res.status(201).json({ ...sale, change: sale.received != null ? sale.received - sale.total : null });
});

async function cashSummary(businessId: string, tz: string, date: string, openingFloat?: number) {
  const { start, end } = dayBounds(date, tz);
  const [sales, closing, pending, logs] = await Promise.all([
    prisma.sale.findMany({
      where: { businessId, createdAt: { gte: start, lt: end } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cashClosing.findUnique({ where: { businessId_date: { businessId, date } } }),
    prisma.appointment.findMany({
      where: { businessId, startsAt: { gte: start, lt: end }, paidAt: null, status: { in: ["BOOKED", "DONE"] } },
      include: { pet: true, service: true, client: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.activityLog.findMany({ where: { businessId, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" } }),
  ]);
  const byMethod = { CASH: 0, CARD: 0, TRANSFER: 0 };
  let services = 0;
  let products = 0;
  for (const s of sales) {
    byMethod[s.method] += s.total;
    for (const i of s.items) (i.kind === "SERVICE" ? (services += i.qty * i.unitPrice) : (products += i.qty * i.unitPrice));
  }
  const total = byMethod.CASH + byMethod.CARD + byMethod.TRANSFER;
  const float = closing?.openingFloat ?? openingFloat ?? 0;
  return {
    date,
    total,
    tickets: sales.length,
    services,
    products,
    byMethod,
    openingFloat: float,
    expectedCash: float + byMethod.CASH,
    closing,
    sales: sales.map((s) => ({
      id: s.id,
      time: localTime(s.createdAt, tz),
      method: s.method,
      total: s.total,
      items: s.items.map((i) => ({ kind: i.kind, name: i.name, qty: i.qty, unitPrice: i.unitPrice })),
    })),
    pending: pending.map((a) => ({
      id: a.id,
      time: localTime(a.startsAt, tz),
      pet: a.pet.name,
      client: a.client.name,
      service: a.service.name,
      price: a.price,
      status: a.status,
    })),
    activity: logs.map((l) => ({ time: localTime(l.createdAt, tz), type: l.type, message: l.message })),
  };
}

const floatQ = z.object({ openingFloat: z.coerce.number().int().min(0).optional() });

cajaRouter.get("/cash/:date", async (req, res) => {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: req.user!.businessId } });
  parseDay(req.params.date, b.timezone);
  const { openingFloat } = parse(floatQ, req.query);
  res.json(await cashSummary(b.id, b.timezone, req.params.date, openingFloat));
});

const closeBody = z.object({
  openingFloat: z.number().int().min(0),
  countedCash: z.number().int().min(0),
  notes: z.string().trim().max(500).nullable().optional(),
});

cajaRouter.post("/cash/:date/close", async (req, res) => {
  const body = parse(closeBody, req.body);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const day = parseDay(req.params.date, b.timezone);
  if (day > DateTime.now().setZone(b.timezone).startOf("day")) throw badRequest("No puedes cerrar un día que no ha pasado");
  const date = req.params.date;
  const sum = await cashSummary(b.id, b.timezone, date, body.openingFloat);
  if (sum.closing) throw conflict("Ese día ya tiene corte de caja");
  const expectedCash = body.openingFloat + sum.byMethod.CASH;
  const closing = await prisma.$transaction(async (tx) => {
    const c = await tx.cashClosing.create({
      data: {
        businessId: b.id,
        date,
        openingFloat: body.openingFloat,
        expectedCash,
        countedCash: body.countedCash,
        difference: body.countedCash - expectedCash,
        totalSales: sum.total,
        notes: body.notes ?? null,
        userId: u.id,
      },
    });
    const diff = c.difference;
    await logActivity(
      tx,
      b.id,
      "cash.closed",
      `Corte de caja · vendido ${pesos(sum.total)} · efectivo esperado ${pesos(expectedCash)}, contado ${pesos(body.countedCash)}${
        diff === 0 ? " · cuadra" : ` · diferencia ${diff > 0 ? "+" : "−"}${pesos(Math.abs(diff))}`
      }`,
      { userId: u.id },
    );
    return c;
  });
  res.status(201).json(closing);
});
