import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/infrastructure/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for agent database access");
}

export const db = drizzle(databaseUrl, { schema });
