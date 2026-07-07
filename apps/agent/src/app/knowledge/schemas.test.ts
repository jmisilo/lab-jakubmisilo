import {
  ImplicitKnowledgeExtractionModelOutputSchema,
  ImplicitKnowledgeExtractionSchema,
  ImplicitKnowledgeIngestionDecisionModelOutputSchema,
  ImplicitKnowledgeIngestionDecisionSchema,
  KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS,
  ManageKnowledgeToolInputSchema,
  ReadKnowledgeToolInputSchema,
} from '@/app/knowledge/schemas';

describe('knowledge schemas', () => {
  it('strips fields that do not belong to the selected manage-knowledge action', () => {
    const parsed = ManageKnowledgeToolInputSchema.parse({
      action: 'create',
      path: 'profile/gender',
      supersededByPath: '/',
      node: {
        parentPath: 'profile',
        slug: 'gender',
        title: 'User gender',
        content: 'The user is male.',
      },
      update: {
        title: 'User gender',
        content: 'The user is male.',
      },
    });

    expect(parsed).toEqual({
      action: 'create',
      node: {
        parentPath: 'profile',
        slug: 'gender',
        title: 'User gender',
        content: 'The user is male.',
      },
    });
  });

  it('accepts bounded long explicit notes and rejects unbounded note content', () => {
    expect(
      ManageKnowledgeToolInputSchema.safeParse({
        action: 'create',
        node: {
          title: 'Long note',
          content: 'a'.repeat(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS),
        },
      }).success,
    ).toBe(true);

    expect(
      ManageKnowledgeToolInputSchema.safeParse({
        action: 'create',
        node: {
          title: 'Too long note',
          content: 'a'.repeat(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS + 1),
        },
      }).success,
    ).toBe(false);
  });

  it('accepts bounded explore input for subtree traversal', () => {
    const parsed = ReadKnowledgeToolInputSchema.parse({
      action: 'explore',
      startPath: 'projects/lab-agent',
      query: 'knowledge retrieval',
      direction: 'descendants',
      maxDepth: 3,
      limit: 12,
      includeContentPreview: true,
    });

    expect(parsed).toEqual({
      action: 'explore',
      startPath: 'projects/lab-agent',
      query: 'knowledge retrieval',
      direction: 'descendants',
      maxDepth: 3,
      limit: 12,
      includeContentPreview: true,
    });
  });

  it('keeps read-only and mutation knowledge actions separated by tool schema', () => {
    expect(
      ReadKnowledgeToolInputSchema.safeParse({
        action: 'create',
        node: {
          title: 'User preference',
          content: 'The user prefers concise answers.',
        },
      }).success,
    ).toBe(false);

    expect(
      ManageKnowledgeToolInputSchema.safeParse({
        action: 'explore',
        query: 'work',
      }).success,
    ).toBe(false);
  });

  it('normalizes null implicit parent paths to undefined', () => {
    const parsed = ImplicitKnowledgeExtractionSchema.parse({
      items: [
        {
          parentPath: null,
          slug: null,
          title: 'User gender',
          content: 'The user is male.',
          confidence: 0.9,
          reason: null,
        },
      ],
    });

    expect(parsed.items[0]?.parentPath).toBeUndefined();
    expect(parsed.items[0]?.slug).toBeUndefined();
    expect(parsed.items[0]?.reason).toBeUndefined();
  });

  it('accepts nullable fields in structured implicit extraction model output', () => {
    const parsed = ImplicitKnowledgeExtractionModelOutputSchema.parse({
      items: [
        {
          parentPath: null,
          slug: null,
          title: 'User gender',
          content: 'The user is male.',
          confidence: 0.9,
          reason: null,
        },
      ],
    });

    expect(parsed.items[0]?.parentPath).toBeNull();
    expect(parsed.items[0]?.slug).toBeNull();
    expect(parsed.items[0]?.reason).toBeNull();
  });

  it('normalizes null implicit ingestion decision fields to undefined', () => {
    const parsed = ImplicitKnowledgeIngestionDecisionSchema.parse({
      action: 'create',
      targetPath: null,
      parentPath: null,
      slug: null,
      title: null,
      content: null,
      reason: null,
    });

    expect(parsed).toEqual({
      action: 'create',
      targetPath: undefined,
      parentPath: undefined,
      slug: undefined,
      title: undefined,
      content: undefined,
      reason: undefined,
    });
  });

  it('accepts nullable fields in structured ingestion decision model output', () => {
    const parsed = ImplicitKnowledgeIngestionDecisionModelOutputSchema.parse({
      action: 'skip',
      targetPath: 'profile/age',
      parentPath: null,
      slug: null,
      title: null,
      content: null,
      reason: null,
    });

    expect(parsed).toEqual({
      action: 'skip',
      targetPath: 'profile/age',
      parentPath: null,
      slug: null,
      title: null,
      content: null,
      reason: null,
    });
  });
});
