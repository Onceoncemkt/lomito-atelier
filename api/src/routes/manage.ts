import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { parse, notFound, badRequest, conflict } from "../lib/errors.js";
import { computeSlots, pickGroomer, overlaps } from "../lib/availability.js";
import { openWindow, localDate, localTime, DATE_RE, type OpeningHours } from "../lib/time.js";
import { busyBetween, lockDay } from "../lib/booking.js";
import { logActivity } from "../lib/activity.js";

/** Liga privada del cliente: ver, cambiar o cancelar su cita. */
export const manageRouter = Router();

const HOUR = 3600_000;

async function load(slug: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound("Cita");
  const a = await prisma.appointment.findFirst({
    where: { manageToken: token, business: { slug } },
    include: { business: true, pet: true, client: true, service: true, addOns: { include: { addOn: true } } },
  });
  if (!a) throw notFound("Cita");
  return a;
}

type Loaded = Awaited<ReturnType<typeof load>>;

function changeState(a: Loaded, now = new Date()) {
  if (a.status === "CANCELLED") return { canChange: false, reason: "Esta cita ya está cancelada." };
  if (a.status !== "BOOKED") return { canChange: false, reason: "Esta cita ya pasó." };
  if (+a.startsAt - +now < a.business.minNoticeHours * HOUR) {
    return { canChange: false, reason: `Faltan menos de ${a.business.minNoticeHours} horas para tu cita. Para cambiarla, escríbenos por WhatsApp.` };
  }
  return { canChange: true, reason: null as string | null };
}

function dto(a: Loaded) {
  return {
    business: {
      name: a.business.name,
      phone: a.business.phone,
      minNoticeHours: a.business.minNoticeHours,
      openingHours: a.business.openingHours,
      timezone: a.business.timezone,
    },
    appointment: {
      status: a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      petName: a.pet.name,
      clientName: a.client.name.split(" ")[0],
      service: a.service.name,
      size: a.size,
      addOns: a.addOns.map((x) => x.addOn.name),
      price: a.price,
      drying: a.useCabin ? "cabina" : "a mano",
    },
    ...changeState(a),
  };
}

manageRouter.get("/:slug/manage/:token", async (req, res) => {
  res.json(dto(await load(req.params.slug, req.params.token)));
});

manageRouter.get("/:slug/manage/:token/availability", async (req, res) => {
  const { date } = parse(z.object({ date: z.string().regex(DATE_RE) }), req.query);
  const a = await load(req.params.slug, req.params.token);
  const st = changeState(a);
  if (!st.canChange) throw badRequest(st.reason!);
  const b = a.business;
  const today = DateTime.now().setZone(b.timezone).startOf("day");
  const day = DateTime.fromISO(date, { zone: b.timezone });
  const win = openWindow(date, b.timezone, b.openingHours as OpeningHours);
  if (!win || day < today || day > today.plus({ days: 60 })) {
    res.json({ date, slots: [] });
    return;
  }
  const durationMin = (+a.endsAt - +a.startsAt) / 60_000;
  const groomers = await prisma.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } });
  const busy = await busyBetween(prisma, b.id, win.open.toJSDate(), win.close.toJSDate(), a.id);
  const slots = computeSlots({
    open: win.open,
    close: win.close,
    stepMin: b.slotMinutes,
    durationMin,
    groomerIds: groomers.map((g) => g.id),
    busy,
    now: new Date(),
    leadMin: Math.max(30, b.minNoticeHours * 60),
  });
  res.json({
    date,
    slots: slots.map((s) => ({ time: s.time, startsAt: s.startsAt, current: +new Date(s.startsAt) === +a.startsAt })),
  });
});

manageRouter.post("/:slug/manage/:token/cancel", async (req, res) => {
  const a = await load(req.params.slug, req.params.token);
  const st = changeState(a);
  if (!st.canChange) throw badRequest(st.reason!);
  const r = await prisma.appointment.updateMany({ where: { id: a.id, status: "BOOKED" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) throw conflict("La cita ya no se puede cancelar");
  await logActivity(
    prisma,
    a.businessId,
    "appointment.cancelled_by_client",
    `El cliente canceló en línea · ${a.pet.name} · ${localDate(a.startsAt, a.business.timezone)} ${localTime(a.startsAt, a.business.timezone)}`,
    { meta: { appointmentId: a.id } },
  );
  res.json(dto(await load(req.params.slug, req.params.token)));
});

manageRouter.post("/:slug/manage/:token/reschedule", async (req, res) => {
  const { startsAt: iso } = parse(z.object({ startsAt: z.iso.datetime({ offset: true }) }), req.body);
  const a = await load(req.params.slug, req.params.token);
  const st = changeState(a);
  if (!st.canChange) throw badRequest(st.reason!);
  const b = a.business;
  const startsAt = new Date(iso);
  const durationMin = (+a.endsAt - +a.startsAt) / 60_000;
  const endsAt = new Date(+startsAt + durationMin * 60_000);
  if (+startsAt === +a.startsAt) throw badRequest("Es la misma hora que ya tienes");
  if (+startsAt - Date.now() < Math.max(0.5, b.minNoticeHours) * HOUR) {
    throw badRequest(`Elige un horario con al menos ${b.minNoticeHours} horas de anticipación`);
  }
  const newDate = localDate(startsAt, b.timezone);
  const oldDate = localDate(a.startsAt, b.timezone);
  const win = openWindow(newDate, b.timezone, b.openingHours as OpeningHours);
  if (!win || startsAt < win.open.toJSDate() || endsAt > win.close.toJSDate()) throw badRequest("Ese horario está fuera de servicio");
  if ((+startsAt - +win.open.toJSDate()) % (b.slotMinutes * 60_000) !== 0) throw badRequest("Horario inválido");

  await prisma.$transaction(async (tx) => {
    // candados en orden para no bloquearse entre dos reservas
    for (const d of [...new Set([oldDate, newDate])].sort()) await lockDay(tx, b.id, d);
    const groomers = await tx.groomer.findMany({ where: { businessId: b.id, active: true }, orderBy: { createdAt: "asc" } });
    const busy = await busyBetween(tx, b.id, win.open.toJSDate(), win.close.toJSDate(), a.id);
    const keep = groomers.some((g) => g.id === a.groomerId) && !busy.some((x) => x.groomerId === a.groomerId && overlaps(startsAt, endsAt, x.start, x.end));
    const groomerId = keep ? a.groomerId : pickGroomer(groomers.map((g) => g.id), busy, startsAt, endsAt);
    if (!groomerId) throw conflict("Ese horario se acaba de ocupar, elige otro");
    const r = await tx.appointment.updateMany({
      where: { id: a.id, status: "BOOKED", startsAt: a.startsAt },
      data: { startsAt, endsAt, groomerId, reminderSentAt: null },
    });
    if (r.count !== 1) throw conflict("La cita cambió mientras tanto; recarga la página");
    await logActivity(
      tx,
      b.id,
      "appointment.rescheduled_by_client",
      `El cliente cambió su cita en línea · ${a.pet.name} · de ${oldDate} ${localTime(a.startsAt, b.timezone)} a ${newDate} ${localTime(startsAt, b.timezone)}`,
      { meta: { appointmentId: a.id } },
    );
  });
  res.json(dto(await load(req.params.slug, req.params.token)));
});
