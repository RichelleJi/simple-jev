import { fetchWithRetry, wait } from "../vision/queue.mjs";
import { levels, idFor, buildRequest, guessesFrom } from "./request.mjs";

const $ = (id) => document.getElementById(id),
  base = "https://simple-jev-demo-api.featherless.ai/v1";
// Snapshots while a stroke is in progress; gap between request starts; image size sent.
const DRAW_SNAPSHOT_MS = 700,
  MIN_GAP_MS = 300,
  IMAGE_SIZE = 384,
  TOP_N = 8;

let level = "normal",
  mode = "game";
const round = { word: "", start: 0, won: false, timer: null };

function text(node, value) {
  node.textContent = value;
}

// ---------- drawing ----------
const canvas = $("canvas"),
  ctx = canvas.getContext("2d");
const strokes = [];
let current = null,
  dirty = false;

function paint() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
    ctx.stroke();
  }
  $("hint").hidden = strokes.length > 0;
}

function point(event) {
  const r = canvas.getBoundingClientRect();
  return [
    ((event.clientX - r.left) * canvas.width) / r.width,
    ((event.clientY - r.top) * canvas.height) / r.height,
  ];
}

canvas.addEventListener("pointerdown", (event) => {
  if (round.won || $("model").disabled) return;
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {}
  current = [point(event)];
  strokes.push(current);
  startTimer();
  dirty = true;
  paint();
});
canvas.addEventListener("pointermove", (event) => {
  if (!current) return;
  current.push(point(event));
  dirty = true;
  paint();
});
function endStroke() {
  if (!current) return;
  current = null;
  requestGuess(); // every finished stroke gets a guess
}
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
setInterval(() => current && dirty && requestGuess(), DRAW_SNAPSHOT_MS);

function clearDrawing() {
  strokes.length = 0;
  current = null;
  paint();
  resetGuess();
}
$("undo").addEventListener("click", () => {
  strokes.pop();
  paint();
  strokes.length ? requestGuess() : resetGuess();
});
$("clear").addEventListener("click", clearDrawing);

// ---------- classify: one request in flight, newest drawing next ----------
const snapshot = document.createElement("canvas");
snapshot.width = snapshot.height = IMAGE_SIZE;
let busy = false,
  wanted = false,
  epoch = 0,
  guesses = 0;

function requestGuess() {
  if (!strokes.length || round.won) return;
  wanted = true;
  if (!busy) pump();
}

async function pump() {
  busy = true;
  try {
    while (wanted && strokes.length && !round.won) {
      wanted = false;
      dirty = false;
      const sentEpoch = epoch,
        sentLevel = level;
      snapshot.getContext("2d").drawImage(canvas, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
      const body = buildRequest(
        $("model").value,
        sentLevel,
        snapshot.toDataURL("image/png"),
      );
      const started = performance.now();
      try {
        const response = await fetchWithRetry(
          base + "/classifier",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "omit",
          },
          {
            onRetry: (n, delay) =>
              text(
                $("status"),
                `Rate limited. Retry ${n} of 3 in ${Math.ceil(delay / 1000)} s…`,
              ),
          },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok)
          throw Error(
            response.status === 429
              ? "Rate limit persists after retries. Try again in a moment."
              : data?.error?.message ||
                  (typeof data?.detail === "string"
                    ? data.detail
                    : `API error ${response.status}`),
          );
        // A clear, new round, or level change since sending makes this answer stale.
        if (sentEpoch === epoch) {
          render(guessesFrom(data, sentLevel), performance.now() - started, data);
          text($("status"), "Guessing live as you draw.");
        }
      } catch (error) {
        text($("status"), error.message);
      }
      await wait(MIN_GAP_MS);
    }
  } finally {
    busy = false;
  }
}

// ---------- render ----------
function resetGuess() {
  epoch++;
  text($("lead"), "Waiting for a sketch…");
  text($("g-name"), "?");
  text($("g-pct"), "");
  $("board").replaceChildren();
}

function leadText(p) {
  if (level === "absurd")
    return p >= levels.absurd.winAt
      ? "Unmistakably…"
      : p >= 0.4
        ? "Squinting, it's probably…"
        : "Honestly? Maybe…";
  return p >= levels.normal.winAt
    ? "It's…"
    : p >= 0.4
      ? "I think it's…"
      : "Maybe…";
}

function row(guess, isTop, isTarget) {
  const node = document.createElement("div");
  node.className = "board-row";
  node.classList.toggle("top", isTop);
  node.classList.toggle("target", isTarget);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = guess.word;
  name.title = guess.word;
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("div");
  fill.className = "fill";
  fill.style.width = `${(guess.p * 100).toFixed(1)}%`;
  track.append(fill);
  const value = document.createElement("span");
  value.className = "value";
  value.textContent = `${(guess.p * 100).toFixed(guess.p < 0.1 ? 1 : 0)}%`;
  node.append(name, track, value);
  return node;
}

function render(sorted, elapsed, data) {
  const top = sorted[0];
  guesses++;
  text($("lead"), leadText(top.p));
  text($("g-name"), top.word);
  text($("g-pct"), `${Math.round(top.p * 100)}%`);
  text($("m-n"), `#${guesses}`);
  text($("m-rt"), `${Math.round(elapsed)} ms`);
  text($("m-tok"), data.usage?.input_tokens ?? "–");
  text($("response"), JSON.stringify(data, null, 2));

  // Top guesses, always including the target in game mode.
  const target = mode === "game" ? idFor(round.word) : null;
  const shown = sorted.slice(0, TOP_N);
  if (target && !shown.some((g) => g.id === target))
    shown[TOP_N - 1] = sorted.find((g) => g.id === target);
  $("board").replaceChildren(
    ...shown.map((g) => row(g, g === top, g.id === target)),
  );

  const targetGuess = target && sorted.find((g) => g.id === target);
  if (!round.won && targetGuess && targetGuess.p >= levels[level].winAt) win();
}

// ---------- game ----------
function newRound() {
  const words = levels[level].words;
  let word;
  do word = words[Math.floor(Math.random() * words.length)];
  while (word === round.word && words.length > 1);
  clearInterval(round.timer);
  Object.assign(round, { word, start: 0, won: false });
  text($("target"), word);
  text($("timer"), "0.0s");
  $("prompt").classList.remove("won");
  $("banner").hidden = true;
  $("next").hidden = true;
  $("skip").hidden = false;
  clearDrawing();
}

function startTimer() {
  if (mode !== "game" || round.start) return;
  round.start = performance.now();
  round.timer = setInterval(
    () =>
      text(
        $("timer"),
        `${((performance.now() - round.start) / 1000).toFixed(1)}s`,
      ),
    100,
  );
}

function win() {
  round.won = true;
  clearInterval(round.timer);
  const seconds = ((performance.now() - round.start) / 1000).toFixed(1);
  text($("timer"), `${seconds}s`);
  $("prompt").classList.add("won");
  text(
    $("banner"),
    level === "absurd"
      ? `Somehow, it believes you. ${seconds}s`
      : `Got it in ${seconds}s!`,
  );
  $("banner").hidden = false;
  $("next").hidden = false;
  $("skip").hidden = true;
}

function apply() {
  for (const name of Object.keys(levels))
    $(`lvl-${name}`).setAttribute("aria-pressed", name === level);
  $("mode-game").setAttribute("aria-pressed", mode === "game");
  $("mode-free").setAttribute("aria-pressed", mode === "free");
  document
    .querySelector(".pictionary-page")
    .classList.toggle("absurd", level === "absurd");
  $("prompt").hidden = mode !== "game";
  text($("skip"), level === "absurd" ? "Give up" : "Skip word");
  const { words, winAt } = levels[level];
  text(
    $("words"),
    `The model picks from ${words.length} ${level === "absurd" ? "concepts" : "words"}: ${words.join(", ")}. ` +
      (mode === "game" ? `You win at ${Math.round(winAt * 100)}%.` : ""),
  );
  clearInterval(round.timer);
  round.won = false;
  if (mode === "game") newRound();
  else {
    $("banner").hidden = true;
    $("skip").hidden = true;
    $("next").hidden = true;
    clearDrawing();
  }
}

for (const name of Object.keys(levels))
  $(`lvl-${name}`).addEventListener("click", () => {
    level = name;
    apply();
  });
$("mode-game").addEventListener("click", () => {
  mode = "game";
  apply();
});
$("mode-free").addEventListener("click", () => {
  mode = "free";
  apply();
});
$("skip").addEventListener("click", newRound);
$("next").addEventListener("click", newRound);
$("model").addEventListener("change", () => strokes.length && requestGuess());
paint();
apply();

// ---------- models ----------
try {
  const response = await fetch(base + "/models", {
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Model list unavailable (${response.status})`);
  const ids = ((await response.json())?.data ?? [])
    .map((m) => m?.id)
    .filter((id) => typeof id === "string" && /gemma|qwen/i.test(id))
    .sort();
  if (!ids.length) throw Error("No vision models are available right now.");
  $("model").replaceChildren(...ids.map((id) => new Option(id, id)));
  // Gemma 26B read hand-drawn sketches more reliably than Qwen in testing.
  const preferred = "featherless-ai/gemma-4-26B-A4B-classifier";
  if (ids.includes(preferred)) $("model").value = preferred;
  $("model").disabled = false;
  text($("status"), "Ready. Start drawing.");
} catch (error) {
  text($("status"), `Could not load models: ${error.message}`);
}
