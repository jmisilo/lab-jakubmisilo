import { z } from 'zod';

import {
  GoogleReconnectReasonSchema,
  GoogleToolContextSchema,
} from '@/app/features/google/schemas';

export const GOOGLE_GMAIL_SEARCH_MAX_RESULTS = 10;
export const GOOGLE_GMAIL_THREAD_MAX_MESSAGES = 10;
export const GOOGLE_GMAIL_MESSAGE_BODY_MAX_CHARACTERS = 8_000;

export const GmailToolContextSchema = GoogleToolContextSchema;

export const ReadGmailToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z
      .literal('search_messages')
      .describe('Search Gmail messages and return bounded metadata.'),
    query: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Gmail search query, using Gmail search syntax. Use a bounded recent query when the user asks broadly.',
      ),
    labelIds: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe('Optional Gmail label ids, such as INBOX or UNREAD.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(GOOGLE_GMAIL_SEARCH_MAX_RESULTS)
      .optional()
      .describe(`Maximum messages to return. Defaults to ${GOOGLE_GMAIL_SEARCH_MAX_RESULTS}.`),
  }),
  z.object({
    action: z
      .literal('read_message')
      .describe('Read one selected Gmail message, including a bounded body.'),
    messageId: z
      .string()
      .min(1)
      .describe(
        'Exact Gmail message id from a prior search result. Never expose this id to the user.',
      ),
  }),
  z.object({
    action: z
      .literal('read_thread')
      .describe('Read a selected Gmail conversation in chronological order.'),
    threadId: z
      .string()
      .min(1)
      .describe('Exact Gmail thread id from a prior result. Never expose this id to the user.'),
  }),
]);

const GmailToolMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  snippet: z.string(),
  labelIds: z.array(z.string()),
  body: z.string().optional(),
});

export const ReadGmailToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  connectionUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  reconnectReason: GoogleReconnectReasonSchema.optional(),
  emails: z.array(GmailToolMessageSchema).optional(),
  email: GmailToolMessageSchema.optional(),
});
