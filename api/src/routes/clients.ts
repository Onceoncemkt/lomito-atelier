import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { parse, notFound, conflict } from "../lib/errors.js";
import { allow, STAFF } from "../lib/auth.js";
import { normalizePhone } from "../lib/booking.js";
import { canUseCabin } from "../lib/cabin.js";
import { SIZES } from "./public.js";

export const clientsRouter = Router();
clientsRouter.use(allow(...STAFF));

clientsRouter.get("/clients", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const digits = q.replace(/\D/g, "");
  const businessId = req.user!.businessId;
  const clients = await prisma.client.findMany({
    where: {
      businessId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
              { pets: { some: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      pets: true,
      appointments: { where: { status: { in: ["BOOKED", "DONE"] } }, select: { startsAt: true, price: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(
    clients.map((c) => {
      const done = c.appointments.filter((a) => a.status === "DONE");
      const last = done.reduce<Date | null>((m, a) => (!m || a.startsAt > m ? a.startsAt : m), null);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        pets: c.pets.map((p) => ({ id: p.id, name: p.name, breed: p.breed, size: p.size })),
        visits: done.length,
        spent: done.reduce((t, a) => t + a.price, 0),
        lastVisit: last,
      };
    }),
  );
});

clientsRouter.get("/clients/:id", async (req, res) => {
  const c = await prisma.client.findFirst({
    where: { id: req.params.id, businessId: req.user!.businessId },
    include: {
      pets: true,
      appointments: {
        include: { service: true, groomer: true, pet: true },
        orderBy: { startsAt: "desc" },
        take: 50,
      },
    },
  });
  if (!c) throw notFound("Cliente");
  res.json({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    pets: c.pets.map((p) => ({ ...p, cabin: canUseCabin(p.breed, p.size, p.cabinOk) })),
    history: c.appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt,
      status: a.status,
      price: a.price,
      paid: !!a.paidAt,
      service: a.service.name,
      groomer: a.groomer.name,
      pet: a.pet.name,
    })),
  });
});

const clientBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string(),
  email: z.email().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

clientsRouter.post("/clients", async (req, res) => {
  const body = parse(clientBody, req.body);
  const businessId = req.user!.businessId;
  const phone = normalizePhone(body.phone);
  const exists = await prisma.client.findUnique({ where: { businessId_phone: { businessId, phone } } });
  if (exists) throw conflict("Ya existe un cliente con ese WhatsApp", { clientId: exists.id });
  const c = await prisma.client.create({ data: { ...body, phone, businessId } });
  res.status(201).json(c);
});

clientsRouter.patch("/clients/:id", async (req, res) => {
  const body = parse(clientBody.partial(), req.body);
  const businessId = req.user!.businessId;
  const c = await prisma.client.findFirst({ where: { id: req.params.id, businessId } });
  if (!c) throw notFound("Cliente");
  const phone = body.phone ? normalizePhone(body.phone) : undefined;
  if (phone && phone !== c.phone) {
    const other = await prisma.client.findUnique({ where: { businessId_phone: { businessId, phone } } });
    if (other) throw conflict("Ese WhatsApp ya es de otro cliente", { clientId: other.id });
  }
  res.json(await prisma.client.update({ where: { id: c.id }, data: { ...body, phone } }));
});

const petBody = z.object({
  name: z.string().trim().min(1).max(40),
  breed: z.string().trim().max(60).nullable().optional(),
  size: z.enum(SIZES),
  notes: z.string().trim().max(1000).nullable().optional(),
  cabinOk: z.boolean().nullable().optional(),
});

clientsRouter.post("/clients/:id/pets", async (req, res) => {
  const body = parse(petBody, req.body);
  const businessId = req.user!.businessId;
  const c = await prisma.client.findFirst({ where: { id: req.params.id, businessId } });
  if (!c) throw notFound("Cliente");
  res.status(201).json(await prisma.pet.create({ data: { ...body, businessId, clientId: c.id } }));
});

clientsRouter.patch("/pets/:id", async (req, res) => {
  const body = parse(petBody.partial(), req.body);
  const p = await prisma.pet.findFirst({ where: { id: req.params.id, businessId: req.user!.businessId } });
  if (!p) throw notFound("Lomito");
  res.json(await prisma.pet.update({ where: { id: p.id }, data: body }));
});
