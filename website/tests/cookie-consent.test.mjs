import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const siteFiles = walk(websiteRoot).filter(
  (f) => !relative(websiteRoot, f).startsWith(`tests${join("")}`) && !f.endsWith("README.md"),
);
const pages = siteFiles.filter((f) => f.endsWith(".html"));
const topLevelPages = readdirSync(websiteRoot)
  .filter((entry) => entry.endsWith(".html"))
  .map((entry) => join(websiteRoot, entry));

// Async loading skips CookieHub's own DOMContentLoaded init, so the banner
// never shows.
test("every site page loads CookieHub synchronously and initializes it explicitly", () => {
  const problems = [];
  for (const file of pages) {
    const rel = relative(websiteRoot, file);
    const html = readFileSync(file, "utf8");
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]*cdn\.cookiehub\.eu[^"]*"[^>]*>\s*<\/script>/g)].map((m) => m[0]);
    const sync = tags.filter((tag) => !/\basync\b|\bdefer\b/.test(tag));
    if (sync.length === 0) problems.push(`${rel}: no synchronous CookieHub script tag`);
    for (const tag of tags) {
      if (/\basync\b/.test(tag)) problems.push(`${rel}: CookieHub script must not be async`);
      if (/\bdefer\b/.test(tag)) problems.push(`${rel}: CookieHub script must not be deferred`);
    }
    if (!html.includes("window.cookiehub.load(cpm);")) problems.push(`${rel}: missing the window.cookiehub.load(cpm) init block`);
  }
  assert.deepEqual(problems, []);
});

// The banner only shows until answered, so users need a static re-entry point.
test("every top-level page links to the privacy policy", () => {
  const problems = [];
  for (const file of topLevelPages) {
    const html = readFileSync(file, "utf8");
    if (!html.includes('href="https://featherless.ai/legal/privacy-policy"')) {
      problems.push(`${relative(websiteRoot, file)}: missing a privacy policy link`);
    }
  }
  assert.deepEqual(problems, []);
});

// Demo pages get their re-entry point from the shared header.
test("shared demo header offers a cookie settings link that opens CookieHub settings", () => {
  const src = readFileSync(join(websiteRoot, "shared/demo-header.js"), "utf8");
  assert.match(src, /class="nav-cookies"/, "demo header must render a .nav-cookies link");
  assert.match(src, /querySelector\("\.nav-cookies"\)/, "click handler must target the .nav-cookies link");
  assert.match(src, /window\.cookiehub\.openSettings\(\)/, "clicking the link must open the CookieHub settings dialog");
});

test("each page embeds exactly one CookieHub script tag", () => {
  const problems = [];
  for (const file of pages) {
    const count = (readFileSync(file, "utf8").match(/cdn\.cookiehub\.eu/g) ?? []).length;
    if (count !== 1) problems.push(`${relative(websiteRoot, file)}: expected one CookieHub reference, found ${count}`);
  }
  assert.deepEqual(problems, []);
});