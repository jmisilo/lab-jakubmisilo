import { z } from "zod/v4";

export const UrlSchema = z.url().refine((value) => {
  const { hostname } = new URL(value);

  return (
    hostname === "localhost" ||
    (hostname.includes(".") &&
      !hostname.startsWith(".") &&
      !hostname.endsWith("."))
  );
});

export * from "./ai-widget";
