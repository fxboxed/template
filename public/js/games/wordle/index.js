// public/js/games/wordle/index.js (ESM)
// Fixes:
// - Hard-normalize st.results[r] at render time (prevents row 2+ losing colours due to legacy saved formats)
// - Keeps migration logic
// - Facebook button copies result then opens share dialog

const CLIENT_VERSION = "2026-01-03.v4.1-row2colors";
window.__WORDLE_CLIENT_VERSION__ = CLIENT_VERSION;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const WORD_LEN = 5;
const MAX_ATTEMPTS = 6;

const STATE_RANK = { empty: 0, absent: 1, present: 2, correct: 3 };
const EMOJI = { absent: "⬛", present: "🟨", correct: "🟩" };

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
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

function clearState(puzId) {
  storage.remove(stateStorageKey(puzId));
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

function normalizeState(s) {
  const v = String(s ?? "").toLowerCase().trim();
  if (!v || v === "empty") return "empty";
  if (["correct", "hit", "right", "green", "match", "exact", "c"].includes(v)) return "correct";
  if (["present", "misplaced", "wrongpos", "wrong_position", "wrong-position", "near", "yellow", "p"].includes(v)) return "present";
  if (["absent", "miss", "none", "no", "gray", "grey", "a"].includes(v)) return "absent";
  return "absent";
}

function normalizeResultArray(arr) {
  // Accept weird legacy things:
  // - array of strings
  // - array of numbers (2/1/0)
  // - string like "correct,present,absent,..." or "cpaaa"
  if (Array.isArray(arr)) {
    return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(arr[i]));
  }

  if (typeof arr === "string") {
    const s = arr.trim().toLowerCase();
    // "correct,present,absent,absent,absent"
    if (s.includes(",")) {
      const parts = s.split(",").map((x) => x.trim());
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(parts[i]));
    }
    // "cpaaa" style
    if (s.length >= WORD_LEN) {
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(s[i]));
    }
  }

  return Array.from({ length: WORD_LEN }, () => "absent");
}

// migrate old state shapes into { guesses: string[], results: string[][] }
function migrateStateShape(st) {
  const next = { ...st };

  const guessesRaw = Array.isArray(next.guesses) ? next.guesses : [];
  const resultsRaw = Array.isArray(next.results) ? next.results : [];

  const guesses = [];
  const results = [];

  for (const g of guessesRaw) {
    if (typeof g === "string") {
      const w = g.trim().toLowerCase();
      if (w.length === WORD_LEN) guesses.push(w);
      continue;
    }
    if (g && typeof g === "object") {
      const w = String(g.word || g.guess || "").trim().toLowerCase();
      if (w.length === WORD_LEN) {
        guesses.push(w);
        if (g.result != null) results.push(normalizeResultArray(g.result));
      }
    }
  }

  if (results.length === 0 && resultsRaw.length > 0) {
    for (const r of resultsRaw) results.push(normalizeResultArray(r));
  }

  while (results.length < guesses.length) results.push(Array.from({ length: WORD_LEN }, () => "absent"));
  if (results.length > guesses.length) results.length = guesses.length;

  next.guesses = guesses;
  next.results = results;

  next.current = typeof next.current === "string" ? next.current : "";
  next.current = next.current.trim().toLowerCase().slice(0, WORD_LEN);

  if (!["playing", "won", "lost"].includes(next.status)) next.status = "playing";

  return next;
}

function computeShareText({ dayKey, idx, attemptsUsed, gridStates }) {
  const score = attemptsUsed != null ? `${attemptsUsed}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  const header = `Game 1 (aptati) ${dayKey} #${idx} ${score}`;
  const lines = gridStates.map((row) => row.map((s) => EMOJI[s] || "⬛").join(""));
  return `${header}\n\n${lines.join("\n")}`;
}

function getShareUrl() {
  return window.location.origin + window.location.pathname;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
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

function renderAttempts(st) {
  const el = $("#wordle-attempts");
  if (!el) return;
  const used = st.guesses.length;
  const show = st.status === "playing" ? Math.min(used + 1, MAX_ATTEMPTS) : used;
  el.textContent = `${show}/${MAX_ATTEMPTS}`;
}

function renderStreak(stats) {
  const el = $("#wordle-streak");
  if (!el) return;
  el.textContent = `Streak: ${Number(stats?.streak || 0)}`;
}

function renderBoard(st) {
  // Clear tiles
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    for (let c = 0; c < WORD_LEN; c++) setTile(r, c, "", "empty");
  }

  // Clear keyboard
  $$("#wordle-keyboard .kb__key[data-key]").forEach((btn) => {
    btn.dataset.state = "empty";
  });

  // Paint completed rows
  for (let r = 0; r < st.guesses.length; r++) {
    const guess = st.guesses[r] || "";
    // ✅ Always normalize whatever is stored for this row
    const rowStates = normalizeResultArray(st.results?.[r]);

    for (let c = 0; c < WORD_LEN; c++) {
      const ch = (guess[c] || "").toUpperCase();
      const state = rowStates[c] || "absent";
      setTile(r, c, ch, state);
      if (ch) setKeyState(ch, state);
    }
  }

  // Paint current row typing
  if (st.status === "playing") {
    const r = st.guesses.length;
    for (let c = 0; c < WORD_LEN; c++) {
      const ch = st.current[c] ? st.current[c].toUpperCase() : "";
      setTile(r, c, ch, "empty");
    }
  }

  renderAttempts(st);
}

function openSharePanel(st, { dayKey, idx }) {
  const pre = $("#wordle-shareText");
  if (!pre) return;

  const gridStates = [];
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    if (st.results?.[r]) gridStates.push(normalizeResultArray(st.results[r]));
    else gridStates.push(Array.from({ length: WORD_LEN }, () => "absent"));
  }

  const attemptsUsed = st.status === "won" ? st.guesses.length : null;
  pre.textContent = computeShareText({ dayKey, idx, attemptsUsed, gridStates });
  setShareOpen(true);
}

function normalizeKeyFromEvent(e) {
  const k = e.key;
  if (k === "Enter") return "Enter";
  if (k === "Backspace") return "Backspace";
  if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
  return null;
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
    guesses: [],
    results: [],
    current: "",
    status: "playing",
  };

  const saved = loadState(puzId);
  let st = saved && saved.puzzleId === puzId ? saved : defaultState;

  // migrate + persist so the data stops being weird
  st = migrateStateShape(st);
  saveState(puzId, st);

  let isSubmitting = false;

  const stats = loadStats();
  renderStreak(stats);
  renderBoard(st);

  const onLetter = (L) => {
    if (st.status !== "playing") return;
    if (st.current.length >= WORD_LEN) return;
    st.current += L.toLowerCase();
    renderBoard(st);
    saveState(puzId, st);
  };

  const onBackspace = () => {
    if (st.status !== "playing") return;
    if (!st.current.length) return;
    st.current = st.current.slice(0, -1);
    renderBoard(st);
    saveState(puzId, st);
  };

  const onEnter = async () => {
    if (isSubmitting) return;
    if (st.status !== "playing") return;

    const g = st.current.trim().toLowerCase();
    if (g.length !== WORD_LEN) {
      toast("Need 5 letters.");
      return;
    }

    isSubmitting = true;
    toast("Checking…");

    try {
      const data = await apiGuess({ dayKey, idx, guess: g });

      if (!data?.ok) {
        toast("Server error.");
        return;
      }

      if (!data.valid) {
        const why =
          data.reason === "not_in_word_list" ? "Not in word list." :
          data.reason === "bad_format" ? "Invalid guess." :
          "Not allowed.";
        toast(why);
        return;
      }

      const result = normalizeResultArray(data.result);
      const row = st.guesses.length;

      st.guesses.push(g);
      st.results[row] = result;

      st.current = "";
      renderBoard(st);
      saveState(puzId, st);

      if (data.isSolved) {
        st.status = "won";

        const s = loadStats();
        if (s.lastWinDayKey !== dayKey) {
          s.streak = Number(s.streak || 0) + 1;
          s.lastWinDayKey = dayKey;
          saveStats(s);
          renderStreak(s);
        }

        toast("Solved!");
        saveState(puzId, st);
        openSharePanel(st, { dayKey, idx });
        return;
      }

      if (st.guesses.length >= MAX_ATTEMPTS) {
        st.status = "lost";
        const s = loadStats();
        s.streak = 0;
        saveStats(s);
        renderStreak(s);
        toast("Unlucky. New puzzle at 00:00 UTC.");
        saveState(puzId, st);
        openSharePanel(st, { dayKey, idx });
        return;
      }

      toast("");
    } catch {
      toast("Network error.");
    } finally {
      isSubmitting = false;
    }
  };

  // On-screen keyboard
  $("#wordle-keyboard")?.addEventListener("click", (e) => {
    const btn = e.target?.closest("button[data-key]");
    if (!btn) return;
    const k = btn.getAttribute("data-key");

    if (k === "Enter") onEnter();
    else if (k === "Backspace") onBackspace();
    else if (/^[A-Z]$/.test(k)) onLetter(k);
  });

  // Physical keyboard
  window.addEventListener("keydown", (e) => {
    if (!$("#wordle-sharePanel")?.hidden) return;

    const k = normalizeKeyFromEvent(e);
    if (!k) return;

    if (k === "Enter") {
      if (e.repeat) return;
      e.preventDefault();
      onEnter();
      return;
    }
    if (k === "Backspace") {
      e.preventDefault();
      onBackspace();
      return;
    }
    if (/^[A-Z]$/.test(k)) onLetter(k);
  });

  // Share UI
  $("#wordle-shareBtn")?.addEventListener("click", () => openSharePanel(st, { dayKey, idx }));
  $("#wordle-closeShareBtn")?.addEventListener("click", () => setShareOpen(false));

  $("#wordle-copyBtn")?.addEventListener("click", async () => {
    const text = $("#wordle-shareText")?.textContent || "";
    const ok = await copyToClipboard(text);
    toast(ok ? "Copied result ✅" : "Copy failed.");
  });

  $("#wordle-copyLinkBtn")?.addEventListener("click", async () => {
    const url = getShareUrl();
    const ok = await copyToClipboard(url);
    toast(ok ? "Copied link 🔗" : "Copy failed.");
  });

  $("#wordle-nativeShareBtn")?.addEventListener("click", async () => {
    const url = getShareUrl();
    const text = $("#wordle-shareText")?.textContent || "";
    if (navigator.share) {
      try {
        await navigator.share({ title: "Game 1 (aptati)", text, url });
        toast("Shared ✅");
      } catch {
        // cancelled
      }
    } else {
      toast("No native share on this browser.");
    }
  });

  // Facebook: copy result first, then open share dialog
  $("#wordle-fbBtn")?.addEventListener("click", async () => {
    const shareUrl = encodeURIComponent(getShareUrl());
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`;

    const text = $("#wordle-shareText")?.textContent || "";
    if (text) {
      const ok = await copyToClipboard(text);
      toast(ok ? "Result copied. Paste into Facebook post." : "Open Facebook. (Copy failed)");
    } else {
      toast("Open Facebook share.");
    }

    window.open(fb, "_blank", "noopener,noreferrer,width=640,height=480");
  });

  // Reset
  $("#wordle-resetBtn")?.addEventListener("click", () => {
    clearState(puzId);
    st = migrateStateShape({ ...defaultState });
    renderBoard(st);
    saveState(puzId, st);
    toast("Reset locally.");
  });
}

document.addEventListener("DOMContentLoaded", initWordle);
