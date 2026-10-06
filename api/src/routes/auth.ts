import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { parse, HttpError } from "../lib/errors.js";
import { signToken, requireAuth } from "../lib/auth.js";

export const authRouter = Router();

const loginBody = z.object({
  business: z.string().min(1),
  email: z.email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const body = parse(loginBody, req.body);
  const user = await prisma.user.findFirst({
    where: { email: body.email.toLowerCase(), active: true, business: { slug: body.business } },
    include: { business: true },
  });
  const ok = user && (await bcrypt.compare(body.password, user.passwordHash));
  if (!user || !ok) throw new HttpError(401, "Correo o contraseña incorrectos");
  const auth = { id: user.id, businessId: user.businessId, role: user.role, groomerId: user.groomerId, name: user.name };
  res.json({
    token: signToken(auth),
    user: { ...auth, email: user.email },
    business: { slug: user.business.slug, name: user.business.name, timezone: user.business.timezone },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, include: { business: true } });
  if (!user || !user.active) throw new HttpError(401, "Inicia sesión");
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, groomerId: user.groomerId, businessId: user.businessId },
    business: {
      slug: user.business.slug,
      name: user.business.name,
      timezone: user.business.timezone,
      slotMinutes: user.business.slotMinutes,
      openingHours: user.business.openingHours,
      commissionPct: user.business.commissionPct,
    },
  });
});
