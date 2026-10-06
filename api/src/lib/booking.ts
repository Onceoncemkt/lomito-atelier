import { prisma, type Tx, type Size, type Source } from "./db.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { canUseCabin } from "./cabin.js";
import { overlaps, type Busy } from "./availability.js";
import { localDate, localTime } from "./time.js";
import { logActivity, pesos } from "./activity.js";

type Db = Tx | typeof prisma;

export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  if (d.length !== 10) throw badRequest("El WhatsApp debe tener 10 dígitos");
  return d;
}

export async function businessBySlug(slug: string) {
  const b = await prisma.business.findUnique({ where: { slug } });
  if (!b) throw notFound("Negocio");
  return b;
}

/** Precio y duración de un servicio + extras para un tamaño. Busca por id o por código. */
export async function quote(
  db: Db,
  businessId: string,
  service: { id?: string; code?: string },
  size: Size,
  addOnKeys: string[] = [],
) {
  const svc = await db.service.findFirst({
    where: { businessId, active: true, ...(service.id ? { id: service.id } : { code: service.code }) },
    include: { prices: true },
  });
  if (!svc) throw notFound("Servicio");
  const row = svc.prices.find((p) => p.size === size);
  if (!row) throw badRequest(`${svc.name} no está disponible para tamaño ${size.toLowerCase()}`);
  const keys = [...new Set(addOnKeys)];
  const addOns = keys.length
    ? await db.addOn.findMany({
        where: { businessId, active: true, OR: [{ id: { in: keys } }, { code: { in: keys } }] },
      })
    : [];
  if (addOns.length !== keys.length) throw badRequest("Algún extra no existe");
  return {
    service: svc,
    addOns,
    price: row.price + addOns.reduce((t, a) => t + a.price, 0),
    durationMin: row.durationMin + addOns.reduce((t, a) => t + a.durationMin, 0),
  };
}

export async function busyBetween(db: Db, businessId: string, start: Date, end: Date, exceptId?: string): Promise<Busy[]> {
  const rows = await db.appointment.findMany({
    where: {
      businessId,
      status: { in: ["BOOKED", "DONE"] },
      startsAt: { lt: end },
      endsAt: { gt: start },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { groomerId: true, startsAt: true, endsAt: true },
  });
  return rows.map((r) => ({ groomerId: r.groomerId, start: r.startsAt, end: r.endsAt }));
}

/** Candado por negocio+día: dos reservas simultáneas no pueden tomar el mismo hueco. */
export async function lockDay(tx: Tx, businessId: string, date: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId + ":" + date}))`;
}

export async function assertGroomerFree(tx: Tx, businessId: string, groomerId: string, start: Date, end: Date, exceptId?: string) {
  const clash = await tx.appointment.findFirst({
    where: {
      businessId,
      groomerId,
      status: { in: ["BOOKED", "DONE"] },
      startsAt: { lt: end },
      endsAt: { gt: start },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    include: { pet: true, groomer: true },
  });
  if (clash && overlaps(start, end, clash.startsAt, clash.endsAt)) {
    throw conflict(`${clash.groomer.name} ya tiene a ${clash.pet.name} en ese horario`, {
      appointmentId: clash.id,
      startsAt: clash.startsAt,
      endsAt: clash.endsAt,
    });
  }
}

export type ClientPetInput = {
  clientName: string;
  phone: string;
  email?: string | null;
  petName: string;
  breed?: string | null;
  size: Size;
  petNotes?: string | null;
};

/** Busca al cliente por WhatsApp y al lomito por nombre; si no existen, los crea. */
export async function upsertClientPet(tx: Tx, businessId: string, input: ClientPetInput) {
  const phone = normalizePhone(input.phone);
  const client = await tx.client.upsert({
    where: { businessId_phone: { businessId, phone } },
    create: { businessId, phone, name: input.clientName.trim(), email: input.email ?? null },
    update: input.email ? { email: input.email } : {},
  });
  const existing = await tx.pet.findFirst({
    where: { businessId, clientId: client.id, name: { equals: input.petName.trim(), mode: "insensitive" } },
  });
  const pet = existing
    ? await tx.pet.update({
        where: { id: existing.id },
        data: { size: input.size, ...(input.breed ? { breed: input.breed.trim() } : {}) },
      })
    : await tx.pet.create({
        data: {
          businessId,
          clientId: client.id,
          name: input.petName.trim(),
          breed: input.breed?.trim() || null,
          size: input.size,
          notes: input.petNotes ?? null,
        },
      });
  return { client, pet };
}

export async function createAppointment(
  tx: Tx,
  args: {
    businessId: string;
    timezone: string;
    clientId: string;
    pet: { id: string; name: string; breed: string | null; cabinOk: boolean | null };
    groomerId: string;
    q: Awaited<ReturnType<typeof quote>>;
    size: Size;
    startsAt: Date;
    durationMin: number;
    source: Source;
    notes?: string | null;
    userId?: string | null;
  },
) {
  const endsAt = new Date(+args.startsAt + args.durationMin * 60_000);
  const appt = await tx.appointment.create({
    data: {
      businessId: args.businessId,
      clientId: args.clientId,
      petId: args.pet.id,
      groomerId: args.groomerId,
      serviceId: args.q.service.id,
      size: args.size,
      startsAt: args.startsAt,
      endsAt,
      source: args.source,
      price: args.q.price,
      useCabin: canUseCabin(args.pet.breed, args.size, args.pet.cabinOk),
      notes: args.notes ?? null,
      addOns: { create: args.q.addOns.map((a) => ({ addOnId: a.id, price: a.price })) },
    },
    include: { groomer: true, service: true, pet: true, client: true, addOns: { include: { addOn: true } } },
  });
  await logActivity(
    tx,
    args.businessId,
    "appointment.created",
    `Cita agendada · ${appt.pet.name} · ${appt.service.name} · ${localDate(args.startsAt, args.timezone)} ${localTime(
      args.startsAt,
      args.timezone,
    )} con ${appt.groomer.name} (${SOURCE_LABEL[args.source]}) · ${pesos(appt.price)}`,
    { userId: args.userId, meta: { appointmentId: appt.id } },
  );
  return appt;
}

export const SOURCE_LABEL: Record<Source, string> = {
  WEB: "página web",
  RECEPTION: "recepción",
  PHONE: "llamada",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
};
