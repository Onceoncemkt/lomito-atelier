import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma, type Size } from "../lib/db.js";
import { parse, conflict, badRequest } from "../lib/errors.js";
import { computeSlots, pickGroomer } from "../lib/availability.js";
import { openWindow, localDate, type OpeningHours, DATE_RE } from "../lib/time.js";
import { sendConfirmation } from "../lib/reminders.js";
import { businessBySlug, quote, busyBetween, lockDay, upsertClientPet, createAppointment } from "../lib/booking.js";

export const SIZES = ["CHICO", "MEDIANO", "GRANDE", "GIGANTE"] as const;
const MAX_DAYS_AHEAD = 60;

export const publicRouter = Router();

/** Datos del negocio y menú para la página de reservas. */
publicRouter.get("/:slug", async (req, res) => {
  const b = await businessBySlug(req.params.slug);
  const [services, addOns] = await Promise.all([
    prisma.service.findMany({
      where: { businessId: b.id, active: true },
      orderBy: { sortOrder: "asc" },
      include: { prices: true },
    }),
    prisma.addOn.findMany({ where: { businessId: b.id, active: true }, orderBy: { price: "desc" } }),
  ]);
  res.json({
    business: { slug: b.slug, name: b.name, timezone: b.timezone, phone: b.phone, openingHours: b.openingHours, minNoticeHours: b.minNoticeHours,
      legalName: b.legalName, address: b.address, contactEmail: b.contactEmail },
    services: services.map((s) => ({
      code: s.code,
      name: s.name,
      description: s.description,
      prices: Object.fromEntries(s.prices.map((p) => [p.size, { price: p.price, durationMin: p.durationMin }])),
    })),
    addOns: addOns.map((a) => ({ code: a.code, name: a.name, price: a.price, durationMin: a.durationMin })),
  });
});

const availQ = z.object({
  date: z.string().regex(DATE_RE),
  service: z.string().min(1),
  size: z.enum(SIZES),
  addOns: z.string().optional(),
});

async function slotsFor(slug: string, date: string, service: string, size: Size, addOnCodes: string[], now = new Date()) {
  const b = await businessBySlug(slug);
  const q = await quote(prisma, b.id, { code: service }, size, addOnCodes);
  const today = DateTime.now().setZone(b.timezone).startOf("day");
  const day = DateTime.fromISO(date, { zone: b.timezone });
  const win = openWindow(date, b.timezone, b.openingHours as OpeningHours);
  if (!win || day < today || day > today.plus({ days: MAX_DAYS_AHEAD })) return { b, q, slots: [] };
  const groomers = await prisma.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } });
  const busy = await busyBetween(prisma, b.id, win.open.toJSDate(), win.close.toJSDate());
  const slots = computeSlots({
    open: win.open,
    close: win.close,
    stepMin: b.slotMinutes,
    durationMin: q.durationMin,
    groomerIds: groomers.map((g) => g.id),
    busy,
    now,
  });
  return { b, q, slots };
}

publicRouter.get("/:slug/availability", async (req, res) => {
  const p = parse(availQ, req.query);
  const codes = p.addOns ? p.addOns.split(",").filter(Boolean) : [];
  const { q, slots } = await slotsFor(req.params.slug, p.date, p.service, p.size, codes);
  res.json({
    date: p.date,
    price: q.price,
    durationMin: q.durationMin,
    slots: slots.map((s) => ({ time: s.time, startsAt: s.startsAt })),
  });
});

const bookingBody = z.object({
  service: z.string().min(1),
  size: z.enum(SIZES),
  addOns: z.array(z.string()).max(10).default([]),
  startsAt: z.iso.datetime({ offset: true }),
  clientName: z.string().trim().min(2).max(80),
  phone: z.string().min(10).max(20),
  email: z.email().optional().nullable(),
  petName: z.string().trim().min(1).max(40),
  breed: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

publicRouter.post("/:slug/bookings", async (req, res) => {
  const body = parse(bookingBody, req.body);
  const b = await businessBySlug(req.params.slug);
  const startsAt = new Date(body.startsAt);
  const date = localDate(startsAt, b.timezone);

  const appt = await prisma.$transaction(async (tx) => {
    await lockDay(tx, b.id, date);
    const q = await quote(tx, b.id, { code: body.service }, body.size, body.addOns);
    const win = openWindow(date, b.timezone, b.openingHours as OpeningHours);
    const end = new Date(+startsAt + q.durationMin * 60_000);
    if (!win || startsAt < win.open.toJSDate() || end > win.close.toJSDate()) throw badRequest("Ese horario está fuera de servicio");
    if ((+startsAt - +win.open.toJSDate()) % (b.slotMinutes * 60_000) !== 0) throw badRequest("Horario inválido");
    if (+startsAt < Date.now() + 30 * 60_000) throw badRequest("Ese horario ya pasó");
    const groomers = await tx.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } });
    const busy = await busyBetween(tx, b.id, win.open.toJSDate(), win.close.toJSDate());
    const groomerId = pickGroomer(groomers.map((g) => g.id), busy, startsAt, end);
    if (!groomerId) throw conflict("Ese horario se acaba de ocupar, elige otro");

    const { client, pet } = await upsertClientPet(tx, b.id, {
      clientName: body.clientName,
      phone: body.phone,
      email: body.email,
      petName: body.petName,
      breed: body.breed,
      size: body.size,
    });
    return createAppointment(tx, {
      businessId: b.id,
      timezone: b.timezone,
      clientId: client.id,
      pet,
      groomerId,
      q,
      size: body.size,
      startsAt,
      durationMin: q.durationMin,
      source: "WEB",
      notes: body.notes,
    });
  });

  void sendConfirmation(appt.id).catch(() => {});
  res.status(201).json({
    id: appt.id,
    manageToken: appt.manageToken,
    startsAt: appt.startsAt,
    endsAt: appt.endsAt,
    service: appt.service.name,
    addOns: appt.addOns.map((a) => a.addOn.name),
    petName: appt.pet.name,
    groomer: appt.groomer.name,
    price: appt.price,
    drying: appt.useCabin ? "cabina" : "a mano",
  });
});

