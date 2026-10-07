import { ipFingerprint, isSupportedModel, json, runModel, utcDay } from '../../_lib/sf-tech-week-signal.js';

const TOTAL_EVENTS = 1593;

export async function onRequestPost({ request, env }) {
  if (!env.SF_SIGNAL_DB) return json({ error: 'Run storage is unavailable' }, 503);
  const body = await request.json().catch(() => null);
  const model = body?.model || runModel();
  if (!isSupportedModel(model)) return json({ error: 'Unsupported model' }, 400);
  if (body?.total_events !== TOTAL_EVENTS) return json({ error: 'The full event dataset is required' }, 400);

  const now = new Date();
  const day = utcDay(now);
  const retentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let ipHash;
  try {
    ipHash = await ipFingerprint(request, day, env);
  } catch {
    return json({ error: 'IP quota protection is not configured' }, 503);
  }
  if (!ipHash) return json({ error: 'The hosting platform did not provide a client IP' }, 503);

  // Keep short-lived run records for in-progress classification and diagnostics.
  await env.SF_SIGNAL_DB.prepare('DELETE FROM sf_signal_runs WHERE quota_day < ?').bind(retentionCutoff).run();

  const runId = crypto.randomUUID();
  await env.SF_SIGNAL_DB.prepare(`
    INSERT INTO sf_signal_runs (id, ip_hash, quota_day, model, status, total_events, processed_events, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?)
    RETURNING id
  `).bind(runId, ipHash, day, model, TOTAL_EVENTS, now.toISOString()).first();

  return json({
    run_id: runId,
    model,
    total_events: TOTAL_EVENTS,
    processed_events: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_latency_ms: 0,
    status: 'running',
  });
}
