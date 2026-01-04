// server/games/wordle/wordlists.js (ESM)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Word length (default 5). Keep this consistent with v1.
const WORD_LEN = Number(process.env.WORDLE_WORD_LENGTH || 5) || 5;

const ANSWERS_PATH = path.join(__dirname, "answers.txt");
const GUESSES_PATH = path.join(__dirname, "guesses.txt");

// Cache only in prod. In dev, reload each call so edits apply instantly.
let _cache = null;

function normalizeLines(text) {
  const out = [];
  const re = new RegExp(`^[a-z]{${WORD_LEN}}$`);

  for (const raw of String(text || "").split(/\r?\n/)) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    if (!re.test(w)) continue;
    out.push(w);
  }
  return out;
}

function readFileSafe(fp) {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}

function build() {
  const answersText = readFileSafe(ANSWERS_PATH);
  const guessesText = readFileSafe(GUESSES_PATH);

  const answers = Array.from(new Set(normalizeLines(answersText)));
  const guesses = Array.from(new Set(normalizeLines(guessesText)));

  // ✅ Always allow answers as guesses too (Wordle standard)
  const guessSet = new Set([...answers, ...guesses]);

  return {
    answers,
    guesses,
    guessSet,
    wordLength: WORD_LEN,
    counts: {
      answers: answers.length,
      guesses: guesses.length,
      totalAllowed: guessSet.size,
    },
    paths: {
      answers: ANSWERS_PATH,
      guesses: GUESSES_PATH,
    },
  };
}

export function getWordlists() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return build();      // ✅ dev: hot reload wordlists
  if (_cache) return _cache;
  _cache = build();
  return _cache;
}

// Optional manual reload (still useful)
export function reloadWordlists() {
  _cache = build();
  return _cache;
}
