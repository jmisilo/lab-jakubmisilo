import {
  ImplicitKnowledgeExtractionSchema,
  ManageKnowledgeToolInputSchema,
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

  it('normalizes null implicit parent paths to undefined', () => {
    const parsed = ImplicitKnowledgeExtractionSchema.parse({
      items: [
        {
          parentPath: null,
          title: 'User gender',
          content: 'The user is male.',
          confidence: 0.9,
        },
      ],
    });

    expect(parsed.items[0]?.parentPath).toBeUndefined();
  });
});
