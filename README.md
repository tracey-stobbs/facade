# Facade Service (Milestone 1)

Minimal skeleton for the Façade API described in `docs/requirements-next-phase.md` Milestone 1.

## Implemented
- Fastify server on port 3001 (`src/server.ts`)
- JSON config loader with fallback (`src/shared/config.ts`) reading `config/defaults.json`
- Structured logging via pino (`src/shared/logger.ts`)
- POST `/generate` endpoint (JSON only) enforcing `SYNC_ROW_LIMIT` (env, default 5000)
- Basic normalisation + validation errors (400 / 413)
- Stub synchronous generation returning static CSV (placeholder for generator HTTP adapter in Milestone 2)
- Vitest tests for config loader and `/generate` path

## Env Vars
- `PORT` (default 3001)
- `SYNC_ROW_LIMIT` (default 5000)
- `DEBUG` (sets log level to debug)

## Future (Next Milestones)
- Generator HTTP adapter (Milestone 2)
- Report API wrapper (Milestone 3)
- Async job runner, packaging, /jobs endpoints (Milestone 4)
- UI integration (Milestone 5)
- SSE enhancement documented (future)

## Run
```bash
npm install
npm run dev
```

## Test
```bash
npm run lint
npm test
```

## SSE Future Enhancement
Not implemented; will add Server-Sent Events for live job progress after async job runner (Milestone 4) is complete.
