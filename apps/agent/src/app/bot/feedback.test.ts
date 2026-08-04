import type { FeedbackInput } from '@mastra/core/observability';
import type { Lock, ReactionEvent } from 'chat';

import { describe, expect, it, vi } from 'vitest';

import type { FeedbackObservability, FeedbackState } from './feedback';
import {
  createFeedback,
  handleReactionFeedback,
  responseKey,
  trackAgentResponse,
} from './feedback';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost/agent-test';
});

describe('reaction feedback bridge', () => {
  it('persists the agent trace against the posted platform message', async () => {
    const state = createState();

    await trackAgentResponse(
      'imsg-1',
      {
        resourceId: 'resource-1',
        threadId: 'thread-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        runId: 'run-1',
      },
      state,
    );

    expect(state.values.get(responseKey('imsg-1'))).toMatchObject({
      resourceId: 'resource-1',
      threadId: 'thread-1',
      traceId: 'trace-1',
      spanId: 'span-1',
      runId: 'run-1',
    });
  });

  it('records thumbs feedback and ignores duplicate additions', async () => {
    const state = createState();
    const observability = createObservability();
    const dependencies = { state, observability };

    await trackAgentResponse(
      'imsg-2',
      { resourceId: 'resource-2', threadId: 'thread-2', traceId: 'trace-2' },
      state,
    );

    const event = reactionEvent({
      added: true,
      messageId: 'imsg-2',
      rawEmoji: 'like',
      threadId: 'thread-2',
      userId: '+48123456789',
    });

    await handleReactionFeedback(event, dependencies);
    await handleReactionFeedback(event, dependencies);

    expect(observability.feedback).toHaveLength(1);
    expect(observability.feedback[0]).toMatchObject({
      traceId: 'trace-2',
      feedback: {
        feedbackSource: 'user',
        feedbackType: 'thumbs',
        value: 1,
        metadata: { action: 'added', reaction: 'like' },
      },
    });
    expect((observability.feedback[0] as FeedbackCall).feedback.feedbackUserId).not.toContain(
      '+48123456789',
    );
    expect(observability.flushCount).toBe(1);
  });

  it('emits a removal tombstone and ignores duplicate removals', async () => {
    const state = createState();
    const observability = createObservability();
    const dependencies = { state, observability };

    await trackAgentResponse(
      'imsg-3',
      { resourceId: 'resource-3', threadId: 'thread-3', traceId: 'trace-3' },
      state,
    );

    const added = reactionEvent({
      added: true,
      messageId: 'imsg-3',
      rawEmoji: 'dislike',
      threadId: 'thread-3',
      userId: 'user-3',
    });
    const removed = reactionEvent({
      added: false,
      messageId: 'imsg-3',
      rawEmoji: 'dislike',
      threadId: 'thread-3',
      userId: 'user-3',
    });

    await handleReactionFeedback(added, dependencies);
    await handleReactionFeedback(removed, dependencies);
    await handleReactionFeedback(removed, dependencies);

    expect(observability.feedback).toHaveLength(2);
    expect(observability.feedback[1]).toMatchObject({
      feedback: {
        feedbackType: 'thumbs_removed',
        value: 'dislike',
        metadata: { action: 'removed', reaction: 'dislike' },
      },
    });
  });

  it('does not emit a removal tombstone when the addition was never observed', async () => {
    const state = createState();
    const observability = createObservability();

    await trackAgentResponse(
      'imsg-4',
      { resourceId: 'resource-4', threadId: 'thread-4', traceId: 'trace-4' },
      state,
    );

    await handleReactionFeedback(
      reactionEvent({
        added: false,
        messageId: 'imsg-4',
        rawEmoji: 'love',
        threadId: 'thread-4',
        userId: 'user-4',
      }),
      { state, observability },
    );

    expect(observability.feedback).toHaveLength(0);
  });

  it('maps non-thumb reactions to tapback feedback', () => {
    const feedback = createFeedback(
      reactionEvent({
        added: true,
        messageId: 'imsg-5',
        rawEmoji: 'love',
        threadId: 'thread-5',
        userId: 'user-5',
      }),
      'love',
      'source-5',
    );

    expect(feedback).toMatchObject({
      feedbackType: 'tapback',
      value: 'love',
      sourceId: 'source-5',
    });
  });
});

type FeedbackCall = {
  traceId?: string;
  spanId?: string;
  feedback: FeedbackInput;
};

function createState() {
  const values = new Map<string, unknown>();
  const locks = new Map<string, Lock>();

  const state: FeedbackState & {
    values: Map<string, unknown>;
  } = {
    values,
    async acquireLock(threadId) {
      if (locks.has(threadId)) {
        return null;
      }

      const lock = { expiresAt: Date.now() + 30_000, threadId, token: threadId };
      locks.set(threadId, lock);
      return lock;
    },
    async releaseLock(lock) {
      locks.delete(lock.threadId);
    },
    async get<T = unknown>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async set<T = unknown>(key: string, value: T) {
      values.set(key, value);
    },
  };

  return state;
}

function createObservability() {
  const feedback: FeedbackCall[] = [];

  const observability: FeedbackObservability & {
    feedback: FeedbackCall[];
    flushCount: number;
  } = {
    feedback,
    flushCount: 0,
    async addFeedback(call) {
      feedback.push(call);
    },
    async flush() {
      observability.flushCount += 1;
    },
  };

  return observability;
}

function reactionEvent({
  added,
  messageId,
  rawEmoji,
  threadId,
  userId,
}: {
  added: boolean;
  messageId: string;
  rawEmoji: string;
  threadId: string;
  userId: string;
}) {
  return {
    added,
    messageId,
    rawEmoji,
    threadId,
    user: { userId },
  } as unknown as ReactionEvent;
}
