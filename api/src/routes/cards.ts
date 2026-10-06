import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma } from "../lib/db.js";
import { parse, notFound, badRequest } from "../lib/errors.js";
import { allow, STAFF } from "../lib/auth.js";
import { saveCard } from "../lib/cards.js";
import { analyzeCard, aiConfigured } from "../lib/vaccineAI.js";
import { logActivity } from "../lib/activity.js";
import { DATE_RE } from "../lib/time.js";

/** Revisión de cartillas por el equipo. */
export const cardsRouter = Router();
cardsRouter.use(["/vaccine-cards", "/pets/:id/vaccine-card"], allow(...STAFF));

cardsRouter.get("/vaccine-cards", async (req, res) => {
  const status = String(req.query.status ?? "PENDING");
  const businessId = req.user!.businessId;
  const cards = await prisma.vaccineCard.findMany({
    where: { businessId, ...(status === "PENDING" ? { review: "PENDING" } : {}) },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 60,
    select: {
      id: true, mimeType: true, uploadedBy: true, aiStatus: true, aiSuggestion: true, aiSummary: true, aiResult: true,
      review: true, reviewNote: true, reviewedAt: true, expiresAt: true, createdAt: true,
      pet: { select: { id: true, name: true, breed: true, size: true, client: { select: { id: true, name: true, phone: true } } } },
    },
  });
  const pending = await prisma.vaccineCard.count({ where: { businessId, review: "PENDING" } });
  res.json({ pending, ai: aiConfigured(), cards });
});

cardsRouter.get("/vaccine-cards/:id/file", async (req, res) => {
  const c = await prisma.vaccineCard.findFirst({ where: { id: String(req.params.id), businessId: req.user!.businessId }, select: { data: true, mimeType: true } });
  if (!c) throw notFound("Cartilla");
  res.setHeader("Content-Type", c.mimeType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(Buffer.from(c.data));
});

cardsRouter.post("/pets/:id/vaccine-card", async (req, res) => {
  const { dataUrl } = parse(z.object({ dataUrl: z.string().max(9_000_000) }), req.body);
  const pet = await prisma.pet.findFirst({ where: { id: String(req.params.id), businessId: req.user!.businessId } });
  if (!pet) throw notFound("Lomito");
  const { card } = await saveCard({ businessId: pet.businessId, petId: pet.id, dataUrl, uploadedBy: "STAFF", userId: req.user!.id });
  res.status(201).json(card);
});

cardsRouter.post("/vaccine-cards/:id/analyze", async (req, res) => {
  const c = await prisma.vaccineCard.findFirst({ where: { id: String(req.params.id), businessId: req.user!.businessId } });
  if (!c) throw notFound("Cartilla");
  await prisma.vaccineCard.update({ where: { id: c.id }, data: { aiStatus: "PENDING" } });
  await analyzeCard(c.id);
  res.json({ ok: true });
});

const decisionBody = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(300).nullable().optional(),
  /** vigencia final (AAAA-MM-DD); si no viene se usa la que calculó la IA */
  expiresOn: z.string().regex(DATE_RE).nullable().optional(),
});

cardsRouter.patch("/vaccine-cards/:id", async (req, res) => {
  const body = parse(decisionBody, req.body);
  const u = req.user!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: u.businessId } });
  const c = await prisma.vaccineCard.findFirst({ where: { id: String(req.params.id), businessId: b.id }, include: { pet: true } });
  if (!c) throw notFound("Cartilla");
  const expiresAt = body.expiresOn ? DateTime.fromISO(body.expiresOn, { zone: b.timezone }).endOf("day").toJSDate() : c.expiresAt;
  if (body.decision === "APPROVED" && !expiresAt) throw badRequest("Indica hasta cuándo valen las vacunas");
  await prisma.$transaction(async (tx) => {
    await tx.vaccineCard.update({
      where: { id: c.id },
      data: { review: body.decision, reviewNote: body.note ?? null, reviewedBy: u.name, reviewedAt: new Date(), expiresAt },
    });
    const latest = await tx.vaccineCard.findFirst({ where: { petId: c.petId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (body.decision === "APPROVED") {
      await tx.pet.update({ where: { id: c.petId }, data: { vaccineStatus: "APPROVED", vaccineExpiresAt: expiresAt } });
    } else if (latest?.id === c.id && c.pet.vaccineStatus !== "APPROVED") {
      await tx.pet.update({ where: { id: c.petId }, data: { vaccineStatus: "REJECTED" } });
    }
    await logActivity(
      tx,
      b.id,
      "vaccine.review",
      `Cartilla de ${c.pet.name} ${body.decision === "APPROVED" ? `aprobada (vigente hasta ${DateTime.fromJSDate(expiresAt!, { zone: b.timezone }).toISODate()})` : "rechazada"}${body.note ? ` · ${body.note}` : ""} por ${u.name}`,
      { userId: u.id, meta: { cardId: c.id } },
    );
  });
  res.json({ ok: true });
});
