# Facade Service (Milestones 1–4)

Adds asynchronous job processing for large generation requests (Milestone 4) on top of the initial façade skeleton.

## Implemented
### Core (Milestone 1)
- Fastify server on port 3001 (`src/server.ts`)
- JSON config loader with fallback (`src/shared/config.ts`)
- Structured logging via pino (`src/shared/logger.ts`)
- POST `/generate` synchronous path enforcing `SYNC_ROW_LIMIT`
- Basic normalisation + validation errors
### Async Jobs (Milestone 4)
- In-memory job manager (`src/jobs/jobManager.ts`) with states: `pending`, `running`, `completed`, `failed`
- Auto–enqueue when `rows > syncRowLimit` returning `202 Accepted`
- Job status endpoint `GET /jobs/:id`
- Job output endpoint `GET /jobs/:id/output`
- SSE events endpoint `GET /jobs/:id/events` streaming progress + end event
- Progress staging simulation (20% → 70% → 100%)
- Vitest tests for enqueue and lifecycle (`tests/jobs.spec.ts`)

## Env Vars
- `PORT` (default 3001)
- `SYNC_ROW_LIMIT` (default 5000)
- `DEBUG` (sets log level to debug)

## Future
- Integrate real generator & report services into job stages
- Persist jobs (Redis / file-backed) for durability
- Cancellation endpoint `DELETE /jobs/:id`
- Seed propagation for deterministic async runs
- Retry strategy for transient failures
- UI integration (Milestone 5)

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

## SSE Details
Events format:
```
event: progress
data: {"id":"<uuid>","state":"running","progress":20}

event: end
data: {"id":"<uuid>","state":"completed"}
```
Connection closes automatically on completion or failure; clients should reconnect if interrupted.
