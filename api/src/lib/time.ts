import { DateTime } from "luxon";
import { badRequest } from "./errors.js";

export type DayHours = { open: string; close: string } | null;
export type OpeningHours = Record<string, DayHours>;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(date: string, tz: string): DateTime {
  const d = DateTime.fromISO(date, { zone: tz });
  if (!DATE_RE.test(date) || !d.isValid) throw badRequest("Fecha inválida, usa AAAA-MM-DD");
  return d.startOf("day");
}

/** Inicio y fin (UTC) del día local del negocio. */
export function dayBounds(date: string, tz: string) {
  const d = parseDay(date, tz);
  return { start: d.toUTC().toJSDate(), end: d.plus({ days: 1 }).toUTC().toJSDate() };
}

/** Horario de apertura de ese día como DateTime en la zona del negocio, o null si cierra. */
export function openWindow(date: string, tz: string, hours: OpeningHours) {
  const d = parseDay(date, tz);
  const h = hours[String(d.weekday)];
  if (!h) return null;
  const at = (hm: string) => {
    const [H, M] = hm.split(":").map(Number);
    return d.set({ hour: H, minute: M, second: 0, millisecond: 0 });
  };
  return { open: at(h.open), close: at(h.close) };
}

export function localDate(js: Date, tz: string) {
  return DateTime.fromJSDate(js, { zone: tz }).toISODate()!;
}

export function localTime(js: Date, tz: string) {
  return DateTime.fromJSDate(js, { zone: tz }).toFormat("HH:mm");
}
