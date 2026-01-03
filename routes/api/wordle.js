// routes/api/wordle.js (ESM)

import express from "express";
import { getWordlists } from "../../server/games/wordle/wordlists.js";
import { getDayKeyUTC, getPuzzleId, selectAnswer, evaluateGuess } from "../../server/games/wordle/puzzle.js";

const router = express.Router();

const WORDLE_SECRET = process.env.WORDLE_SECRET || "dev-secret-change-me";

router.post("/guess", (req, res) => {
  try {
    const { dayKey, idx = 0, guess } = req.body || {};

    const serverDayKey = getDayKeyUTC(new Date());

    // v1 lock: today's puzzle idx=0 only
    if (String(dayKey) !== serverDayKey || Number(idx) !== 0) {
      return res.status(403).json({ ok: false, reason: "locked_v1_today_idx0", serverDayKey });
    }

    const g = String(guess || "").trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(g)) return res.json({ ok: true, valid: false, reason: "bad_format" });

    const { answers, guessSet } = getWordlists();
    if (!guessSet.has(g)) return res.json({ ok: true, valid: false, reason: "not_in_word_list" });

    const answer = selectAnswer({ dayKey: serverDayKey, idx: 0, secret: WORDLE_SECRET, answers });
    const result = evaluateGuess(g, answer);

    return res.json({
      ok: true,
      valid: true,
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

export default router;
