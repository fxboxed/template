// server/games/wordle/puzzle.js (ESM)

import crypto from "node:crypto";

export function getDayKeyUTC(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getPuzzleId(dayKey, idx) {
  return `wordle:${dayKey}:${idx}`;
}

function hmacHex(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg).digest("hex");
}

export function selectAnswer({ dayKey, idx, secret, answers }) {
  if (!Array.isArray(answers) || answers.length === 0) throw new Error("No answers configured.");
  const seedHex = hmacHex(secret, `${dayKey}:${idx}`);
  const num = parseInt(seedHex.slice(0, 12), 16); // 48 bits
  return answers[num % answers.length];
}

export function evaluateGuess(guess, answer) {
  const res = Array(5).fill("absent");
  const g = guess.split("");
  const a = answer.split("");

  const counts = {};
  for (let i = 0; i < 5; i++) counts[a[i]] = (counts[a[i]] || 0) + 1;

  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = "correct";
      counts[g[i]] -= 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (res[i] === "correct") continue;
    const ch = g[i];
    if (counts[ch] > 0) {
      res[i] = "present";
      counts[ch] -= 1;
    }
  }

  return res;
}
