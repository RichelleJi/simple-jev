const DEFAULT_MODEL = 'featherless-ai/Qwen3.8-27B-classifier';
const SUPPORTED_MODELS = [
  'featherless-ai/Qwen3.6-35B-A3B-classifier',
  'featherless-ai/Qwen3.8-27B-classifier',
  'featherless-ai/Qwen3.5-4B-classifier',
  'featherless-ai/gemma-4-26B-A4B-classifier',
  'featherless-ai/gemma-4-12B-it-classifier',
  'featherless-ai/RWKV-std-classifier',
  'featherless-ai/RWKV-mid-classifier',
  'featherless-ai/RWKV-small-classifier',
];
const ENDPOINT = 'https://simple-jev-demo-api.featherless.ai/v1/classifier';
const MAX_BATCH_SIZE = 10;
const SECONDARY_SIGNAL_THRESHOLD = 0.25;
const SIGNALS = ['Investor access', 'Engineer talent', 'Research talent', 'Looking for a job', 'Sales pitch / noise'];
const DEFAULT_RUBRIC = [
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
const BEST_FOR = {
  'Investor access': 'Founders raising',
  'Engineer talent': 'Engineers',
  'Research talent': 'Researchers',
  'Looking for a job': 'Job seekers',
  'Sales pitch / noise': 'General networking',
};

export function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function nextUtcResetSeconds(date = new Date()) {
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - date.getTime()) / 1000));
}

export async function ipFingerprint(request, day, env) {
  // Cloudflare overwrites CF-Connecting-IP at its edge. Never trust a client-supplied X-Forwarded-For.
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  if (!ip) return null;
  const salt = env.SF_SIGNAL_IP_HASH_SALT;
  if (!salt) throw new Error('SF_SIGNAL_IP_HASH_SALT is not configured');
  const bytes = new TextEncoder().encode(`${salt}\n${day}\n${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function ownedRun(request, env, runId) {
  const run = await env.SF_SIGNAL_DB.prepare(
    'SELECT id, model, quota_day, ip_hash, status, total_events, processed_events, input_tokens, output_tokens, total_latency_ms FROM sf_signal_runs WHERE id = ?'
  ).bind(runId).first();
  if (!run) return { response: json({ error: 'Classification run not found' }, 404) };
  const fingerprint = await ipFingerprint(request, run.quota_day, env);
  if (!fingerprint || fingerprint !== run.ip_hash) {
    return { response: json({ error: 'This run belongs to a different IP address' }, 403) };
  }
  return { run };
}

export function normalizeRubric(input) {
  const entries = Array.isArray(input) ? input : [];
  const byName = new Map(entries.filter((entry) => entry && typeof entry.name === 'string').map((entry) => [entry.name, entry]));
  return DEFAULT_RUBRIC.map((base) => {
    const entry = byName.get(base.name) || {};
    const weight = Number.isInteger(entry.weight) ? Math.min(40, Math.max(0, entry.weight)) : base.weight;
    return { ...base, weight };
  });
}

export function buildQuestions(events, rubricInput = []) {
  const rubric = normalizeRubric(rubricInput);
  const signalDescriptions = Object.fromEntries(rubric.filter(({ name }) => SIGNALS.includes(name)).map(({ name, guidance }) => [name, guidance]));
  const questions = {};
  events.forEach((event, index) => {
    questions[`signal_${index}`] = {
      type: 'choice',
      instructions: `For event ${index + 1} in the shared event list, choose its strongest attendee signal. Use the matching signal guidance in the shared rubric.`,
      criteria: signalDescriptions,
    };
    questions[`vibe_${index}`] = {
      type: 'score',
      instructions: `For event ${index + 1} in the shared event list, score its value to a San Francisco engineer, founder, researcher, or job seeker. Apply the fixed rubric and its weights supplied in shared state.`,
      criteria: ['Hard skip', 'Weak', 'Mixed', 'Strong', 'Exceptional'],
    };
  });
  return questions;
}

export function runModel() { return DEFAULT_MODEL; }
export function supportedModels() { return [...SUPPORTED_MODELS]; }
export function isSupportedModel(model) { return SUPPORTED_MODELS.includes(model); }
export function maxBatchSize() { return MAX_BATCH_SIZE; }
export function endpoint(env) { return env.SF_SIGNAL_CLASSIFIER_ENDPOINT || ENDPOINT; }
export function signals() { return SIGNALS; }
export function defaultRubric() { return DEFAULT_RUBRIC.map((item) => ({ ...item })); }
export function signalTags(answer, primary) {
  const probabilities = answer?.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {};
  return [primary, ...SIGNALS.filter((signal) => signal !== primary && Number.isFinite(probabilities[signal]) && probabilities[signal] >= SECONDARY_SIGNAL_THRESHOLD)];
}
export function bestFor() { return BEST_FOR; }
