# Facade Service (Milestones 1–5)

Unified entry-point that orchestrates test data file generation (via Generator service) and report translation (via Report API) offering synchronous streaming for small requests and asynchronous job handling with ZIP packaging for larger multi-artifact workflows.

## Implemented Overview
### Core (Milestone 1)
* Fastify server on port 3001 (`src/server.ts`)
* Config loader (`src/shared/config.ts`) merging env + `config/defaults.json`
* Structured logging wrapper + domain helper (`src/shared/logger.ts`)
* POST `/generate` deciding sync vs async based on `SYNC_ROW_LIMIT`.
### Persistence & Jobs (Milestones 1–4)
* Job manager (`src/jobs/jobManager.ts`) with states: `pending`, `running`, `completed`, `failed`.
* Persistent JSON job store (`src/jobs/jobStore.ts`) for durability across restarts.
* Auto enqueue path (202 Accepted) when row count exceeds sync threshold or multi-file requested.
* Endpoints: `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/status`, `GET /jobs/:id/download` (ZIP with `metadata.json`).
* SSE streaming progress: `GET /jobs/:id/events`.
* Retention sweeper removing expired job artifacts based on `JOB_RETENTION_DAYS`.
### Reporting Integration (Milestone 3)
* Separate Report API exposes `/translate/json` and `/translate/file` for CSV→XML workflows. Integrate via HTTP or explicit module adapter using env `REPORT_API_ENTRY`.
### Generator Integration (Milestone 2)
* Generator service exposes `/generate-file` for deterministic CSV generation. Integrate via HTTP or explicit module adapter using env `GENERATOR_ENTRY`.
### Logging (Milestone 4)
* Consistent JSON structure: `{ ts, level, jobId, event, msg, ... }` emitted on lifecycle transitions.
### UI Sample (Milestone 5)
* Minimal HTML/JS example (`docs/ui-example.html`) to demonstrate sync generation and async job polling (SEE BELOW).
### Tests
* Sync vs async decision, job lifecycle, persistence, retention sweeper, SSE progress.

## Environment Variables
* `PORT` (default 3001) – façade server port.
* `SYNC_ROW_LIMIT` (default 5000) – max rows for synchronous streaming.
* `MAX_CONCURRENT_JOBS` (default 4) – parallel job limit.
* `JOB_RETENTION_DAYS` (default 7) – artifact retention window.
* `OUTPUT_ROOT` (default `<repo>/jobs`) – base for job artifact folders.
* `REPORT_API_ENTRY` – optional ESM path to adapter module for report API.
* `GENERATOR_ENTRY` – optional ESM path to adapter module for generator.
* `DEBUG` – set for verbose logging.

## API Contract
### POST `/generate`
Request body (JSON):
```json
{
	"fileTypes": ["EaziPay"],
	"rows": 2500,
	"seed": 1234,
	"originatingAccount": {
		"sortCode": "401726",
		"accountNumber": "51779109"
	}
}
```
Responses:
* `200 text/csv` – single-file generation within sync limit.
* `202 application/json` – `{ jobId, state, progress }` for async path.
* `400 application/json` – `{ code, detail }` validation errors.

### GET `/jobs/:id`
Returns job status & summary: `{ id, state, progress, output? }`.

### GET `/jobs/:id/download`
Returns ZIP file containing generated artifacts + `metadata.json`.

### GET `/jobs/:id/events`
Server-Sent Events stream `progress` + final `end` event.

## UI Example (Milestone 5)
File: `docs/ui-example.html` contains a minimal fetch-based interface demonstrating:
1. Sync request (rows below threshold) – triggers file download.
2. Async request – polls status and enables ZIP download when complete.

### Snippet (Core JS Extract)
```js
async function startGeneration(payload) {
	const res = await fetch('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
	if (res.status === 200) {
		const blob = await res.blob();
		downloadBlob(blob, 'generated.csv');
	} else if (res.status === 202) {
		const { jobId } = await res.json();
		monitorJob(jobId);
	} else {
		console.error('Error', await res.json());
	}
}
```

## Future Enhancements
* Cancellation endpoint `DELETE /jobs/:id`.
* Retry & backoff for transient generator/report failures.
* Streaming adapter for multi-artifact preview.
* Pluggable persistence (swap file-store with Redis/Postgres).
* Metrics endpoint (job throughput, queue depth).

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

---
_Milestone 5 complete: façade now documents its public contract and includes a UI sample stub for local experimentation._
