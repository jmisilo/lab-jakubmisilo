import { db } from "@/infrastructure/db/client";

export class DbService {
  protected static client = db;
}
