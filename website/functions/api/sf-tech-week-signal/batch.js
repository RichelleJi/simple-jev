import { bestFor, buildQuestions, endpoint, isSupportedModel, json, maxBatchSize, normalizeRubric, ownedRun, signalTags, signals } from '../../_lib/sf-tech-week-signal.js';

function text(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value) {
  return Array.isArray(value) ? value.slice(0, 20).map((item) => text(item, 120)) : [];
}

function cleanEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const title = text(value.title, 300);
  if (!title) return null;
  return {
    source_id: text(value.source_id, 100),
    title,
    host: text(value.host, 200),
    location: text(value.location, 200),
    description: text(value.description, 3000),
    summary: text(value.summary, 1000),
    themes: list(value.themes),
    formats: list(value.formats),
    sponsors: list(value.sponsors),
  };
}

function scoreToVibe(score) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 4) {
    throw new Error('Classifier returned an invalid vibe score');
  }
  return Math.round(score * 25);
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 64 * 1024) return json({ error: 'Batch request is too large' }, 413);
  const body = await request.json().catch(() => null);
  const runId = typeof body?.run_id === 'string' ? body.run_id : '';
  const model = body?.model;
  const offset = Number(body?.offset);
  const events = Array.isArray(body?.events) ? body.events.map(cleanEvent) : [];
  if (!runId || !isSupportedModel(model) || !Number.isInteger(offset) || events.length < 1 || events.length > maxBatchSize() || events.some((event) => !event)) {
    return json({ error: 'Invalid run batch' }, 400);
  }

  const { run, response } = await ownedRun(request, env, runId);
  if (response) return response;
  if (model !== run.model) return json({ error: 'The selected model does not match this run' }, 400);
  if (run.status !== 'running') return json({ error: `Run is ${run.status}` }, 409);
  const expectedBatchLength = Math.min(maxBatchSize(), run.total_events - offset);
  if (offset !== run.processed_events || events.length !== expectedBatchLength || offset + events.length > run.total_events) {
    return json({ error: 'Batches must be submitted once, sequentially, within the full run' }, 409);
  }

  // Claim the exact next batch before making a paid inference request. Duplicate or
  // parallel submissions for the same offset cannot both reach the model endpoint.
  const claim = await env.SF_SIGNAL_DB.prepare(`
    UPDATE sf_signal_runs SET status = 'processing'
    WHERE id = ? AND ip_hash = ? AND status = 'running' AND processed_events = ?
    RETURNING id
  `).bind(runId, run.ip_hash, offset).first();
  if (!claim) return json({ error: 'This batch was already submitted or the run is no longer active' }, 409);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const started = Date.now();
  try {
    const response = await fetch(endpoint(env), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        state: { events, rubric: normalizeRubric(body.rubric) },
        questions: buildQuestions(events, body.rubric),
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!response.ok) throw new Error(`Simple Jev API returned HTTP ${response.status}`);
    if (!payload?.answers || typeof payload.answers !== 'object') throw new Error('Classifier returned an invalid response');

    const best = bestFor();
    const acceptedSignals = signals();
    const results = events.map((event, index) => {
      const signalAnswer = payload.answers[`signal_${index}`] || {};
      const vibeAnswer = payload.answers[`vibe_${index}`] || {};
      if (!acceptedSignals.includes(signalAnswer.choice)) throw new Error(`Classifier returned an invalid signal for event ${index + 1}`);
      const vibe = scoreToVibe(vibeAnswer.score);
      return {
        source_id: event.source_id,
        signal: signalAnswer.choice,
        signals: signalTags(signalAnswer, signalAnswer.choice),
        best_for: best[signalAnswer.choice],
        vibe,
        verdict: vibe >= 78 ? 'GO' : vibe >= 62 ? 'MAYBE' : 'SKIP',
        confidence: typeof signalAnswer.confidence === 'number' ? signalAnswer.confidence : 0,
      };
    });
    const usage = payload.usage || {};
    const inputTokens = Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : 0;
    const outputTokens = Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : 0;
    const latency = Date.now() - started;
    const processed = offset + events.length;
    const done = processed === run.total_events;
    await env.SF_SIGNAL_DB.prepare(`
      UPDATE sf_signal_runs SET status = ?, processed_events = ?, input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ?, total_latency_ms = total_latency_ms + ?
      WHERE id = ? AND status = 'processing'
    `).bind(done ? 'complete' : 'running', processed, inputTokens, outputTokens, latency, runId).run();
    return json({
      run_id: runId,
      model,
      status: done ? 'complete' : 'running',
      done,
      processed_events: processed,
      total_events: run.total_events,
      input_tokens: run.input_tokens + inputTokens,
      output_tokens: run.output_tokens + outputTokens,
      total_latency_ms: run.total_latency_ms + latency,
      batch_latency_ms: latency,
      results,
    });
  } catch (error) {
    await env.SF_SIGNAL_DB.prepare(
      "UPDATE sf_signal_runs SET status = 'failed' WHERE id = ? AND status = 'processing'"
    ).bind(runId).run();
    return json({ error: 'Classification batch failed', detail: error instanceof Error ? error.message : 'Unknown error' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
