import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/sf-tech-week-signal/start.js';
import { buildQuestions, defaultRubric, normalizeRubric, signalTags, supportedModels } from '../functions/_lib/sf-tech-week-signal.js';

const MODEL = 'featherless-ai/Qwen3.8-27B-classifier';

test('signal tags keep the selected primary and include secondary choices at the 25% threshold', () => {
  assert.deepEqual(signalTags({ probabilities: {
    'Investor access': 0.56,
    'Engineer talent': 0.29,
    'Research talent': 0.10,
    'Looking for a job': 0.03,
    'Sales pitch / noise': 0.02,
  } }, 'Investor access'), ['Investor access', 'Engineer talent']);
});

test('signal tags always retain the primary choice when probabilities are missing', () => {
  assert.deepEqual(signalTags({}, 'Research talent'), ['Research talent']);
});

test('rubric weights are customizable while criterion titles and guidance stay fixed', () => {
  const rubric = defaultRubric();
  const engineer = rubric.find((item) => item.name === 'Engineer talent');
  engineer.title = 'Builder access';
  engineer.guidance = 'Prioritize hands-on engineering and real builders.';
  engineer.weight = 35;
  const questions = buildQuestions([{ title: 'Demo event', host: 'Demo', location: 'SOMA', description: 'A product demo.' }], rubric);
  assert.equal(questions.signal_0.type, 'choice');
  assert.equal(questions.signal_0.criteria['Engineer talent'], 'Strong engineers, technical leaders, project maintainers, and formats that reveal real ability.');
  assert.match(questions.vibe_0.instructions, /fixed rubric and its weights supplied in shared state/);
});

test('rubric customization bounds weights, ignores title and guidance edits, and ignores unknown dimensions', () => {
  const rubric = normalizeRubric([
    { name: 'Venue quality', title: `  ${'x'.repeat(60)}  `, weight: 100, guidance: 'v'.repeat(400) },
    { name: 'Not a rubric dimension', weight: 20, guidance: 'ignored' },
  ]);
  const venue = rubric.find((item) => item.name === 'Venue quality');
  assert.equal(venue.weight, 40);
  assert.equal(venue.title, undefined);
  assert.equal(venue.guidance, 'Comfort, acoustics, accessibility, location, layout, and suitability for conversation.');
  assert.equal(rubric.length, defaultRubric().length);
  assert.ok(!rubric.some((item) => item.name === 'Not a rubric dimension'));
});

function fakeEnv() {
  const runs = [];
  return {
    runs,
    SF_SIGNAL_IP_HASH_SALT: 'test-only-salt',
    SF_SIGNAL_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                if (sql.includes('INSERT INTO sf_signal_runs')) {
                  const [id, ipHash, quotaDay, model, totalEvents, startedAt] = values;
                  runs.push({ id, ipHash, quotaDay, model, totalEvents, startedAt });
                  return { id };
                }
                return null;
              },
              async run() { return { success: true }; },
            };
          },
        };
      },
    },
  };
}

function startRequest(ip = '203.0.113.10') {
  return new Request('https://demo.test/api/sf-tech-week-signal/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    body: JSON.stringify({ model: MODEL, total_events: 1593 }),
  });
}

test('allows repeated full-run starts from the same IP without a site-side daily cap', async () => {
  const env = fakeEnv();
  const responses = await Promise.all(Array.from({ length: 8 }, () => onRequestPost({ request: startRequest(), env })));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(env.runs.length, 8);
  assert.ok((await responses[0].json()).runs_remaining === undefined);
});

test('allows each listed classifier model and rejects unknown model IDs', async () => {
  const env = fakeEnv();
  for (const [index, model] of supportedModels().entries()) {
    const request = new Request('https://demo.test/api/sf-tech-week-signal/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `203.0.113.${20 + index}` },
      body: JSON.stringify({ model, total_events: 1593 }),
    });
    const response = await onRequestPost({ request, env });
    assert.equal(response.status, 200, `${model} should be accepted`);
    assert.equal((await response.json()).model, model);
  }
  const unsupportedRequest = new Request('https://demo.test/api/sf-tech-week-signal/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.29' },
    body: JSON.stringify({ model: 'example/unknown-model', total_events: 1593 }),
  });
  assert.equal((await onRequestPost({ request: unsupportedRequest, env })).status, 400);
});

test('fails closed when the trusted platform IP or hash salt is unavailable', async () => {
  const env = fakeEnv();
  assert.equal((await onRequestPost({ request: startRequest(null), env })).status, 503);
  env.SF_SIGNAL_IP_HASH_SALT = '';
  assert.equal((await onRequestPost({ request: startRequest(), env })).status, 503);
});
