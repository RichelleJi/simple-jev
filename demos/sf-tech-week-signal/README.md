# SF Tech Week Signal

An event-intelligence demo that classifies the full San Francisco Tech Week 2026 calendar with Simple Jev. Events can carry multiple signal tags: the highest-probability signal is primary, with additional tags shown when their choice probability is at least 25%. The dashboard streams event classifications, shows a live signal-tag mix, and scores events against a fixed rubric whose criterion importance can be adjusted before a run.

## Try it

The demo is served at `/cool-demo/sf-tech-week-signal/` from the Simple Jev website. It includes the official MCP calendar snapshot for October 5–11, 2026 (1,593 events) and calls the public Simple Jev classifier API through a Pages Function. No browser API key is used.

Each IP address may start **three complete runs per UTC calendar day**. A run covers the entire 1,593-event dataset; its 10-event batches do not consume extra run slots. The server reserves a slot atomically when `/start` is accepted. A started run counts even if the visitor closes the page, and the fourth run returns HTTP 429 with `Retry-After` until the UTC reset. Batch requests are bound to the originating IP and run, and must be sent sequentially. IP addresses are never stored directly: the server stores a salted daily SHA-256 fingerprint and removes run records older than 30 days.

The model selector supports Qwen3.6-35B-A3B, Qwen3.8-27B, Qwen3.5-4B, Gemma 4 26B-A4B, Gemma 4 12B-it, RWKV std, RWKV mid, and RWKV small classifier IDs. The RWKV models are text-only, which fits this text-event workflow. Prices shown in the selector come from the supplied model lists; Gemma 4 12B-it and RWKV small did not include a price. The chosen ID is pinned to the run and sent to the classifier endpoint for each batch.

This is an IP-based abuse limit, not identity verification. People sharing an IP share the allowance, and a visitor who changes networks may receive a different allowance.

## Local development

The UI is static, but the run allowance requires a local Cloudflare Pages Functions runtime and D1 database. Install Node.js 22+ and Wrangler 4, then create local-only configuration and a development-only salt:

```text
SF_SIGNAL_IP_HASH_SALT=replace-with-a-long-random-local-value
```

```sh
cp website/wrangler.example.jsonc website/wrangler.jsonc
cp website/.dev.vars.example website/.dev.vars
# Edit website/.dev.vars and replace the placeholder with a long random value.
cd website
npx wrangler d1 execute sf-signal-local --local --file=../demos/sf-tech-week-signal/migrations/0001_run_quota.sql
npx wrangler pages dev .
```

Wrangler runs Pages Functions and serves the site together. The classifier endpoint can be overridden with `SF_SIGNAL_CLASSIFIER_ENDPOINT`; the default is the public Simple Jev demo API.

The standalone static preview (`python3 -m http.server`) is useful for layout review, but classification will not run because it has no server-side quota enforcement.

## Deployment requirements

The Simple Jev website uses Cloudflare Pages. Before enabling this demo in a deployment, the Pages project needs:

- D1 binding `SF_SIGNAL_DB` with `migrations/0001_run_quota.sql` applied.
- A secret named `SF_SIGNAL_IP_HASH_SALT` in both Preview and Production, with a randomly generated value.
- The deployment command run from `website/` so Wrangler includes `website/functions/` in the Pages deployment.

Without the D1 binding or salt, the Function fails closed with HTTP 503 rather than running unmetered classification. Cloudflare documents [Pages Functions](https://developers.cloudflare.com/pages/functions/) and [D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/).

## Data and attribution

The demo uses the October 5–11, 2026 San Francisco event catalog served by the official Tech Week MCP. Event links point to their original Tech Week listings. The data snapshot is included for reproducible browsing and may become stale; check the source listing before making plans. This independent community demo is not affiliated with or endorsed by SF Tech Week.

## Implementation

- `website/cool-demo/sf-tech-week-signal/`: static dashboard and bundled dataset.
- `website/functions/api/sf-tech-week-signal/`: server-side run reservation and batch proxy; shared helpers live under `website/functions/_lib/`.
- `migrations/0001_run_quota.sql`: minimal 30-day run ledger used for per-IP quotas and ownership checks.

Run quotas are enforced at run start with one conditional D1 insert, so simultaneous starts cannot exceed three slots. Every batch revalidates the run owner and exact expected offset before forwarding input to the classifier. A failed run keeps its reserved slot to prevent retries from bypassing the daily cap.
