import type { AdapterPostableMessage } from 'chat';

import { describe, expect, it, vi } from 'vitest';

import type { ReplyDeliveryThread, ReplyPlanner } from './reply-delivery';
import {
  createReplyPlan,
  deliverAgentReply,
  isPartialReplyDeliveryFailure,
} from './reply-delivery';

vi.mock('./feedback', () => ({
  trackAgentResponse: vi.fn(),
}));

const traceContext = {
  resourceId: 'resource-1',
  threadId: 'thread-1',
  traceId: 'trace-1',
  spanId: 'span-1',
  runId: 'run-1',
};

describe('reply delivery', () => {
  it('keeps a response as one exact bubble when the planner selects END first', async () => {
    const response = responseWithThreeBeats();
    const thread = createThread();

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      { planner: plannerFrom('END') },
    );

    expect(outcome).toMatchObject({ kind: 'delivered', usedFallback: false });
    expect(outcome.bubbles).toEqual([response]);
    expect(outcome.bubbles.join('')).toBe(response);
    expect(thread.postedText()).toEqual([response]);
    expect(thread.value.startTyping).not.toHaveBeenCalled();
  });

  it('delivers two exact bubbles in order, tracks both, and paces only the second', async () => {
    const response = responseWithThreeBeats();
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread();
    const waits: number[] = [];
    const tracked: Array<{ messageId: string; context: typeof traceContext }> = [];

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      {
        planner: plannerFrom(firstBoundary.id, 'END'),
        random: () => 0,
        trackResponse: async (messageId, context) => {
          tracked.push({ messageId, context: context as typeof traceContext });
        },
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      },
    );

    const expected = [
      response.slice(0, firstBoundary.offset),
      response.slice(firstBoundary.offset),
    ];

    expect(outcome.bubbles).toEqual(expected);
    expect(outcome.bubbles.join('')).toBe(response);
    expect(thread.postedText()).toEqual(expected.map((bubble) => bubble.trim()));
    expect(waits).toEqual([400]);
    expect(thread.value.startTyping).toHaveBeenCalledTimes(1);
    expect(tracked).toEqual([
      { messageId: 'sent-1', context: traceContext },
      { messageId: 'sent-2', context: traceContext },
    ]);
  });

  it('delivers at most three bubbles with bounded jitter and no trailing delay', async () => {
    const response = responseWithThreeBeats();
    const [firstBoundary, secondBoundary] = nonEndCandidates(response);
    const thread = createThread();
    const waits: number[] = [];
    const randomValues = [0, 1];

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      {
        planner: plannerFrom(firstBoundary!.id, secondBoundary!.id, 'END'),
        random: () => randomValues.shift() ?? 0.5,
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      },
    );

    const expected = [
      response.slice(0, firstBoundary!.offset),
      response.slice(firstBoundary!.offset, secondBoundary!.offset),
      response.slice(secondBoundary!.offset),
    ];

    expect(outcome.bubbles).toEqual(expected);
    expect(outcome.bubbles.join('')).toBe(response);
    expect(thread.postedText()).toEqual(expected.map((bubble) => bubble.trim()));
    expect(waits).toEqual([400, 1_200]);
    expect(thread.value.startTyping).toHaveBeenCalledTimes(2);
  });

  it('posts the first bubble before a deferred later planner selection completes', async () => {
    const response = responseWithThreeBeats();
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread();
    const firstPost = deferred<void>();
    const nextSelection = deferred<void>();

    thread.post.mockImplementationOnce(async (message) => {
      thread.posts.push(message);
      firstPost.resolve();
      return { id: 'sent-1' };
    });

    const planner: ReplyPlanner = {
      async *streamSelections() {
        yield { id: firstBoundary.id };
        await nextSelection.promise;
        yield { id: 'END' };
      },
    };

    const delivery = deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      { planner, wait: async () => undefined },
    );

    await firstPost.promise;
    expect(thread.postedText()).toEqual([response.slice(0, firstBoundary.offset)]);

    nextSelection.resolve();
    const outcome = await delivery;

    expect(outcome.bubbles.join('')).toBe(response);
  });

  it('excludes code, lists, tables, and URLs from locally safe split candidates', () => {
    const response = [
      '```txt',
      'A sentence. Another sentence.',
      '```',
      '- A list item. Another list clause.',
      '| item | value |',
      '| --- | --- |',
      '| one. | two. |',
      'See https://example.com/path.with.dots.',
    ].join('\n');

    expect(createReplyPlan(response).candidates).toEqual([
      { id: 'END', offset: response.length, kind: 'end' },
    ]);
  });

  it('falls back to the untouched original response when the first planner id is invalid', async () => {
    const response = responseWithThreeBeats();
    const thread = createThread();

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      { planner: plannerFrom('not-a-candidate') },
    );

    expect(outcome).toMatchObject({ kind: 'delivered', usedFallback: true });
    expect(outcome.bubbles).toEqual([response]);
    expect(thread.postedText()).toEqual([response]);
  });

  it('falls back to an untouched remainder when the planner fails after the first bubble', async () => {
    const response = responseWithThreeBeats();
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread();
    const waits: number[] = [];
    const planner: ReplyPlanner = {
      async *streamSelections() {
        yield { id: firstBoundary.id };
        throw new Error('planner went away');
      },
    };

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      {
        planner,
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      },
    );

    expect(outcome).toMatchObject({ kind: 'delivered', usedFallback: true });
    expect(outcome.bubbles).toEqual([
      response.slice(0, firstBoundary.offset),
      response.slice(firstBoundary.offset),
    ]);
    expect(outcome.bubbles.join('')).toBe(response);
    expect(waits).toHaveLength(1);
  });

  it('falls back to an untouched remainder for an out-of-order planner boundary', async () => {
    const response = responseWithThreeBeats();
    const [, secondBoundary] = nonEndCandidates(response);
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread();

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      {
        planner: plannerFrom(secondBoundary!.id, firstBoundary.id),
        wait: async () => undefined,
      },
    );

    expect(outcome).toMatchObject({ kind: 'delivered', usedFallback: true });
    expect(outcome.bubbles).toEqual([
      response.slice(0, secondBoundary!.offset),
      response.slice(secondBoundary!.offset),
    ]);
    expect(outcome.bubbles.join('')).toBe(response);
  });

  it('falls back to one untouched bubble when the planner errors before choosing one', async () => {
    const response = responseWithThreeBeats();
    const thread = createThread();
    const planner: ReplyPlanner = {
      async *streamSelections() {
        throw new Error('planner unavailable');
      },
    };

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      { planner },
    );

    expect(outcome).toMatchObject({ kind: 'delivered', usedFallback: true });
    expect(outcome.bubbles).toEqual([response]);
  });

  it('returns a typed partial-delivery outcome without retrying when a later platform post fails', async () => {
    const response = responseWithThreeBeats();
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread({ failPostNumber: 2 });

    const outcome = await deliverAgentReply(
      { responseText: response, thread: thread.value, traceContext },
      { planner: plannerFrom(firstBoundary.id, 'END'), wait: async () => undefined },
    );

    expect(isPartialReplyDeliveryFailure(outcome)).toBe(true);

    if (isPartialReplyDeliveryFailure(outcome)) {
      expect(outcome.messageIds).toEqual(['sent-1']);
      expect(outcome.bubbles).toEqual([response.slice(0, firstBoundary.offset)]);
    }

    expect(thread.value.post).toHaveBeenCalledTimes(2);
  });

  it('keeps a first platform post failure as a normal handler failure', async () => {
    const response = responseWithThreeBeats();
    const firstBoundary = nonEndCandidates(response)[0]!;
    const thread = createThread({ failPostNumber: 1 });

    await expect(
      deliverAgentReply(
        { responseText: response, thread: thread.value, traceContext },
        { planner: plannerFrom(firstBoundary.id, 'END') },
      ),
    ).rejects.toThrow('post 1 failed');

    expect(thread.value.post).toHaveBeenCalledTimes(1);
  });
});

function responseWithThreeBeats() {
  return [
    'I checked the details and the important part is already in place, so you do not need to chase anything down right now.',
    'The only thing worth watching is the confirmation later today, because that is where timing could still move.',
    'If it does shift, I can help you decide the next move as soon as it lands.',
  ].join(' ');
}

function nonEndCandidates(response: string) {
  return createReplyPlan(response).candidates.filter((candidate) => candidate.id !== 'END');
}

function plannerFrom(...ids: string[]): ReplyPlanner {
  return {
    async *streamSelections() {
      for (const id of ids) {
        yield { id };
      }
    },
  };
}

function createThread({ failPostNumber }: { failPostNumber?: number } = {}) {
  const posts: AdapterPostableMessage[] = [];
  let postCount = 0;
  const thread: ReplyDeliveryThread = {
    post: vi.fn(async (message) => {
      postCount += 1;

      if (postCount === failPostNumber) {
        throw new Error(`post ${postCount} failed`);
      }

      posts.push(message);
      return { id: `sent-${postCount}` };
    }),
    startTyping: vi.fn(async () => undefined),
  };

  return {
    posts,
    postedText: () => posts.map((post) => (post as { raw?: string }).raw ?? post),
    post: thread.post as ReturnType<typeof vi.fn>,
    value: thread,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
