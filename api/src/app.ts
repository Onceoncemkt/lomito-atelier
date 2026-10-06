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
import { accountRouter } from "./routes/account.js";
import { cardsRouter } from "./routes/cards.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  const origins = (process.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : true }));
  // las cartillas (foto/PDF en base64) necesitan más espacio que el resto
  const smallJson = express.json({ limit: "100kb" });
  const bigJson = express.json({ limit: "9mb" });
  app.use((req, res, next) => (/\/(card|vaccine-card)$/.test(req.path) ? bigJson : smallJson)(req, res, next));

  const testing = process.env.NODE_ENV === "test";
  const limiter = (max: number) =>
    rateLimit({ windowMs: 15 * 60_000, limit: testing ? 10_000 : max, standardHeaders: "draft-8", legacyHeaders: false });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/public/:slug/bookings", limiter(20));
  app.use("/public/:slug/manage/:token", limiter(60));
  app.use(["/public/:slug/account/code", "/public/:slug/account/verify"], limiter(15));
  app.use("/public/:slug/account/pets", limiter(30));
  app.use("/public", limiter(600), manageRouter, accountRouter, publicRouter);
  app.use("/auth/login", limiter(30));
  app.use("/auth", authRouter);
  app.use("/api", requireAuth, agendaRouter, clientsRouter, cajaRouter, adminRouter, settingsRouter, reportsRouter, cardsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
  });
  app.use(errorHandler);
  return app;
}
