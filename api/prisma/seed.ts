/**
 * Carga Lomito Atelier con su menú, extras, boutique y groomers.
 * Se puede correr varias veces: no duplica nada.
 *
 *   SEED_OWNER_EMAIL=tu@correo.com SEED_OWNER_PASSWORD=algo-seguro npm run seed -w api
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, type Size } from "../src/lib/db.js";

const $ = (pesos: number) => pesos * 100;
const SIZES: Size[] = ["CHICO", "MEDIANO", "GRANDE", "GIGANTE"];
const OPEN = { open: "09:00", close: "19:00" };

const SERVICES = [
  {
    code: "experiencia",
    name: "Experiencia Atelier",
    description: "Baño de spa, corte de estilo, uñas, oídos, perfume y moño.",
    prices: [450, 600, 850, 1200],
    durations: [90, 120, 150, 180],
  },
  {
    code: "mantenimiento",
    name: "Baño de mantenimiento",
    description: "Baño, secado, cepillado, uñas y oídos. Sin corte.",
    prices: [300, 380, 550, 750],
    durations: [60, 90, 120, 150],
  },
  {
    code: "unas",
    name: "Uñas",
    description: "Corte y limado de uñas.",
    prices: [120, 120, 150, 150],
    durations: [30, 30, 30, 30],
  },
];

const ADDONS = [
  { code: "signature", name: "Ritual Signature", price: 250, durationMin: 15 },
  { code: "deslanado", name: "Deslanado", price: 300, durationMin: 30 },
  { code: "antipulgas", name: "Baño antipulgas", price: 150, durationMin: 0 },
];

const PRODUCTS = [
  { name: "Shampoo de la casa", price: 280, stock: 12 },
  { name: "Perfume Lomito", price: 220, stock: 10 },
  { name: "Pañoleta", price: 180, stock: 15 },
  { name: "Moño extra", price: 60, stock: 40 },
  { name: "Premios horneados", price: 90, stock: 25 },
  { name: "Collar de piel", price: 350, stock: 6 },
];

async function main() {
  const slug = process.env.SEED_BUSINESS_SLUG ?? "lomito-atelier";
  const b = await prisma.business.upsert({
    where: { slug },
    create: {
      slug,
      name: "Lomito Atelier",
      timezone: "America/Mexico_City",
      slotMinutes: 30,
      commissionPct: 30,
      // 1 = lunes (cerrado) … 7 = domingo
      openingHours: { "1": null, "2": OPEN, "3": OPEN, "4": OPEN, "5": OPEN, "6": OPEN, "7": OPEN },
    },
    update: {},
  });

  for (const [i, s] of SERVICES.entries()) {
    const svc = await prisma.service.upsert({
      where: { businessId_code: { businessId: b.id, code: s.code } },
      create: { businessId: b.id, code: s.code, name: s.name, description: s.description, sortOrder: i },
      update: {},
    });
    for (const [j, size] of SIZES.entries()) {
      await prisma.servicePrice.upsert({
        where: { serviceId_size: { serviceId: svc.id, size } },
        create: { serviceId: svc.id, size, price: $(s.prices[j]), durationMin: s.durations[j] },
        update: {},
      });
    }
  }

  for (const a of ADDONS) {
    await prisma.addOn.upsert({
      where: { businessId_code: { businessId: b.id, code: a.code } },
      create: { businessId: b.id, ...a, price: $(a.price) },
      update: {},
    });
  }

  if ((await prisma.product.count({ where: { businessId: b.id } })) === 0) {
    await prisma.product.createMany({ data: PRODUCTS.map((p) => ({ ...p, price: $(p.price), businessId: b.id })) });
  }

  if ((await prisma.groomer.count({ where: { businessId: b.id } })) === 0) {
    await prisma.groomer.create({ data: { businessId: b.id, name: "Estilista 1" } });
    await prisma.groomer.create({ data: { businessId: b.id, name: "Estilista 2" } });
  }

  const email = (process.env.SEED_OWNER_EMAIL ?? "maria@onceonce.community").toLowerCase();
  const existing = await prisma.user.findUnique({ where: { businessId_email: { businessId: b.id, email } } });
  if (!existing) {
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString("base64url");
    await prisma.user.create({
      data: { businessId: b.id, email, name: "María", role: "OWNER", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Usuaria dueña creada: ${email}`);
    if (!process.env.SEED_OWNER_PASSWORD) console.log(`Contraseña temporal: ${password}  (cámbiala)`);
  }
  console.log(`Listo: ${b.name} (${b.slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
