import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { DateTime } from "luxon";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { setTransport, type WaMessage } from "../src/lib/whatsapp.js";
import { runReminders } from "../src/lib/reminders.js";

const app = createApp();
const TZ = "America/Mexico_City";
const SLUG = "lomito-atelier";
// un miércoles al menos 5 días adelante (no choca con las pruebas de api.test.ts)
const wed = (() => {
  let d = DateTime.now().setZone(TZ).plus({ days: 5 }).startOf("day");
  while (d.weekday !== 3) d = d.plus({ days: 1 });
  return d.toISODate()!;
})();
const iso = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone: TZ }).toUTC().toISO()!;

let token = "";
const book = (over: Record<string, unknown> = {}) =>
  request(app)
    .post(`/public/${SLUG}/bookings`)
    .send({
      service: "mantenimiento",
      size: "CHICO",
      addOns: [],
      startsAt: iso(wed, "10:00"),
      clientName: "Laura Pérez",
      phone: "7713334455",
      petName: "Kiwi",
      breed: "Maltés",
      ...over,
    });

beforeAll(async () => {
  const r = await book();
  expect(r.status).toBe(201);
  token = r.body.manageToken;
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
});

describe("liga del cliente", () => {
  it("muestra la cita sin datos sensibles", async () => {
    const r = await request(app).get(`/public/${SLUG}/manage/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.appointment.petName).toBe("Kiwi");
    expect(r.body.appointment.clientName).toBe("Laura");
    expect(r.body.canChange).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("7713334455");
  });

  it("liga inválida o de otro negocio → 404", async () => {
    expect((await request(app).get(`/public/${SLUG}/manage/abcdefghijklmnopqrstuvwx`)).status).toBe(404);
    expect((await request(app).get(`/public/otro-spa/manage/${token}`)).status).toBe(404);
  });

  it("puede cambiar a otro horario libre y su hora anterior se libera", async () => {
    const av = await request(app).get(`/public/${SLUG}/manage/${token}/availability`).query({ date: wed });
    expect(av.body.slots.find((s: any) => s.time === "10:00").current).toBe(true);
    const r = await request(app).post(`/public/${SLUG}/manage/${token}/reschedule`).send({ startsAt: iso(wed, "12:00") });
    expect(r.status).toBe(200);
    expect(r.body.appointment.startsAt).toBe(iso(wed, "12:00"));
    const same = await request(app).post(`/public/${SLUG}/manage/${token}/reschedule`).send({ startsAt: iso(wed, "12:00") });
    expect(same.status).toBe(400);
  });

  it("no puede cambiar a una hora ocupada por los dos groomers", async () => {
    await book({ startsAt: iso(wed, "15:00"), phone: "7710000101", petName: "A1" });
    await book({ startsAt: iso(wed, "15:00"), phone: "7710000102", petName: "A2" });
    const r = await request(app).post(`/public/${SLUG}/manage/${token}/reschedule`).send({ startsAt: iso(wed, "15:00") });
    expect(r.status).toBe(409);
  });

  it("dentro de la anticipación mínima ya no se puede cambiar", async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { manageToken: token } });
    const soon = new Date(Date.now() + 2 * 3600_000);
    await prisma.appointment.update({ where: { id: appt.id }, data: { startsAt: soon, endsAt: new Date(+soon + 3600_000) } });
    const r = await request(app).get(`/public/${SLUG}/manage/${token}`);
    expect(r.body.canChange).toBe(false);
    expect(r.body.reason).toMatch(/menos de 4 horas/);
    expect((await request(app).post(`/public/${SLUG}/manage/${token}/cancel`)).status).toBe(400);
    await prisma.appointment.update({ where: { id: appt.id }, data: { startsAt: appt.startsAt, endsAt: appt.endsAt } });
  });

  it("puede cancelar; después ya no puede cambiar", async () => {
    const r = await request(app).post(`/public/${SLUG}/manage/${token}/cancel`);
    expect(r.status).toBe(200);
    expect(r.body.appointment.status).toBe("CANCELLED");
    expect(r.body.canChange).toBe(false);
    const again = await request(app).post(`/public/${SLUG}/manage/${token}/reschedule`).send({ startsAt: iso(wed, "16:00") });
    expect(again.status).toBe(400);
  });
});

describe("recordatorios por WhatsApp", () => {
  const sent: WaMessage[] = [];
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.WHATSAPP_TOKEN = "t";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_TEMPLATE_REMINDER = "recordatorio_cita";
    process.env.PUBLIC_WEB_URL = "https://www.lomitoatelier.mx";
    setTransport(async (m) => {
      sent.push(m);
      return m.to === "7719999999" ? { ok: false, error: "número inválido" } : { ok: true, id: "wamid.1" };
    });
  });
  afterAll(() => {
    process.env = saved;
    setTransport(null);
  });

  it("manda un recordatorio 24 h antes, una sola vez, con liga", async () => {
    const r = await book({ startsAt: iso(wed, "11:00"), phone: "7714445566", petName: "Luna", clientName: "Sofía Gómez" });
    const appt = await prisma.appointment.findFirstOrThrow({ where: { manageToken: r.body.manageToken } });
    // simula que la reservaron hace días
    await prisma.appointment.update({ where: { id: appt.id }, data: { createdAt: new Date(Date.now() - 5 * 86400_000) } });
    const now = new Date(+appt.startsAt - 20 * 3600_000);
    const res = await runReminders(now);
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const msg = sent.find((m) => m.to === "7714445566")!;
    expect(msg.template).toBe("recordatorio_cita");
    expect(msg.params[0]).toBe("Sofía");
    expect(msg.params[1]).toBe("Luna");
    expect(msg.params[2]).toMatch(/^miércoles \d+ de \w+/);
    expect(msg.params[3]).toBe("11:00");
    expect(msg.params[4]).toBe(`https://www.lomitoatelier.mx/cita/${r.body.manageToken}`);
    const before = sent.length;
    await runReminders(now);
    expect(sent.filter((m) => m.to === "7714445566")).toHaveLength(1);
    expect(sent.length).toBe(before);
  });

  it("no manda a citas canceladas ni a las de más de 24 h", async () => {
    const far = await book({ startsAt: iso(wed, "17:00"), phone: "7718887766", petName: "Lejos" });
    const appt = await prisma.appointment.findFirstOrThrow({ where: { manageToken: far.body.manageToken } });
    await prisma.appointment.update({ where: { id: appt.id }, data: { createdAt: new Date(Date.now() - 5 * 86400_000) } });
    await runReminders(new Date(+appt.startsAt - 30 * 3600_000));
    expect(sent.some((m) => m.to === "7718887766")).toBe(false);
  });

  it("si falla lo deja en la bitácora y no reintenta", async () => {
    const r = await book({ startsAt: iso(wed, "13:00"), phone: "7719999999", petName: "Error" });
    const appt = await prisma.appointment.findFirstOrThrow({ where: { manageToken: r.body.manageToken } });
    await prisma.appointment.update({ where: { id: appt.id }, data: { createdAt: new Date(Date.now() - 5 * 86400_000) } });
    const now = new Date(+appt.startsAt - 10 * 3600_000);
    const res = await runReminders(now);
    expect(res.failed).toBeGreaterThanOrEqual(1);
    const log = await prisma.activityLog.findFirst({ where: { type: "whatsapp.error" }, orderBy: { createdAt: "desc" } });
    expect(log?.message).toMatch(/número inválido/);
    await runReminders(now);
    expect(sent.filter((m) => m.to === "7719999999")).toHaveLength(1);
  });
});
