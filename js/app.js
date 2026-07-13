/* ============ NomNom Log — app logic ============ */
"use strict";

/* ---------- storage ---------- */
const STORE_KEY = "nomnom.v1";

const defaultState = () => ({
  settings: { calorieTarget: 2000, proteinTarget: 100, apiKey: "" },
  entries: {}, // { "YYYY-MM-DD": [entry, ...] }
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    // Most likely quota exceeded from photo thumbnails — drop them and retry.
    for (const day of Object.values(state.entries)) {
      for (const en of day) delete en.thumb;
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }
}

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);

function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function entriesFor(key) {
  return state.entries[key] || [];
}

function dayTotals(key) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
  for (const e of entriesFor(key)) {
    for (const k of Object.keys(t)) t[k] += Number(e[k]) || 0;
  }
  return t;
}

function fmt(n, digits = 0) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------- nutrition verdict ---------- */
/* Scores nutrient density per 100 kcal so scanned and manual entries are judged alike. */
function computeVerdict(e) {
  const kcal = Math.max(Number(e.calories) || 0, 1);
  const per100 = (v) => ((Number(v) || 0) / kcal) * 100;

  const proteinFrac = ((Number(e.protein) || 0) * 4) / kcal; // share of calories from protein
  const fiber100 = per100(e.fiber);
  const sugar100 = per100(e.sugar);
  const sodium100 = per100(e.sodium);

  let score = 3;
  const why = [];

  if (proteinFrac >= 0.25) { score += 2; why.push("packed with protein"); }
  else if (proteinFrac >= 0.15) { score += 1; why.push("a good protein source"); }

  if (fiber100 >= 2) { score += 2; why.push("high in fiber"); }
  else if (fiber100 >= 1) { score += 1; why.push("has some fiber"); }

  if (sugar100 >= 10) { score -= 2; why.push("quite sugary"); }
  else if (sugar100 >= 5) { score -= 1; why.push("a bit sugary"); }

  if (sodium100 >= 400) { score -= 2; why.push("very salty"); }
  else if (sodium100 >= 250) { score -= 1; why.push("on the salty side"); }

  const reason = why.length ? why.join(", ") : "a balanced mix of nutrients";
  if (score >= 6) return { level: "great", emoji: "🌱", label: "Great choice!", reason: `It's ${reason} — your body says thank you!` };
  if (score >= 3) return { level: "okay", emoji: "🙂", label: "Okay in moderation", reason: `It's ${reason}. Totally fine as part of your day!` };
  return { level: "treat", emoji: "🍩", label: "Treat — enjoy occasionally!", reason: `It's ${reason}. Savor it, no guilt — just balance it out later!` };
}

/* ---------- tabs / views ---------- */
const tabs = document.querySelectorAll(".tab");
tabs.forEach((tab) =>
  tab.addEventListener("click", () => showView(tab.dataset.tab))
);

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  if (name === "home") renderHome();
  if (name === "calendar") renderCalendar();
  if (name === "scan") resetScanUI();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0 });
}

/* ---------- HOME ---------- */
const RING_CIRC = 2 * Math.PI * 84;

function renderHome() {
  const key = dateKey();
  const totals = dayTotals(key);
  const target = state.settings.calorieTarget || 2000;
  const remaining = target - totals.calories;
  const pct = Math.min(totals.calories / target, 1);

  $("header-date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  const ring = $("ring-fill");
  ring.style.strokeDashoffset = RING_CIRC * (1 - pct);
  ring.classList.toggle("over", totals.calories > target);

  $("ring-remaining").textContent = remaining >= 0 ? fmt(remaining) : `+${fmt(-remaining)}`;
  $("ring-sub").textContent = remaining >= 0 ? "kcal left" : "kcal over";
  $("stat-eaten").textContent = fmt(totals.calories);
  $("stat-target").textContent = fmt(target);

  const p = totals.calories / target;
  let mascot;
  if (totals.calories === 0) mascot = "🐣 Let's log some yummy things!";
  else if (p < 0.5) mascot = "🐥 Plenty of room left — nom away!";
  else if (p < 0.9) mascot = "🐤 Cruising along nicely!";
  else if (p <= 1.05) mascot = "🎉 Right on target — beautifully balanced!";
  else mascot = "🐻 A little over today — tomorrow is a fresh start!";
  $("mascot").textContent = mascot;

  renderMacroBars(totals);
  renderFoodLog($("food-log"), key, true);
  $("log-empty").hidden = entriesFor(key).length > 0;
}

function renderMacroBars(totals) {
  const proteinTarget = state.settings.proteinTarget || 0;
  const calTarget = state.settings.calorieTarget || 2000;
  // Reference amounts: protein → user target (or 30% kcal), carbs 50% kcal, fat 30% kcal.
  const refs = {
    protein: proteinTarget || (calTarget * 0.3) / 4,
    carbs: (calTarget * 0.5) / 4,
    fat: (calTarget * 0.3) / 9,
  };
  const rows = [
    ["Protein", "protein", totals.protein, refs.protein, "g"],
    ["Carbs", "carbs", totals.carbs, refs.carbs, "g"],
    ["Fat", "fat", totals.fat, refs.fat, "g"],
  ];
  $("macro-bars").innerHTML = rows
    .map(([label, cls, val, ref]) => {
      const w = Math.min((val / ref) * 100, 100);
      return `<div class="macro-row">
        <span class="macro-name">${label}</span>
        <div class="macro-track"><div class="macro-fill ${cls}" style="width:${w}%"></div></div>
        <span class="macro-val">${fmt(val)} / ${fmt(ref)} g</span>
      </div>`;
    })
    .join("");

  $("micro-chips").innerHTML = [
    `🌾 fiber ${fmt(totals.fiber)} g`,
    `🍬 sugar ${fmt(totals.sugar)} g`,
    `🧂 sodium ${fmt(totals.sodium)} mg`,
  ].map((c) => `<span class="chip">${c}</span>`).join("");
}

function renderFoodLog(ul, key, editable) {
  const items = entriesFor(key);
  ul.innerHTML = "";
  for (const e of items) {
    const li = document.createElement("li");
    li.className = "food-item";
    const v = computeVerdict(e);
    const thumb = e.thumb
      ? `<img class="food-thumb" src="${e.thumb}" alt="">`
      : `<span class="food-thumb">${e.source === "scan" ? "📸" : "✏️"}</span>`;
    li.innerHTML = `${thumb}
      <div><div class="food-name"></div><div class="food-meta">${e.time || ""} · P ${fmt(e.protein)}g · C ${fmt(e.carbs)}g · F ${fmt(e.fat)}g</div></div>
      <div><div class="food-kcal">${fmt(e.calories)} kcal</div><div class="food-verdict">${v.emoji} ${v.label}</div></div>`;
    li.querySelector(".food-name").textContent = e.name;
    if (editable) li.addEventListener("click", () => openSheet(key, e.id));
    ul.appendChild(li);
  }
}

/* ---------- SCAN ---------- */
const LOADING_MSGS = [
  "Nibbling on the pixels…",
  "Consulting the snack oracle 🔮",
  "Counting every last crumb…",
  "Asking the AI chef 👩‍🍳",
];

let scanImage = null;   // { base64, mediaType, thumb }
let scanBase = null;    // nutrition per 1× portion from the AI
let scanMult = 1;

function resetScanUI() {
  ["scan-preview", "scan-loading", "scan-result", "scan-error"].forEach((id) => ($(id).hidden = true));
  $("scan-start").hidden = false;
  $("scan-key-note").hidden = !!state.settings.apiKey;
  scanImage = null; scanBase = null; scanMult = 1;
}

$("input-camera").addEventListener("change", onImagePicked);
$("input-gallery").addEventListener("change", onImagePicked);
$("btn-retake").addEventListener("click", resetScanUI);
$("btn-scan-again").addEventListener("click", resetScanUI);
$("btn-error-retry").addEventListener("click", resetScanUI);
$("btn-scan-manual").addEventListener("click", () => openSheet(dateKey(), null));
$("btn-error-manual").addEventListener("click", () => { resetScanUI(); openSheet(dateKey(), null); });
$("btn-add-manual").addEventListener("click", () => openSheet(dateKey(), null));

async function onImagePicked(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    scanImage = await prepareImage(file);
  } catch {
    return showScanError("Couldn't read that photo — try another one?");
  }
  $("preview-img").src = `data:${scanImage.mediaType};base64,${scanImage.base64}`;
  $("scan-start").hidden = true;
  $("scan-preview").hidden = false;
}

/* Downscale to ≤1024px JPEG to keep the API request small and fast on mobile data. */
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1024 / Math.max(img.width, img.height), 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      const tc = document.createElement("canvas");
      const ts = 96 / Math.min(canvas.width, canvas.height);
      tc.width = Math.round(canvas.width * ts);
      tc.height = Math.round(canvas.height * ts);
      tc.getContext("2d").drawImage(canvas, 0, 0, tc.width, tc.height);

      resolve({
        base64: dataUrl.split(",")[1],
        mediaType: "image/jpeg",
        thumb: tc.toDataURL("image/jpeg", 0.7),
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}

const FOOD_SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean", description: "Whether the image clearly shows food or drink" },
    name: { type: "string", description: "Short name of the dish or food, e.g. 'Chicken katsu curry'" },
    portion: { type: "string", description: "Estimated visible portion, e.g. '1 bowl (~350 g)'" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    calories: { type: "number", description: "Estimated kcal for the visible portion" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
    fiber_g: { type: "number" },
    sugar_g: { type: "number" },
    sodium_mg: { type: "number" },
    note: { type: "string", description: "One friendly sentence about the estimate or the food" },
  },
  required: ["is_food", "name", "portion", "confidence", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "note"],
  additionalProperties: false,
};

$("btn-analyze").addEventListener("click", analyzePhoto);

async function analyzePhoto() {
  if (!state.settings.apiKey) {
    return showScanError("No API key yet! Add your Anthropic API key in Settings, or log this meal manually.");
  }
  $("scan-preview").hidden = true;
  $("scan-loading").hidden = false;
  $("loading-msg").textContent = LOADING_MSGS[Math.floor(Math.random() * LOADING_MSGS.length)];

  try {
    const result = await callClaudeVision(scanImage);
    if (!result.is_food) {
      return showScanError(`Hmm, that doesn't look like food to me (I saw: ${result.name || "something mysterious"}). Try another photo?`);
    }
    scanBase = result;
    scanMult = 1;
    renderScanResult();
  } catch (err) {
    showScanError(err.message || "Something went wrong talking to the AI. Try again in a moment?");
  }
}

async function callClaudeVision(image) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: FOOD_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            {
              type: "text",
              text: "You are the food scanner inside a friendly calorie-tracking app. Identify the food in this photo and estimate its nutrition for the visible portion. Be realistic with portion sizes. If the image does not clearly show food or drink, set is_food to false and name what you see instead.",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch {}
    if (res.status === 401) throw new Error("That API key doesn't seem to work — double-check it in Settings.");
    if (res.status === 429) throw new Error("The AI is a bit busy (rate limited). Wait a moment and try again!");
    throw new Error(`The AI request failed (${res.status}). ${detail}`);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("The AI declined to analyze this image. Try a different photo?");
  if (data.stop_reason === "max_tokens") throw new Error("The AI's answer got cut off — try again?");
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("The AI didn't return a readable answer — try again?");
  return JSON.parse(textBlock.text);
}

function renderScanResult() {
  $("scan-loading").hidden = true;
  $("scan-result").hidden = false;
  $("result-name").value = scanBase.name;
  $("result-portion").textContent = `· AI saw: ${scanBase.portion}`;
  const confEmoji = { high: "🎯", medium: "🤔", low: "🌫️" }[scanBase.confidence] || "🤔";
  $("result-confidence").textContent = `${confEmoji} ${scanBase.confidence} confidence`;
  $("result-note").textContent = scanBase.note || "";
  updateResultNumbers();
}

function scaledEntry() {
  const m = scanMult;
  return {
    calories: Math.round(scanBase.calories * m),
    protein: +(scanBase.protein_g * m).toFixed(1),
    carbs: +(scanBase.carbs_g * m).toFixed(1),
    fat: +(scanBase.fat_g * m).toFixed(1),
    fiber: +(scanBase.fiber_g * m).toFixed(1),
    sugar: +(scanBase.sugar_g * m).toFixed(1),
    sodium: Math.round(scanBase.sodium_mg * m),
  };
}

function updateResultNumbers() {
  const s = scaledEntry();
  $("portion-mult").textContent = `${scanMult}×`;
  $("result-nutrition").innerHTML = [
    ["Calories", `${fmt(s.calories)} kcal`],
    ["Protein", `${s.protein} g`],
    ["Carbs", `${s.carbs} g`],
    ["Fat", `${s.fat} g`],
    ["Fiber", `${s.fiber} g`],
    ["Sugar", `${s.sugar} g`],
    ["Sodium", `${fmt(s.sodium)} mg`],
  ].map(([k, v]) => `<div class="nutri-cell"><span>${k}</span><b>${v}</b></div>`).join("");

  const v = computeVerdict(s);
  const el = $("result-verdict");
  el.className = `verdict ${v.level}`;
  el.innerHTML = `<b>${v.emoji} ${v.label}</b>${v.reason}`;
}

$("portion-minus").addEventListener("click", () => { scanMult = Math.max(0.25, +(scanMult - 0.25).toFixed(2)); updateResultNumbers(); });
$("portion-plus").addEventListener("click", () => { scanMult = Math.min(5, +(scanMult + 0.25).toFixed(2)); updateResultNumbers(); });

$("btn-log-it").addEventListener("click", () => {
  const s = scaledEntry();
  addEntry(dateKey(), {
    name: $("result-name").value.trim() || scanBase.name,
    ...s,
    source: "scan",
    thumb: scanImage?.thumb,
  });
  toast(`Yum! Logged ${$("result-name").value.trim() || scanBase.name} 🍜`);
  resetScanUI();
  showView("home");
});

function showScanError(msg) {
  ["scan-start", "scan-preview", "scan-loading", "scan-result"].forEach((id) => ($(id).hidden = true));
  $("scan-error").hidden = false;
  $("scan-error-msg").textContent = msg;
}

/* ---------- entries ---------- */
function addEntry(key, data) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0,
    source: "manual",
    ...data,
  };
  (state.entries[key] = state.entries[key] || []).push(entry);
  saveState();
  return entry;
}

/* ---------- edit / manual sheet ---------- */
let sheetCtx = null; // { key, id } — id null = new entry

function openSheet(key, id) {
  sheetCtx = { key, id };
  const e = id ? entriesFor(key).find((x) => x.id === id) : null;
  $("sheet-title").textContent = e ? "Edit food" : "Add food";
  $("sheet-name").value = e ? e.name : "";
  $("sheet-cal").value = e ? e.calories : "";
  $("sheet-protein").value = e ? e.protein : "";
  $("sheet-carbs").value = e ? e.carbs : "";
  $("sheet-fat").value = e ? e.fat : "";
  $("sheet-fiber").value = e ? e.fiber : "";
  $("sheet-sugar").value = e ? e.sugar : "";
  $("sheet-sodium").value = e ? e.sodium : "";
  $("sheet-delete").hidden = !e;
  $("sheet-backdrop").hidden = false;
}

function closeSheet() {
  $("sheet-backdrop").hidden = true;
  sheetCtx = null;
}

$("sheet-cancel").addEventListener("click", closeSheet);
$("sheet-backdrop").addEventListener("click", (ev) => { if (ev.target === $("sheet-backdrop")) closeSheet(); });

$("sheet-save").addEventListener("click", () => {
  const name = $("sheet-name").value.trim();
  const calories = Number($("sheet-cal").value);
  if (!name || !(calories >= 0)) return toast("Give it a name and calories 🙏");
  const data = {
    name,
    calories: Math.round(calories),
    protein: Number($("sheet-protein").value) || 0,
    carbs: Number($("sheet-carbs").value) || 0,
    fat: Number($("sheet-fat").value) || 0,
    fiber: Number($("sheet-fiber").value) || 0,
    sugar: Number($("sheet-sugar").value) || 0,
    sodium: Number($("sheet-sodium").value) || 0,
  };
  if (sheetCtx.id) {
    const e = entriesFor(sheetCtx.key).find((x) => x.id === sheetCtx.id);
    Object.assign(e, data);
    saveState();
    toast("Updated! ✨");
  } else {
    addEntry(sheetCtx.key, data);
    toast(`Logged ${name} ✏️`);
  }
  closeSheet();
  renderHome();
  if (!$("view-calendar").hidden) renderCalendar();
  showView("home");
});

$("sheet-delete").addEventListener("click", () => {
  const list = entriesFor(sheetCtx.key);
  state.entries[sheetCtx.key] = list.filter((x) => x.id !== sheetCtx.id);
  saveState();
  toast("Deleted 🗑️");
  closeSheet();
  renderHome();
  if (!$("view-calendar").hidden) renderCalendar();
});

/* ---------- CALENDAR ---------- */
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

$("cal-prev").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$("cal-next").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });
$("day-detail-close").addEventListener("click", () => ($("day-detail").hidden = true));

function renderCalendar() {
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  $("cal-title").textContent = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const first = new Date(y, m, 1);
  const startBlanks = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const target = state.settings.calorieTarget || 2000;
  const todayK = dateKey();

  const grid = $("cal-grid");
  grid.innerHTML = "";
  for (let i = 0; i < startBlanks; i++) {
    const b = document.createElement("span");
    b.className = "cal-day blank";
    grid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(y, m, d));
    const totals = dayTotals(key);
    const has = entriesFor(key).length > 0;
    const btn = document.createElement("button");
    btn.className = "cal-day";
    if (has) btn.classList.add(totals.calories > target ? "over" : "under");
    if (key === todayK) btn.classList.add("today");
    btn.innerHTML = `<span class="cal-num">${d}</span>` + (has ? `<span class="cal-kcal">${fmt(totals.calories)}</span>` : "");
    btn.setAttribute("aria-label", `${key}: ${has ? fmt(totals.calories) + " kcal" : "no entries"}`);
    btn.addEventListener("click", () => showDayDetail(key));
    grid.appendChild(btn);
  }

  renderStats();
  $("day-detail").hidden = true;
}

function renderStats() {
  // last 7 days incl. today
  let kcalSum = 0, proteinSum = 0, daysWithData = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const t = dayTotals(dateKey(d));
    if (entriesFor(dateKey(d)).length) {
      kcalSum += t.calories;
      proteinSum += t.protein;
      daysWithData++;
    }
  }
  $("stat-avg").textContent = daysWithData ? fmt(kcalSum / daysWithData) : "–";
  $("stat-protein-avg").textContent = daysWithData ? fmt(proteinSum / daysWithData) : "–";

  // streak: consecutive logged days ending today (or yesterday)
  let streak = 0;
  const start = new Date();
  if (!entriesFor(dateKey(start)).length) start.setDate(start.getDate() - 1);
  while (entriesFor(dateKey(start)).length) {
    streak++;
    start.setDate(start.getDate() - 1);
  }
  $("stat-streak").textContent = streak;
}

function showDayDetail(key) {
  const items = entriesFor(key);
  const t = dayTotals(key);
  $("day-detail-title").textContent = new Date(key + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  $("day-detail-summary").textContent = items.length
    ? `${fmt(t.calories)} kcal · P ${fmt(t.protein)}g · C ${fmt(t.carbs)}g · F ${fmt(t.fat)}g`
    : "No entries this day.";
  renderFoodLog($("day-detail-log"), key, true);
  $("day-detail").hidden = false;
  $("day-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- SETTINGS ---------- */
function renderSettings() {
  $("set-cal-target").value = state.settings.calorieTarget;
  $("set-protein-target").value = state.settings.proteinTarget || "";
  $("set-api-key").value = state.settings.apiKey || "";
}

$("set-cal-target").addEventListener("change", (e) => {
  const v = Number(e.target.value);
  if (v >= 500) { state.settings.calorieTarget = Math.round(v); saveState(); toast("Target updated 🎯"); }
});
$("set-protein-target").addEventListener("change", (e) => {
  state.settings.proteinTarget = Math.max(0, Math.round(Number(e.target.value) || 0));
  saveState();
});
$("set-api-key").addEventListener("change", (e) => {
  state.settings.apiKey = e.target.value.trim();
  saveState();
  toast(state.settings.apiKey ? "API key saved 🔑" : "API key removed");
});

/* ---------- demo data ---------- */
const DEMO_FOODS = [
  { name: "Avocado toast", calories: 320, protein: 9, carbs: 30, fat: 18, fiber: 8, sugar: 3, sodium: 380 },
  { name: "Chicken teriyaki bowl", calories: 560, protein: 38, carbs: 68, fat: 14, fiber: 4, sugar: 12, sodium: 900 },
  { name: "Greek yogurt & berries", calories: 180, protein: 15, carbs: 20, fat: 4, fiber: 3, sugar: 14, sodium: 60 },
  { name: "Spicy ramen 🍜", calories: 650, protein: 22, carbs: 80, fat: 26, fiber: 4, sugar: 6, sodium: 1800 },
  { name: "Strawberry mochi", calories: 110, protein: 1, carbs: 25, fat: 0.5, fiber: 1, sugar: 14, sodium: 30 },
  { name: "Salmon poke bowl", calories: 520, protein: 32, carbs: 55, fat: 18, fiber: 5, sugar: 8, sodium: 750 },
  { name: "Matcha latte", calories: 190, protein: 7, carbs: 26, fat: 6, fiber: 0, sugar: 22, sodium: 105 },
  { name: "Veggie omelette", calories: 280, protein: 19, carbs: 6, fat: 20, fiber: 2, sugar: 3, sodium: 420 },
];

$("btn-demo").addEventListener("click", () => {
  const times = ["08:12", "12:45", "16:20", "19:30"];
  for (let i = 9; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    if (entriesFor(key).length) continue;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let j = 0; j < n; j++) {
      const f = DEMO_FOODS[Math.floor(Math.random() * DEMO_FOODS.length)];
      addEntry(key, { ...f, time: times[j % times.length], source: "manual" });
    }
  }
  toast("Demo data sprinkled in 🌸");
  renderHome();
});

$("btn-clear").addEventListener("click", () => {
  if (!confirm("Clear ALL your logged food and settings? This can't be undone.")) return;
  localStorage.removeItem(STORE_KEY);
  state = defaultState();
  renderHome();
  renderSettings();
  toast("All clean! 🧹");
});

/* ---------- init ---------- */
renderHome();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
