import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { DateTime } from "luxon";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

const app = createApp();
const TZ = "America/Mexico_City";
const today = DateTime.now().setZone(TZ).toISODate()!;
const OPEN = { open: "09:00", close: "19:00" };

/** Negocio aparte para no tocar los datos de las otras pruebas. */
let token = "";
let bizId = "";
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const b = await prisma.business.create({
    data: {
      slug: `prueba-${Date.now()}`,
      name: "Spa de prueba",
      openingHours: { "1": OPEN, "2": OPEN, "3": OPEN, "4": OPEN, "5": OPEN, "6": OPEN, "7": OPEN },
    },
  });
  bizId = b.id;
  const g = await prisma.groomer.create({ data: { businessId: b.id, name: "G" } });
  const svc = await prisma.service.create({
    data: { businessId: b.id, code: "bano", name: "Baño", prices: { create: [{ size: "CHICO", price: 30000, durationMin: 60 }] } },
  });
  const prod = await prisma.product.create({ data: { businessId: b.id, name: "Shampoo", price: 20000, stock: 10 } });
  await prisma.user.create({ data: { businessId: b.id, email: "d@p.mx", name: "D", role: "OWNER", passwordHash: await bcrypt.hash("dueno-123456", 4) } });
  token = (await request(app).post("/auth/login").send({ business: b.slug, email: "d@p.mx", password: "dueno-123456" })).body.token;

  // cliente que vino hace 90 días (por recuperar) y cliente nuevo hoy
  const old = await prisma.client.create({ data: { businessId: b.id, name: "Vieja Clienta", phone: "7711110000" } });
  const oldPet = await prisma.pet.create({ data: { businessId: b.id, clientId: old.id, name: "Canica", size: "CHICO" } });
  const ago = new Date(Date.now() - 90 * 86400_000);
  await prisma.appointment.create({
    data: { businessId: b.id, clientId: old.id, petId: oldPet.id, groomerId: g.id, serviceId: svc.id, size: "CHICO", startsAt: ago, endsAt: new Date(+ago + 3600_000), status: "DONE", source: "WEB", price: 30000, useCabin: true },
  });
  const nu = await prisma.client.create({ data: { businessId: b.id, name: "Nuevo", phone: "7712220000" } });
  const nuPet = await prisma.pet.create({ data: { businessId: b.id, clientId: nu.id, name: "Rayo", size: "CHICO" } });
  const now = new Date();
  const a = await prisma.appointment.create({
    data: { businessId: b.id, clientId: nu.id, petId: nuPet.id, groomerId: g.id, serviceId: svc.id, size: "CHICO", startsAt: now, endsAt: new Date(+now + 3600_000), status: "BOOKED", source: "INSTAGRAM", price: 30000, useCabin: true },
  });
  const sale = await request(app).post("/api/sales").set(auth()).send({ items: [{ appointmentId: a.id }, { productId: prod.id, qty: 2 }], method: "CARD" });
  expect(sale.status).toBe(201);
  await prisma.appointment.create({
    data: { businessId: b.id, clientId: nu.id, petId: nuPet.id, groomerId: g.id, serviceId: svc.id, size: "CHICO", startsAt: new Date(+now + 7200_000), endsAt: new Date(+now + 10800_000), status: "NO_SHOW", source: "WHATSAPP", price: 30000, useCabin: true },
  });
});

describe("reportes", () => {
  it("suma ventas, citas, clientes y detecta a quién recuperar", async () => {
    const r = await request(app).get("/api/reports").query({ from: today, to: today }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.sales.total).toBe(30000 + 40000);
    expect(r.body.sales.services).toBe(30000);
    expect(r.body.sales.products).toBe(40000);
    expect(r.body.sales.avgTicket).toBe(70000); // redondeado a pesos
    expect(r.body.sales.byDay.find((d: any) => d.date === today).products).toBe(40000);
    expect(r.body.appointments.DONE).toBe(1);
    expect(r.body.appointments.NO_SHOW).toBe(1);
    expect(r.body.appointments.noShowRate).toBe(0.5);
    expect(r.body.appointments.bySource.INSTAGRAM).toBe(1);
    expect(r.body.clients.new).toBe(1);
    expect(r.body.topProducts[0]).toEqual({ name: "Shampoo", qty: 2, revenue: 40000 });
    expect(r.body.winback.map((w: any) => w.name)).toEqual(["Vieja Clienta"]);
    expect(r.body.winback[0].pets).toEqual(["Canica"]);
  });

  it("sólo la dueña", async () => {
    await prisma.user.create({ data: { businessId: bizId, email: "r@p.mx", name: "R", role: "RECEPTION", passwordHash: await bcrypt.hash("recep-123456", 4) } });
    const slug = (await prisma.business.findUniqueOrThrow({ where: { id: bizId } })).slug;
    const t = (await request(app).post("/auth/login").send({ business: slug, email: "r@p.mx", password: "recep-123456" })).body.token;
    expect((await request(app).get("/api/reports").query({ from: today, to: today }).set({ Authorization: `Bearer ${t}` })).status).toBe(403);
    expect((await request(app).post("/api/settings/reset-data").set({ Authorization: `Bearer ${t}` }).send({ confirm: "BORRAR" })).status).toBe(403);
  });
});

describe("borrar datos de prueba", () => {
  it("pide confirmación escrita", async () => {
    expect((await request(app).post("/api/settings/reset-data").set(auth()).send({ confirm: "si" })).status).toBe(400);
  });

  it("borra citas, clientes y ventas de este negocio y nada de otros", async () => {
    const otherBefore = await prisma.appointment.count({ where: { businessId: { not: bizId } } });
    const r = await request(app).post("/api/settings/reset-data").set(auth()).send({ confirm: "borrar" });
    expect(r.status).toBe(200);
    expect(r.body.clients).toBe(2);
    expect(await prisma.appointment.count({ where: { businessId: bizId } })).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: bizId } })).toBe(0);
    expect(await prisma.client.count({ where: { businessId: bizId } })).toBe(0);
    expect(await prisma.product.count({ where: { businessId: bizId } })).toBe(1);
    expect(await prisma.service.count({ where: { businessId: bizId } })).toBe(1);
    expect(await prisma.appointment.count({ where: { businessId: { not: bizId } } })).toBe(otherBefore);
  });

  it("los datos del aviso de privacidad se guardan y salen en la página pública", async () => {
    const r = await request(app).patch("/api/settings/business").set(auth()).send({ legalName: "María Fernanda X", address: "Calle 1, Tulancingo", contactEmail: "hola@spa.mx" });
    expect(r.status).toBe(200);
    const slug = (await prisma.business.findUniqueOrThrow({ where: { id: bizId } })).slug;
    const pub = await request(app).get(`/public/${slug}`);
    expect(pub.body.business.legalName).toBe("María Fernanda X");
    expect(pub.body.business.contactEmail).toBe("hola@spa.mx");
  });
});
