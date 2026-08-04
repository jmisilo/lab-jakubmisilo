import type { CoreMessage } from '@mastra/core/llm';
import type { Message, Thread } from 'chat';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';

import type { AgentResult, AskUserSuspension } from './response';
import { logger } from '../../infrastructure/logger';
import { agent } from '../agent';
import { resolveTimeZone } from '../agent/runtime-context';
import { AttachmentService } from '../attachments';
import { trackAgentResponse } from './feedback';
import { normalizeIMessagePost } from './imessage';
import { extractResponseText, formatAskUserQuestion, readAskUserSuspension } from './response';
import { chatState } from './transport';

const PENDING_QUESTION_TTL_MS = 24 * 60 * 60 * 1_000;

export class BotHandler {
  static async respondToMessage({
    event,
    thread,
    message,
  }: {
    event: string;
    thread: Thread;
    message: Message;
  }) {
    const resourceId = message.author.userId;

    logger.info('Inbound message handling started', {
      eventType: event,
      messageId: message.id,
      resourceId,
      threadId: thread.id,
    });

    await this.#startMessageLifecycle(thread);

    try {
      const pendingKey = pendingQuestionKey(thread.id);
      const pending = await chatState.get<PendingAgentQuestion>(pendingKey);
      const requestContext = createRequestContext({
        eventType: event,
        message,
        resourceId,
        threadId: thread.id,
        operationMessageId: pending?.operationMessageId,
      });

      let result: AgentResult;

      if (pending) {
        try {
          result = (await agent.resumeGenerate(message.text.trim(), {
            runId: pending.runId,
            toolCallId: pending.toolCallId,
            memory: { resource: resourceId, thread: thread.id },
            requestContext,
          })) as AgentResult;
        } catch (error) {
          await chatState.delete(pendingKey);
          throw error;
        }
      } else {
        await AttachmentService.prepareMessage(message);
        result = (await agent.generate(createUserMessage(message), {
          memory: { resource: resourceId, thread: thread.id },
          requestContext,
        })) as AgentResult;
      }

      const suspension = readAskUserSuspension(result);

      if (suspension) {
        await this.#postQuestion(thread, pendingKey, message, suspension, result);
        return;
      }

      if (pending) {
        await chatState.delete(pendingKey);
      }

      const sent = await thread.post(normalizeIMessagePost(extractResponseText(result)));
      await trackAgentResponse(sent.id, {
        resourceId,
        threadId: thread.id,
        traceId: result.traceId,
        spanId: result.spanId,
        runId: result.runId,
      });

      logger.info('Inbound message handling completed', {
        messageId: message.id,
        resourceId,
        threadId: thread.id,
      });
    } catch (error) {
      logger.error('Inbound message handling failed', {
        messageId: message.id,
        resourceId,
        threadId: thread.id,
        error: describeError(error),
      });

      await this.#postFailure(thread);
    }
  }

  static async #postQuestion(
    thread: Thread,
    pendingKey: string,
    message: Message,
    suspension: AskUserSuspension,
    result: AgentResult,
  ) {
    const pending = {
      ...suspension,
      operationMessageId: message.id,
    } satisfies PendingAgentQuestion;

    // Persist the continuation only while the question is being delivered.
    // If posting fails, clear it so the next user message is not consumed as
    // an answer to a question they never received.
    await chatState.set(pendingKey, pending, PENDING_QUESTION_TTL_MS);

    try {
      const sent = await thread.post(normalizeIMessagePost(formatAskUserQuestion(suspension)));
      await trackAgentResponse(sent.id, {
        resourceId: message.author.userId,
        threadId: thread.id,
        traceId: result.traceId,
        spanId: result.spanId,
        runId: result.runId,
      });
    } catch (error) {
      await chatState.delete(pendingKey);
      throw error;
    }
  }

  static async #startMessageLifecycle(thread: Thread) {
    const results = await Promise.allSettled([this.#markRead(thread), thread.startTyping()]);

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn('iMessage message lifecycle operation failed', {
          threadId: thread.id,
          error: describeError(result.reason),
        });
      }
    }
  }

  static async #markRead(thread: Thread) {
    const adapter = thread.adapter as { markRead?: (threadId: string) => Promise<void> };

    if (typeof adapter.markRead === 'function') {
      await adapter.markRead(thread.id);
    }
  }

  static async #postFailure(thread: Thread) {
    try {
      await thread.post(
        normalizeIMessagePost('I hit a failure while handling that request. Please retry.'),
      );
    } catch (postError) {
      logger.error('Failure message could not be posted', {
        threadId: thread.id,
        error: describeError(postError),
      });
    }
  }
}

function createRequestContext({
  eventType,
  message,
  operationMessageId,
  resourceId,
  threadId,
}: {
  eventType: string;
  message: Message;
  operationMessageId?: string;
  resourceId: string;
  threadId: string;
}) {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, threadId);
  requestContext.set('timeZone', resolveTimeZone());
  requestContext.set('channel', {
    platform: 'imessage',
    eventType,
    userId: resourceId,
    threadId,
    messageId: operationMessageId ?? message.id,
  });
  return requestContext;
}

function createUserMessage(message: Message): CoreMessage[] {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: message.text }];

  for (const attachment of message.attachments) {
    if (!attachment.data || !attachment.mimeType) {
      continue;
    }

    content.push({
      type: 'file',
      data: attachment.data,
      mimeType: attachment.mimeType,
      ...(attachment.name ? { filename: attachment.name } : {}),
    });
  }

  return [{ role: 'user', content: content as never }];
}

function pendingQuestionKey(threadId: string) {
  return `pending-agent-question:${threadId}`;
}

type PendingAgentQuestion = AskUserSuspension & {
  operationMessageId: string;
};

function describeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 500) }
    : { name: 'UnknownError', message: String(error).slice(0, 500) };
}
