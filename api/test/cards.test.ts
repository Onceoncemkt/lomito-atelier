import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { DateTime } from "luxon";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { setAiTransport } from "../src/lib/vaccineAI.js";
import { setTransport, type WaMessage } from "../src/lib/whatsapp.js";
import { evaluate, DEFAULT_POLICY } from "../src/lib/vaccines.js";

const app = createApp();
const TZ = "America/Mexico_City";
const SLUG = "lomito-atelier";
const today = DateTime.now().setZone(TZ);
const ymd = (d: DateTime) => d.toISODate()!;
const thu = (() => {
  let d = today.plus({ days: 5 }).startOf("day");
  while (d.weekday !== 4) d = d.plus({ days: 1 });
  return d.toISODate()!;
})();
const iso = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone: TZ }).toUTC().toISO()!;
const JPEG = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");

const saved = { ...process.env };
let manageToken = "";
let clientToken = "";
let staff = "";
const sent: WaMessage[] = [];

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1";
  process.env.WHATSAPP_TEMPLATE_CODE = "codigo_acceso";
  setTransport(async (m) => { sent.push(m); return { ok: true }; });
  // IA simulada: rabia y múltiple vigentes, bordetella vencida, desparasitación vigente
  setAiTransport(async (i) => ({
    es_cartilla: true,
    legible: true,
    nombre_mascota: i.petName,
    vacunas: [
      { tipo: "rabia", nombre: "Rabisin", fecha_aplicacion: ymd(today.minus({ months: 2 })), proxima_dosis: null },
      { tipo: "multiple", nombre: "Vanguard Plus", fecha_aplicacion: ymd(today.minus({ months: 3 })), proxima_dosis: null },
      { tipo: "bordetella", nombre: "KC", fecha_aplicacion: ymd(today.minus({ months: 14 })), proxima_dosis: null },
      { tipo: "desparasitacion", nombre: "Drontal", fecha_aplicacion: ymd(today.minus({ months: 1 })), proxima_dosis: null },
    ],
    notas: "",
  }));
  const r = await request(app).post(`/public/${SLUG}/bookings`).send({
    service: "unas", size: "CHICO", addOns: [], startsAt: iso(thu, "10:00"),
    clientName: "Marta Ruiz", phone: "7715556677", petName: "Pelusa", breed: "Pomerania",
  });
  expect(r.status).toBe(201);
  manageToken = r.body.manageToken;
  staff = (await request(app).post("/auth/login").send({ business: SLUG, email: "maria@onceonce.community", password: "lomito-test-123" })).body.token
    ?? (await request(app).post("/auth/login").send({ business: SLUG, email: "maria@onceonce.community", password: "nueva-clave-123" })).body.token;
  expect(staff).toBeTruthy();
});

afterAll(() => {
  process.env = saved;
  setAiTransport(null);
  setTransport(null);
});

describe("evaluación de vacunas", () => {
  it("usa la próxima dosis si viene y si no suma los meses de la política", () => {
    const ev = evaluate(DEFAULT_POLICY, {
      es_cartilla: true, legible: true, nombre_mascota: null, notas: "",
      vacunas: [
        { tipo: "rabia", nombre: "", fecha_aplicacion: "2026-01-10", proxima_dosis: "2027-01-10" },
        { tipo: "multiple", nombre: "", fecha_aplicacion: "2025-12-01", proxima_dosis: null },
        { tipo: "bordetella", nombre: "", fecha_aplicacion: "2026-05-01", proxima_dosis: null },
        { tipo: "desparasitacion", nombre: "", fecha_aplicacion: "2026-08-01", proxima_dosis: null },
      ],
    }, DateTime.fromISO("2026-10-06"));
    expect(ev.allRequiredValid).toBe(true);
    expect(ev.expiresAt).toBe("2026-12-01");
    expect(ev.suggestion).toBe("APPROVE");
  });
  it("si falta una vacuna, pide revisión", () => {
    const ev = evaluate(DEFAULT_POLICY, { es_cartilla: true, legible: true, nombre_mascota: null, notas: "", vacunas: [] }, DateTime.fromISO("2026-10-06"));
    expect(ev.suggestion).toBe("REVIEW");
    expect(ev.summary).toMatch(/Rabia: no aparece/);
  });
});

describe("cuenta del cliente", () => {
  it("entra con la liga de su cita y ve sus lomitos y citas", async () => {
    const r = await request(app).post(`/public/${SLUG}/account/from-link`).send({ token: manageToken });
    expect(r.status).toBe(200);
    clientToken = r.body.token;
    const acc = await request(app).get(`/public/${SLUG}/account`).set({ Authorization: `Bearer ${clientToken}` });
    expect(acc.status).toBe(200);
    expect(acc.body.name).toBe("Marta Ruiz");
    expect(acc.body.pets[0].name).toBe("Pelusa");
    expect(acc.body.pets[0].vaccine).toBe("NONE");
    expect(acc.body.upcoming).toHaveLength(1);
  });

  it("el token de cliente no sirve para el panel ni para otro negocio", async () => {
    expect((await request(app).get("/api/agenda").query({ date: thu }).set({ Authorization: `Bearer ${clientToken}` })).status).toBe(401);
  });

  it("entra con código por WhatsApp; código incorrecto falla", async () => {
    const r = await request(app).post(`/public/${SLUG}/account/code`).send({ phone: "771 555 6677" });
    expect(r.status).toBe(200);
    const msg = sent.find((m) => m.template === "codigo_acceso" && m.to === "7715556677")!;
    const code = msg.params[0];
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await request(app).post(`/public/${SLUG}/account/verify`).send({ phone: "7715556677", code: code === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);
    const ok = await request(app).post(`/public/${SLUG}/account/verify`).send({ phone: "7715556677", code });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const reuse = await request(app).post(`/public/${SLUG}/account/verify`).send({ phone: "7715556677", code });
    expect(reuse.status).toBe(400);
  });

  it("un número que no es cliente recibe la misma respuesta pero no se manda nada", async () => {
    const before = sent.length;
    const r = await request(app).post(`/public/${SLUG}/account/code`).send({ phone: "7710009999" });
    expect(r.status).toBe(200);
    expect(sent.length).toBe(before);
  });
});

describe("cartilla", () => {
  let cardId = "";
  it("el cliente sube la foto, queda pendiente y la IA sugiere", async () => {
    const acc = await request(app).get(`/public/${SLUG}/account`).set({ Authorization: `Bearer ${clientToken}` });
    const petId = acc.body.pets[0].id;
    const up = await request(app).post(`/public/${SLUG}/account/pets/${petId}/card`).set({ Authorization: `Bearer ${clientToken}` }).send({ dataUrl: JPEG });
    expect(up.status).toBe(201);
    cardId = up.body.id;
    // espera a la IA (corre en segundo plano)
    for (let i = 0; i < 20; i++) {
      const c = await prisma.vaccineCard.findUnique({ where: { id: cardId } });
      if (c?.aiStatus !== "PENDING") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const list = await request(app).get("/api/vaccine-cards").set({ Authorization: `Bearer ${staff}` });
    const card = list.body.cards.find((c: any) => c.id === cardId);
    expect(card.aiStatus).toBe("DONE");
    expect(card.aiSuggestion).toBe("REVIEW");
    expect(card.aiSummary).toMatch(/Bordetella.*VENCIDA/);
    const ag = await request(app).get("/api/agenda").query({ date: thu }).set({ Authorization: `Bearer ${staff}` });
    expect(ag.body.appointments.find((a: any) => a.pet.name === "Pelusa").pet.vaccine).toBe("PENDING");
    const file = await request(app).get(`/api/vaccine-cards/${cardId}/file`).set({ Authorization: `Bearer ${staff}` });
    expect(file.headers["content-type"]).toBe("image/jpeg");
  });

  it("rechaza archivos que no son imagen o PDF reales", async () => {
    const acc = await request(app).get(`/public/${SLUG}/account`).set({ Authorization: `Bearer ${clientToken}` });
    const petId = acc.body.pets[0].id;
    const fake = "data:image/jpeg;base64," + Buffer.from("hola no soy foto").toString("base64");
    const r = await request(app).post(`/public/${SLUG}/account/pets/${petId}/card`).set({ Authorization: `Bearer ${clientToken}` }).send({ dataUrl: fake });
    expect(r.status).toBe(400);
  });

  it("no puede subir cartilla a un perro que no es suyo", async () => {
    const b = await prisma.business.findUniqueOrThrow({ where: { slug: SLUG } });
    const oc = await prisma.client.create({ data: { businessId: b.id, name: "Otro", phone: "7710007777" } });
    const other = await prisma.pet.create({ data: { businessId: b.id, clientId: oc.id, name: "Ajeno", size: "CHICO" } });
    const r = await request(app).post(`/public/${SLUG}/account/pets/${other.id}/card`).set({ Authorization: `Bearer ${clientToken}` }).send({ dataUrl: JPEG });
    expect(r.status).toBe(404);
  });

  it("el equipo aprueba con vigencia y el lomito queda aprobado", async () => {
    const until = ymd(today.plus({ months: 6 }));
    const r = await request(app).patch(`/api/vaccine-cards/${cardId}`).set({ Authorization: `Bearer ${staff}` }).send({ decision: "APPROVED", expiresOn: until, note: "Bordetella puesta en el atelier" });
    expect(r.status).toBe(200);
    const acc = await request(app).get(`/public/${SLUG}/account`).set({ Authorization: `Bearer ${clientToken}` });
    expect(acc.body.pets[0].vaccine).toBe("APPROVED");
    const pending = await request(app).get("/api/vaccine-cards").set({ Authorization: `Bearer ${staff}` });
    expect(pending.body.cards.some((c: any) => c.id === cardId)).toBe(false);
  });
});
