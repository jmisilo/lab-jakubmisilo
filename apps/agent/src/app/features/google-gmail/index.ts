import type {
  GoogleGmailMessage,
  GoogleGmailMessageSummary,
} from '@/app/features/google-gmail/types';

import {
  GOOGLE_GMAIL_MESSAGE_BODY_MAX_CHARACTERS,
  GOOGLE_GMAIL_SEARCH_MAX_RESULTS,
  GOOGLE_GMAIL_THREAD_MAX_MESSAGES,
} from '@/app/features/google-gmail/schemas';
import { GoogleConnectionService } from '@/app/features/google/connection';
import { GoogleGmailApiClient } from '@/infrastructure/google/gmail';

export class GoogleGmailService {
  static async searchMessages({
    identityId,
    query,
    labelIds,
    maxResults = GOOGLE_GMAIL_SEARCH_MAX_RESULTS,
  }: SearchMessagesInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'gmail',
    });
    const references = await GoogleGmailApiClient.searchMessages({
      accessToken,
      query,
      labelIds,
      maxResults: Math.min(maxResults, GOOGLE_GMAIL_SEARCH_MAX_RESULTS),
    });
    const messages = await Promise.all(
      references.map((reference) =>
        GoogleGmailApiClient.getMessage({
          accessToken,
          messageId: reference.id,
          format: 'metadata',
        }),
      ),
    );

    return messages.map((message) => this.#toSummary(message));
  }

  static async readMessage({ identityId, messageId }: ReadMessageInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'gmail',
    });
    const message = await GoogleGmailApiClient.getMessage({ accessToken, messageId });

    return this.#toMessage(message);
  }

  static async readThread({ identityId, threadId }: ReadThreadInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'gmail',
    });
    const thread = await GoogleGmailApiClient.getThread({ accessToken, threadId });

    return [...(thread.messages ?? [])]
      .sort((left, right) => Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0))
      .slice(-GOOGLE_GMAIL_THREAD_MAX_MESSAGES)
      .map((message) => this.#toMessage(message));
  }

  static #toSummary(message: GoogleApiMessage): GoogleGmailMessageSummary {
    return {
      id: message.id,
      threadId: message.threadId,
      subject: GoogleGmailApiClient.getHeader(message.payload, 'Subject') ?? '(no subject)',
      from: GoogleGmailApiClient.getHeader(message.payload, 'From'),
      to: GoogleGmailApiClient.getHeader(message.payload, 'To'),
      date: GoogleGmailApiClient.getHeader(message.payload, 'Date'),
      snippet: message.snippet ?? '',
      labelIds: message.labelIds ?? [],
    };
  }

  static #toMessage(message: GoogleApiMessage): GoogleGmailMessage {
    const summary = this.#toSummary(message);
    const body = GoogleGmailApiClient.getTextBody(message.payload);

    return {
      ...summary,
      body:
        body.length <= GOOGLE_GMAIL_MESSAGE_BODY_MAX_CHARACTERS
          ? body
          : `${body.slice(0, GOOGLE_GMAIL_MESSAGE_BODY_MAX_CHARACTERS)}\n[truncated]`,
    };
  }
}

type SearchMessagesInput = {
  identityId: string;
  query?: string;
  labelIds?: string[];
  maxResults?: number;
};

type ReadMessageInput = {
  identityId: string;
  messageId: string;
};

type ReadThreadInput = {
  identityId: string;
  threadId: string;
};

type GoogleApiMessage = Awaited<ReturnType<typeof GoogleGmailApiClient.getMessage>>;
