import { Hono } from "hono";
import { waitUntil } from "@vercel/functions";

import { bot } from "@/app/channels";

const app = new Hono()
  .get("/", (c) => c.json({ ok: true, service: "agent" }))
  .get("/health", (c) => c.json({ ok: true }))
  .post("/webhooks/telegram", (c) =>
    bot.webhooks.telegram(c.req.raw, { waitUntil }),
  );

export type AppType = typeof app;

export default app;
