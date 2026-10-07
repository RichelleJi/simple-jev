# SF Tech Week Signal

An event-intelligence demo that classifies the full San Francisco Tech Week 2026 calendar with Simple Jev. Events can carry multiple signal tags: the highest-probability signal is primary, with additional tags shown when their choice probability is at least 25%. The dashboard streams event classifications, shows a live signal-tag mix, and scores events against a fixed rubric whose criterion importance can be adjusted before a run.

## Try it

The demo is served at `/cool-demo/sf-tech-week-signal/` from the Simple Jev website. It includes the official MCP calendar snapshot for October 5–11, 2026 (1,593 events) and calls the public Simple Jev classifier API directly from the browser. No API key, server-side proxy, database, or site-side per-IP run cap is required.

Each run classifies all 1,593 events in sequential batches of up to 10. Requests are spaced to stay within the public API's limit of two requests per second. The API also enforces its own context and usage limits; errors are shown in the dashboard. The selector supports Qwen3.6-35B-A3B, Qwen3.8-27B, Qwen3.5-4B, Gemma 4 26B-A4B, Gemma 4 12B-it, RWKV std, RWKV mid, and RWKV small classifier IDs. RWKV models are text-only, which fits this workflow.

## Local development

Serve the `website/` directory with any static HTTP server. The interface and event catalog are static files; classification uses the same public API as the deployed site. Browsers need network access to `simple-jev-demo-api.featherless.ai`. No environment file, API key, local database, or server runtime is required.

## Data and attribution

The demo uses the October 5–11, 2026 San Francisco event catalog served by the official Tech Week MCP. Event links point to their original Tech Week listings. The data snapshot is included for reproducible browsing and may become stale; check the source listing before making plans. This independent community demo is not affiliated with or endorsed by SF Tech Week.

## Implementation

- `website/cool-demo/sf-tech-week-signal/`: static dashboard, bundled dataset, and browser-side classifier client.
- `website/tests/sf-tech-week-signal.test.mjs`: deterministic tests for request construction, response parsing, signal tags, and API errors.

The client sends public event metadata and the selected rubric to the public classifier endpoint. It never includes a private API key. Sequential batches let the dashboard update progress, token counts, and signal mix as responses arrive.
