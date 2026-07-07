import { AgentPromptService } from '@/app/agent/prompt';

describe('AgentPromptService', () => {
  it('builds a sectioned static prompt with knowledge guidance', () => {
    const prompt = AgentPromptService.buildSystemPrompt({
      skills: [
        {
          name: 'knowledge-management',
          description: 'How to manage durable knowledge.',
        },
      ],
    });

    expect(prompt).toContain('# Identity');
    expect(prompt).not.toContain('# Runtime Context');
    expect(prompt).not.toContain('identity-1');
    expect(prompt).not.toContain('2026-07-05');
    expect(prompt).not.toContain('Europe/Warsaw');
    expect(prompt).toContain('# User Experience');
    expect(prompt).toContain('Default style: casual, warm, natural, direct, and short.');
    expect(prompt).toContain('Sound like a sharp friend who works with the user');
    expect(prompt).toContain('# Privacy And Metadata');
    expect(prompt).toContain('operation IDs, debug IDs, error codes');
    expect(prompt).toContain('# Knowledge Use');
    expect(prompt).toContain('without exposing debug or operation metadata');
    expect(prompt).toContain('work/history/company-x');
    expect(prompt).toContain('create or identify Company Y, then supersede Company X');
    expect(prompt).toContain('# Skills');
    expect(prompt).toContain('- knowledge-management: How to manage durable knowledge.');
    expect(prompt).toContain('Use load-skill to load full content');
    expect(prompt).toContain('# Tool Knowledge And Routing');
    expect(prompt).toContain('Do not invent tool capabilities.');
    expect(prompt).toContain(
      'Never say a task was scheduled, cancelled, or updated until manage-schedule returns ok=true.',
    );
  });

  it('builds a stable provider prompt cache key from identity and prompt shape', () => {
    const context = {
      identityId: 'identity-1',
      tools: ['load-skill', 'manage-knowledge', 'get-weather'],
      skills: [
        {
          name: 'knowledge-management',
          description: 'How to manage durable knowledge.',
        },
      ],
    };

    expect(AgentPromptService.buildPromptCacheKey(context)).toBe(
      AgentPromptService.buildPromptCacheKey(context),
    );
    expect(AgentPromptService.buildPromptCacheKey(context)).toMatch(
      /^agent-prompt:v1:identity-1:[a-f0-9]{16}$/,
    );
    expect(
      AgentPromptService.buildPromptCacheKey({
        ...context,
        tools: ['load-skill'],
      }),
    ).not.toBe(AgentPromptService.buildPromptCacheKey(context));
  });

  it('builds a fresh runtime context message for relative time handling', () => {
    const runtimeClock = {
      currentDate: '2026-07-07',
      currentDateTime: '2026-07-07 07:41',
      currentUtcDateTime: '2026-07-07T05:41:00.000Z',
      currentWeekday: 'Tuesday',
      timeZone: 'Europe/Warsaw',
      timeZoneOffset: 'UTC+02:00',
    };
    const message = AgentPromptService.buildRuntimeContextMessage(runtimeClock);

    expect(message.role).toBe('system');
    expect(message.content).toContain('# Current Runtime Context');
    expect(message.content).toContain('Tuesday, 2026-07-07 07:41 Europe/Warsaw (UTC+02:00)');
    expect(message.content).toContain('"in 15 minutes"');
    expect(message.content).toContain('prefer this message and the latest user message');
  });

  it('places fresh runtime context immediately before the latest message', () => {
    const latestMessage = {
      role: 'user' as const,
      content: 'Remind me in 15 minutes.',
    };
    const messages = AgentPromptService.buildMessagesWithRuntimeContext({
      messages: [
        {
          role: 'user',
          content: 'Earlier message.',
        },
        {
          role: 'assistant',
          content: 'Earlier response.',
        },
        latestMessage,
      ],
      runtimeClock: {
        currentDate: '2026-07-07',
        currentDateTime: '2026-07-07 07:41',
        currentUtcDateTime: '2026-07-07T05:41:00.000Z',
        currentWeekday: 'Tuesday',
        timeZone: 'Europe/Warsaw',
        timeZoneOffset: 'UTC+02:00',
      },
    });

    expect(messages).toHaveLength(4);
    expect(messages.at(-2)?.role).toBe('system');
    expect(messages.at(-2)?.content).toContain('# Current Runtime Context');
    expect(messages.at(-1)).toBe(latestMessage);
  });
});
