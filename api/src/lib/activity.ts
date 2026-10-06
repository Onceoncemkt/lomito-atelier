import type { Tx } from "./db.js";
import { prisma } from "./db.js";

export function logActivity(
  db: Tx | typeof prisma,
  businessId: string,
  type: string,
  message: string,
  opts: { userId?: string | null; meta?: Record<string, unknown> } = {},
) {
  return db.activityLog.create({
    data: { businessId, type, message, userId: opts.userId ?? null, meta: (opts.meta ?? undefined) as object | undefined },
  });
}

export const pesos = (centavos: number) =>
  "$" + (centavos / 100).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
