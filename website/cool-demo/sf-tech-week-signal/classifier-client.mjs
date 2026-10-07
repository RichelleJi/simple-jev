export const CLASSIFIER_ENDPOINT = 'https://simple-jev-demo-api.featherless.ai/v1/classifier';
export const MAX_BATCH_SIZE = 10;

const SIGNALS = [
  'Investor access',
  'Engineer talent',
  'Research talent',
  'Looking for a job',
  'Sales pitch / noise',
];
const BEST_FOR = {
  'Investor access': 'Founders raising',
  'Engineer talent': 'Engineers',
  'Research talent': 'Researchers',
  'Looking for a job': 'Job seekers',
  'Sales pitch / noise': 'General networking',
};
const RUBRIC = [
  { name: 'Investor access', weight: 20, guidance: 'Partner, principal, angel, or allocator density; fundraising intent; small-group access.' },
  { name: 'Engineer talent', weight: 16, guidance: 'Strong engineers, technical leaders, project maintainers, and formats that reveal real ability.' },
  { name: 'Research talent', weight: 14, guidance: 'Researchers, paper authors, labs, frontier-model teams, and substantive technical depth.' },
  { name: 'Looking for a job', weight: 12, guidance: 'Active recruiters, hiring managers, open roles, referral access, and career-relevant conversations.' },
  { name: 'Food quality', weight: 8, guidance: 'Substantial, well-reviewed food that supports the event format—not just snack-table bait.' },
  { name: 'Exclusivity', weight: 9, guidance: 'Meaningful curation, relevant invitees, limited capacity, and credible access barriers.' },
  { name: 'Swag ROI', weight: 6, guidance: 'Usefulness and quality of giveaways relative to the time and attention the event demands.' },
  { name: 'Venue quality', weight: 7, guidance: 'Comfort, acoustics, accessibility, location, layout, and suitability for conversation.' },
  { name: 'Sales pitch / noise', weight: 8, guidance: 'Sponsor-heavy framing, vague futurism, lead-gen language, and low audience specificity.' },
];

export function normalizeRubric(input = []) {
  const byName = new Map((Array.isArray(input) ? input : [])
    .filter((item) => item && typeof item.name === 'string')
    .map((item) => [item.name, item]));
  return RUBRIC.map((base) => {
    const weight = byName.get(base.name)?.weight;
    return {
      ...base,
      weight: Number.isInteger(weight) ? Math.min(40, Math.max(0, weight)) : base.weight,
    };
  });
}

export function buildQuestions(events, rubric) {
  const normalizedRubric = normalizeRubric(rubric);
  const signalCriteria = Object.fromEntries(
    normalizedRubric
      .filter(({ name }) => SIGNALS.includes(name))
      .map(({ name, guidance }) => [name, guidance]),
  );
  const questions = {};
  events.forEach((event, index) => {
    questions[`signal_${index}`] = {
      type: 'choice',
      instructions: `For event ${index + 1} in the shared event list, choose its strongest attendee signal. Use the matching signal guidance in the shared rubric.`,
      criteria: signalCriteria,
    };
    questions[`vibe_${index}`] = {
      type: 'score',
      instructions: `For event ${index + 1} in the shared event list, score its value to a San Francisco engineer, founder, researcher, or job seeker. Apply the fixed rubric and its weights supplied in shared state.`,
      criteria: ['Hard skip', 'Weak', 'Mixed', 'Strong', 'Exceptional'],
    };
  });
  return questions;
}

function tagsFor(answer, primary) {
  const probabilities = answer?.probabilities && typeof answer.probabilities === 'object'
    ? answer.probabilities
    : {};
  return [primary, ...SIGNALS.filter((signal) => signal !== primary
    && Number.isFinite(probabilities[signal]) && probabilities[signal] >= 0.25)];
}

function resultMessage(payload, status) {
  for (const value of [payload?.detail, payload?.error, payload?.message]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `Simple Jev classifier returned HTTP ${status}`;
}

export async function classifyBatch({ model, events, rubric, fetchImpl = fetch }) {
  if (!Array.isArray(events) || events.length < 1 || events.length > MAX_BATCH_SIZE) {
    throw new Error(`Choose between 1 and ${MAX_BATCH_SIZE} events per classifier request`);
  }
  const stateRubric = normalizeRubric(rubric);
  const startedAt = Date.now();
  const response = await fetchImpl(CLASSIFIER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      state: { events, rubric: stateRubric },
      questions: buildQuestions(events, stateRubric),
    }),
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(resultMessage(payload, response.status));
  if (!payload?.answers || typeof payload.answers !== 'object') {
    throw new Error('Classifier returned an invalid response (answers were missing)');
  }

  const results = events.map((event, index) => {
    const signalAnswer = payload.answers[`signal_${index}`] || {};
    const vibeAnswer = payload.answers[`vibe_${index}`] || {};
    if (!SIGNALS.includes(signalAnswer.choice)) {
      throw new Error(`Classifier returned an invalid signal for event ${index + 1}`);
    }
    const score = vibeAnswer.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 4) {
      throw new Error(`Classifier returned an invalid vibe score for event ${index + 1}`);
    }
    const vibe = Math.round(score * 25);
    return {
      source_id: event.source_id,
      signal: signalAnswer.choice,
      signals: tagsFor(signalAnswer, signalAnswer.choice),
      best_for: BEST_FOR[signalAnswer.choice],
      vibe,
      verdict: vibe >= 78 ? 'GO' : vibe >= 62 ? 'MAYBE' : 'SKIP',
      confidence: typeof signalAnswer.confidence === 'number' ? signalAnswer.confidence : 0,
    };
  });

  const usage = payload.usage || {};
  return {
    results,
    input_tokens: Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : 0,
    output_tokens: Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : 0,
    batch_latency_ms: Date.now() - startedAt,
  };
}
