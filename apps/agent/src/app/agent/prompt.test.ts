import { AgentPromptService } from '@/app/agent/prompt';

describe('AgentPromptService', () => {
  it('builds a sectioned prompt with runtime context and knowledge guidance', () => {
    const prompt = AgentPromptService.buildSystemPrompt({
      identityId: 'identity-1',
      currentDate: '2026-07-05',
      timeZone: 'Europe/Warsaw',
      tools: ['manage-knowledge', 'get-weather'],
    });

    expect(prompt).toContain('# Identity');
    expect(prompt).toContain('# Runtime Context');
    expect(prompt).toContain('- Identity ID: identity-1');
    expect(prompt).toContain('- Current date: 2026-07-05');
    expect(prompt).toContain('- User timezone: Europe/Warsaw');
    expect(prompt).toContain('- Available tools: manage-knowledge, get-weather');
    expect(prompt).toContain('# Knowledge Use');
    expect(prompt).toContain('work/history/company-x');
    expect(prompt).toContain('create or identify Company Y, then supersede Company X');
  });
});
