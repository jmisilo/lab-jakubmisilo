import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeContextProcessor } from './runtime-context';

describe('RuntimeContextProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one clock snapshot throughout an agent tool loop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T08:00:00.000Z'));

    const processor = new RuntimeContextProcessor();
    const state: Record<string, unknown> = {};
    const args = {
      requestContext: {
        get: () => undefined,
      },
      state,
    };

    processor.processInputStep(args as never);
    const initialContext = state.runtimeContext;

    vi.setSystemTime(new Date('2026-07-28T08:05:00.000Z'));
    processor.processInputStep(args as never);

    expect(state.runtimeContext).toBe(initialContext);
    expect(state.runtimeContext).toContain('2026-07-28T08:00:00.000Z');
    expect(state.runtimeContext).not.toContain('2026-07-28T08:05:00.000Z');
  });
});
