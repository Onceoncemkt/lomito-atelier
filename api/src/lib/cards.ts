import { prisma } from "./db.js";
import { decodeDataUrl } from "./uploads.js";
import { analyzeCard } from "./vaccineAI.js";
import { effectiveVaccineStatus } from "./vaccines.js";
import { logActivity } from "./activity.js";

/** Guarda una cartilla nueva, marca al lomito como "por revisar" y lanza la lectura con IA en segundo plano. */
export async function saveCard(opts: { businessId: string; petId: string; dataUrl: string; uploadedBy: "CLIENT" | "STAFF"; userId?: string }) {
  const { mimeType, data } = decodeDataUrl(opts.dataUrl);
  const pet = await prisma.pet.findFirstOrThrow({ where: { id: opts.petId, businessId: opts.businessId } });
  const card = await prisma.vaccineCard.create({
    data: { businessId: opts.businessId, petId: pet.id, mimeType, data, uploadedBy: opts.uploadedBy },
    select: { id: true, createdAt: true },
  });
  if (effectiveVaccineStatus(pet) !== "APPROVED") {
    await prisma.pet.update({ where: { id: pet.id }, data: { vaccineStatus: "PENDING" } });
  }
  await logActivity(prisma, opts.businessId, "vaccine.uploaded", `${opts.uploadedBy === "CLIENT" ? "El cliente subió" : "Se subió"} la cartilla de ${pet.name}`, {
    userId: opts.userId,
    meta: { cardId: card.id, petId: pet.id },
  });
  const analysis = analyzeCard(card.id).catch(() => {});
  return { card, analysis };
}
