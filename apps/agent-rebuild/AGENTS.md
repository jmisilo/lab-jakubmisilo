# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly
- Keep Mastra tables owned by `PostgresStore` in the `mastra` schema.
- Keep custom Drizzle tables under `src/infrastructure/database` and prefixed with `agent_rebuild_`.
- Use a pooled Neon `DATABASE_URL` for runtime database access.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
