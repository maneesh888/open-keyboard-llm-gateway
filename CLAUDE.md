# LLM Gateway

## What
API gateway for Ollama with API key auth, rate limiting, logging.
TypeScript + Hono + Vitest + Docker.

## Run
- Dev: npm run dev
- Test: npm test
- Build: npm run build
- Docker: docker compose up -d

## Structure
- src/middleware/ - auth and rate limiting
- src/proxy/ - Ollama proxy
- src/keys/ - API key management
- src/logging/ - request logging
- tests/ - Vitest tests

## Key Decisions
- Hono over Express: lighter, faster, native fetch API
- In-memory rate limiting: no Redis dependency
- File-based keys: simple, hot-reloadable
- Multi-stage Docker build: small image
