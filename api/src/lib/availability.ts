import type { DateTime } from "luxon";

export type Busy = { groomerId: string; start: Date; end: Date };
export type Slot = { time: string; startsAt: string; groomerId: string };

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

/** Groomer libre en [start,end); entre varios libres, el que tiene menos minutos ocupados ese día. */
export function pickGroomer(groomerIds: string[], busy: Busy[], start: Date, end: Date): string | null {
  const free = groomerIds.filter(
    (g) => !busy.some((b) => b.groomerId === g && overlaps(start, end, b.start, b.end)),
  );
  if (!free.length) return null;
  const load = (g: string) =>
    busy.filter((b) => b.groomerId === g).reduce((t, b) => t + (+b.end - +b.start), 0);
  return free.reduce((best, g) => (load(g) < load(best) ? g : best), free[0]);
}

/**
 * Horarios disponibles para un servicio de `durationMin` minutos.
 * Cada horario lleva el groomer que se asignaría.
 */
export function computeSlots(opts: {
  open: DateTime;
  close: DateTime;
  stepMin: number;
  durationMin: number;
  groomerIds: string[];
  busy: Busy[];
  now: Date;
  leadMin?: number;
}): Slot[] {
  const { open, close, stepMin, durationMin, groomerIds, busy, now, leadMin = 30 } = opts;
  const earliest = new Date(+now + leadMin * 60_000);
  const out: Slot[] = [];
  for (let t = open; +t.plus({ minutes: durationMin }) <= +close; t = t.plus({ minutes: stepMin })) {
    const start = t.toJSDate();
    if (start < earliest) continue;
    const end = t.plus({ minutes: durationMin }).toJSDate();
    const g = pickGroomer(groomerIds, busy, start, end);
    if (g) out.push({ time: t.toFormat("HH:mm"), startsAt: t.toUTC().toISO()!, groomerId: g });
  }
  return out;
}
