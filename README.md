# lab-jakubmisilo

[My](https://jakubmisilo.com) place to experiment with latest tech & ideas.

## Open Source projects

- [Custom AI Agent](https://github.com/jmisilo/lab-jakubmisilo/tree/main/apps/agent)
- [Extendable AI Widget](https://github.com/jmisilo/lab-jakubmisilo/tree/main/apps/web/src/app/ai-widget)
- [CLIP x GPT Captioning](https://github.com/jmisilo/clip-gpt-captioning)

## Setup

```sh
git clone git@github.com:jmisilo/lab-jakubmisilo.git

cd lab-jakubmisilo

corepack enable
pnpm install
```

Requires Node.js 24+, pnpm 10, and Vercel CLI.

```sh
pnpm add -g vercel
```

## Environment

Create local API env files:

```sh
cp apps/api/.env.local.example apps/api/.env.local
```

Fill the provider keys if you want to use real AI calls locally.

## Development

```sh
pnpm dev
```

This starts:

- web: http://localhost:3000
- api: http://localhost:8080
- agent: TUI

Health check:

```sh
curl http://localhost:8080/health
```
