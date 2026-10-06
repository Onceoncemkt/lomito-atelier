import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL");

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export * from "../generated/prisma/client.js";
