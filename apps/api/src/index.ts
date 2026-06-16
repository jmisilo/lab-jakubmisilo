import { Hono } from "hono";
import { cors } from "hono/cors";

export const app = new Hono().use("*", cors()).get("/health", (c) => {
  return c.json({ status: "ok" });
});

export type AppType = typeof app;

export default app;
