import type { TranscriptEntry, TranscriptRole } from 'chat';

export type ShortTermMemory = Pick<TranscriptEntry, 'role' | 'text'> &
  Partial<Pick<TranscriptEntry, 'timestamp'>>;
export type MemoryMessageRole = Extract<TranscriptRole, 'user' | 'assistant'>;
export type MemoryMessageForCompression = {
  id: string;
  role: string;
  content: string;
  createdAt?: Date;
};
