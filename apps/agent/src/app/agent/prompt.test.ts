import { AgentPromptService } from '@/app/agent/prompt';

describe('AgentPromptService', () => {
  it('builds a sectioned prompt with runtime context and knowledge guidance', () => {
    const prompt = AgentPromptService.buildSystemPrompt({
      identityId: 'identity-1',
      currentDate: '2026-07-05',
      timeZone: 'Europe/Warsaw',
      tools: ['load-skill', 'manage-knowledge', 'get-weather'],
      skills: [
        {
          name: 'knowledge-management',
          description: 'How to manage durable knowledge.',
        },
      ],
    });

    expect(prompt).toContain('# Identity');
    expect(prompt).toContain('# Runtime Context');
    expect(prompt).toContain('- Identity ID: identity-1');
    expect(prompt).toContain('- Current date: 2026-07-05');
    expect(prompt).toContain('- User timezone: Europe/Warsaw');
    expect(prompt).toContain('- Available tools: load-skill, manage-knowledge, get-weather');
    expect(prompt).toContain('# User Experience');
    expect(prompt).toContain('Default style: casual, natural, direct, and short.');
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
    expect(prompt.indexOf('# Runtime Context')).toBeGreaterThan(
      prompt.indexOf('# Safety And Side Effects'),
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
});
