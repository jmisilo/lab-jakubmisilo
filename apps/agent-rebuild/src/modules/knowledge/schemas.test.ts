import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ManageKnowledgeInputSchema,
  ManageKnowledgeRequestSchema,
  ReadKnowledgeInputSchema,
  ReadKnowledgeRequestSchema,
} from './schemas';

describe('knowledge schemas', () => {
  it('applies bounded exploration defaults', () => {
    const result = ReadKnowledgeRequestSchema.parse({
      action: 'explore',
      path: 'projects/personal-agent',
    });

    expect(result).toEqual({
      action: 'explore',
      path: 'projects/personal-agent',
      direction: 'both',
      depth: 2,
    });
  });

  it('exposes object-shaped schemas to tool providers', () => {
    expect(z.toJSONSchema(ReadKnowledgeInputSchema)).toMatchObject({ type: 'object' });
    expect(z.toJSONSchema(ManageKnowledgeInputSchema)).toMatchObject({ type: 'object' });
  });

  it('accepts long notes up to the storage limit', () => {
    const result = ManageKnowledgeRequestSchema.parse({
      action: 'create',
      path: 'journal/2026/07/24',
      title: 'Journal entry',
      content: 'x'.repeat(20_000),
    });

    expect(result.action).toBe('create');

    if (result.action !== 'create') {
      throw new Error('Expected a create knowledge request.');
    }

    expect(result.content).toHaveLength(20_000);
  });

  it('rejects notes above the storage limit', () => {
    expect(() =>
      ManageKnowledgeRequestSchema.parse({
        action: 'create',
        path: 'journal/2026/07/24',
        title: 'Journal entry',
        content: 'x'.repeat(20_001),
      }),
    ).toThrow();
  });
});
