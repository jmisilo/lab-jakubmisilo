# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Keep application/runtime code under `src/app` using feature-oriented boundaries; `src/mastra`
  is the framework composition root and observability setup.
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly
- Keep Mastra tables owned by `PostgresStore` in the `mastra` schema.
- Keep custom Drizzle tables under `src/infrastructure/database` and use the `agent_` prefix.
- Treat `archive-ai-sdk` as read-only reference material. Do not import, build, test, or deploy it
  as part of the active Mastra application.
- Register HTTP routes with Mastra's `registerApiRoute`; do not create a second Hono application in
  the agent package. Chat SDK remains the sole platform transport/orchestration runtime.
- Use a pooled Neon `DATABASE_URL` for runtime database access.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
