# @labjm/api

Hono-based API server powering [lab.jakubmisilo.com](https://jakubmisilo.com). Deployed as a Vercel serverless function.


## Environment

```sh
cp .env.local.example .env.local
```

## Development

From the repo root:

```sh
pnpm dev
```

API runs at `http://localhost:8080`.

```sh
curl http://localhost:8080/health
```

## Stack

- [Hono](https://hono.dev) — web framework
- [Vercel AI SDK](https://sdk.vercel.ai) — streaming AI responses
