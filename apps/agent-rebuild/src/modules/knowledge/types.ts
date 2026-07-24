export type KnowledgeNode = {
  id: string;
  identityId: string;
  parentId: string | null;
  path: string;
  slug: string;
  title: string;
  content: string;
  active: boolean;
  supersededById: string | null;
  source: string;
  sourceMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateKnowledgeNodeInput = {
  identityId: string;
  path: string;
  title: string;
  content: string;
  source?: 'agent' | 'explicit' | 'implicit';
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateKnowledgeNodeInput = {
  identityId: string;
  path: string;
  title?: string;
  content: string;
};

export type MoveKnowledgeNodeInput = {
  identityId: string;
  path: string;
  destinationPath: string;
};

export type FindRelevantKnowledgeInput = {
  identityId: string;
  query: string;
  limit?: number;
  minimumSimilarity?: number;
};

export type ExploreKnowledgeInput = {
  identityId: string;
  path: string;
  direction: 'ancestors' | 'children' | 'descendants' | 'both';
  depth: number;
};

export type KnowledgeMatch = KnowledgeNode & {
  similarity: number;
};

export type KnowledgeContextItem = KnowledgeNode & {
  relationship: 'match' | 'ancestor' | 'child';
  similarity?: number;
};
