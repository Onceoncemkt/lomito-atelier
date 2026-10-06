import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../lib/db.js";
import { parse, badRequest, notFound, conflict, forbidden } from "../lib/errors.js";
import { allow, STAFF } from "../lib/auth.js";
import { dayBounds, openWindow, localDate, localTime, DATE_RE, type OpeningHours } from "../lib/time.js";
import { pickGroomer } from "../lib/availability.js";
import { canUseCabin } from "../lib/cabin.js";
import { pesos } from "../lib/activity.js";
import { quote, busyBetween, lockDay, upsertClientPet, createAppointment, assertGroomerFree } from "../lib/booking.js";
import { logActivity } from "../lib/activity.js";
import { SIZES } from "./public.js";

export const agendaRouter = Router();

const include = {
  groomer: true,
  service: true,
  pet: true,
  client: true,
  addOns: { include: { addOn: true } },
} as const;

type ApptFull = Prisma.AppointmentGetPayload<{ include: typeof include }>;

export function apptDto(a: ApptFull, visits?: number) {
  return {
    id: a.id,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    source: a.source,
    price: a.price,
    paid: !!a.paidAt,
    paidAt: a.paidAt,
    useCabin: a.useCabin,
    notes: a.notes,
    size: a.size,
    groomer: { id: a.groomer.id, name: a.groomer.name },
    service: { id: a.service.id, name: a.service.name },
    addOns: a.addOns.map((x) => ({ id: x.addOnId, name: x.addOn.name, price: x.price })),
    pet: { id: a.pet.id, name: a.pet.name, breed: a.pet.breed, notes: a.pet.notes },
    client: { id: a.client.id, name: a.client.name, phone: a.client.phone },
    visits,
  };
}

const dayQ = z.object({ date: z.string().regex(DATE_RE) });

agendaRouter.get("/agenda", async (req, res) => {
  const { date } = parse(dayQ, req.query);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const { start, end } = dayBounds(date, b.timezone);
  const [groomers, appts] = await Promise.all([
    prisma.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.appointment.findMany({
      where: {
        businessId: b.id,
        startsAt: { gte: start, lt: end },
        ...(u.role === "GROOMER" ? { groomerId: u.groomerId ?? "-" } : {}),
      },
      include,
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const petIds = [...new Set(appts.map((a) => a.petId))];
  const counts = petIds.length
    ? await prisma.appointment.groupBy({
        by: ["petId"],
        where: { businessId: b.id, petId: { in: petIds }, status: { in: ["BOOKED", "DONE"] }, startsAt: { lt: end } },
        _count: { _all: true },
      })
    : [];
  const visits = new Map(counts.map((c) => [c.petId, c._count._all]));
  const win = openWindow(date, b.timezone, b.openingHours as OpeningHours);
  res.json({
    date,
    open: win ? win.open.toFormat("HH:mm") : null,
    close: win ? win.close.toFormat("HH:mm") : null,
    groomers: groomers.map((g) => ({ id: g.id, name: g.name })),
    appointments: appts.map((a) => apptDto(a, visits.get(a.petId))),
  });
});

agendaRouter.get("/appointments/:id", async (req, res) => {
  const a = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.user!.businessId }, include });
  if (!a) throw notFound("Cita");
  res.json(apptDto(a));
});

const newAppt = z
  .object({
    clientId: z.string().optional(),
    petId: z.string().optional(),
    client: z.object({ name: z.string().trim().min(2), phone: z.string(), email: z.email().optional().nullable() }).optional(),
    pet: z
      .object({
        name: z.string().trim().min(1),
        breed: z.string().trim().optional().nullable(),
        size: z.enum(SIZES),
        notes: z.string().trim().optional().nullable(),
      })
      .optional(),
    serviceId: z.string(),
    size: z.enum(SIZES).optional(),
    addOnIds: z.array(z.string()).default([]),
    groomerId: z.string().optional(),
    startsAt: z.iso.datetime({ offset: true }),
    durationMin: z.number().int().min(15).max(480).optional(),
    source: z.enum(["RECEPTION", "PHONE", "WHATSAPP", "INSTAGRAM"]).default("RECEPTION"),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.petId || (v.client && v.pet), { message: "Elige un lomito o captura cliente y lomito nuevos" });

agendaRouter.post("/appointments", allow(...STAFF), async (req, res) => {
  const body = parse(newAppt, req.body);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const startsAt = new Date(body.startsAt);
  const date = localDate(startsAt, b.timezone);

  const appt = await prisma.$transaction(async (tx) => {
    await lockDay(tx, b.id, date);
    let clientId: string;
    let pet;
    if (body.petId) {
      pet = await tx.pet.findFirst({ where: { id: body.petId, businessId: b.id } });
      if (!pet) throw notFound("Lomito");
      clientId = pet.clientId;
    } else {
      const r = await upsertClientPet(tx, b.id, {
        clientName: body.client!.name,
        phone: body.client!.phone,
        email: body.client!.email,
        petName: body.pet!.name,
        breed: body.pet!.breed,
        size: body.pet!.size,
        petNotes: body.pet!.notes,
      });
      clientId = r.client.id;
      pet = r.pet;
    }
    const size = body.size ?? pet.size;
    const q = await quote(tx, b.id, { id: body.serviceId }, size, body.addOnIds);
    const durationMin = body.durationMin ?? q.durationMin;
    const end = new Date(+startsAt + durationMin * 60_000);
    let groomerId = body.groomerId;
    if (groomerId) {
      const g = await tx.groomer.findFirst({ where: { id: groomerId, businessId: b.id, active: true } });
      if (!g) throw notFound("Groomer");
      await assertGroomerFree(tx, b.id, groomerId, startsAt, end);
    } else {
      const groomers = await tx.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } });
      const { start, end: dayEnd } = dayBounds(date, b.timezone);
      const busy = await busyBetween(tx, b.id, start, dayEnd);
      groomerId = pickGroomer(groomers.map((g) => g.id), busy, startsAt, end) ?? undefined;
      if (!groomerId) throw conflict("No hay groomer libre a esa hora");
    }
    return createAppointment(tx, {
      businessId: b.id,
      timezone: b.timezone,
      clientId,
      pet,
      groomerId,
      q,
      size,
      startsAt,
      durationMin,
      source: body.source,
      notes: body.notes,
      userId: u.id,
    });
  });
  res.status(201).json(apptDto(appt));
});

const patchAppt = z.object({
  status: z.enum(["BOOKED", "DONE", "CANCELLED", "NO_SHOW"]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  groomerId: z.string().optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  durationMin: z.number().int().min(15).max(480).optional(),
  useCabin: z.boolean().optional(),
  /** Tamaño real al llegar: recalcula precio y duración, y corrige la ficha del lomito. */
  size: z.enum(SIZES).optional(),
});

const STATUS_LABEL = { BOOKED: "agendada", DONE: "terminada", CANCELLED: "cancelada", NO_SHOW: "no llegó" } as const;

agendaRouter.patch("/appointments/:id", async (req, res) => {
  const body = parse(patchAppt, req.body);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const current = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: b.id }, include });
  if (!current) throw notFound("Cita");
  if (u.role === "GROOMER") {
    const onlyStatus = Object.keys(body).every((k) => k === "status" || k === "notes");
    if (current.groomerId !== u.groomerId || !onlyStatus) throw forbidden();
  }
  if (current.paidAt && (body.status === "CANCELLED" || body.status === "NO_SHOW")) {
    throw badRequest("Esta cita ya se cobró; no se puede cancelar");
  }
  const resizing = !!body.size && body.size !== current.size;
  if (resizing && current.paidAt) throw badRequest("Esta cita ya se cobró; no se puede cambiar el tamaño");

  const updated = await prisma.$transaction(async (tx) => {
    const q = resizing
      ? await quote(tx, b.id, { id: current.serviceId }, body.size!, current.addOns.map((x) => x.addOnId))
      : null;
    const moving = body.startsAt || body.groomerId || body.durationMin || resizing;
    const startsAt = body.startsAt ? new Date(body.startsAt) : current.startsAt;
    const dur = body.durationMin ?? q?.durationMin ?? (+current.endsAt - +current.startsAt) / 60_000;
    const endsAt = new Date(+startsAt + dur * 60_000);
    const groomerId = body.groomerId ?? current.groomerId;
    if (moving) {
      await lockDay(tx, b.id, localDate(startsAt, b.timezone));
      const g = await tx.groomer.findFirst({ where: { id: groomerId, businessId: b.id } });
      if (!g) throw notFound("Groomer");
      await assertGroomerFree(tx, b.id, groomerId, startsAt, endsAt, current.id);
    }
    const a = await tx.appointment.update({
      where: { id: current.id },
      data: {
        status: body.status,
        notes: body.notes,
        useCabin: body.useCabin ?? (resizing ? canUseCabin(current.pet.breed, body.size!, current.pet.cabinOk) : undefined),
        ...(moving ? { startsAt, endsAt, groomerId } : {}),
        ...(resizing ? { size: body.size, price: q!.price } : {}),
      },
      include,
    });
    if (resizing) await tx.pet.update({ where: { id: current.petId }, data: { size: body.size } });
    const msgs: string[] = [];
    if (body.status && body.status !== current.status) msgs.push(`marcada como ${STATUS_LABEL[body.status]}`);
    if (resizing) msgs.push(`cambió a tamaño ${body.size!.toLowerCase()} (${pesos(current.price)} → ${pesos(a.price)})`);
    if (moving && !resizing) msgs.push(`movida a ${localDate(startsAt, b.timezone)} ${localTime(startsAt, b.timezone)} con ${a.groomer.name}`);
    if (msgs.length) {
      await logActivity(tx, b.id, "appointment.updated", `Cita de ${a.pet.name} ${msgs.join(", ")}`, {
        userId: u.id,
        meta: { appointmentId: a.id },
      });
    }
    return a;
  });
  res.json(apptDto(updated));
});
