import { z } from "zod";

export const UrlSchema = z.url().refine((value) => {
  const { hostname } = new URL(value);

  return (
    hostname === "localhost" ||
    (hostname.includes(".") && !hostname.startsWith(".") && !hostname.endsWith("."))
  );
});
