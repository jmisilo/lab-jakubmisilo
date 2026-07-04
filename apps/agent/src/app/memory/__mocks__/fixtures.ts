const now = new Date('2026-01-01T00:00:00.000Z');

export const createMessage = ({
  id,
  role,
  content,
  createdAt = now,
}: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
}) => ({
  id,
  identityId: 'identity-1',
  threadId: 'thread-1',
  role,
  content,
  sourceMessageId: null,
  compressedAt: null,
  createdAt,
});

export const createMemoryChunk = ({ id, summary }: { id: string; summary: string }) => ({
  id,
  identityId: 'identity-1',
  threadId: 'thread-1',
  summary,
  metadata: {},
  sourceMessageIds: [],
  createdAt: now,
});
