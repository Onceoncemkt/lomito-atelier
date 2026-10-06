import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { HttpError, forbidden } from "./errors.js";
import type { Role } from "../generated/prisma/enums.js";
import { prisma } from "./db.js";

export type AuthUser = { id: string; businessId: string; role: Role; groomerId: string | null; name: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Falta JWT_SECRET");
  return s;
};

export function signToken(u: AuthUser) {
  return jwt.sign(
    { businessId: u.businessId, role: u.role, groomerId: u.groomerId, name: u.name },
    secret(),
    { subject: u.id, expiresIn: "12h" },
  );
}

/** Verifica el token y que el usuario siga activo (rol y estado se leen de la base, así los cambios aplican al momento). */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw new HttpError(401, "Inicia sesión");
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(h.slice(7), secret()) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, "Sesión vencida, vuelve a entrar");
  }
  const u = await prisma.user.findUnique({ where: { id: p.sub! }, select: { active: true, role: true, businessId: true, groomerId: true, name: true } });
  if (!u || !u.active || u.businessId !== p.businessId) throw new HttpError(401, "Inicia sesión");
  req.user = { id: p.sub!, businessId: u.businessId, role: u.role, groomerId: u.groomerId, name: u.name };
  next();
};

export const allow =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };

export const STAFF: Role[] = ["OWNER", "RECEPTION"];
