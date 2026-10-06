import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeSlots, pickGroomer } from "../src/lib/availability.js";
import { canUseCabin, isBrachycephalic } from "../src/lib/cabin.js";
import { openWindow, dayBounds } from "../src/lib/time.js";

const TZ = "America/Mexico_City";
const HOURS = { "1": null, "2": { open: "09:00", close: "19:00" }, "7": { open: "09:00", close: "19:00" } };

describe("horario", () => {
  it("lunes cerrado, martes 9 a 19 hora de Tulancingo", () => {
    expect(openWindow("2026-12-07", TZ, HOURS)).toBeNull(); // lunes
    const w = openWindow("2026-12-08", TZ, HOURS)!;
    expect(w.open.toUTC().toISO()).toBe("2026-12-08T15:00:00.000Z");
    expect(w.close.toFormat("HH:mm")).toBe("19:00");
  });
  it("el día local abarca 24 h en UTC", () => {
    const { start, end } = dayBounds("2026-12-08", TZ);
    expect(start.toISOString()).toBe("2026-12-08T06:00:00.000Z");
    expect(+end - +start).toBe(24 * 3600_000);
  });
});

describe("disponibilidad", () => {
  const open = DateTime.fromISO("2026-12-08T09:00", { zone: TZ });
  const close = DateTime.fromISO("2026-12-08T19:00", { zone: TZ });
  const past = new Date("2026-01-01T00:00:00Z");
  const at = (hm: string) => DateTime.fromISO(`2026-12-08T${hm}`, { zone: TZ }).toJSDate();

  it("cada 30 min y la cita debe terminar antes del cierre", () => {
    const s = computeSlots({ open, close, stepMin: 30, durationMin: 120, groomerIds: ["a"], busy: [], now: past });
    expect(s[0].time).toBe("09:00");
    expect(s.at(-1)!.time).toBe("17:00");
    expect(s).toHaveLength(17);
  });

  it("si un groomer está ocupado se asigna el otro; si ambos, no hay hueco", () => {
    const busy = [
      { groomerId: "a", start: at("10:00"), end: at("12:00") },
      { groomerId: "b", start: at("11:00"), end: at("12:00") },
    ];
    const s = computeSlots({ open, close, stepMin: 30, durationMin: 60, groomerIds: ["a", "b"], busy, now: past });
    const t = Object.fromEntries(s.map((x) => [x.time, x.groomerId]));
    expect(t["10:00"]).toBe("b");
    expect(t["11:00"]).toBeUndefined();
    expect(t["10:30"]).toBeUndefined();
    expect(t["12:00"]).toBeDefined();
  });

  it("no ofrece horarios pasados ni con menos de 30 min de anticipación", () => {
    const now = at("13:10");
    const s = computeSlots({ open, close, stepMin: 30, durationMin: 60, groomerIds: ["a"], busy: [], now });
    expect(s[0].time).toBe("14:00");
  });

  it("reparte la carga: elige al groomer menos ocupado", () => {
    const busy = [{ groomerId: "a", start: at("09:00"), end: at("10:00") }];
    expect(pickGroomer(["a", "b"], busy, at("15:00"), at("16:00"))).toBe("b");
  });
});

describe("cabina de secado", () => {
  it("braquicéfalos y grandes van a mano", () => {
    expect(isBrachycephalic("Shih Tzu")).toBe(true);
    expect(isBrachycephalic("Bulldog Francés")).toBe(true);
    expect(canUseCabin("Pug", "CHICO")).toBe(false);
    expect(canUseCabin("Golden", "GRANDE")).toBe(false);
    expect(canUseCabin("Poodle", "CHICO")).toBe(true);
    expect(canUseCabin("Mestizo", "MEDIANO")).toBe(true);
  });
  it("la ficha del lomito puede forzar la decisión", () => {
    expect(canUseCabin("Poodle", "CHICO", false)).toBe(false);
    expect(canUseCabin("Labrador", "GRANDE", true)).toBe(true);
  });
});
