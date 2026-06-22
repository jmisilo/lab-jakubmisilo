import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id").notNull(),
    threadId: text("thread_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    sourceMessageId: text("source_message_id"),
    compressedAt: timestamp("compressed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_messages_identity_thread_created_at_idx").on(
      table.identityId,
      table.threadId,
      table.createdAt,
    ),
    index("agent_messages_uncompressed_idx").on(
      table.identityId,
      table.threadId,
      table.compressedAt,
    ),
  ],
);

export const agentMemoryChunks = pgTable(
  "agent_memory_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id").notNull(),
    threadId: text("thread_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    sourceMessageIds: uuid("source_message_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_memory_chunks_identity_created_at_idx").on(
      table.identityId,
      table.createdAt,
    ),
    index("agent_memory_chunks_thread_created_at_idx").on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

export const agentNotedMemories = pgTable(
  "agent_noted_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id").notNull(),
    kind: text("kind").notNull().default("note"),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    embedding: vector("embedding", { dimensions: 1536 }),
    importance: integer("importance").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_noted_memories_identity_importance_idx").on(
      table.identityId,
      table.importance,
    ),
    index("agent_noted_memories_identity_updated_at_idx").on(
      table.identityId,
      table.updatedAt,
    ),
    index("agent_noted_memories_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);
