import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  out: "./src/infrastructure/db/drizzle",
  schema: "./src/infrastructure/db/schema.ts",
  strict: true,
  verbose: true,
});
