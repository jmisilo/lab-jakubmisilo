import type { TranscriptEntry, TranscriptRole } from 'chat';

export type ShortTermMemory = Pick<TranscriptEntry, 'role' | 'text'>;
export type MemoryMessageRole = Extract<TranscriptRole, 'user' | 'assistant'>;
export type MemoryMessageForCompression = {
  id: string;
  role: string;
  content: string;
};
