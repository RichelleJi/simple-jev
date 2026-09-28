# Pictionary

Static page at `/cool-demo/pictionary/`, linked from Cool demos, with shared navigation. The visitor draws on a canvas (mouse, pen, or touch) and the classifier guesses live: the top guess, a leaderboard of the eight most likely words, and per-guess round-trip time and input tokens.

- **Game mode** shows a random target word and a timer. The round is won when the target reaches the level's threshold. **Free draw** has no target.
- **Normal** uses 38 drawable nouns and wins at 80%. **Absurd** uses 30 abstract concepts ("democracy", "existential dread", "the smell of rain", …) and wins at 60%. Each level is its own option set: the model can only answer with words from the current level, which is what makes Absurd funny.

Each request sends one 384×384 PNG of the drawing and one `choice` question over the current level's words, with `null` descriptions. Only one request is in flight at a time. Every finished stroke asks for a guess, and a snapshot is requested every 700 ms while a stroke is in progress. Requests made while one is pending collapse into a single follow-up with the newest drawing, with at least 300 ms between request starts. Answers sent before a clear, undo to empty, new round, or level change are ignored. HTTP 429 uses the vision demo's bounded retry helper (`../vision/queue.mjs`), honoring Retry-After. Errors are shown and the next stroke tries again; guesses are never fabricated, and responses that fail validation are rejected.

Only the drawing is sent, and only while drawing. No credentials, cookies, or browser storage are used.

Gemma 4 26B is selected by default. In testing, Gemma and Qwen both recognized clean synthetic shapes, but Gemma was noticeably better on real hand-drawn sketches, even though Qwen answers about twice as fast. On the public demo, one request used about 3,000 input tokens on Gemma and 1,500 on Qwen, with round trips around 1.2–2.5 seconds.

Include this folder, `cool-demo/vision/queue.mjs`, and `shared/` in deployment; no build is needed.

Run `node --test website/tests/pictionary.test.mjs`.
