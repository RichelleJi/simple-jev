// Word lists, request construction, and response validation for Pictionary.
// Each level is its own option set: the model only chooses between its words
// (the API allows at most 50 choice options).
export const levels = {
  normal: {
    winAt: 0.8,
    words: [
      "cat", "dog", "fish", "bird", "snake", "spider", "house", "tree", "flower",
      "sun", "moon", "star", "cloud", "rainbow", "mountain", "car", "bicycle",
      "airplane", "boat", "rocket", "clock", "cup", "key", "umbrella", "glasses",
      "hat", "shoe", "apple", "banana", "pizza", "ice cream", "heart",
      "smiley face", "snowman", "ladder", "lightbulb", "guitar", "book",
    ],
  },
  absurd: {
    winAt: 0.6,
    words: [
      "democracy", "Tuesday", "the smell of rain", "existential dread", "Wi-Fi",
      "deja vu", "a sneeze", "gravity", "jazz", "procrastination", "a white lie",
      "taxes", "awkward silence", "the internet", "nostalgia", "Monday morning",
      "inflation", "a group chat", "time zones", "a software bug", "irony",
      "the cloud", "a midlife crisis", "an inside joke", "an echo",
      "the number zero", "sarcasm", "a hangover", "bureaucracy", "vibes",
    ],
  },
};

// Choice IDs the model sees, e.g. "the smell of rain" -> "the_smell_of_rain".
export const idFor = (word) =>
  word.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function buildRequest(model, level, image) {
  if (!/gemma|qwen/i.test(model))
    throw Error("Choose a Gemma or Qwen vision model.");
  if (!Object.hasOwn(levels, level)) throw Error("Unknown difficulty.");
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(image))
    throw Error("A drawing is required.");
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "A quick black-and-white sketch drawn in a Pictionary game.",
          },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    questions: {
      drawing: {
        type: "choice",
        instructions: "What is this sketch trying to depict?",
        criteria: Object.fromEntries(
          levels[level].words.map((w) => [idFor(w), null]),
        ),
      },
    },
  };
}

// Returns guesses sorted by probability, or throws rather than showing a partial result.
export function guessesFrom(data, level) {
  const answer = data?.answers?.drawing;
  const ids = levels[level]?.words.map(idFor);
  const inUnit = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
  if (
    !ids ||
    !answer ||
    !ids.includes(answer.choice) ||
    !ids.every((k) => inUnit(answer.probabilities?.[k]))
  )
    throw Error("The API returned an invalid guess.");
  return levels[level].words
    .map((word) => ({ id: idFor(word), word, p: answer.probabilities[idFor(word)] }))
    .sort((a, b) => b.p - a.p);
}
