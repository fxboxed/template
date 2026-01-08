// routes/api/wordle.js (ESM)

import express from "express";
import { getWordlists } from "../../server/games/wordle/wordlists.js";
import {
  getDayKeyUTC,
  getPuzzleId,
  selectAnswer,
  evaluateGuess,
} from "../../server/games/wordle/puzzle.js";

const router = express.Router();

const WORDLE_SECRET = process.env.WORDLE_SECRET || "dev-secret-change-me";
const isProd = process.env.NODE_ENV === "production";

function isValidDayKey(dayKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""));
}

function dayKeyUtcMs(dayKey) {
  // dayKey: YYYY-MM-DD -> ms at UTC midnight
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return Date.UTC(y, mo, d, 0, 0, 0);
}

router.post("/guess", (req, res) => {
  try {
    const { dayKey, idx = 0, guess } = req.body || {};

    const serverDayKey = getDayKeyUTC(new Date());

    // v1 lock: today's puzzle idx=0 only
    if (String(dayKey) !== serverDayKey || Number(idx) !== 0) {
      return res
        .status(403)
        .json({ ok: false, reason: "locked_v1_today_idx0", serverDayKey });
    }

    const g = String(guess || "").trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(g)) {
      return res.json({ ok: true, valid: false, reason: "bad_format" });
    }

    const { answers, guessSet } = getWordlists();

    const inList = guessSet.has(g);

    // ✅ Production: strict list
    // ✅ Development: score anyway so you can test freely (and see colours)
    if (!inList && isProd) {
      return res.json({ ok: true, valid: false, reason: "not_in_word_list" });
    }

    const answer = selectAnswer({
      dayKey: serverDayKey,
      idx: 0,
      secret: WORDLE_SECRET,
      answers,
    });

    const result = evaluateGuess(g, answer);

    return res.json({
      ok: true,
      valid: true,
      warning: !inList ? "not_in_word_list_dev_scored" : "",
      dayKey: serverDayKey,
      idx: 0,
      puzzleId: getPuzzleId(serverDayKey, 0),
      guess: g,
      result,
      isSolved: g === answer,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

// NEW: return canonical answers for previous days.
// Client sends: { idx: 0, dayKeys: ["YYYY-MM-DD", ...] }
// Server returns: { ok:true, serverDayKey, answers: { "YYYY-MM-DD": "apple", ... } }
//
// Rules:
// - idx is locked to 0 (same as v1 guess lock)
// - only returns answers for past days (strictly before serverDayKey)
// - caps request size (10 by default; allows a bit extra safely)
router.post("/answers", (req, res) => {
  try {
    const { idx = 0, dayKeys = [] } = req.body || {};

    const serverDayKey = getDayKeyUTC(new Date());

    // v1 lock: idx=0 only
    if (Number(idx) !== 0) {
      return res
        .status(403)
        .json({ ok: false, reason: "locked_v1_idx0", serverDayKey });
    }

    if (!Array.isArray(dayKeys)) {
      return res.json({ ok: false, reason: "bad_format_dayKeys", serverDayKey });
    }

    // Limit + sanitize
    const wanted = dayKeys
      .map((d) => String(d || "").trim())
      .filter((d) => isValidDayKey(d))
      .slice(0, 20);

    const serverMs = dayKeyUtcMs(serverDayKey);
    const { answers } = getWordlists();

    const out = {};

    for (const dk of wanted) {
      const dkMs = dayKeyUtcMs(dk);

      // only past days; never reveal today's or future answers
      if (!Number.isFinite(dkMs) || dkMs >= serverMs) continue;

      out[dk] = selectAnswer({
        dayKey: dk,
        idx: 0,
        secret: WORDLE_SECRET,
        answers,
      });
    }

    return res.json({
      ok: true,
      serverDayKey,
      idx: 0,
      answers: out,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

export default router;
