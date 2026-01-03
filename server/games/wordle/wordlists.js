// server/games/wordle/wordlists.js (ESM)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadWordFile(relPath) {
  const abs = path.join(__dirname, relPath);
  const raw = fs.readFileSync(abs, "utf8");
  return raw
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

let cached = null;

export function getWordlists() {
  if (cached) return cached;

  const answers = loadWordFile("./answers.txt").filter((w) => /^[a-z]{5}$/.test(w));
  const guesses = loadWordFile("./guesses.txt").filter((w) => /^[a-z]{5}$/.test(w));

  const guessSet = new Set(guesses);
  for (const a of answers) guessSet.add(a);

  cached = { answers, guessSet };
  return cached;
}
