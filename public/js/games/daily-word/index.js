// public/js/games/daily-word/index.js (ESM)
//
// Daily Word client + Previous Answers overlay dropdown (animated).
// Row-score toast (10 separate toasts):
// - correct tile = 2
// - present tile = 1
// - absent tile = 0
// Total range 0..10 -> tier 1..10 (0 clamps to 1)
// Shows the matching tier toast element for 2.5s, sliding in from the left over the row.
//
// Share-link behavior (NO BACKEND CHANGES):
// - Shared link uses ?fresh=1 so the grid loads empty (even for the sharer)
// - In fresh mode we DO NOT read/write the normal localStorage keys
//   (so clicking your own shared link won’t overwrite your real progress).
// - Optional hash carries score and is displayed as a small banner:
//   #shared=1&day=YYYY-MM-DD&idx=0&score=3-6

const CLIENT_VERSION = "2026-01-09.v2-fresh-link-score-hash";

// Keep old global for compatibility (if anything checks it), but also expose a new one.
window.__WORDLE_CLIENT_VERSION__ = CLIENT_VERSION;
window.__DAILY_WORD_CLIENT_VERSION__ = CLIENT_VERSION;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const WORD_LEN = 5;
const MAX_ATTEMPTS = 6;

const STATE_RANK = { empty: 0, absent: 0, present: 1, correct: 2 };
const EMOJI = { absent: "⬛", present: "🟨", correct: "🟩" };

const ROW_TOAST_MS = 2500;

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

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

function readUrlFlags() {
  let fresh = false;
  let shared = false;
  let sharedDay = "";
  let sharedIdx = "";
  let sharedScore = "";

  try {
    const u = new URL(window.location.href);
    fresh = u.searchParams.get("fresh") === "1";

    const h = (u.hash || "").replace(/^#/, "");
    if (h) {
      const hp = new URLSearchParams(h);
      shared = hp.get("shared") === "1";
      sharedDay = String(hp.get("day") || "").trim();
      sharedIdx = String(hp.get("idx") || "").trim();
      sharedScore = String(hp.get("score") || "").trim(); // e.g. "3-6"
    }
  } catch {}

  return { fresh, shared, sharedDay, sharedIdx, sharedScore };
}

function coerceScoreForBanner(sharedScore) {
  // Accept "3-6" or "3/6" or "X-6"
  const s = String(sharedScore || "").trim();
  if (!s) return "";
  if (s.includes("/")) return s;
  if (s.includes("-")) return s.replace("-", "/");
  return s;
}

function ensureSharedBanner({ gameTitle, sharedDay, sharedIdx, sharedScore }) {
  const root = $(".wordle-game-wrap");
  if (!root) return;

  const scoreText = coerceScoreForBanner(sharedScore);
  if (!scoreText && !sharedDay && !sharedIdx) return;

  // Don't duplicate
  if (root.querySelector(".shared-score-banner")) return;

  const banner = document.createElement("div");
  banner.className = "shared-score-banner";
  banner.setAttribute("role", "status");

  // Minimal inline style so we don't require CSS work right now
  banner.style.margin = "0 0 0.75rem 0";
  banner.style.padding = "0.6rem 0.75rem";
  banner.style.borderRadius = "0.75rem";
  banner.style.border = "1px solid rgba(255,255,255,0.12)";
  banner.style.background = "rgba(0,0,0,0.25)";
  banner.style.backdropFilter = "blur(6px)";
  banner.style.fontSize = "0.95rem";

  const bits = [];
  bits.push("Shared result");
  if (gameTitle) bits.push(`for ${gameTitle}`);
  if (sharedDay) bits.push(sharedDay);
  if (sharedIdx !== "") bits.push(`#${sharedIdx}`);
  if (scoreText) bits.push(scoreText);

  banner.textContent = bits.join(" · ");
  root.prepend(banner);
}

function readGameDataset() {
  const root = $(".wordle-game"); // keep class name for now so existing markup still works
  if (root) root.dataset.clientVersion = CLIENT_VERSION;

  // Support old markup:
  // - data-game-key (existing)
  // Support new markup (optional):
  // - data-game-slug, data-game-title, data-api-base
  const gameSlug =
    String(root?.dataset.gameSlug || root?.dataset.gameKey || "daily-word").trim() || "daily-word";

  const gameTitle =
    String(root?.dataset.gameTitle || "Daily Word").trim() || "Daily Word";

  const apiBase =
    String(root?.dataset.apiBase || `/api/games/${gameSlug}`).trim() || `/api/games/${gameSlug}`;

  return {
    root,
    dayKey: root?.dataset.dayKey || "",
    idx: Number(root?.dataset.idx || 0),
    gameSlug,
    gameTitle,
    apiBase,
    prevAnswersEndpoint: root?.dataset.prevAnswersEndpoint || `${apiBase}/answers`,
  };
}

function puzzleId(gameSlug, dayKey, idx) {
  return `${gameSlug}:${dayKey}:${idx}`;
}

function stateStorageKey(storageSlug, puzId) {
  return `aptati:${storageSlug}:state:${puzId}`;
}

function statsStorageKey(storageSlug) {
  return `aptati:${storageSlug}:stats`;
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadState(storageSlug, gameSlug, dayKey, idx) {
  const puzId = puzzleId(gameSlug, dayKey, idx);

  // New key
  const raw = storage.get(stateStorageKey(storageSlug, puzId));
  const current = safeJsonParse(raw, null);
  if (current) return current;

  // Legacy migration only for NON-fresh mode
  if (storageSlug !== gameSlug) return null;

  // old puzzleId: wordle:YYYY-MM-DD:idx
  // old key: aptati:wordle:state:${legacyPuzId}
  const legacyPuzId = `wordle:${dayKey}:${idx}`;
  const legacyRaw = storage.get(`aptati:wordle:state:${legacyPuzId}`);
  const legacy = safeJsonParse(legacyRaw, null);

  if (legacy) {
    storage.set(stateStorageKey(storageSlug, puzId), JSON.stringify(legacy));
    return legacy;
  }

  return null;
}

function saveState(storageSlug, gameSlug, dayKey, idx, st) {
  const puzId = puzzleId(gameSlug, dayKey, idx);
  storage.set(stateStorageKey(storageSlug, puzId), JSON.stringify(st));
}

function clearState(storageSlug, gameSlug, dayKey, idx) {
  const puzId = puzzleId(gameSlug, dayKey, idx);
  storage.remove(stateStorageKey(storageSlug, puzId));
}

function loadStats(storageSlug, gameSlug) {
  const cur = safeJsonParse(storage.get(statsStorageKey(storageSlug)), null);
  if (cur) return cur;

  // Legacy migration only for NON-fresh mode
  if (storageSlug === gameSlug) {
    const legacy = safeJsonParse(storage.get("aptati:wordle:stats"), null);
    if (legacy) {
      storage.set(statsStorageKey(storageSlug), JSON.stringify(legacy));
      return legacy;
    }
  }

  return {
    streak: 0,
    lastWinDayKey: null,
  };
}

function saveStats(storageSlug, stats) {
  storage.set(statsStorageKey(storageSlug), JSON.stringify(stats));
}

function rankUpgrade(oldState, newState) {
  const o = STATE_RANK[oldState] ?? 0;
  const n = STATE_RANK[newState] ?? 0;
  return n > o ? newState : oldState;
}

function rowEl(row) {
  return $(`#wordle-board .wordle-row[data-row="${row}"]`);
}

function tileAt(row, col) {
  const r = rowEl(row);
  if (!r) return null;
  return r.querySelector(`.wordle-tile[data-col="${col}"]`);
}

function setTile(row, col, letter, state) {
  const el = tileAt(row, col);
  if (!el) return;
  el.textContent = letter || "";
  el.dataset.state = state || "empty";
}

function keyButton(letter) {
  return $(`#wordle-keyboard .kb-key[data-key="${letter}"]`);
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
  if (["present", "misplaced", "wrongpos", "wrong_position", "wrong-position", "near", "yellow", "p"].includes(v))
    return "present";
  if (["absent", "miss", "none", "no", "gray", "grey", "a"].includes(v)) return "absent";
  return "absent";
}

function normalizeResultArray(arr) {
  if (Array.isArray(arr)) {
    return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(arr[i]));
  }

  if (typeof arr === "string") {
    const s = arr.trim().toLowerCase();

    if (s.includes(",")) {
      const parts = s.split(",").map((x) => x.trim());
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(parts[i]));
    }

    if (s.length >= WORD_LEN) {
      return Array.from({ length: WORD_LEN }, (_, i) => normalizeState(s[i]));
    }
  }

  return Array.from({ length: WORD_LEN }, () => "absent");
}

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

function computeShareText({ gameTitle, dayKey, idx, attemptsUsed, gridStates }) {
  const score = attemptsUsed != null ? `${attemptsUsed}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
  const header = `${gameTitle} (Aptati Arcade) ${dayKey} #${idx} ${score}`;
  const lines = gridStates.map((row) => row.map((s) => EMOJI[s] || "⬛").join(""));
  return `${header}\n\n${lines.join("\n")}`;
}

function getShareUrl({ fresh = false, dayKey = "", idx = 0, scoreText = "" } = {}) {
  // Always share a clean canonical URL with optional ?fresh=1 and hash.
  const u = new URL(window.location.origin + window.location.pathname);

  if (fresh) u.searchParams.set("fresh", "1");

  if (scoreText || dayKey) {
    const hp = new URLSearchParams();
    hp.set("shared", "1");
    if (dayKey) hp.set("day", String(dayKey));
    hp.set("idx", String(idx));
    if (scoreText) hp.set("score", String(scoreText).replace("/", "-"));
    u.hash = hp.toString();
  }

  return u.toString();
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

async function apiGuess({ apiBase, dayKey, idx, guess }) {
  const res = await fetch(`${apiBase}/guess`, {
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
  const used = Math.min(st.guesses.length, MAX_ATTEMPTS);
  el.textContent = `${used}/${MAX_ATTEMPTS}`;
}

function renderStreak(stats) {
  const el = $("#wordle-streak");
  if (!el) return;
  el.textContent = `Streak: ${Number(stats?.streak || 0)}`;
}

function renderBoard(st) {
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    for (let c = 0; c < WORD_LEN; c++) setTile(r, c, "", "empty");
  }

  $$("#wordle-keyboard .kb-key[data-key]").forEach((btn) => {
    btn.dataset.state = "empty";
  });

  for (let r = 0; r < st.guesses.length; r++) {
    const guess = st.guesses[r] || "";
    const rowStates = normalizeResultArray(st.results?.[r]);

    for (let c = 0; c < WORD_LEN; c++) {
      const ch = (guess[c] || "").toUpperCase();
      const state = rowStates[c] || "absent";
      setTile(r, c, ch, state);
      if (ch) setKeyState(ch, state);
    }
  }

  if (st.status === "playing") {
    const r = st.guesses.length;
    for (let c = 0; c < WORD_LEN; c++) {
      const ch = st.current[c] ? st.current[c].toUpperCase() : "";
      setTile(r, c, ch, "empty");
    }
  }

  renderAttempts(st);
}

function openSharePanel(st, { gameTitle, dayKey, idx }) {
  const pre = $("#wordle-shareText");
  if (!pre) return;

  const gridStates = [];
  for (let r = 0; r < MAX_ATTEMPTS; r++) {
    if (st.results?.[r]) gridStates.push(normalizeResultArray(st.results[r]));
    else gridStates.push(Array.from({ length: WORD_LEN }, () => "absent"));
  }

  const attemptsUsed = st.status === "won" ? st.guesses.length : null;

  pre.textContent = computeShareText({ gameTitle, dayKey, idx, attemptsUsed, gridStates });
  setShareOpen(true);
}

function normalizeKeyFromEvent(e) {
  const k = e.key;
  if (k === "Enter") return "Enter";
  if (k === "Backspace") return "Backspace";
  if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
  return null;
}

// ---------------- Row score toasts (10 separate elements) ----------------

let rowToastTimer = null;

function scoreRowFromStates(states) {
  // correct=2, present=1, absent=0
  let total = 0;
  for (const s of states || []) {
    if (s === "correct") total += 2;
    else if (s === "present") total += 1;
    else total += 0;
  }
  return total; // 0..10
}

function toastTierFromScore(score) {
  // only 1..10 exist; clamp 0 -> 1
  const n = Number(score) || 0;
  return Math.max(1, Math.min(10, n));
}

function rowToastHost() {
  return $("#wordle-rowToastHost");
}

function allRowToasts() {
  const host = rowToastHost();
  if (!host) return [];
  return $$(".wordle-row-toast", host);
}

function toastElForTier(tier) {
  const host = rowToastHost();
  if (!host) return null;
  return host.querySelector(`.wordle-row-toast[data-tier="${tier}"]`);
}

function hideAllRowToasts() {
  for (const el of allRowToasts()) el.classList.remove("is-show");
}

function positionRowToastHostOverRow(row) {
  const host = rowToastHost();
  const board = $("#wordle-board");
  const rEl = rowEl(row);
  if (!host || !board) return;

  let topPx = 0;

  try {
    if (rEl) {
      const boardRect = board.getBoundingClientRect();
      const rowRect = rEl.getBoundingClientRect();
      const centerY = rowRect.top - boardRect.top + rowRect.height / 2;
      if (Number.isFinite(centerY)) topPx = Math.max(0, centerY);
    }
  } catch {}

  host.style.top = `${topPx}px`;
}

function showRowToast({ row, tier }) {
  const el = toastElForTier(tier);
  if (!el) return;

  if (rowToastTimer) {
    clearTimeout(rowToastTimer);
    rowToastTimer = null;
  }

  positionRowToastHostOverRow(row);

  hideAllRowToasts();

  // restart animation reliably
  el.classList.remove("is-show");
  void el.offsetWidth;
  el.classList.add("is-show");

  rowToastTimer = setTimeout(() => {
    el.classList.remove("is-show");
  }, ROW_TOAST_MS);
}

// ---------------- Previous answers (overlay + transitions) ----------------

function parseDayKeyUtc(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d, 0, 0, 0));
}

const prevDateFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatPrevDateUtc(dateObj) {
  return prevDateFmt.format(dateObj).replace(",", "");
}

function buildPreviousDayKeys(todayDayKey, count = 10) {
  const base = parseDayKeyUtc(todayDayKey);
  if (!base) return [];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function setPrevStatus(msg) {
  const el = $(".previous-answers-status");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function setPrevAnswersOpen(open) {
  const btn = $(".previous-answer-btn");
  const panel = $("#previous-answers");
  if (!btn || !panel) return;

  panel.classList.toggle("is-open", !!open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isPrevAnswersOpen() {
  const panel = $("#previous-answers");
  return !!panel && panel.classList.contains("is-open");
}

const prevAnswersCache = new Map();

function cacheKey(todayDayKey, idx) {
  return `${todayDayKey}::${idx}`;
}

async function apiPreviousAnswers({ endpoint, idx, dayKeys }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idx, dayKeys }),
  });
  return res.json();
}

function coerceAnswersMap(data) {
  const map = new Map();

  if (!data || data.ok !== true) return map;

  if (data.answers && typeof data.answers === "object") {
    for (const [k, v] of Object.entries(data.answers)) {
      const ans = String(v || "").trim();
      if (ans) map.set(k, ans.toUpperCase());
    }
    return map;
  }

  if (Array.isArray(data.items)) {
    for (const it of data.items) {
      const k = String(it?.dayKey || "").trim();
      const ans = String(it?.answer || "").trim();
      if (k && ans) map.set(k, ans.toUpperCase());
    }
    return map;
  }

  return map;
}

function renderPreviousAnswersList(todayDayKey, idx, answersMap) {
  const list = $(".previous-answers-list");
  if (!list) return;

  list.innerHTML = "";

  const base = parseDayKeyUtc(todayDayKey);
  if (!base) {
    const li = document.createElement("li");
    li.textContent = "Missing dayKey.";
    list.appendChild(li);
    return;
  }

  for (let i = 1; i <= 10; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    const dayKeyPrev = d.toISOString().slice(0, 10);

    const label = formatPrevDateUtc(d);
    const ans = answersMap.get(dayKeyPrev) || "—";

    const li = document.createElement("li");

    const left = document.createElement("span");
    left.className = "prev-date";
    left.textContent = label;

    const right = document.createElement("span");
    right.className = "prev-answer";
    right.textContent = ans;

    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  }
}

function initPreviousAnswersUi({ dayKey, idx, endpoint }) {
  const btn = $(".previous-answer-btn");
  const panel = $("#previous-answers");
  if (!btn || !panel) return;

  setPrevAnswersOpen(false);
  setPrevStatus("");

  btn.addEventListener("click", async () => {
    const open = !isPrevAnswersOpen();

    if (!open) {
      setPrevAnswersOpen(false);
      setPrevStatus("");
      return;
    }

    setPrevAnswersOpen(true);

    const k = cacheKey(dayKey, idx);
    const cached = prevAnswersCache.get(k);
    if (cached) {
      setPrevStatus("");
      renderPreviousAnswersList(dayKey, idx, cached);
      return;
    }

    const wanted = buildPreviousDayKeys(dayKey, 10);
    setPrevStatus("Loading answers…");

    try {
      const data = await apiPreviousAnswers({ endpoint, idx, dayKeys: wanted });
      const map = coerceAnswersMap(data);

      if (map.size === 0) setPrevStatus("No answers returned.");
      else setPrevStatus("");

      prevAnswersCache.set(k, map);
      renderPreviousAnswersList(dayKey, idx, map);
    } catch {
      setPrevStatus("Could not load answers.");
      prevAnswersCache.set(k, new Map());
      renderPreviousAnswersList(dayKey, idx, new Map());
    }
  });

  document.addEventListener("click", (e) => {
    if (!isPrevAnswersOpen()) return;

    const t = e.target;
    if (btn.contains(t)) return;
    if (panel.contains(t)) return;

    setPrevAnswersOpen(false);
    setPrevStatus("");
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!isPrevAnswersOpen()) return;
    setPrevAnswersOpen(false);
    setPrevStatus("");
  });

  renderPreviousAnswersList(dayKey, idx, new Map());
}

// -------------------------------------------------------------------------

function attemptsScoreText(st) {
  if (!st) return "";
  if (st.status === "won") return `${st.guesses.length}/${MAX_ATTEMPTS}`;
  if (st.status === "lost") return `X/${MAX_ATTEMPTS}`;
  return "";
}

function initDailyWord() {
  initCountdown();

  const { fresh, shared, sharedDay, sharedIdx, sharedScore } = readUrlFlags();

  const { root, dayKey, idx, gameSlug, gameTitle, apiBase, prevAnswersEndpoint } = readGameDataset();
  if (!root) return;

  // If this page was opened from a shared link, show banner (optional).
  if (shared) {
    ensureSharedBanner({
      gameTitle,
      sharedDay,
      sharedIdx,
      sharedScore,
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    toast("Missing dayKey.");
    return;
  }

  initPreviousAnswersUi({ dayKey, idx, endpoint: prevAnswersEndpoint });

  // Key idea:
  // - normal mode uses storageSlug = gameSlug
  // - fresh mode uses storageSlug = `${gameSlug}:fresh` so it never loads/overwrites real progress
  const storageSlug = fresh ? `${gameSlug}:fresh` : gameSlug;

  const puzId = puzzleId(gameSlug, dayKey, idx);

  const defaultState = {
    puzzleId: puzId,
    dayKey,
    idx,
    guesses: [],
    results: [],
    current: "",
    status: "playing",
  };

  const saved = loadState(storageSlug, gameSlug, dayKey, idx);
  let st = saved && saved.puzzleId === puzId ? saved : defaultState;

  st = migrateStateShape(st);
  saveState(storageSlug, gameSlug, dayKey, idx, st);

  let isSubmitting = false;

  // In fresh mode, also isolate stats so clicking shared links doesn't change streaks.
  const stats = loadStats(storageSlug, gameSlug);
  renderStreak(stats);
  renderBoard(st);

  const onLetter = (L) => {
    if (st.status !== "playing") return;
    if (st.current.length >= WORD_LEN) return;

    st.current += L.toLowerCase();
    renderBoard(st);
    saveState(storageSlug, gameSlug, dayKey, idx, st);
  };

  const onBackspace = () => {
    if (st.status !== "playing") return;
    if (!st.current.length) return;

    st.current = st.current.slice(0, -1);
    renderBoard(st);
    saveState(storageSlug, gameSlug, dayKey, idx, st);
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
      const data = await apiGuess({ apiBase, dayKey, idx, guess: g });

      if (!data?.ok) {
        toast("Server error.");
        return;
      }

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

      const result = normalizeResultArray(data.result);
      const row = st.guesses.length;

      st.guesses.push(g);
      st.results[row] = result;

      st.current = "";

      renderBoard(st);
      saveState(storageSlug, gameSlug, dayKey, idx, st);

      // 10 separate toasts (tier = score 1..10)
      const score = scoreRowFromStates(result); // 0..10
      const tier = toastTierFromScore(score);
      showRowToast({ row, tier });

      if (data.isSolved) {
        st.status = "won";

        // In fresh mode, stats are isolated; in normal mode, real streak works.
        const s = loadStats(storageSlug, gameSlug);
        if (s.lastWinDayKey !== dayKey) {
          s.streak = Number(s.streak || 0) + 1;
          s.lastWinDayKey = dayKey;
          saveStats(storageSlug, s);
          renderStreak(s);
        }

        toast("Solved!");
        saveState(storageSlug, gameSlug, dayKey, idx, st);
        openSharePanel(st, { gameTitle, dayKey, idx });
        return;
      }

      if (st.guesses.length >= MAX_ATTEMPTS) {
        st.status = "lost";

        const s = loadStats(storageSlug, gameSlug);
        s.streak = 0;
        saveStats(storageSlug, s);
        renderStreak(s);

        toast("Unlucky. New puzzle at 00:00 UTC.");
        saveState(storageSlug, gameSlug, dayKey, idx, st);
        openSharePanel(st, { gameTitle, dayKey, idx });
        return;
      }

      toast("");
    } catch {
      toast("Network error.");
    } finally {
      isSubmitting = false;
    }
  };

  $("#wordle-keyboard")?.addEventListener("click", (e) => {
    if (isPrevAnswersOpen()) return;

    const btn = e.target?.closest("button[data-key]");
    if (!btn) return;

    const k = btn.getAttribute("data-key");

    if (k === "Enter") onEnter();
    else if (k === "Backspace") onBackspace();
    else if (/^[A-Z]$/.test(k)) onLetter(k);
  });

  window.addEventListener("keydown", (e) => {
    if (!$("#wordle-sharePanel")?.hidden) return;
    if (isPrevAnswersOpen()) return;

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

  // Share actions
  $("#wordle-shareBtn")?.addEventListener("click", () => openSharePanel(st, { gameTitle, dayKey, idx }));
  $("#wordle-closeShareBtn")?.addEventListener("click", () => setShareOpen(false));

  $("#wordle-copyBtn")?.addEventListener("click", async () => {
    const text = $("#wordle-shareText")?.textContent || "";
    const ok = await copyToClipboard(text);
    toast(ok ? "Copied result ✅" : "Copy failed.");
  });

  // Copy link: always share a fresh board link + include score in hash (optional banner)
  $("#wordle-copyLinkBtn")?.addEventListener("click", async () => {
    const scoreText = attemptsScoreText(st);
    const url = getShareUrl({ fresh: true, dayKey, idx, scoreText });
    const ok = await copyToClipboard(url);
    toast(ok ? "Copied link 🔗" : "Copy failed.");
  });

  // Native share: share fresh link so clicking opens empty grid
  $("#wordle-nativeShareBtn")?.addEventListener("click", async () => {
    const scoreText = attemptsScoreText(st);
    const url = getShareUrl({ fresh: true, dayKey, idx, scoreText });
    const text = $("#wordle-shareText")?.textContent || "";

    if (navigator.share) {
      try {
        await navigator.share({ title: gameTitle, text, url });
        toast("Shared ✅");
      } catch {}
    } else {
      toast("No native share on this browser.");
    }
  });

  // Facebook: open share dialog with the FRESH URL, and copy result text for paste
  $("#wordle-fbBtn")?.addEventListener("click", async () => {
    const scoreText = attemptsScoreText(st);
    const shareTarget = getShareUrl({ fresh: true, dayKey, idx, scoreText });
    const shareUrl = encodeURIComponent(shareTarget);
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

  $("#wordle-resetBtn")?.addEventListener("click", () => {
    clearState(storageSlug, gameSlug, dayKey, idx);

    st = migrateStateShape({ ...defaultState });

    renderBoard(st);
    saveState(storageSlug, gameSlug, dayKey, idx, st);
    toast("Reset locally.");
  });

  // Keep toast aligned if window changes mid-toast (best effort).
  window.addEventListener("resize", () => {
    const host = rowToastHost();
    if (!host) return;
    const showing = host.querySelector(".wordle-row-toast.is-show");
    if (!showing) return;
    const lastRow = Math.max(0, Math.min(MAX_ATTEMPTS - 1, st.guesses.length - 1));
    positionRowToastHostOverRow(lastRow);
  });
}

document.addEventListener("DOMContentLoaded", initDailyWord);
