import { DateTime } from "luxon";
import { prisma } from "./db.js";
import { evaluate, getPolicy, type CardReading } from "./vaccines.js";
import { logActivity } from "./activity.js";

/**
 * Lectura de cartillas con Claude (API de Anthropic).
 *   ANTHROPIC_API_KEY   clave de console.anthropic.com
 *   ANTHROPIC_MODEL     opcional (por defecto claude-sonnet-5-5)
 */
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export type AiInput = { mimeType: string; base64: string; petName: string; breed: string | null; today: string };
export type AiTransport = (input: AiInput) => Promise<CardReading>;

const TOOL = {
  name: "registrar_cartilla",
  description: "Registra lo que se lee en la cartilla de vacunación del perro.",
  input_schema: {
    type: "object",
    properties: {
      es_cartilla: { type: "boolean", description: "true si la imagen es una cartilla o constancia de vacunación de una mascota" },
      legible: { type: "boolean", description: "true si las fechas y vacunas se alcanzan a leer con seguridad" },
      nombre_mascota: { type: ["string", "null"] },
      vacunas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["rabia", "multiple", "bordetella", "desparasitacion", "otra"] },
            nombre: { type: "string", description: "como aparece en la cartilla (marca o nombre)" },
            fecha_aplicacion: { type: ["string", "null"], description: "AAAA-MM-DD" },
            proxima_dosis: { type: ["string", "null"], description: "AAAA-MM-DD si la cartilla la indica" },
          },
          required: ["tipo", "nombre", "fecha_aplicacion", "proxima_dosis"],
        },
      },
      notas: { type: "string", description: "observaciones breves en español para el personal (tachones, fechas dudosas, firma del veterinario, etc.)" },
    },
    required: ["es_cartilla", "legible", "nombre_mascota", "vacunas", "notas"],
  },
};

const prompt = (i: AiInput) => `Eres asistente de una estética canina en México. Lee esta cartilla de vacunación del perro "${i.petName}"${i.breed ? ` (${i.breed})` : ""}. Hoy es ${i.today}.

Registra CADA aplicación que veas (no sólo la última), con su fecha. Reglas:
- Las fechas en México se escriben día/mes/año (ej. 03/04/25 = 3 de abril de 2025). Conviértelas a AAAA-MM-DD.
- tipo "rabia": antirrábica, Rabisin, Nobivac Rabies, Defensor, Imrab.
- tipo "multiple": séxtuple, quíntuple, cuádruple, puppy, DHPP, DHPPi, DHPPiL, DA2PP, Vanguard Plus, Nobivac DHPPi, Canigen, Eurican.
- tipo "bordetella": Bordetella, KC, tos de las perreras, Bronchi-Shield, Nobivac KC, Pneumodog.
- tipo "desparasitacion": desparasitación interna (Drontal, Total Full, Endogard, Canex, Milbemax, NexGard Spectra, Simparica Trio). Antipulgas solo externo (Bravecto, NexGard, Frontline) es "otra".
- Si una etiqueta o sello trae la fecha de la próxima dosis, ponla en proxima_dosis.
- No inventes. Si una fecha no se lee, usa null y dilo en notas.`;

const anthropic: AiTransport = async (i) => {
  const isPdf = i.mimeType === "application/pdf";
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 2000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: i.base64 } }
              : { type: "image", source: { type: "base64", media_type: i.mimeType, data: i.base64 } },
            { type: "text", text: prompt(i) },
          ],
        },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { content?: { type: string; input?: unknown }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  const tool = data.content?.find((c) => c.type === "tool_use");
  if (!tool?.input) throw new Error("La IA no devolvió la lectura");
  return tool.input as CardReading;
};

let transport: AiTransport = anthropic;
export const setAiTransport = (t: AiTransport | null) => {
  transport = t ?? anthropic;
};

/** Lee la cartilla con IA y guarda la sugerencia. Nunca aprueba sola. */
export async function analyzeCard(cardId: string) {
  const card = await prisma.vaccineCard.findUnique({ where: { id: cardId }, include: { pet: true, business: true } });
  if (!card) return;
  if (!aiConfigured()) {
    await prisma.vaccineCard.update({ where: { id: card.id }, data: { aiStatus: "SKIPPED" } });
    return;
  }
  const tz = card.business.timezone;
  const today = DateTime.now().setZone(tz);
  try {
    const reading = await transport({
      mimeType: card.mimeType,
      base64: Buffer.from(card.data).toString("base64"),
      petName: card.pet.name,
      breed: card.pet.breed,
      today: today.toISODate()!,
    });
    const ev = evaluate(getPolicy(card.business.vaccinePolicy), reading, today);
    await prisma.vaccineCard.update({
      where: { id: card.id },
      data: {
        aiStatus: "DONE",
        aiResult: { reading, evaluation: ev } as object,
        aiSuggestion: ev.suggestion,
        aiSummary: ev.summary,
        expiresAt: ev.expiresAt ? DateTime.fromISO(ev.expiresAt, { zone: tz }).endOf("day").toJSDate() : null,
      },
    });
    await logActivity(prisma, card.businessId, "vaccine.ai", `Cartilla de ${card.pet.name} revisada por IA: ${ev.suggestion === "APPROVE" ? "todo vigente" : "requiere revisión"}`, {
      meta: { cardId: card.id },
    });
  } catch (e) {
    await prisma.vaccineCard.update({ where: { id: card.id }, data: { aiStatus: "ERROR", aiSummary: `No se pudo leer con IA: ${(e as Error).message}` } });
  }
}
