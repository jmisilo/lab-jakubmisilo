export type GoogleGmailMessageSummary = {
  id: string;
  threadId: string;
  subject: string;
  from?: string;
  to?: string;
  date?: string;
  snippet: string;
  labelIds: string[];
};

export type GoogleGmailMessage = GoogleGmailMessageSummary & {
  body: string;
};
