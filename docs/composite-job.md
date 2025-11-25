# Composite Job: EaziPay + DDICA Guide

This document explains how to run the facade composite job which generates an EaziPay CSV and a DDICA XML using the local generator and report API, and how to troubleshoot common failures.

## Endpoints

- POST `/jobs/composite` — enqueue a composite job (EaziPay CSV + DDICA XML)
- GET `/jobs/:id/status` — check job progress and state
- GET `/jobs/:id/events` — stream SSE progress events
- GET `/jobs/:id/download` — download `artifact.zip` once job completes
- POST `/generate` — synchronous generator endpoint (CSV-only response when under `syncRowLimit`)

## Example: enqueue composite job

Request:

```bash
curl -v -X POST http://localhost:3001/jobs/composite \
  -H 'Content-Type: application/json' \
  -d '{"rows":5,"seed":1234,"processingDate":"2025-11-15"}'
```

Response (202 Accepted):

```json
{"jobId":"<uuid>","state":"pending","progress":0}
```

## Poll job status

```bash
curl http://localhost:3001/jobs/<jobId>/status
```

Response example while running:

```json
{"id":"<uuid>","state":"running","progress":70,"createdAt":"2025-11-25T17:16:04.857Z"}
```

## Stream progress (SSE)

```bash
curl http://localhost:3001/jobs/<jobId>/events
```

You will receive `progress` events and a final `end` event when the job completes or fails.

## Download artifacts

After the job shows `state: "completed"`:

```bash
curl -o artifact.zip http://localhost:3001/jobs/<jobId>/download
```

The ZIP includes:
- `<file>.csv` — generated EaziPay file
- `<file>.xml` — generated DDICA XML
- `metadata.json` — merged metadata with checksums and sizes

## Troubleshooting

1. Job remains `pending` forever
   - Confirm the facade server was started from the project root so `jobStore` reads the correct `jobs-store` directory.
   - Ensure the server process was started after recent code changes (a rebuild + restart is required when source changes are made).
   - To resume persisted pending jobs after a restart: ensure `JobManager.init()` logs `JobManager initialised` and that there are no `Failed to read job file` warnings.

2. Job moves to `progress: 70` then `failed` with DDICA errors
   - This means EaziPay generation succeeded but the Report API call to `http://localhost:3003/translate/json` failed on retries.
   - Quick checks:
     - Is the Report API running? `curl http://localhost:3003/health`
     - Test the translate endpoint directly:
       ```bash
       curl -v -X POST http://localhost:3003/translate/json \
         -H 'Content-Type: application/json' \
         -d '{"report":"ddica","rows":5,"metadata":{"Sun":{"sunNumber":"123456"}}}'
       ```
   - If the Report API is not running, start it from its repo:
     ```bash
     cd C:/git/BACS/bacs-report-api
     npm run build
     node dist/src/server.js
     ```

3. `Failed to read job file` JSON parse errors on startup
   - Some platforms can leave temporary partial files in `jobs-store` (e.g., `<id>.tmp-<ts>.json`). These are ignored by the JobStore loader; if you still see warnings, remove any zero-byte `.tmp-*` files from `jobs-store`.

4. Need to resume jobs without restarting
   - You can use the admin resume action (if added). Otherwise restart the facade process to re-run `JobManager.init()` which will schedule pending jobs.

## Notes
- The facade uses a HTTP-first integration approach to call the generator and report API. If HTTP fails for the generator there is a local fallback import (for developer convenience) but the Report API path is HTTP-only in the current implementation.
- Outputs are written to `jobs/<jobId>/` under the facade's `outputRoot` (default `./jobs`).

If you want, I can add:
- `POST /admin/resume-jobs` to force schedule pending jobs without restart
- Improved error messages in the DDICA client for clearer failure reasons

