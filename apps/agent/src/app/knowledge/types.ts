import type {
  ImplicitKnowledgeExtractionSchema,
  ImplicitKnowledgeIngestionDecisionSchema,
} from '@/app/knowledge/schemas';
import type { ShortTermMemory } from '@/app/memory/types';
import type { AgentKnowledgeSource } from '@/types';
import type { z } from 'zod';

export type CreateKnowledgeNodeInput = {
  identityId: string;
  parentId?: string | null;
  parentPath?: string | null;
  slug?: string;
  title: string;
  content?: string;
  source?: AgentKnowledgeSource;
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateKnowledgeNodeContentInput = {
  identityId: string;
  nodeId: string;
  title?: string;
  content: string;
};

export type UpdateKnowledgeNodeByPathInput = Omit<UpdateKnowledgeNodeContentInput, 'nodeId'> & {
  path: string;
};

export type ListKnowledgeNodesInput = {
  identityId: string;
  parentPath?: string | null;
  includeInactive?: boolean;
  limit?: number;
};

export type ReadKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  includeInactive?: boolean;
};

export type DeactivateKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
};

export type MoveKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  newParentPath?: string | null;
  newSlug?: string;
  title?: string;
};

export type SupersedeKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  supersededById?: string;
};

export type SupersedeKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  supersededByPath?: string;
};

export type GetContextItemsInput = {
  identityId: string;
  shortTermMemory: ShortTermMemory[];
};

export type ExtractImplicitKnowledgeInput = {
  identityId: string;
  threadId: string;
  sourceMessageId: string;
  userMessage: string;
  assistantMessage: string;
};

export type ImplicitKnowledgeItem = z.infer<
  typeof ImplicitKnowledgeExtractionSchema
>['items'][number];

export type ImplicitKnowledgeIngestionDecision = z.infer<
  typeof ImplicitKnowledgeIngestionDecisionSchema
>;

export type ImplicitKnowledgeIngestionAction = ImplicitKnowledgeIngestionDecision['action'];

export type ImplicitKnowledgeIngestionOutcome = {
  action: ImplicitKnowledgeIngestionAction;
  path?: string;
  targetPath?: string;
};
