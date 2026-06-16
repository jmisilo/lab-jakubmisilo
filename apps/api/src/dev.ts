import { serve } from "@hono/node-server";
import { config } from "dotenv";

config({ path: ".env.local" });

const { app } = await import("./index");

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8080),
  },
  (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  },
);
