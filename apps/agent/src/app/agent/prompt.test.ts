import { describe, expect, it } from 'vitest';

import { agentInstructions } from './prompt';

describe('agent conversation style', () => {
  it('asks for natural texting without forcing it', () => {
    expect(agentInstructions).toContain('informal, normal texting');
    expect(agentInstructions).toContain('do not force slang');
    expect(agentInstructions).toContain('one conversational beat by default');
  });

  it('uses ASCII hyphens by default while preserving exact user text', () => {
    expect(agentInstructions).toContain('Use an ASCII hyphen (-) instead.');
    expect(agentInstructions).toContain('Do not rewrite user-requested or quoted em dashes.');
    expect(agentInstructions).not.toContain('—');
  });
});
