import type { FeedbackInput } from '@mastra/core/observability';
import type { Lock, ReactionEvent, StateAdapter } from 'chat';

import { createHash } from 'node:crypto';

import { logger } from '../../infrastructure/logger';
import { agentObservability } from '../../mastra/observability';
import { chatState } from './transport';

const RESPONSE_TRACE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const REACTION_STATE_TTL_MS = RESPONSE_TRACE_TTL_MS;
const REACTION_LOCK_TTL_MS = 30 * 1_000;

export type FeedbackState = Pick<StateAdapter, 'acquireLock' | 'releaseLock' | 'get' | 'set'>;
export type FeedbackObservability = Pick<typeof agentObservability, 'addFeedback' | 'flush'>;

export type AgentTraceContext = {
  resourceId: string;
  threadId: string;
  traceId?: string;
  spanId?: string;
  runId?: string;
};

export type ResponseTrace = AgentTraceContext & {
  recordedAt: string;
};

export type ReactionFeedbackDependencies = {
  state: FeedbackState;
  observability: FeedbackObservability;
};

const defaultDependencies: ReactionFeedbackDependencies = {
  state: chatState,
  observability: agentObservability,
};

/**
 * Keep the trace associated with the platform message, not with a local
 * process. Reactions can arrive in a later serverless invocation.
 */
export async function trackAgentResponse(
  messageId: string,
  context: AgentTraceContext,
  state: FeedbackState = chatState,
) {
  const traceId = context.traceId?.trim();

  if (!messageId || !traceId) {
    return;
  }

  const response: ResponseTrace = {
    ...context,
    traceId,
    ...(context.spanId?.trim() ? { spanId: context.spanId.trim() } : {}),
    ...(context.runId?.trim() ? { runId: context.runId.trim() } : {}),
    recordedAt: new Date().toISOString(),
  };

  try {
    await state.set(responseKey(messageId), response, RESPONSE_TRACE_TTL_MS);
  } catch (error) {
    // The response has already been delivered. A state failure must not make
    // the bot post a second failure response to the user.
    logger.warn('Agent response feedback mapping could not be persisted', {
      messageId,
      threadId: context.threadId,
      error: describeError(error),
    });
  }
}

/**
 * Convert Chat SDK reaction events into Mastra feedback without invoking the
 * agent. State transitions are serialized per response/user/reaction so
 * duplicate webhook deliveries remain harmless.
 */
export async function handleReactionFeedback(
  event: ReactionEvent,
  dependencies: ReactionFeedbackDependencies = defaultDependencies,
) {
  let lock: Lock | undefined;
  try {
    const response = await dependencies.state.get<ResponseTrace>(responseKey(event.messageId));

    if (!response || response.threadId !== event.threadId || !response.traceId) {
      return;
    }

    const reaction = normalizeReaction(event.rawEmoji);

    if (!reaction || !event.user.userId) {
      return;
    }

    const reactionStateKey = stateKey(event, reaction);
    lock =
      (await dependencies.state.acquireLock(reactionStateKey, REACTION_LOCK_TTL_MS)) ?? undefined;

    if (!lock) {
      logger.debug('Reaction feedback event skipped because its state is locked', {
        messageId: event.messageId,
        threadId: event.threadId,
      });
      return;
    }

    const current = await dependencies.state.get<StoredReactionState>(reactionStateKey);

    // A removal without a previously observed addition is not actionable.
    // This can happen when the webhook was enabled after the reaction was
    // added, or when an old event is replayed.
    if (!event.added && !current?.active) {
      return;
    }

    if (current?.active === event.added) {
      return;
    }

    const sourceId = reactionSourceId(event, reaction);
    const feedback = createFeedback(event, reaction, sourceId);

    await dependencies.observability.addFeedback({
      traceId: response.traceId,
      ...(response.spanId ? { spanId: response.spanId } : {}),
      // Supplying correlationContext makes this a direct exporter event. It
      // avoids requiring the production Platform-only setup to rehydrate the
      // trace from the local Mastra Postgres store.
      correlationContext: {
        resourceId: response.resourceId,
        threadId: response.threadId,
        ...(response.runId ? { runId: response.runId } : {}),
        source: 'imessage',
        serviceName: 'agent',
      },
      feedback,
    });

    // Mastra buffers non-tracing signals. Flush explicitly because this
    // handler normally runs in a short-lived serverless invocation.
    await dependencies.observability.flush();

    await dependencies.state.set(
      reactionStateKey,
      {
        active: event.added,
        sourceId,
        updatedAt: new Date().toISOString(),
      } satisfies StoredReactionState,
      REACTION_STATE_TTL_MS,
    );

    logger.info('Reaction feedback recorded', {
      added: event.added,
      feedbackType: feedback.feedbackType,
      messageId: event.messageId,
      threadId: event.threadId,
    });
  } catch (error) {
    logger.error('Reaction feedback could not be recorded', {
      added: event.added,
      messageId: event.messageId,
      threadId: event.threadId,
      error: describeError(error),
    });
  } finally {
    if (lock) {
      await releaseLock(dependencies.state, lock);
    }
  }
}

export function createFeedback(
  event: Pick<ReactionEvent, 'added' | 'messageId' | 'rawEmoji' | 'threadId' | 'user'>,
  reaction: string,
  sourceId: string,
): FeedbackInput {
  const thumbs = reaction === 'like' || reaction === 'dislike';
  const isRemoval = !event.added;

  return {
    feedbackSource: 'user',
    feedbackType: isRemoval
      ? thumbs
        ? 'thumbs_removed'
        : 'tapback_removed'
      : thumbs
        ? 'thumbs'
        : 'tapback',
    value: !isRemoval && thumbs ? (reaction === 'like' ? 1 : -1) : reaction,
    feedbackUserId: `imessage-user:${digest(event.user.userId)}`,
    sourceId,
    metadata: {
      action: isRemoval ? 'removed' : 'added',
      channel: 'imessage',
      messageId: event.messageId,
      reaction,
      threadId: event.threadId,
    },
  };
}

export function responseKey(messageId: string) {
  return `feedback:response:${encodeURIComponent(messageId)}`;
}

function stateKey(event: ReactionEvent, reaction: string) {
  return `feedback:reaction:${digest(
    [event.threadId, event.messageId, event.user.userId, reaction].join('\u0000'),
  )}`;
}

function reactionSourceId(event: ReactionEvent, reaction: string) {
  return `imessage-reaction:${digest(
    [event.threadId, event.messageId, event.user.userId, reaction].join('\u0000'),
  )}`;
}

function normalizeReaction(rawEmoji: string) {
  const reaction = rawEmoji.trim().toLowerCase();
  return reaction || undefined;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function releaseLock(state: FeedbackState, lock: Lock) {
  try {
    await state.releaseLock(lock);
  } catch (error) {
    logger.warn('Reaction feedback state lock could not be released', {
      threadId: lock.threadId,
      error: describeError(error),
    });
  }
}

type StoredReactionState = {
  active: boolean;
  sourceId: string;
  updatedAt: string;
};

function describeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 500) }
    : { name: 'UnknownError', message: String(error).slice(0, 500) };
}
