import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { parse, badRequest } from "../lib/errors.js";
import { allow } from "../lib/auth.js";
import { dayBounds, localDate, DATE_RE } from "../lib/time.js";

/** Reportes del negocio (sólo dueña). Montos en centavos. */
export const reportsRouter = Router();
reportsRouter.use("/reports", allow("OWNER"));

const rangeQ = z.object({ from: z.string().regex(DATE_RE), to: z.string().regex(DATE_RE) });
const WINBACK_DAYS = 60;

async function salesTotal(businessId: string, start: Date, end: Date) {
  const r = await prisma.sale.aggregate({ where: { businessId, createdAt: { gte: start, lt: end } }, _sum: { total: true }, _count: true });
  return { total: r._sum.total ?? 0, tickets: r._count };
}

reportsRouter.get("/reports", async (req, res) => {
  const { from, to } = parse(rangeQ, req.query);
  const b = await prisma.business.findUniqueOrThrow({ where: { id: req.user!.businessId } });
  const tz = b.timezone;
  const start = dayBounds(from, tz).start;
  const end = dayBounds(to, tz).end;
  if (end <= start) throw badRequest("Rango de fechas inválido");
  const days = Math.round((+end - +start) / 86400_000);
  if (days > 400) throw badRequest("Elige un rango de máximo un año");

  const [sales, appts, prev] = await Promise.all([
    prisma.sale.findMany({ where: { businessId: b.id, createdAt: { gte: start, lt: end } }, include: { items: true } }),
    prisma.appointment.findMany({
      where: { businessId: b.id, startsAt: { gte: start, lt: end } },
      select: { id: true, status: true, source: true, price: true, startsAt: true, clientId: true, service: { select: { name: true } } },
    }),
    salesTotal(b.id, new Date(+start - (+end - +start)), start),
  ]);

  // --- ventas
  const byDayMap = new Map<string, { services: number; products: number }>();
  for (let d = DateTime.fromISO(from, { zone: tz }); d.toISODate()! <= to; d = d.plus({ days: 1 })) byDayMap.set(d.toISODate()!, { services: 0, products: 0 });
  const byMethod = { CASH: 0, CARD: 0, TRANSFER: 0 };
  const products = new Map<string, { qty: number; revenue: number }>();
  let services = 0;
  let productsTotal = 0;
  for (const s of sales) {
    byMethod[s.method] += s.total;
    const day = byDayMap.get(localDate(s.createdAt, tz));
    for (const i of s.items) {
      const amt = i.qty * i.unitPrice;
      if (i.kind === "SERVICE") {
        services += amt;
        if (day) day.services += amt;
      } else {
        productsTotal += amt;
        if (day) day.products += amt;
        const p = products.get(i.name) ?? { qty: 0, revenue: 0 };
        p.qty += i.qty;
        p.revenue += amt;
        products.set(i.name, p);
      }
    }
  }
  const total = services + productsTotal;

  // --- citas
  const status = { BOOKED: 0, DONE: 0, CANCELLED: 0, NO_SHOW: 0 };
  const bySource: Record<string, number> = {};
  const svc = new Map<string, { count: number; revenue: number }>();
  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of appts) {
    status[a.status]++;
    if (a.status === "CANCELLED") continue;
    bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    const dt = DateTime.fromJSDate(a.startsAt, { zone: tz });
    heat[dt.weekday - 1][dt.hour]++;
    if (a.status === "DONE") {
      const v = svc.get(a.service.name) ?? { count: 0, revenue: 0 };
      v.count++;
      v.revenue += a.price;
      svc.set(a.service.name, v);
    }
  }
  const attended = status.DONE;
  const scheduled = status.DONE + status.NO_SHOW;

  // --- clientes nuevos vs. que regresan (entre los atendidos en el rango)
  const doneClientIds = [...new Set(appts.filter((a) => a.status === "DONE").map((a) => a.clientId))];
  const before = doneClientIds.length
    ? await prisma.appointment.groupBy({
        by: ["clientId"],
        where: { businessId: b.id, clientId: { in: doneClientIds }, status: "DONE", startsAt: { lt: start } },
      })
    : [];
  const returning = before.length;

  // --- clientes por recuperar: última visita hace más de 60 días y sin cita próxima
  const cutoff = new Date(Date.now() - WINBACK_DAYS * 86400_000);
  const lastVisits = await prisma.appointment.groupBy({
    by: ["clientId"],
    where: { businessId: b.id, status: "DONE" },
    _max: { startsAt: true },
    _count: { _all: true },
  });
  const stale = lastVisits.filter((v) => v._max.startsAt && v._max.startsAt < cutoff);
  const upcoming = stale.length
    ? await prisma.appointment.findMany({
        where: { businessId: b.id, clientId: { in: stale.map((s) => s.clientId) }, status: "BOOKED", startsAt: { gte: new Date() } },
        select: { clientId: true },
      })
    : [];
  const hasNext = new Set(upcoming.map((u) => u.clientId));
  const winIds = stale.filter((s) => !hasNext.has(s.clientId)).sort((a, z) => +a._max.startsAt! - +z._max.startsAt!).slice(0, 50);
  const winClients = winIds.length
    ? await prisma.client.findMany({ where: { id: { in: winIds.map((w) => w.clientId) } }, include: { pets: { select: { name: true } } } })
    : [];
  const winback = winIds.map((w) => {
    const c = winClients.find((x) => x.id === w.clientId)!;
    return {
      clientId: c.id,
      name: c.name,
      phone: c.phone,
      pets: c.pets.map((p) => p.name),
      lastVisit: localDate(w._max.startsAt!, tz),
      daysAgo: Math.floor((Date.now() - +w._max.startsAt!) / 86400_000),
      visits: w._count._all,
    };
  });

  res.json({
    from,
    to,
    sales: {
      total,
      services,
      products: productsTotal,
      tickets: sales.length,
      avgTicket: sales.length ? Math.round(total / sales.length / 100) * 100 : 0,
      byMethod,
      prevTotal: prev.total,
      byDay: [...byDayMap].map(([date, v]) => ({ date, ...v })),
    },
    appointments: {
      ...status,
      noShowRate: scheduled ? status.NO_SHOW / scheduled : 0,
      cancelRate: appts.length ? status.CANCELLED / appts.length : 0,
      bySource,
      heat,
    },
    clients: { attended: doneClientIds.length, returning, new: doneClientIds.length - returning, dogs: attended },
    topServices: [...svc].map(([name, v]) => ({ name, ...v })).sort((a, z) => z.revenue - a.revenue),
    topProducts: [...products].map(([name, v]) => ({ name, ...v })).sort((a, z) => z.revenue - a.revenue).slice(0, 10),
    winback,
    winbackDays: WINBACK_DAYS,
  });
});
