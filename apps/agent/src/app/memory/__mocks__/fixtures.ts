const now = new Date("2026-01-01T00:00:00.000Z");

export const createMessage = ({
  id,
  role,
  content,
  createdAt = now,
}: {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}) => ({
  id,
  identityId: "identity-1",
  threadId: "thread-1",
  role,
  content,
  sourceMessageId: null,
  compressedAt: null,
  createdAt,
});

export const createMemoryChunk = ({
  id,
  summary,
}: {
  id: string;
  summary: string;
}) => ({
  id,
  identityId: "identity-1",
  threadId: "thread-1",
  summary,
  metadata: {},
  sourceMessageIds: [],
  createdAt: now,
});

export const createNotedMemory = ({
  id,
  content,
  kind = "note",
  importance = 1,
}: {
  id: string;
  content: string;
  kind?: string;
  importance?: number;
}) => ({
  id,
  identityId: "identity-1",
  kind,
  content,
  metadata: {},
  embedding: [0.1, 0.2, 0.3],
  importance,
  createdAt: now,
  updatedAt: now,
});
