import { Router, type RequestHandler } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { createHash, randomInt } from "node:crypto";
import { prisma } from "../lib/db.js";
import { parse, HttpError, badRequest, notFound } from "../lib/errors.js";
import { businessBySlug, normalizePhone } from "../lib/booking.js";
import { sendTemplate, templates, whatsappStatus, codeComponents } from "../lib/whatsapp.js";
import { saveCard } from "../lib/cards.js";
import { effectiveVaccineStatus, getPolicy } from "../lib/vaccines.js";

/** Cuenta del cliente ("Mi lomito"): entra con código por WhatsApp o con la liga de una cita. */
export const accountRouter = Router();

const secret = () => process.env.JWT_SECRET!;
const hash = (businessId: string, phone: string, code: string) => createHash("sha256").update(`${businessId}:${phone}:${code}:${secret()}`).digest("hex");
const CODE_MIN = 10;

function clientToken(businessId: string, clientId: string) {
  return jwt.sign({ kind: "client", businessId }, secret(), { subject: clientId, expiresIn: "30d" });
}

type ClientReq = { clientId: string; businessId: string };
const clientAuth: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw new HttpError(401, "Entra a tu cuenta");
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(h.slice(7), secret()) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, "Tu sesión venció, vuelve a entrar");
  }
  if (p.kind !== "client") throw new HttpError(401, "Entra a tu cuenta");
  const b = await businessBySlug(String(req.params.slug));
  if (b.id !== p.businessId) throw new HttpError(401, "Entra a tu cuenta");
  (req as unknown as { client: ClientReq }).client = { clientId: p.sub!, businessId: b.id };
  next();
};
const me = (req: unknown) => (req as { client: ClientReq }).client;

accountRouter.post("/:slug/account/code", async (req, res) => {
  const { phone: raw } = parse(z.object({ phone: z.string() }), req.body);
  const b = await businessBySlug(req.params.slug);
  if (!whatsappStatus().loginCodes) throw new HttpError(503, "Por ahora entra con la liga que te dimos al agendar tu cita");
  const phone = normalizePhone(raw);
  const recent = await prisma.clientLoginCode.count({ where: { businessId: b.id, phone, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (recent >= 3) throw new HttpError(429, "Ya te mandamos varios códigos. Espera unos minutos.");
  const client = await prisma.client.findUnique({ where: { businessId_phone: { businessId: b.id, phone } } });
  // misma respuesta exista o no, para no revelar quién es cliente
  if (client) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.clientLoginCode.create({ data: { businessId: b.id, phone, codeHash: hash(b.id, phone, code), expiresAt: new Date(Date.now() + CODE_MIN * 60_000) } });
    await sendTemplate({ to: phone, template: templates().code!, params: [code], components: codeComponents(code) });
  }
  res.json({ sent: true, minutes: CODE_MIN });
});

accountRouter.post("/:slug/account/verify", async (req, res) => {
  const body = parse(z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/, "El código tiene 6 números") }), req.body);
  const b = await businessBySlug(req.params.slug);
  const phone = normalizePhone(body.phone);
  const c = await prisma.clientLoginCode.findFirst({
    where: { businessId: b.id, phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!c || c.attempts >= 5) throw badRequest("El código venció. Pide uno nuevo.");
  if (c.codeHash !== hash(b.id, phone, body.code)) {
    await prisma.clientLoginCode.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
    throw badRequest("Código incorrecto");
  }
  await prisma.clientLoginCode.update({ where: { id: c.id }, data: { usedAt: new Date() } });
  const client = await prisma.client.findUniqueOrThrow({ where: { businessId_phone: { businessId: b.id, phone } } });
  res.json({ token: clientToken(b.id, client.id) });
});

/** La liga privada de una cita también abre la cuenta del cliente. */
accountRouter.post("/:slug/account/from-link", async (req, res) => {
  const { token } = parse(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }), req.body);
  const b = await businessBySlug(req.params.slug);
  const a = await prisma.appointment.findFirst({ where: { manageToken: token, businessId: b.id }, select: { clientId: true } });
  if (!a) throw notFound("Cita");
  res.json({ token: clientToken(b.id, a.clientId) });
});

accountRouter.get("/:slug/account", clientAuth, async (req, res) => {
  const { clientId, businessId } = me(req);
  const c = await prisma.client.findFirst({
    where: { id: clientId, businessId },
    include: {
      pets: { include: { vaccineCards: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, review: true, reviewNote: true } } }, orderBy: { createdAt: "asc" } },
      appointments: { include: { service: true, pet: true }, orderBy: { startsAt: "desc" }, take: 40 },
    },
  });
  if (!c) throw new HttpError(401, "Entra a tu cuenta");
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const now = new Date();
  const appt = (a: (typeof c.appointments)[number]) => ({
    startsAt: a.startsAt, status: a.status, service: a.service.name, pet: a.pet.name, price: a.price, manageToken: a.manageToken,
  });
  res.json({
    name: c.name,
    phone: c.phone,
    requiredVaccines: getPolicy(b.vaccinePolicy).filter((p) => p.required).map((p) => p.label),
    pets: c.pets.map((p) => ({
      id: p.id, name: p.name, breed: p.breed, size: p.size,
      vaccine: effectiveVaccineStatus(p, now),
      vaccineExpiresAt: p.vaccineExpiresAt,
      lastCard: p.vaccineCards[0] ? { uploadedAt: p.vaccineCards[0].createdAt, review: p.vaccineCards[0].review, note: p.vaccineCards[0].reviewNote } : null,
    })),
    upcoming: c.appointments.filter((a) => a.status === "BOOKED" && a.startsAt >= now).reverse().map(appt),
    past: c.appointments.filter((a) => !(a.status === "BOOKED" && a.startsAt >= now)).slice(0, 20).map(appt),
  });
});

accountRouter.post("/:slug/account/pets/:petId/card", clientAuth, async (req, res) => {
  const { dataUrl } = parse(z.object({ dataUrl: z.string().max(9_000_000) }), req.body);
  const { clientId, businessId } = me(req);
  const pet = await prisma.pet.findFirst({ where: { id: String(req.params.petId), businessId, clientId } });
  if (!pet) throw notFound("Lomito");
  const { card } = await saveCard({ businessId, petId: pet.id, dataUrl, uploadedBy: "CLIENT" });
  res.status(201).json({ id: card.id, uploadedAt: card.createdAt });
});
