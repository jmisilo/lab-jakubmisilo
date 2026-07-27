import type {
  ImplicitKnowledgeExtractionSchema,
  ImplicitKnowledgeIngestionDecisionSchema,
  KnowledgeExploreDirectionSchema,
} from '@/app/knowledge/schemas';
import type { ShortTermMemory } from '@/app/memory/types';
import type { AgentKnowledgeNode, AgentKnowledgeSource } from '@/types';
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

export type ExplicitKnowledgeNodeDraft = {
  parentPath?: string;
  slug?: string;
  title: string;
  content: string;
};

export type ApplyExplicitKnowledgeMutationInput = {
  identityId: string;
  sourceMessageId?: string;
} & (
  | {
      action: 'create';
      node: ExplicitKnowledgeNodeDraft;
    }
  | {
      action: 'update';
      path: string;
      update: {
        title?: string;
        content: string;
      };
    }
  | {
      action: 'deactivate';
      path: string;
    }
  | {
      action: 'move';
      path: string;
      move: {
        parentPath?: string | null;
        slug?: string;
        title?: string;
      };
    }
  | {
      action: 'supersede';
      path: string;
      node: ExplicitKnowledgeNodeDraft;
      supersededByPath?: never;
    }
  | {
      action: 'supersede';
      path: string;
      node?: never;
      supersededByPath: string;
    }
);

export type ExplicitKnowledgeMutationOutcome =
  | {
      action: 'create';
      node: AgentKnowledgeNode;
    }
  | {
      action: 'update';
      node: AgentKnowledgeNode;
    }
  | {
      action: 'deactivate';
      node: AgentKnowledgeNode;
    }
  | {
      action: 'move';
      previousPath: string;
      node: AgentKnowledgeNode;
    }
  | {
      action: 'supersede';
      node: AgentKnowledgeNode | null;
      supersededNode: AgentKnowledgeNode;
    };

export type ExploreKnowledgeNodesInput = {
  identityId: string;
  startPath?: string;
  query?: string;
  direction?: KnowledgeExploreDirection;
  maxDepth?: number;
  includeInactive?: boolean;
  includeContentPreview?: boolean;
  limit?: number;
};

export type SupersedeKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  supersededByPath: string;
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

export type KnowledgeExploreDirection = z.infer<typeof KnowledgeExploreDirectionSchema>;
