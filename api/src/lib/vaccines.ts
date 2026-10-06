import { DateTime } from "luxon";

export type PolicyItem = { key: string; label: string; months: number; required: boolean };
export type ReadVaccine = { tipo: string; nombre: string; fecha_aplicacion: string | null; proxima_dosis: string | null };
export type CardReading = { es_cartilla: boolean; legible: boolean; nombre_mascota: string | null; vacunas: ReadVaccine[]; notas: string };

export const DEFAULT_POLICY: PolicyItem[] = [
  { key: "rabia", label: "Rabia", months: 12, required: true },
  { key: "multiple", label: "Múltiple / Séxtuple", months: 12, required: true },
  { key: "bordetella", label: "Bordetella (tos de perrera)", months: 12, required: true },
  { key: "desparasitacion", label: "Desparasitación interna", months: 6, required: true },
];

export function getPolicy(raw: unknown): PolicyItem[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_POLICY;
  return DEFAULT_POLICY.map((d) => {
    const o = (raw as PolicyItem[]).find((x) => x.key === d.key);
    return o ? { ...d, months: Number(o.months) || d.months, required: !!o.required } : d;
  });
}

const parseDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = DateTime.fromISO(s);
  return d.isValid ? d : null;
};

export type Evaluation = {
  items: { key: string; label: string; required: boolean; applied: string | null; expires: string | null; valid: boolean }[];
  allRequiredValid: boolean;
  /** la primera fecha en que vence alguna vacuna obligatoria */
  expiresAt: string | null;
  suggestion: "APPROVE" | "REVIEW" | "REJECT";
  summary: string;
};

/** Revisa la lectura de la IA contra la política. La decisión la calcula el código, no el modelo. */
export function evaluate(policy: PolicyItem[], reading: CardReading, today: DateTime): Evaluation {
  const items = policy.map((p) => {
    const doses = reading.vacunas.filter((v) => v.tipo === p.key);
    let best: { applied: DateTime | null; expires: DateTime | null } = { applied: null, expires: null };
    for (const d of doses) {
      const applied = parseDate(d.fecha_aplicacion);
      const next = parseDate(d.proxima_dosis);
      const expires = next ?? (applied ? applied.plus({ months: p.months }) : null);
      if (expires && (!best.expires || expires > best.expires)) best = { applied, expires };
      else if (!best.expires && applied && (!best.applied || applied > best.applied)) best = { applied, expires: null };
    }
    const valid = !!best.expires && best.expires >= today.startOf("day");
    return { key: p.key, label: p.label, required: p.required, applied: best.applied?.toISODate() ?? null, expires: best.expires?.toISODate() ?? null, valid };
  });
  const req = items.filter((i) => i.required);
  const allRequiredValid = req.every((i) => i.valid);
  const expiries = req.map((i) => i.expires).filter(Boolean).sort() as string[];
  let suggestion: Evaluation["suggestion"] = allRequiredValid ? "APPROVE" : "REVIEW";
  if (!reading.es_cartilla) suggestion = "REJECT";
  const fmt = (d: string) => DateTime.fromISO(d).setLocale("es").toFormat("d LLL yyyy");
  const parts = req.map((i) =>
    i.valid ? `${i.label}: vigente hasta ${fmt(i.expires!)}` : i.expires ? `${i.label}: VENCIDA desde ${fmt(i.expires)}` : `${i.label}: no aparece`,
  );
  let summary = parts.join(" · ");
  if (!reading.es_cartilla) summary = "La imagen no parece una cartilla de vacunación.";
  else if (!reading.legible) summary = `No se lee bien. ${summary}`;
  return { items, allRequiredValid, expiresAt: allRequiredValid ? expiries[0] ?? null : null, suggestion, summary };
}

export type EffectiveVaccine = "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
export function effectiveVaccineStatus(pet: { vaccineStatus: string; vaccineExpiresAt: Date | null }, at = new Date()): EffectiveVaccine {
  if (pet.vaccineStatus === "APPROVED" && pet.vaccineExpiresAt && pet.vaccineExpiresAt < at) return "EXPIRED";
  return pet.vaccineStatus as EffectiveVaccine;
}
