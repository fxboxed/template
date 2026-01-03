// public/js/games/wordle/index.js (ESM)
// Fixes:
// - Supports server result formats: strings OR numbers (2/1/0) OR objects ({state:"present"})
// - Prevents double-submit (Enter repeat + fast clicks)
// - Keeps attempts + streak UI updated
// - Uses your actual API route: /api/games/game1/guess  :contentReference[oaicite:4]{index=4}

const CLIENT_VERSION = "2026-01-03.v3";
window.__WORDLE_CLIENT_VERSION__ = CLIENT_VERSION;
console.log(`[Wordle] client ${CLIENT_VERSION} loaded`);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const WORD_LEN = 5;
const MAX_ATTEMPTS = 6;

const STATE_RANK = { empty: 0, absent: 1, present: 2, correct: 3 };
const EMOJI = { absent: "⬛", present: "🟨", correct: "🟩" };

const SHAKE_MS = 420;
const FLIP_MS = 520;

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  },
};

function pad2(n) { return String(n).padStart(2, "0"); }

function formatHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function nextUtcMidnightMs(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return Date.UTC(y, m, d + 1, 0, 0, 0);
}

function toast(msg) {
  const el = $("#wordle-toast");
  if (el) el.textContent = msg || "";
}

function setShareOpen(open) {
  const panel = $("#wordle-sharePanel");
  if (panel) panel.hidden = !open;
}

function readGameDataset() {
  const root = $(".game--wordle");
  if (root) root.dataset.clientVersion = CLIENT_VERSION;

  return {
    root,
    dayKey: root?.dataset.dayKey || "",
    idx: Number(root?.dataset.idx || 0),
  };
}

function puzzleId(dayKey, idx) {
  return `wordle:${dayKey}:${idx}`;
}

function stateStorageKey(puzId) {
  return `aptati:wordle:state:${puzId}`;
}

function statsStorageKey() {
  return `aptati:wordle:stats`;
}

function safeJsonParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function loadState(puzId) {
  return safeJsonParse(storage.get(stateStorageKey(puzId)), null);
}

function saveState(puzId, st) {
  storage.set(stateStorageKey(puzId), JSON.stringify(st));
}

function loadStats() {
  return safeJsonParse(storage.get(statsStorageKey()), {
    streak: 0,
    lastWinDayKey: null,
  });
}

function saveStats(stats) {
  storage.set(statsStorageKey(), JSON.stringify(stats));
}

function rankUpgrade(oldState, newState) {
  const o = STATE_RANK[oldState] ?? 0;
  const n = STATE_RANK[newState] ?? 0;
  return n > o ? newState : oldState;
}

function rowEl(row) {
  return $(`#wordle-board .wordle__row[data-row="${row}"]`);
}

function tileAt(row, col) {
  const r = rowEl(row);
  if (!r) return null;
  return r.querySelector(`.wordle__tile[data-col="${col}"]`);
}

function setTile(row, col, letter, state) {
  const el = tileAt(row, col);
  if (!el) return;
  el.textContent = letter || "";
  el.dataset.state = state || "empty";
}

function keyButton(letter) {
  return $(`#wordle-keyboard .kb__key[data-key="${letter}"]`);
}

function setKeyState(letter, state) {
  const btn = keyButton(letter);
  if (!btn) return;
  const old = btn.dataset.state || "empty";
  btn.dataset.state = rankUpgrade(old, state);
}

// ✅ Handles result elements that are:
// - strings: "correct"/"present"/"absent"/"misplaced"/"partial"...
// - numbers: 2/1/0 (or 3/2/1 style)
// - objects: {state:"present"} or {status:"correct"} etc.
function normalizeState(x) {
  // numbers (common: 2 correct, 1 present, 0 absent)
  if (typeof x === "number") {
    if (x >= 2) return "correct";
    if (x === 1) return "present";
    return "absent";
  }

  // objects: try common property names
  if (x && typeof x === "object") {
    const cand =
      x.state ?? x.status ?? x.result ?? x.kind ?? x.color ?? x.label ?? x.value;
    return normalizeState(cand);
  }

  const v = String(x ?? "").toLowerCase().trim();

  if (!v || v === "empty") return "empty";

  // correct (green)
  if (["correct", "hit", "right", "green", "match", "exact", "c"].includes(v)) return "correct";

  // present (yellow) — include more synonyms
  if (
    [
      "present",
      "misplaced",
      "partial",
      "inword",
      "in_word",
      "exists",
      "elsewhere",
      "wrongpos",
      "wrong_position",
      "wrong-position",
      "near",
      "yellow",
      "p",
    ].includes(v)
  ) {
    return "present";
  }

  // absent (grey)
  if (["absent", "miss", "none", "no", "gray", "grey", "a"].includes(v)) return "absent";

  return "absent";
}

function normalizeResultArray(arr) {
  const out = Array.from({ length: WORD_LEN }, () => "absent");
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < WORD_LEN; i++) out[i] = normalizeState(arr[i]);
  return out;
}

function computeShareText({ dayKey, idx, attemptsUsed, gridStates }) {
  const score = attemptsUsed != null ? `${attemptsUsed}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  const header = `Game 1 (aptati) ${dayKey} #${idx} ${score}`;
  const lines = gridStates.map((row) => row.map((s) => EMOJI[s] || "⬛").join(""));
  return `${header}\n\n${lines.join("\n")}`;
}

async function apiGuess({ dayKey, idx, guess }) {
  const res = await fetch("/api/games/game1/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dayKey, idx, guess }),
  });
  return res.json();
}

function initCountdown() {
  const el = $("#wordle-countdown");
  if (!el) return;

  const tick = () => {
    const now = new Date();
    const t = nextUtcMidnightMs(now) - now.getTime();
    el.textContent = formatHMS(t);
  };

  tick();
  setInterval(tick, 1000);
}

function initWordle() {
  initCountdown();

  const { root, dayKey, idx } = readGameDataset();
  if (!root) return;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    toast("Missing dayKey.");
    return;
  }

  const puzId = puzzleId(dayKey, idx);

  const defaultState = {
    puzzleId: puzId,
    dayKey,
    idx,
    guesses: [], // [{ word, result }]
    current: "",
    status: "playing",
    keyboard: {},
  };

  const st = loadState(puzId) || defaultState;

  // normalize any stored results (back-compat)
  if (Array.isArray(st.guesses)) {
    for (const g of st.guesses) {
      if (g && Array.isArray(g.result)) g.result = normalizeResultArray(g.result);
    }
  }

  let isSubmitting = false;

  function setStatus(status) {
    st.status = status;
    root.dataset.status = status;
  }

  function renderAttempts() {
    const el = $("#wordle-attempts");
    if (!el) return;

    const attemptNum =
      st.status === "playing"
        ? Math.min(st.guesses.length + 1, MAX_ATTEMPTS)
        : Math.min(st.guesses.length, MAX_ATTEMPTS);

    el.textContent = `${attemptNum}/${MAX_ATTEMPTS}`;
  }

  function renderStreak() {
    const stats = loadStats();
    const el = $("#wordle-streak");
    if (!el) return;
    el.textContent = `Streak: ${Number(stats.streak || 0)}`;
  }

  function renderBoard() {
    for (let r = 0; r < MAX_ATTEMPTS; r++) {
      const committed = st.guesses[r] || null;

      for (let c = 0; c < WORD_LEN; c++) {
        if (committed) {
          const letter = committed.word?.[c]?.toUpperCase?.() || "";
          const state = committed.result?.[c] || "absent";
          setTile(r, c, letter, state);
        } else if (r === st.guesses.length && st.status === "playing") {
          const ch = st.current[c] ? st.current[c].toUpperCase() : "";
          setTile(r, c, ch, "empty");
        } else {
          setTile(r, c, "", "empty");
        }
      }
    }
  }

  function renderKeyboard() {
    for (const btn of $$("#wordle-keyboard .kb__key")) btn.dataset.state = "empty";
    for (const [k, v] of Object.entries(st.keyboard || {})) setKeyState(k, v);
  }

  function renderShareText() {
    if (st.status === "playing") {
      const el = $("#wordle-shareText");
      if (el) el.textContent = "";
      return;
    }

    const gridStates = st.guesses.map((g) => g.result);
    const attemptsUsed = st.status === "won" ? st.guesses.length : null;

    $("#wordle-shareText").textContent = computeShareText({
      dayKey: st.dayKey,
      idx: st.idx,
      attemptsUsed,
      gridStates,
    });
  }

  function render() {
    renderBoard();
    renderKeyboard();
    renderShareText();
    renderAttempts();
    renderStreak();
    root.dataset.status = st.status;
  }

  function persist() {
    saveState(puzId, st);
  }

  function shakeRow(rowIndex) {
    const r = rowEl(rowIndex);
    if (!r) return;
    r.classList.remove("is-shake");
    void r.offsetWidth;
    r.classList.add("is-shake");
    setTimeout(() => r.classList.remove("is-shake"), SHAKE_MS);
  }

  function flipRow(rowIndex) {
    const r = rowEl(rowIndex);
    if (!r) return;
    r.classList.remove("is-revealing");
    void r.offsetWidth;
    r.classList.add("is-revealing");
    setTimeout(() => r.classList.remove("is-revealing"), FLIP_MS + 80);
  }

  function updateKeyboardFromResult(word, result) {
    for (let i = 0; i < WORD_LEN; i++) {
      const L = word[i].toUpperCase();
      const prev = st.keyboard[L] || "empty";
      st.keyboard[L] = rankUpgrade(prev, result[i]);
    }
  }

  function markWon() {
    setStatus("won");

    const stats = loadStats();
    if (stats.lastWinDayKey !== st.dayKey) {
      const last = stats.lastWinDayKey ? Date.parse(`${stats.lastWinDayKey}T00:00:00Z`) : null;
      const now = Date.parse(`${st.dayKey}T00:00:00Z`);
      const oneDay = 24 * 3600 * 1000;

      if (last && now - last === oneDay) stats.streak = (stats.streak || 0) + 1;
      else stats.streak = 1;

      stats.lastWinDayKey = st.dayKey;
      saveStats(stats);
    }

    toast("Solved! 🎉");
    setShareOpen(true);
  }

  function markLost() {
    setStatus("lost");
    toast("Out of attempts.");
    setShareOpen(true);
  }

  function inputLetter(ch) {
    if (st.status !== "playing") return;
    if (!/^[a-z]$/i.test(ch)) return;
    if (st.current.length >= WORD_LEN) return;

    st.current += ch.toUpperCase();
    persist();
    render();
  }

  function backspace() {
    if (st.status !== "playing") return;
    st.current = st.current.slice(0, -1);
    persist();
    render();
  }

  async function submitGuess() {
    if (isSubmitting) return; // stop double-submits
    if (st.status !== "playing") return;

    const guess = st.current.toLowerCase();
    const activeRow = st.guesses.length;

    if (guess.length !== WORD_LEN) {
      toast("Need 5 letters.");
      shakeRow(activeRow);
      return;
    }

    if (st.guesses.length >= MAX_ATTEMPTS) return;

    isSubmitting = true;
    root.dataset.submitting = "1";
    toast("");

    try {
      const data = await apiGuess({ dayKey: st.dayKey, idx: st.idx, guess });

      if (!data.ok) {
        // show server dayKey if mismatch (helps when testing around UTC midnight)
        const extra = data.serverDayKey ? ` (server: ${data.serverDayKey})` : "";
        toast(data.reason === "locked_v1_today_idx0" ? `Daily locked${extra}` : "Server error.");
        shakeRow(activeRow);
        return;
      }

      if (!data.valid) {
        toast(data.reason === "not_in_word_list" ? "Not in word list." : "Invalid guess.");
        shakeRow(activeRow);
        return;
      }

      const normalized = normalizeResultArray(data.result);

      st.guesses.push({ word: guess, result: normalized });
      updateKeyboardFromResult(guess, normalized);
      st.current = "";

      persist();
      render();
      flipRow(activeRow);

      if (data.isSolved) {
        markWon();
        persist();
        render();
        return;
      }

      if (st.guesses.length >= MAX_ATTEMPTS) {
        markLost();
        persist();
        render();
      }
    } catch {
      toast("Network error.");
      shakeRow(activeRow);
    } finally {
      isSubmitting = false;
      delete root.dataset.submitting;
    }
  }

  function handleKey(key) {
    if (key === "Enter") return submitGuess();
    if (key === "Backspace") return backspace();
    if (key.length === 1) return inputLetter(key);
  }

  // Physical keyboard
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key;

    // prevent holding Enter from firing repeatedly
    if (k === "Enter" && e.repeat) return;

    if (k === "Enter" || k === "Backspace") {
      e.preventDefault();
      handleKey(k);
      return;
    }
    if (/^[a-z]$/i.test(k)) handleKey(k);
  });

  // On-screen keyboard
  $("#wordle-keyboard")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    // stop spamming Enter while a request is in flight
    if (btn.dataset.key === "Enter" && isSubmitting) return;
    handleKey(btn.dataset.key);
  });

  // Share UI
  $("#wordle-shareBtn")?.addEventListener("click", () => {
    if (st.status === "playing") return toast("Finish the puzzle to share.");
    setShareOpen(true);
  });

  $("#wordle-closeShareBtn")?.addEventListener("click", () => setShareOpen(false));

  $("#wordle-copyBtn")?.addEventListener("click", async () => {
    const text = $("#wordle-shareText")?.textContent || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard.");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Copied.");
    }
  });

  $("#wordle-resetBtn")?.addEventListener("click", () => {
    storage.remove(stateStorageKey(puzId));
    location.reload();
  });

  render();
}

document.addEventListener("DOMContentLoaded", initWordle);
