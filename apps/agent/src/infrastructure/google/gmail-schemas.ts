import { z } from 'zod';

const GoogleGmailMessageReferenceSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
});

export const GoogleGmailMessageListResponseSchema = z.object({
  messages: z.array(GoogleGmailMessageReferenceSchema).optional(),
});

const GoogleGmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const GoogleGmailMessagePartBodySchema = z.object({
  size: z.number().optional(),
  data: z.string().optional(),
  attachmentId: z.string().optional(),
});

export type GoogleGmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<z.infer<typeof GoogleGmailHeaderSchema>>;
  body?: z.infer<typeof GoogleGmailMessagePartBodySchema>;
  parts?: GoogleGmailMessagePart[];
};

const GoogleGmailMessagePartSchema: z.ZodType<GoogleGmailMessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(GoogleGmailHeaderSchema).optional(),
    body: GoogleGmailMessagePartBodySchema.optional(),
    parts: z.array(GoogleGmailMessagePartSchema).optional(),
  }),
);

export const GoogleGmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: GoogleGmailMessagePartSchema.optional(),
});

export const GoogleGmailThreadSchema = z.object({
  id: z.string().min(1),
  messages: z.array(GoogleGmailMessageSchema).optional(),
});
