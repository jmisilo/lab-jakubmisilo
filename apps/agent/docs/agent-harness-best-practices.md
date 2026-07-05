# Agent Harness Best Practices

Date: 2026-07-04

## Purpose

This document is an implementation guide for evolving `@labjm/agent` into a production-grade personal agent harness.

The harness is the system around the model: message intake, identity, memory, knowledge, tools, approvals, scheduling, prompt construction, context budgeting, telemetry, and user-facing surfaces. For this repo, Telegram via Chat SDK is the first surface, but the agent runtime should stay headless enough to serve Telegram, the local TUI, and future surfaces without changing core behavior.

This is not a request to recreate a coding-agent sandbox. The Vercel Academy guide is about a coding harness, so adapt the stable practices and ignore code-execution-specific pieces unless this app later needs a real workspace/shell sandbox.

## Source Notes

- Main external source read: https://vercel.com/academy/build-ai-agent-harness and its lesson markdown pages.
- Local source read: `apps/agent/node_modules/ai/docs/03-agents/*` and `apps/agent/node_modules/ai/docs/03-ai-sdk-harnesses/*`.
- Repo source read: `apps/agent/docs/handoff.md`, `apps/agent/docs/agent-coding-styleguide.md`, `apps/agent/docs/personal-agent-def.md`, and `apps/agent/docs/personal-assistant-design.md`.
- API correction for this repo: local `ai@7.0.0` docs/source use `isStepCount`, `inputSchema`, `prepareStep`, `onStepEnd`, and `toolApproval`. The Academy course sometimes uses older or deprecated names such as `stepCountIs` and `onStepFinish`; update examples before implementation.
- AI SDK `HarnessAgent` is for running existing agent runtimes such as Claude Code, Codex, OpenCode, or Pi through adapters. The personal Telegram agent should normally use `ToolLoopAgent`/AI SDK Core primitives and app-owned services, not `HarnessAgent`, unless the product explicitly decides to delegate a task to an external coding runtime.

## Core Shape

Keep the harness layered and boring:

- `app/bot/index.ts` owns Chat SDK composition: adapters, state, webhook handlers, and callback registration.
- `BotHandler` owns the incoming message lifecycle: gate, typing indicator, transcript writes, context assembly, model call, response posting, and post-response maintenance.
- `AgentService` should own the configured `ToolLoopAgent` or equivalent runtime policy: model choice, tools, prompt, loop limits, telemetry, and context pruning.
- `AgentContextService` should own context assembly and budgeting across short-term transcript, rolling compressed memory, profile, knowledge, and buffer.
- `KnowledgeService` should own retrieval, explicit/implicit knowledge mutations, embeddings, source references, and formatting structured retrieval results for `AgentContextService`.
- Tool definitions should remain `tool(...)` constants/factories, with business behavior delegated into app services.
- Provider SDKs, database tables, Telegram APIs, and QStash calls stay behind infrastructure or feature services.

Do not build a framework around Chat SDK or AI SDK. Use SDK shapes at the edge, then delegate to app-owned static service interfaces where this repo owns policy.

## Agent Loop

Use an explicit agent runtime boundary instead of scattering model calls through handlers or tools.

```ts
import { isStepCount, pruneMessages, ToolLoopAgent } from 'ai';

export class PersonalAgentService {
  static createAgent(ctx: AgentRuntimeContext) {
    const tools = AgentToolRegistry.createTools(ctx);

    return new ToolLoopAgent({
      model: ctx.model,
      instructions: AgentPromptService.buildSystemPrompt({
        identityId: ctx.identityId,
        userProfile: ctx.userProfile,
        tools: Object.keys(tools),
        contextSummary: ctx.contextSummary,
      }),
      tools,
      stopWhen: isStepCount(ctx.maxSteps ?? 12),
      prepareStep: async ({ messages }) => ({
        messages: shouldCompact(messages)
          ? pruneMessages({
              messages,
              reasoning: 'all',
              toolCalls: 'before-last-3-messages',
              emptyMessages: 'remove',
            })
          : messages,
      }),
      onStepEnd: async ({ stepNumber, usage }) => {
        AgentTelemetryService.recordStep({
          identityId: ctx.identityId,
          stepNumber,
          usage,
        });
      },
    });
  }
}
```

Implementation notes:

- Keep a hard step limit. Unbounded loops are a cost and UX failure.
- Prefer `prepareStep` for message compaction because local AI SDK 7 docs describe it as the public loop-control hook. Use `prepareCall` only if implementation needs call-level policy after confirming the exact local type.
- Treat runtime context as immutable. Pass request IDs, identity IDs, approval mode, and profile-derived defaults as structured context, not as hidden globals.
- Log stable step metadata, not raw prompts or secrets.
- Model IDs should be resolved through the project model/config layer. Verify current AI Gateway model IDs at implementation time rather than copying course examples.

## Prompt Construction

Build prompts from typed runtime context. Do not paste one giant string into the bot handler.

```ts
export interface AgentPromptContext {
  identityId: string;
  userProfile?: UserProfileForPrompt;
  tools: string[];
  contextSummary: string;
  projectInstructions?: string;
  verificationCommands?: string[];
}

export class AgentPromptService {
  static buildSystemPrompt(ctx: AgentPromptContext): string {
    const sections: string[] = [];

    sections.push(`You are Jakub's personal assistant agent.`);
    sections.push(`Current identity: ${ctx.identityId}`);

    sections.push(`
# Agency
- Act through tools and services when action is needed.
- Do not merely describe what you would do.
- Prefer the most specific tool for the job.
- Ask only when the missing information changes the outcome.`);

    sections.push(`
# Guardrails
- Preserve user privacy and never expose secrets.
- Keep side effects explicit and reversible where possible.
- Do not create scheduled work, send messages, or mutate durable knowledge unless the request or policy allows it.
- Use memory naturally; do not announce memory usage unless the user asks.`);

    sections.push(`
# Context
${ctx.contextSummary}`);

    if (ctx.verificationCommands?.length) {
      sections.push(`
# Verification
When code changes are made, run the narrowest relevant checks:
${ctx.verificationCommands.map((command, index) => `${index + 1}. ${command}`).join('\n')}
Report exactly what ran, what failed, and what was not run.`);
    }

    if (ctx.projectInstructions) {
      sections.push(`
# Project Instructions
${ctx.projectInstructions}`);
    }

    return sections.join('\n\n');
  }
}
```

Prompt rules:

- Use sections for policy: Agency, Guardrails, Handling Ambiguity, Context, Verification, Tool Use.
- Keep tool routing in both places: concise system policy plus strong tool descriptions.
- Inject dynamic context through typed fields: profile, timezone, location, available tools, current conversation context, knowledge retrieval, and verification commands.
- Keep `buildSystemPrompt` pure and unit-testable.
- Project or personal instructions should come from explicit files or database records, not implicit code comments.

## Tool Design

Tool descriptions are model-facing routing contracts, not human docstrings.

Every important tool should include:

- One-line summary of what it does and what it returns.
- `WHEN TO USE`: 2-4 concrete scenarios.
- `WHEN NOT TO USE`: soft redirects to better tools.
- `DO NOT USE FOR`: hard boundaries.
- `USAGE`: constraints, caps, defaults, identity rules, side-effect rules.
- `EXAMPLES`: only when examples materially improve routing.

Example:

```ts
export const manageKnowledgeTool = tool({
  description: `Create, update, correct, or archive durable personal knowledge.

WHEN TO USE: the user asks to remember something, corrects stored facts, or states a durable preference, relationship, project, plan, or life fact.
WHEN NOT TO USE: answering from existing knowledge (use retrieval context), storing transient chat details, or saving assistant guesses as truth.
DO NOT USE FOR: deleting history, writing raw transcripts, or storing unsupported claims without uncertainty.
USAGE: include source message IDs when available. Use correction for changed facts. Use uncertainty for inferred facts.`,
  inputSchema: manageKnowledgeInputSchema,
  execute: async (input, { context }) =>
    KnowledgeService.manageKnowledge({
      identityId: context.identityId,
      input,
    }),
});
```

Tool implementation rules:

- Put reusable schemas in the nearest `schemas.ts`.
- Tool callbacks delegate to app services. They should not call Drizzle tables, provider SDKs, Telegram, or QStash directly.
- Tool results must be bounded. Return enough for the next reasoning step, not full dumps.
- If a result is truncated, say so in the tool result and provide a pagination/narrowing path.
- Expected failures should be typed or app-coded results where practical. Unexpected failures become `AppError` or are projected through `ErrorService`.
- Dangerous or side-effecting tools require approval or explicit policy, not only prompt instructions.

## Tool Output Budgets

Prevent context damage at the source:

- File/text reads: cap by lines or characters, include offsets for pagination.
- Search results: cap matches and include total count when known.
- Command/API output: cap characters and usually keep the tail for errors.
- Knowledge retrieval: cap by token budget, not only item count.
- Scheduled/research/tool summaries: return structured summaries plus stable IDs, not raw payloads.

Use caps as defaults in service configuration so subagents and scheduled jobs can tighten them without redefining tools.

## Approval And Human-In-The-Loop

There are two layers:

- Session mode: interactive, background, delegated.
- Fine-grained policy: tool-specific rules, protected resources, risk scoring, or event hooks.

For Telegram MVP, start with explicit app-owned policy rather than relying only on AI SDK approval streaming:

```ts
export type ApprovalMode =
  | { mode: 'interactive' }
  | { mode: 'background' }
  | { mode: 'delegated'; trustedActions: string[] };

export class ApprovalPolicyService {
  static evaluateToolCall(input: {
    mode: ApprovalMode;
    toolName: string;
    action: string;
    risk: 'low' | 'medium' | 'high';
  }): ApprovalDecision {
    if (input.mode.mode === 'background') return { type: 'approved' };

    if (input.mode.mode === 'delegated') {
      return input.mode.trustedActions.includes(input.action)
        ? { type: 'approved' }
        : { type: 'denied', reason: 'Action was not delegated to this run.' };
    }

    return input.risk === 'low'
      ? { type: 'approved' }
      : { type: 'needs_user', reason: 'This action has external side effects.' };
  }
}
```

Practices:

- Always return a visible denial/block result to the model. Silent skipped execution produces false success claims.
- The parent/orchestrator asks the user. Subagents and scheduled runtimes should not ask the user unless explicitly designed for that surface.
- For ambiguous user requests, follow search, then ask, then act.
- `askUser` for Telegram should map to a real pending interaction in app state, not only a string result. The next user message should resolve the pending question.
- Side effects such as reminders, messages, external API changes, deployments, package installs, migrations, and destructive writes need explicit policy.

## Context And Memory

The core product advantage is durable context. Keep storage independent from prompt budgeting, but enforce budgets during context assembly.

Current target budget:

- Short-term transcript: 35%, can borrow unused long-term budget.
- Rolling compressed memory: 35%, newest useful summaries first, old summaries can be dropped.
- Knowledge: 20%, independently retrieved and formatted.
- Buffer: 10%.

Context assembly rules:

- Use Chat SDK transcripts for recent conversation state.
- Keep rolling compressed memory separate from curated knowledge.
- Do not revive flat noted memories. Durable facts belong in `KnowledgeNode`.
- Build context in stable sections so the model can distinguish recent chat, compressed history, user profile, and durable knowledge.
- Retrieval should return structured results plus metadata. Formatting belongs in `AgentContextService`.
- The assistant should use memory naturally. Do not routinely tell the user "based on memory" unless asked.

## Knowledge Retrieval

Use the tree model already agreed in `personal-assistant-design.md`:

- Search all active relevant nodes, not only leaves.
- Retrieve by hybrid ranking: embedding distance, status, confidence, recency, explicit scope, and tree relevance.
- Include ancestor chains for selected nodes so specific facts have context.
- When a group node scores highly, include selected relevant children, not the whole subtree.
- Include siblings/cousins only when they independently score well or the user asks broadly.
- Include superseded/history nodes only when the query asks for history or the old fact explains the current one.
- Store source references to chat messages for durable writes.
- If embedding generation fails, save the knowledge without embedding, log a repairable failure, and backfill later.

Context formatting should be concise:

```md
# Relevant Knowledge

- [active/high] projects/lab-agent/knowledge-model: User wants durable knowledge as a user-owned tree with embeddings and ancestor context. Source: msg_123.
- [uncertain/medium] profile/timezone: User usually operates in Europe/Warsaw unless a request says otherwise. Source: inferred from profile.
```

## Knowledge Ingestion

Ingestion should be owned by the conversation-orchestrating agent, not an unrelated background guesser.

Recommended flow:

- During the normal response, the agent can call `manage-knowledge` for explicit save/correct/archive requests.
- After response, run a bounded ingestion step over the latest user message plus recent context for implicit durable facts.
- MVP ingestion should use user messages as truth. Assistant outputs and tool outputs are not durable truth unless explicitly selected.
- Store uncertainty instead of discarding useful inferences.
- Corrections should supersede or update existing facts without deleting history.
- Hard delete should remain admin-only.

Keep knowledge writes tree-safe in `KnowledgeDbService`: node creation, closure-table maintenance, embedding metadata, source links, and status transitions should happen through one transaction boundary.

## Planning

Planning is useful when work has multiple dependent steps. It is harmful when it adds ceremony to simple questions.

For this personal agent:

- Use a lightweight internal plan object or tool only for multi-step actions such as research, scheduling changes, knowledge refactors, or code tasks in the TUI.
- Enforce one active plan item at a time.
- Do not persist transient plans across sessions unless they become real scheduled items or knowledge.
- Scheduled items are operational records, not knowledge nodes, though they can link to knowledge.

## Subagents

Delegation is for isolation, not architecture theater.

Use subagents when:

- Research spans many sources and the parent only needs a summary.
- A scheduled job should run with constrained instructions and tools.
- A verifier/reviewer should independently evaluate an output.
- A focused executor can operate with a narrowed trust set.

Avoid subagents for:

- Single-step answers.
- Ambiguous requirements that need the user.
- Architectural decisions that the parent must own.

Rules:

- Fresh context per delegated task.
- Role-specific tools and model.
- Role-specific step limit and output cap.
- Parent owns user questions and final synthesis.
- Delegated trust should shrink, not expand.

## Scheduling And External Side Effects

For reminders and background jobs, apply the sandbox lifecycle lessons as general external-system rules:

- Postgres is source of truth. QStash is a trigger/projection.
- Every scheduled item needs stable IDs, current status, delivery history, retry state, and idempotency keys.
- Delivery endpoints must load current DB state before acting.
- Edits cancel/recreate external QStash resources and update Postgres in a controlled service.
- Each delivery should be idempotent; duplicate trigger delivery must not send duplicate user messages.
- User-facing confirmation should include resolved absolute time and timezone.
- Scheduled-agent runtime should have scheduled-specific instructions and constrained tools.

Lifecycle failure modes to defend against:

- Stale external handles after reconnect or retry.
- Stale expiry/schedule data cached in app state.
- Polling or health checks counted as real activity.
- Auto-resume or auto-retry loops.
- Divergent state between provider, database, and client cache.

## Surfaces

The agent is headless. Telegram, TUI, and future web are renderers.

Surface responsibilities:

- Auth and allowlist gating before side effects.
- Thread/message state and platform-specific rendering.
- Typing indicators, streaming display, or deferred posting.
- Mapping tool events to user-visible status when appropriate.
- Pending approvals or pending questions.
- Persisting/resuming conversations through Chat SDK state and app tables.

Agent responsibilities:

- Build context.
- Decide and execute through tools.
- Return text plus structured events/results.
- Record telemetry and safe errors.

Do not put Telegram-specific branching in `AgentService`. Telegram behavior belongs in Chat SDK adapter setup, `BotHandler`, or Telegram-specific rendering helpers when they become justified.

## Extensibility

Start with simple registration points. Do not add a generic plugin/event framework until there are real consumers.

Recommended order:

1. Tool registry: add/remove/wrap tools before constructing the agent.
2. Prompt context sections: add typed fields to `AgentPromptContext`.
3. Skills/progressive disclosure: names/descriptions in context, full content loaded on demand.
4. Typed lifecycle/events: only after multiple cross-cutting concerns need it.

Minimal registry shape:

```ts
export interface AgentToolRegistry {
  register(name: string, tool: AgentTool): void;
  get(name: string): AgentTool | undefined;
  entries(): Array<[string, AgentTool]>;
  names(): string[];
}
```

Use wrappers for real policy, not aesthetics:

- Logging/telemetry around every tool.
- Output truncation.
- Protected-resource checks.
- Approval injection.
- Tool result normalization.

If an event bus is added, keep it typed and predictable:

- Events: `session_start`, `tool_call`, `tool_result`, `context_before_compact`, `session_shutdown`.
- Handlers run in registration order.
- A block result stops execution and returns the reason to the model.
- A modify result changes data seen by subsequent handlers.
- Never log secrets in generic event handlers.

## Verification

Verification should be a contract, not optimistic prose.

- Discover commands from `package.json` and `AGENTS.md` where possible.
- Prefer narrow checks for small changes.
- For broad changes, use `pnpm --filter @labjm/agent typecheck`, `test`, `lint`, and then broader repo checks if needed.
- The final answer should state what ran, what failed, what was skipped, and residual risk.
- Tests should target public module boundaries: `BotHandler`, `AgentContextService`, `KnowledgeService`, `KnowledgeDbService`, scheduling services, and tool service boundaries.
- Mock external systems: AI SDK, OpenAI/provider calls, Telegram/Chat SDK posting, OpenWeather, QStash, World Cup API, and database services.

## Implementation Checklist

- Keep Chat SDK entrypoint thin and native.
- Route all message behavior through `BotHandler`.
- Add `AgentService` only if it hides real model/tool/context policy.
- Add a pure `AgentPromptService.buildSystemPrompt`.
- Add or refine `AgentContextService` budget enforcement.
- Build `KnowledgeService` before `manage-knowledge`.
- Make every tool schema imported from a nearby `schemas.ts`.
- Ensure every side-effecting tool delegates to a service and has approval policy.
- Add tool output caps before adding more tools.
- Add telemetry around agent steps and important service transitions.
- Prefer app-coded expected failures and `ErrorService` projections.
- Verify API names against local `apps/agent/node_modules/ai` before coding.
