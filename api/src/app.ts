import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./lib/errors.js";
import { requireAuth } from "./lib/auth.js";
import { publicRouter } from "./routes/public.js";
import { manageRouter } from "./routes/manage.js";
import { authRouter } from "./routes/auth.js";
import { agendaRouter } from "./routes/agenda.js";
import { clientsRouter } from "./routes/clients.js";
import { cajaRouter } from "./routes/caja.js";
import { adminRouter } from "./routes/admin.js";
import { settingsRouter } from "./routes/settings.js";
import { reportsRouter } from "./routes/reports.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  const origins = (process.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : true }));
  app.use(express.json({ limit: "100kb" }));

  const testing = process.env.NODE_ENV === "test";
  const limiter = (max: number) =>
    rateLimit({ windowMs: 15 * 60_000, limit: testing ? 10_000 : max, standardHeaders: "draft-8", legacyHeaders: false });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/public/:slug/bookings", limiter(20));
  app.use("/public/:slug/manage/:token", limiter(60));
  app.use("/public", limiter(600), manageRouter, publicRouter);
  app.use("/auth/login", limiter(30));
  app.use("/auth", authRouter);
  app.use("/api", requireAuth, agendaRouter, clientsRouter, cajaRouter, adminRouter, settingsRouter, reportsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
  });
  app.use(errorHandler);
  return app;
}
