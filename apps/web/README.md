# @labjm/web

Frontend for [lab.jakubmisilo.com](https://jakubmisilo.com) — a place to experiment with latest tech & ideas.

## Features

- **[Extendable AI Widget](./src/app/ai-widget)** — embeddable chat component backed by multiple AI providers (Gemini, GPT, Claude)

## Development

From the repo root:

```sh
pnpm dev
```

App runs at `http://localhost:3000`. Requires the API (`apps/api`) running at `http://localhost:8080`.

## Stack

- [Next.js](https://nextjs.org) 16
- [Tailwind CSS](https://tailwindcss.com) v4
- [Vercel AI SDK](https://sdk.vercel.ai) — streaming UI
- [Motion](https://motion.dev) — animations
