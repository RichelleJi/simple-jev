import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIFIER_ENDPOINT,
  buildQuestions,
  classifyBatch,
  normalizeRubric,
} from '../cool-demo/sf-tech-week-signal/classifier-client.mjs';

const MODEL = 'featherless-ai/Qwen3.8-27B-classifier';
const event = { source_id: 'event-1', title: 'Demo event', description: 'A product and engineering meetup.' };
const rubric = [{ name: 'Engineer talent', weight: 32 }];

test('builds classifier questions with fixed rubric guidance and adjustable weights', () => {
  const questions = buildQuestions([event], rubric);
  assert.equal(questions.signal_0.type, 'choice');
  assert.equal(questions.signal_0.criteria['Engineer talent'], 'Strong engineers, technical leaders, project maintainers, and formats that reveal real ability.');
  assert.equal(questions.vibe_0.type, 'score');
  assert.deepEqual(questions.vibe_0.criteria, ['Hard skip', 'Weak', 'Mixed', 'Strong', 'Exceptional']);
  assert.equal(normalizeRubric(rubric).find((item) => item.name === 'Engineer talent').weight, 32);
  assert.equal(normalizeRubric(rubric).find((item) => item.name === 'Food quality').weight, 8);
});

test('calls the public classifier endpoint and maps answers, usage, and multi-signal tags', async () => {
  let requestUrl;
  let requestOptions;
  const result = await classifyBatch({
    model: MODEL,
    events: [event],
    rubric,
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        answers: {
          signal_0: { choice: 'Engineer talent', confidence: 0.91, probabilities: { 'Investor access': 0.3 } },
          vibe_0: { score: 3.2 },
        },
        usage: { input_tokens: 410, output_tokens: 28 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(requestUrl, CLASSIFIER_ENDPOINT);
  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestOptions.headers.authorization, undefined);
  const requestBody = JSON.parse(requestOptions.body);
  assert.equal(requestBody.model, MODEL);
  assert.deepEqual(requestBody.state.events, [event]);
  assert.equal(requestBody.state.rubric.find((item) => item.name === 'Engineer talent').weight, 32);
  assert.deepEqual(result.results[0], {
    source_id: 'event-1',
    signal: 'Engineer talent',
    signals: ['Engineer talent', 'Investor access'],
    best_for: 'Engineers',
    vibe: 80,
    verdict: 'GO',
    confidence: 0.91,
  });
  assert.equal(result.input_tokens, 410);
  assert.equal(result.output_tokens, 28);
  assert.ok(result.batch_latency_ms >= 0);
});

test('rejects invalid events, classifier errors, and malformed model answers', async () => {
  await assert.rejects(classifyBatch({ model: MODEL, events: [], rubric }), /between 1 and 10/);
  await assert.rejects(classifyBatch({
    model: MODEL,
    events: [event],
    rubric,
    fetchImpl: async () => new Response(JSON.stringify({ detail: 'Unknown model' }), { status: 404 }),
  }), /Unknown model/);
  await assert.rejects(classifyBatch({
    model: MODEL,
    events: [event],
    rubric,
    fetchImpl: async () => new Response(JSON.stringify({ answers: { signal_0: { choice: 'Unknown' }, vibe_0: { score: 2 } } }), { status: 200 }),
  }), /invalid signal/);
});
