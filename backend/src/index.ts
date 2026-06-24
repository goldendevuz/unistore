import "dotenv/config";
import express from "express";
import cors from "cors";

import fs from "node:fs";
import path from "node:path";

import * as Sentry from "@sentry/node";

import { clerkMiddleware } from "@clerk/express";
import { clerkWebhookHandler } from "./webhooks/clerk.js";
import { getEnv } from "./lib/env.js";
import keepAliveCron from "./lib/cron.js";

import productRouter from "./routes/productRouter.js";
import meRouter from "./routes/meRouter.js";
import streamRouter from "./routes/streamRouter.js";
import chekoutRouter from "./routes/chekoutRouter.js";
import adminRouter from "./routes/adminRouter.js";
import orderRouter from "./routes/orderRouter.js";

import { polarWebhookHandler } from "./webhooks/polar.js";
import { sentryClerkUserMiddleware } from "./middleware/sentryClerkUser.js";

const env = getEnv();
const app = express();

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
});

// IMPORTANT: raw body for webhooks
const rawJson = express.raw({
  type: "application/json",
  limit: "1mb",
});

app.post("/webhooks/clerk", rawJson, (req, res) => {
  void clerkWebhookHandler(req, res);
});

app.post("/webhooks/polar", rawJson, (req, res) => {
  void polarWebhookHandler(req, res);
});

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());

app.use(clerkMiddleware());
app.use(sentryClerkUserMiddleware);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/me", meRouter);
app.use("/api/products", productRouter);
app.use("/api/stream", streamRouter);
app.use("/api/checkout", chekoutRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", orderRouter);

// Static frontend (optional)
const publicDir = path.join(process.cwd(), "public");

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
      return next();
    }

    res.sendFile(path.join(publicDir, "index.html"), (sendFileError) => {
      next(sendFileError);
    });
  });
}

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Custom error handler
app.use(
  (
    _err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const sentryId = (res as express.Response & { sentry?: string }).sentry;

    res.status(500).json({
      error: "Internal server error",
      ...(sentryId ? { sentryId } : {}),
    });
  },
);

// Fly.io / Docker
const port = Number(process.env.PORT ?? env.PORT ?? 5000);

app.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);

  if (env.NODE_ENV === "production") {
    keepAliveCron.start();
  }
});
