import { serve } from "@hono/node-server";

import { app } from ".";

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8080),
  },
  (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  },
);
