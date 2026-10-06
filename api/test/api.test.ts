import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { DateTime } from "luxon";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

const app = createApp();
const TZ = "America/Mexico_City";
const SLUG = "lomito-atelier";

/** Un martes al menos 3 días adelante (abierto). */
const tuesday = (() => {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf("day");
  while (d.weekday !== 2) d = d.plus({ days: 1 });
  return d.toISODate()!;
})();
const monday = DateTime.fromISO(tuesday).minus({ days: 1 }).toISODate()!;
const today = DateTime.now().setZone(TZ).toISODate()!;
const iso = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone: TZ }).toUTC().toISO()!;

let token = "";
const auth = () => ({ Authorization: `Bearer ${token}` });
let catalog: any;

const booking = (over: Record<string, unknown> = {}) => ({
  service: "experiencia",
  size: "CHICO",
  addOns: [],
  startsAt: iso(tuesday, "10:00"),
  clientName: "Ana López",
  phone: "771 123 4567",
  petName: "Canela",
  breed: "Poodle",
  ...over,
});

beforeAll(async () => {
  const r = await request(app)
    .post("/auth/login")
    .send({ business: SLUG, email: "maria@onceonce.community", password: "lomito-test-123" });
  expect(r.status).toBe(200);
  token = r.body.token;
  catalog = (await request(app).get("/api/catalog").set(auth())).body;
});

describe("página pública", () => {
  it("muestra menú con precios en centavos", async () => {
    const r = await request(app).get(`/public/${SLUG}`);
    expect(r.status).toBe(200);
    const exp = r.body.services.find((s: any) => s.code === "experiencia");
    expect(exp.prices.CHICO).toEqual({ price: 45000, durationMin: 90 });
    expect(r.body.addOns.map((a: any) => a.code)).toContain("signature");
  });

  it("lunes cerrado: sin horarios", async () => {
    const r = await request(app).get(`/public/${SLUG}/availability`).query({ date: monday, service: "experiencia", size: "CHICO" });
    expect(r.body.slots).toEqual([]);
  });

  it("cotiza con extras", async () => {
    const r = await request(app)
      .get(`/public/${SLUG}/availability`)
      .query({ date: tuesday, service: "experiencia", size: "MEDIANO", addOns: "signature,deslanado" });
    expect(r.body.price).toBe(60000 + 25000 + 30000);
    expect(r.body.durationMin).toBe(120 + 15 + 30);
    expect(r.body.slots[0].time).toBe("09:00");
  });

  it("negocio inexistente → 404", async () => {
    expect((await request(app).get("/public/no-existe")).status).toBe(404);
  });
});

describe("reservas en línea", () => {
  it("reserva, asigna groomer y decide secado", async () => {
    const r = await request(app).post(`/public/${SLUG}/bookings`).send(booking());
    expect(r.status).toBe(201);
    expect(r.body.price).toBe(45000);
    expect(r.body.drying).toBe("cabina");
    const pug = await request(app)
      .post(`/public/${SLUG}/bookings`)
      .send(booking({ petName: "Tofu", breed: "Pug", phone: "7710000001", clientName: "Luis" }));
    expect(pug.status).toBe(201);
    expect(pug.body.drying).toBe("a mano");
    expect(pug.body.groomer).not.toBe(r.body.groomer);
  });

  it("con 2 groomers ocupados el horario desaparece y la 3a reserva falla", async () => {
    const av = await request(app).get(`/public/${SLUG}/availability`).query({ date: tuesday, service: "experiencia", size: "CHICO" });
    expect(av.body.slots.map((s: any) => s.time)).not.toContain("10:00");
    const r = await request(app).post(`/public/${SLUG}/bookings`).send(booking({ phone: "7710000002", petName: "Max" }));
    expect(r.status).toBe(409);
  });

  it("reservas simultáneas al mismo hueco: sólo entran 2 (una por groomer)", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post(`/public/${SLUG}/bookings`)
          .send(booking({ startsAt: iso(tuesday, "15:00"), phone: `77155500${10 + i}`, petName: `Perro${i}` })),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(2);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
  });

  it("rechaza horarios fuera de servicio, pasados o mal formados", async () => {
    const late = await request(app).post(`/public/${SLUG}/bookings`).send(booking({ startsAt: iso(tuesday, "18:00"), phone: "7710000003" }));
    expect(late.status).toBe(400);
    const odd = await request(app).post(`/public/${SLUG}/bookings`).send(booking({ startsAt: iso(tuesday, "11:10"), phone: "7710000003" }));
    expect(odd.status).toBe(400);
    const bad = await request(app).post(`/public/${SLUG}/bookings`).send(booking({ phone: "123" }));
    expect(bad.status).toBe(400);
  });

  it("el mismo WhatsApp reutiliza cliente y lomito", async () => {
    await request(app).post(`/public/${SLUG}/bookings`).send(booking({ startsAt: iso(tuesday, "13:00"), phone: "+52 771 123 4567", petName: "canela" }));
    const clients = await request(app).get("/api/clients").query({ q: "7711234567" }).set(auth());
    expect(clients.body).toHaveLength(1);
    expect(clients.body[0].pets).toHaveLength(1);
  });
});

describe("recepción", () => {
  it("pide sesión", async () => {
    expect((await request(app).get("/api/agenda").query({ date: tuesday })).status).toBe(401);
  });

  it("agenda del día con groomers y citas", async () => {
    const r = await request(app).get("/api/agenda").query({ date: tuesday }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.open).toBe("09:00");
    expect(r.body.groomers).toHaveLength(2);
    expect(r.body.appointments.length).toBeGreaterThanOrEqual(5);
  });

  it("cita manual: detecta empalme con el groomer y permite otro", async () => {
    const ag = await request(app).get("/api/agenda").query({ date: tuesday }).set(auth());
    const taken = ag.body.appointments.find((a: any) => a.startsAt === iso(tuesday, "10:00"));
    const svc = catalog.services.find((s: any) => s.code === "mantenimiento");
    const body = {
      client: { name: "Sofía", phone: "7712223344" },
      pet: { name: "Luna", breed: "Labrador", size: "GRANDE" },
      serviceId: svc.id,
      groomerId: taken.groomer.id,
      startsAt: iso(tuesday, "10:30"),
      source: "WHATSAPP",
    };
    const clash = await request(app).post("/api/appointments").set(auth()).send(body);
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/ya tiene a/);
    const ok = await request(app).post("/api/appointments").set(auth()).send({ ...body, groomerId: undefined, startsAt: iso(tuesday, "17:00") });
    expect(ok.status).toBe(201);
    expect(ok.body.price).toBe(55000);
    expect(ok.body.useCabin).toBe(false);
    expect(ok.body.source).toBe("WHATSAPP");
  });

  it("mover una cita revisa disponibilidad", async () => {
    const ag = await request(app).get("/api/agenda").query({ date: tuesday }).set(auth());
    const luna = ag.body.appointments.find((a: any) => a.pet.name === "Luna");
    const at10 = ag.body.appointments.find((a: any) => a.startsAt === iso(tuesday, "10:00") && a.groomer.id !== luna.groomer.id);
    const clash = await request(app).patch(`/api/appointments/${luna.id}`).set(auth()).send({ startsAt: iso(tuesday, "10:00"), groomerId: at10.groomer.id });
    expect(clash.status).toBe(409);
    const moved = await request(app).patch(`/api/appointments/${luna.id}`).set(auth()).send({ startsAt: iso(tuesday, "16:30") });
    expect(moved.status).toBe(200);
    expect(moved.body.startsAt).toBe(iso(tuesday, "16:30"));
  });
});

describe("caja", () => {
  let apptId = "";
  it("cobra servicio + boutique, descuenta stock y no permite doble cobro", async () => {
    // cita de hoy (walk-in) para cobrarla
    const svc = catalog.services.find((s: any) => s.code === "unas");
    const start = DateTime.now().setZone(TZ).startOf("hour").toUTC().toISO()!;
    const walk = await request(app)
      .post("/api/appointments")
      .set(auth())
      .send({ client: { name: "Pedro", phone: "7719998877" }, pet: { name: "Rocky", size: "MEDIANO" }, serviceId: svc.id, startsAt: start });
    expect(walk.status).toBe(201);
    apptId = walk.body.id;

    const shampoo = catalog.products.find((p: any) => p.name === "Shampoo de la casa");
    const sale = await request(app)
      .post("/api/sales")
      .set(auth())
      .send({ items: [{ appointmentId: apptId }, { productId: shampoo.id, qty: 2 }], method: "CASH", received: 100000 });
    expect(sale.status).toBe(201);
    expect(sale.body.total).toBe(12000 + 2 * 28000);
    expect(sale.body.change).toBe(100000 - 68000);

    const again = await request(app).post("/api/sales").set(auth()).send({ items: [{ appointmentId: apptId }], method: "CARD" });
    expect(again.status).toBe(409);

    const cat = (await request(app).get("/api/catalog").set(auth())).body;
    expect(cat.products.find((p: any) => p.id === shampoo.id).stock).toBe(shampoo.stock - 2);

    const collar = catalog.products.find((p: any) => p.name === "Collar de piel");
    const tooMany = await request(app).post("/api/sales").set(auth()).send({ items: [{ productId: collar.id, qty: 50 }], method: "CARD" });
    expect(tooMany.status).toBe(409);
  });

  it("resumen del día y corte de caja", async () => {
    await request(app)
      .post("/api/sales")
      .set(auth())
      .send({ items: [{ productId: catalog.products[0].id, qty: 1 }], method: "TRANSFER" });
    const sum = await request(app).get(`/api/cash/${today}`).query({ openingFloat: 50000 }).set(auth());
    expect(sum.status).toBe(200);
    expect(sum.body.byMethod.CASH).toBe(68000);
    expect(sum.body.services).toBe(12000);
    expect(sum.body.expectedCash).toBe(50000 + 68000);
    expect(sum.body.activity.some((l: any) => l.type === "sale.created")).toBe(true);

    const close = await request(app).post(`/api/cash/${today}/close`).set(auth()).send({ openingFloat: 50000, countedCash: 117000 });
    expect(close.status).toBe(201);
    expect(close.body.difference).toBe(-1000);
    const twice = await request(app).post(`/api/cash/${today}/close`).set(auth()).send({ openingFloat: 50000, countedCash: 118000 });
    expect(twice.status).toBe(409);
    const after = await request(app).post("/api/sales").set(auth()).send({ items: [{ productId: catalog.products[0].id }], method: "CARD" });
    expect(after.status).toBe(409);
  });

  it("comisiones: % sobre servicios terminados, sin boutique", async () => {
    const r = await request(app).get("/api/commissions").query({ from: today, to: today }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(Math.round(12000 * 0.3));
  });
});

describe("multi-negocio y permisos", () => {
  let otherToken = "";
  beforeAll(async () => {
    const b = await prisma.business.create({
      data: { slug: "otro-spa", name: "Otro Spa", openingHours: {} },
    });
    await prisma.user.create({
      data: { businessId: b.id, email: "dueno@otro.com", name: "Otro", role: "OWNER", passwordHash: await bcrypt.hash("otro-pass-123", 4) },
    });
    const r = await request(app).post("/auth/login").send({ business: "otro-spa", email: "dueno@otro.com", password: "otro-pass-123" });
    otherToken = r.body.token;
  });

  it("otro negocio no ve ni toca datos de Lomito", async () => {
    const h = { Authorization: `Bearer ${otherToken}` };
    const ag = await request(app).get("/api/agenda").query({ date: tuesday }).set(h);
    expect(ag.body.appointments).toEqual([]);
    expect((await request(app).get("/api/clients").set(h)).body).toEqual([]);
    const lomitoAg = await request(app).get("/api/agenda").query({ date: tuesday }).set(auth());
    const id = lomitoAg.body.appointments[0].id;
    expect((await request(app).get(`/api/appointments/${id}`).set(h)).status).toBe(404);
    expect((await request(app).patch(`/api/appointments/${id}`).set(h).send({ status: "CANCELLED" })).status).toBe(404);
  });

  it("recepción no ve comisiones; contraseña incorrecta no entra", async () => {
    await request(app)
      .post("/api/users")
      .set(auth())
      .send({ name: "Recepción", email: "recepcion@lomito.mx", password: "recepcion-123", role: "RECEPTION" });
    const r = await request(app).post("/auth/login").send({ business: SLUG, email: "recepcion@lomito.mx", password: "recepcion-123" });
    const h = { Authorization: `Bearer ${r.body.token}` };
    expect((await request(app).get("/api/commissions").query({ from: today, to: today }).set(h)).status).toBe(403);
    expect((await request(app).get("/api/agenda").query({ date: tuesday }).set(h)).status).toBe(200);
    const bad = await request(app).post("/auth/login").send({ business: SLUG, email: "recepcion@lomito.mx", password: "nop" });
    expect(bad.status).toBe(401);
  });
});
