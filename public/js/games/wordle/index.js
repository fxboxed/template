// public/js/games/wordle/index.js (ESM)
//
// This file implements the client-side logic for the "Game 1" Wordle-style game.
// Responsibilities:
// - Read puzzle identity (dayKey + idx) from DOM dataset
// - Load/save per-puzzle state (guesses/results/current/status) in localStorage
// - Migrate legacy save formats into the current canonical shape
// - Render the board + keyboard states from the saved state
// - Submit guesses to the server, handle validation + win/loss
// - Show share UI, copy/share text, and special Facebook behavior
//
// Fixes called out by the header request:
// - ✅ Hard-normalize st.results[r] at render time (prevents row 2+ losing colours due to legacy saved formats)
// - ✅ Keeps migration logic
// - ✅ Facebook button copies result then opens share dialog

// A version string to help you identify what client build wrote a given save.
// (Useful for debugging localStorage issues in the wild.)
const CLIENT_VERSION = "2026-01-03.v4.1-row2colors";

// Expose client version for quick debugging via DevTools: window.__WORDLE_CLIENT_VERSION__
window.__WORDLE_CLIENT_VERSION__ = CLIENT_VERSION;

// Tiny DOM helpers.
// $  -> first match
// $$ -> all matches as an Array (not a NodeList)
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Core game constants (Wordle classic).
const WORD_LEN = 5;
const MAX_ATTEMPTS = 6;

// A ranking system for tile/key states.
// We use it to avoid "downgrading" a keyboard key color
// (e.g. if you later guess a letter and it's absent, but it was already present/correct).
const STATE_RANK = { empty: 0, absent: 1, present: 2, correct: 3 };

// Emoji mapping used to build the share grid.
// Note: "empty" is intentionally not mapped; it falls back to ⬛ in computeShareText().
const EMOJI = { absent: "⬛", present: "🟨", correct: "🟩" };

// Storage wrapper that fails gracefully when localStorage is unavailable
// (private browsing restrictions, storage disabled, quota errors, etc.).
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// Left-pad a number to 2 digits.
// Used for countdown formatting (HH:MM:SS).
function pad2(n) {
  return String(n).padStart(2, "0");
}

// Convert milliseconds (ms) into a countdown string "HH:MM:SS".
// Values are clamped at 0 to avoid negative displays.
function formatHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

// Return the timestamp (ms) of the next UTC midnight from `now`.
// Puzzles roll over at 00:00 UTC, not local time.
function nextUtcMidnightMs(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return Date.UTC(y, m, d + 1, 0, 0, 0);
}

// Write a short message to the toast area.
// If msg is falsy, it clears the toast.
function toast(msg) {
  const el = $("#wordle-toast");
  if (el) el.textContent = msg || "";
}

// Show/hide the share panel.
// This is a simple toggle via the `hidden` attribute.
function setShareOpen(open) {
  const panel = $("#wordle-sharePanel");
  if (panel) panel.hidden = !open;
}

// Read puzzle metadata from the DOM.
// Expected markup: an element with class "game--wordle" containing dataset.dayKey and dataset.idx.
function readGameDataset() {
  const root = $(".game--wordle");

  // Stamp the DOM with the running client version for debugging.
  if (root) root.dataset.clientVersion = CLIENT_VERSION;

  return {
    root,
    dayKey: root?.dataset.dayKey || "",
    idx: Number(root?.dataset.idx || 0),
  };
}

// Produce a unique puzzle identifier from (dayKey, idx).
// Example: "wordle:2026-01-06:1"
function puzzleId(dayKey, idx) {
  return `wordle:${dayKey}:${idx}`;
}

// localStorage key used for per-puzzle game state.
function stateStorageKey(puzId) {
  return `aptati:wordle:state:${puzId}`;
}

// localStorage key used for cross-puzzle stats (currently: streak + last win day).
function statsStorageKey() {
  return `aptati:wordle:stats`;
}

// JSON parsing that will never throw.
// If parsing fails, return `fallback`.
function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Load saved state for a puzzle (or null if none).
function loadState(puzId) {
  return safeJsonParse(storage.get(stateStorageKey(puzId)), null);
}

// Save state for a puzzle.
function saveState(puzId, st) {
  storage.set(stateStorageKey(puzId), JSON.stringify(st));
}

// Remove saved state for a puzzle.
function clearState(puzId) {
  storage.remove(stateStorageKey(puzId));
}

// Load persistent stats.
// These stats are intentionally small and stable across versions.
function loadStats() {
  return safeJsonParse(storage.get(statsStorageKey()), {
    streak: 0,
    lastWinDayKey: null,
  });
}

// Save persistent stats.
function saveStats(stats) {
  storage.set(statsStorageKey(), JSON.stringify(stats));
}

// Upgrade a tile/key state if the new state has a higher rank.
// This prevents a "correct" key from ever being downgraded back to "present/absent".
function rankUpgrade(oldState, newState) {
  const o = STATE_RANK[oldState] ?? 0;
  const n = STATE_RANK[newState] ?? 0;
  return n > o ? newState : oldState;
}

// Get the DOM element for a given board row.
// Rows are expected to use: .wordle__row[data-row="0..5"]
function rowEl(row) {
  return $(`#wordle-board .wordle__row[data-row="${row}"]`);
}

// Get a specific tile element by row/col.
// Tiles are expected to use: .wordle__tile[data-col="0..4"]
function tileAt(row, col) {
  const r = rowEl(row);
  if (!r) return null;
  return r.querySelector(`.wordle__tile[data-col="${col}"]`);
}

// Update a tile's displayed letter + its state.
// state is written into data-state, which CSS can style.
function setTile(row, col, letter, state) {
  const el = tileAt(row, col);
  if (!el) return;
  el.textContent = letter || "";
  el.dataset.state = state || "empty";
}

// Find the on-screen keyboard button for a given letter.
// Buttons expected: .kb__key[data-key="A".."Z" or Enter/Backspace]
function keyButton(letter) {
  return $(`#wordle-keyboard .kb__key[data-key="${letter}"]`);
}

// Set a keyboard key state, using rankUpgrade to avoid downgrades.
function setKeyState(letter, state) {
  const btn = keyButton(letter);
  if (!btn) return;
  const old = btn.dataset.state || "empty";
  btn.dataset.state = rankUpgrade(old, state);
}

// Normalize a "state-ish" value into one of: "empty" | "absent" | "present" | "correct".
// This exists because historical saves/server responses might vary:
// - "hit", "right", "green" -> correct
// - "wrongpos", "yellow" -> present
// - "grey", "none" -> absent
// Anything unknown defaults to "absent" (safe + predictable for rendering).
function normalizeState(s) {
  const v = String(s ?? "").toLowerCase().trim();
  if (!v || v === "empty") return "empty";
  if (["correct", "hit", "right", "green", "match", "exact", "c"].includes(v)) return "correct";
  if (["present", "misplaced", "wrongpos", "wrong_position", "wrong-position", "near", "yellow", "p"].includes(v))
    return "present";
  if (["absent", "miss", "none", "no", "gray", "grey", "a"].includes(v)) return "absent";
  return "absent";
}

// Normalize a "result array" into a strict string[5] array of normalized states.
//
// Accepts weird legacy formats:
// - Array of strings: ["correct","present","absent",...]
// - Array of numbers: [2,1,0,...] (numbers are stringified and fall through normalizeState mapping)
// - Comma-separated string: "correct,present,absent,absent,absent"
// - Compact string: "cpaaa"
function normalizeResultArray(arr) {
  // If already an array: normalize each element positionally and enforce length=WORD_LEN.
  if (Array.isArray(arr)) {
    return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(arr[i]));
  }

  // If it's a string, try to interpret it.
  if (typeof arr === "string") {
    const s = arr.trim().toLowerCase();

    // CSV style: "correct,present,absent,absent,absent"
    if (s.includes(",")) {
      const parts = s.split(",").map((x) => x.trim());
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(parts[i]));
    }

    // Compact style: "cpaaa" (or longer)
    if (s.length >= WORD_LEN) {
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(s[i]));
    }
  }

  // If nothing matched, fail closed to a 5-wide array of "absent".
  // (This keeps rendering stable even if stored data is corrupted.)
  return Array.from({ length: WORD_LEN }, () => "absent");
}

// Migrate old state shapes into the canonical format:
// {
//   guesses: string[],
//   results: string[][],
//   current: string,
//   status: "playing" | "won" | "lost",
//   ...
// }
//
// Why this exists:
// Historical versions may have stored guesses as objects,
// stored results in different shapes, or mixed guesses+results together.
function migrateStateShape(st) {
  // Clone to avoid mutating the passed object reference in surprising ways.
  const next = { ...st };

  // Grab raw guesses/results if they exist; otherwise treat them as empty.
  const guessesRaw = Array.isArray(next.guesses) ? next.guesses : [];
  const resultsRaw = Array.isArray(next.results) ? next.results : [];

  const guesses = [];
  const results = [];

  // Normalize guesses list:
  // - If guess is a string, accept it if exactly WORD_LEN.
  // - If guess is an object, read guess.word/guess.guess and optionally guess.result.
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

        // If the object carries a result, migrate it too.
        if (g.result != null) results.push(normalizeResultArray(g.result));
      }
    }
  }

  // If we didn't obtain any results via guess objects,
  // try migrating from a top-level results array.
  if (results.length === 0 && resultsRaw.length > 0) {
    for (const r of resultsRaw) results.push(normalizeResultArray(r));
  }

  // Ensure results length matches guesses length:
  // - Pad missing results with "absent" rows
  // - Trim extras
  while (results.length < guesses.length) results.push(Array.from({ length: WORD_LEN }, () => "absent"));
  if (results.length > guesses.length) results.length = guesses.length;

  // Persist canonical fields back onto next.
  next.guesses = guesses;
  next.results = results;

  // Normalize current input buffer.
  next.current = typeof next.current === "string" ? next.current : "";
  next.current = next.current.trim().toLowerCase().slice(0, WORD_LEN);

  // Normalize status.
  if (!["playing", "won", "lost"].includes(next.status)) next.status = "playing";

  return next;
}

// Build the share text in a Wordle-like format.
// Example header: "Game 1 (aptati) 2026-01-06 #1 4/6"
// Then a grid of emoji blocks.
function computeShareText({ dayKey, idx, attemptsUsed, gridStates }) {
  const score = attemptsUsed != null ? `${attemptsUsed}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  const header = `Game 1 (aptati) ${dayKey} #${idx} ${score}`;

  // Convert each row of states into emoji blocks.
  const lines = gridStates.map((row) => row.map((s) => EMOJI[s] || "⬛").join(""));

  return `${header}\n\n${lines.join("\n")}`;
}

// Share URL should be the stable puzzle URL (no query strings).
// We use origin + pathname (drops hash/search by design).
function getShareUrl() {
  return window.location.origin + window.location.pathname;
}

// Copy text to clipboard using the modern Clipboard API, with a fallback.
// Fallback uses a temporary textarea + document.execCommand("copy").
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

// Call the server to validate a guess and return result.
// API contract expected:
// {
//   ok: boolean,
//   valid: boolean,
//   reason?: string,
//   result?: any,
//   isSolved?: boolean
// }
async function apiGuess({ dayKey, idx, guess }) {
  const res = await fetch("/api/games/game1/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dayKey, idx, guess }),
  });
  return res.json();
}

// Initialize the "time until next puzzle" countdown.
// Updates every second, counting down to next UTC midnight.
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

// Render attempts indicator in the UI.
// If playing, show "current attempt" as used+1 (capped).
// If finished, show attempts used.
function renderAttempts(st) {
  const el = $("#wordle-attempts");
  if (!el) return;

  const used = st.guesses.length;
  const show = st.status === "playing" ? Math.min(used + 1, MAX_ATTEMPTS) : used;
  el.textContent = `${show}/${MAX_ATTEMPTS}`;
}

// Render streak indicator.
function renderStreak(stats) {
  const el = $("#wordle-streak");
  if (!el) return;
  el.textContent = `Streak: ${Number(stats?.streak || 0)}`;
}

// Render the full board + keyboard from state.
// This is the canonical "paint" function.
//
// IMPORTANT FIX:
// We normalize st.results[r] at render time via normalizeResultArray(st.results?.[r]).
// That means even if old saves store row results in weird formats,
// row 2+ does not "lose colours" when we re-render.
function renderBoard(st) {
  // 1) Clear tiles (reset the board completely).
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    for (let c = 0; c < WORD_LEN; c++) setTile(r, c, "", "empty");
  }

  // 2) Clear keyboard states (reset all keys to empty).
  $$("#wordle-keyboard .kb__key[data-key]").forEach((btn) => {
    btn.dataset.state = "empty";
  });

  // 3) Paint completed guess rows.
  for (let r = 0; r < st.guesses.length; r++) {
    const guess = st.guesses[r] || "";

    // ✅ Always normalize whatever is stored for this row (critical for legacy saves).
    const rowStates = normalizeResultArray(st.results?.[r]);

    for (let c = 0; c < WORD_LEN; c++) {
      // Display letters in uppercase for UI.
      const ch = (guess[c] || "").toUpperCase();

      // Default to absent if a state is missing (should be rare after migration).
      const state = rowStates[c] || "absent";

      // Update tile and keyboard.
      setTile(r, c, ch, state);
      if (ch) setKeyState(ch, state);
    }
  }

  // 4) Paint the current typing row (only while playing).
  if (st.status === "playing") {
    const r = st.guesses.length;
    for (let c = 0; c < WORD_LEN; c++) {
      const ch = st.current[c] ? st.current[c].toUpperCase() : "";
      setTile(r, c, ch, "empty");
    }
  }

  // 5) Render attempts counter.
  renderAttempts(st);
}

// Open the share panel and populate its text area.
// We build a 6-row grid regardless of how many rows were played.
function openSharePanel(st, { dayKey, idx }) {
  const pre = $("#wordle-shareText");
  if (!pre) return;

  // Build a full grid of MAX_ATTEMPTS rows.
  // - For existing result rows, normalize them (again).
  // - For missing rows, fill with "absent" blocks for a consistent 6-line output.
  const gridStates = [];
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    if (st.results?.[r]) gridStates.push(normalizeResultArray(st.results[r]));
    else gridStates.push(Array.from({ length: WORD_LEN }, () => "absent"));
  }

  // If won, attemptsUsed is guesses.length; if not, share "X/6".
  const attemptsUsed = st.status === "won" ? st.guesses.length : null;

  // Write share text and show the panel.
  pre.textContent = computeShareText({ dayKey, idx, attemptsUsed, gridStates });
  setShareOpen(true);
}

// Normalize a KeyboardEvent's key into our internal representation.
// Returns:
// - "Enter" or "Backspace"
// - "A".."Z" for letters
// - null for anything else (arrows, modifiers, etc.)
function normalizeKeyFromEvent(e) {
  const k = e.key;
  if (k === "Enter") return "Enter";
  if (k === "Backspace") return "Backspace";
  if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
  return null;
}

// Main entry point.
// Wires up UI, loads state, renders, and binds event handlers.
function initWordle() {
  // Start the countdown timer immediately (safe if countdown element doesn't exist).
  initCountdown();

  // Read puzzle identity from DOM.
  const { root, dayKey, idx } = readGameDataset();
  if (!root) return;

  // Validate dayKey format (YYYY-MM-DD).
  // If missing/invalid, we refuse to proceed because state keys depend on it.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    toast("Missing dayKey.");
    return;
  }

  // Create this puzzle's unique id and default state.
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

  // Load saved state; only accept it if it matches the current puzzle id.
  const saved = loadState(puzId);
  let st = saved && saved.puzzleId === puzId ? saved : defaultState;

  // Migrate legacy formats and immediately persist the canonical form
  // so future renders don't have to fight weird shapes.
  st = migrateStateShape(st);
  saveState(puzId, st);

  // Submission lock to prevent double-Enter / double-click spamming.
  let isSubmitting = false;

  // Load stats and render everything.
  const stats = loadStats();
  renderStreak(stats);
  renderBoard(st);

  // Handle letter input (from on-screen or physical keyboard).
  const onLetter = (L) => {
    if (st.status !== "playing") return;
    if (st.current.length >= WORD_LEN) return;

    // Store as lowercase internally for consistency.
    st.current += L.toLowerCase();

    renderBoard(st);
    saveState(puzId, st);
  };

  // Handle backspace: remove last typed character.
  const onBackspace = () => {
    if (st.status !== "playing") return;
    if (!st.current.length) return;

    st.current = st.current.slice(0, -1);

    renderBoard(st);
    saveState(puzId, st);
  };

  // Handle submit (Enter): validate length, call API, update state, check win/loss.
  const onEnter = async () => {
    // Guardrails: don't submit while a request is in-flight or after game end.
    if (isSubmitting) return;
    if (st.status !== "playing") return;

    // Normalize typed word.
    const g = st.current.trim().toLowerCase();

    // Enforce exact length.
    if (g.length !== WORD_LEN) {
      toast("Need 5 letters.");
      return;
    }

    isSubmitting = true;
    toast("Checking…");

    try {
      // Ask server to validate guess and compute result.
      const data = await apiGuess({ dayKey, idx, guess: g });

      // Basic server sanity check.
      if (!data?.ok) {
        toast("Server error.");
        return;
      }

      // If guess is invalid, show reason and do not consume an attempt.
      if (!data.valid) {
        const why =
          data.reason === "not_in_word_list"
            ? "Not in word list."
            : data.reason === "bad_format"
              ? "Invalid guess."
              : "Not allowed.";
        toast(why);
        return;
      }

      // Normalize result into stable array of 5 states.
      const result = normalizeResultArray(data.result);
      const row = st.guesses.length;

      // Commit guess + result.
      st.guesses.push(g);
      st.results[row] = result;

      // Clear typing buffer for next row.
      st.current = "";

      // Re-render & persist progress.
      renderBoard(st);
      saveState(puzId, st);

      // WIN condition: server says solved.
      if (data.isSolved) {
        st.status = "won";

        // Update streak only once per dayKey to avoid farming resets/refreshes.
        const s = loadStats();
        if (s.lastWinDayKey !== dayKey) {
          s.streak = Number(s.streak || 0) + 1;
          s.lastWinDayKey = dayKey;
          saveStats(s);
          renderStreak(s);
        }

        toast("Solved!");
        saveState(puzId, st);

        // Open share panel immediately on win.
        openSharePanel(st, { dayKey, idx });
        return;
      }

      // LOSS condition: out of attempts.
      if (st.guesses.length >= MAX_ATTEMPTS) {
        st.status = "lost";

        // Reset streak on loss.
        const s = loadStats();
        s.streak = 0;
        saveStats(s);
        renderStreak(s);

        toast("Unlucky. New puzzle at 00:00 UTC.");
        saveState(puzId, st);

        // Open share panel on loss too (common Wordle behavior).
        openSharePanel(st, { dayKey, idx });
        return;
      }

      // Otherwise continue playing; clear toast.
      toast("");
    } catch {
      // Network or unexpected error.
      toast("Network error.");
    } finally {
      // Always release the submission lock.
      isSubmitting = false;
    }
  };

  // -------------------------
  // UI EVENT WIRING
  // -------------------------

  // On-screen keyboard (click/tap).
  $("#wordle-keyboard")?.addEventListener("click", (e) => {
    // Find the closest key button in case an inner element was clicked.
    const btn = e.target?.closest("button[data-key]");
    if (!btn) return;

    const k = btn.getAttribute("data-key");

    // Route to appropriate handler.
    if (k === "Enter") onEnter();
    else if (k === "Backspace") onBackspace();
    else if (/^[A-Z]$/.test(k)) onLetter(k);
  });

  // Physical keyboard input.
  window.addEventListener("keydown", (e) => {
    // When share panel is open, ignore keyboard (prevents typing while reading/copying).
    if (!$("#wordle-sharePanel")?.hidden) return;

    const k = normalizeKeyFromEvent(e);
    if (!k) return;

    if (k === "Enter") {
      // Ignore key repeat for Enter to avoid accidental multi-submits.
      if (e.repeat) return;
      e.preventDefault();
      onEnter();
      return;
    }

    if (k === "Backspace") {
      // Prevent browser navigation/back if focus is not in an input.
      e.preventDefault();
      onBackspace();
      return;
    }

    // Letters.
    if (/^[A-Z]$/.test(k)) onLetter(k);
  });

  // -------------------------
  // SHARE UI
  // -------------------------

  // Open share panel manually.
  $("#wordle-shareBtn")?.addEventListener("click", () => openSharePanel(st, { dayKey, idx }));

  // Close share panel.
  $("#wordle-closeShareBtn")?.addEventListener("click", () => setShareOpen(false));

  // Copy the share text (emoji grid + header).
  $("#wordle-copyBtn")?.addEventListener("click", async () => {
    const text = $("#wordle-shareText")?.textContent || "";
    const ok = await copyToClipboard(text);
    toast(ok ? "Copied result ✅" : "Copy failed.");
  });

  // Copy the URL for the current puzzle page.
  $("#wordle-copyLinkBtn")?.addEventListener("click", async () => {
    const url = getShareUrl();
    const ok = await copyToClipboard(url);
    toast(ok ? "Copied link 🔗" : "Copy failed.");
  });

  // Use the Web Share API when available (mostly mobile browsers).
  // Shares title + text + url.
  $("#wordle-nativeShareBtn")?.addEventListener("click", async () => {
    const url = getShareUrl();
    const text = $("#wordle-shareText")?.textContent || "";

    if (navigator.share) {
      try {
        await navigator.share({ title: "Game 1 (aptati)", text, url });
        toast("Shared ✅");
      } catch {
        // Share dialogs can be cancelled; we intentionally do nothing.
      }
    } else {
      toast("No native share on this browser.");
    }
  });

  // Facebook sharing behavior:
  // 1) Copy the result text first (so the user can paste it into the Facebook post)
  // 2) Open Facebook share dialog in a new window/tab
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

    // Open popup-ish window. "noopener,noreferrer" for safety.
    window.open(fb, "_blank", "noopener,noreferrer,width=640,height=480");
  });

  // -------------------------
  // RESET (LOCAL ONLY)
  // -------------------------

  // Reset clears localStorage state for this puzzle and restores default.
  $("#wordle-resetBtn")?.addEventListener("click", () => {
    clearState(puzId);

    // Re-create and migrate default state (migration keeps the shape consistent).
    st = migrateStateShape({ ...defaultState });

    renderBoard(st);
    saveState(puzId, st);
    toast("Reset locally.");
  });
}

// Start once the DOM is ready (tiles/keyboard/share panel must exist).
document.addEventListener("DOMContentLoaded", initWordle);
