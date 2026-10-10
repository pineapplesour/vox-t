import "./style.css";
import { extractReport, isQuestion } from "./lib/extract.js";
import { formatKoreanReport, readBack, englishLine, burstMessage } from "./lib/report.js";
import { searchSop } from "./lib/sop.js";
import { PushToTalk, decodeUrl, resampleTo16k, speak } from "./lib/audio.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const BASE = import.meta.env.BASE_URL;
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

const LLM_DTYPE = {};
const S = { stt: null, llm: null, sttReady: false, llmReady: false, pending: null, reports: JSON.parse(LS("voxt.reports") || "[]"), seq: 0 };

// ---------- network / status chips ----------
function paintNet() {
  const on = navigator.onLine;
  $("#netChip").textContent = on ? "온라인 (오프라인 동작 가능)" : "오프라인 · 기기 내 처리";
  $("#netChip").className = `chip ${on ? "" : "good"}`;
}
addEventListener("online", paintNet); addEventListener("offline", paintNet); paintNet();
function chip(id, text, cls = "") { const el = $(id); el.textContent = text; el.className = `chip ${cls}`; }

// ---------- workers ----------
function startWorker(kind, model) {
  const w = kind === "stt"
    ? new Worker(new URL("./workers/stt.worker.js", import.meta.url), { type: "module" })
    : new Worker(new URL("./workers/llm.worker.js", import.meta.url), { type: "module" });
  const waiters = new Map();
  w.onmessage = ({ data }) => {
    if (data.type === "progress") {
      const bar = $(`#${kind}Bar`), pct = $(`#${kind}Pct`);
      if (data.done) { bar.style.width = "100%"; pct.textContent = "완료"; return; }
      const p = data.total ? data.loaded / data.total : 0;
      bar.style.width = `${Math.round(p * 100)}%`;
      pct.textContent = data.text ? `${Math.round(p * 100)}%` : data.total ? `${(data.loaded / 1048576).toFixed(0)}/${(data.total / 1048576).toFixed(0)}MB` : "";
      return;
    }
    if (data.type === "ready") {
      S[`${kind}Ready`] = true;
      const i = data.info;
      chip(`#${kind}Chip`, `${kind === "stt" ? "음성 인식" : "LLM"} 준비 · ${i.device === "webgpu" ? "GPU" : "CPU"}`, "good");
      LS(`voxt.${kind}`, model);
      maybeHideSetup();
      return;
    }
    const cb = waiters.get(data.id);
    if (cb) { waiters.delete(data.id); cb(data); }
    else if (data.type === "error") chip(`#${kind}Chip`, `${kind === "stt" ? "음성 인식" : "LLM"} 오류`, "bad"), console.error(data.message);
  };
  const call = (msg) => new Promise((resolve) => { const id = ++S.seq; waiters.set(id, resolve); w.postMessage({ ...msg, id }); });
  const q = new URLSearchParams(location.search);
  if (kind === "llm" && q.get("llm")) model = q.get("llm");
  w.postMessage({ type: "load", base: new URL(BASE, location.href).href, model, prefer: $("#devicePref").value, dtype: kind === "llm" ? q.get("dtype") || LLM_DTYPE[model] : undefined });
  return { worker: w, call };
}

function maybeHideSetup() {
  const wantLlm = $("#llmModel").value;
  if (S.sttReady && (S.llmReady || !wantLlm)) $("#setup").hidden = true;
}

$("#loadBtn").addEventListener("click", () => {
  $("#loadBtn").disabled = true;
  $("#setupHint").textContent = "처음에는 내려받기에 몇 분 걸릴 수 있습니다. 이후에는 저장된 파일로 바로 시작합니다.";
  chip("#sttChip", "음성 인식 불러오는 중", "busy");
  S.stt = startWorker("stt", $("#sttModel").value);
  const llm = new URLSearchParams(location.search).get("llm") || $("#llmModel").value;
  if (llm) { chip("#llmChip", "LLM 불러오는 중", "busy"); S.llm = startWorker("llm", llm); }
  else chip("#llmChip", "LLM 끔 (규칙 추출)", "");
});
for (const id of ["sttModel", "llmModel"]) { const saved = LS(`voxt.${id.slice(0, 3)}`); if (saved !== null) $(`#${id}`).value = saved; }
if (LS("voxt.stt")) $("#loadBtn").click(); // models already cached on this device → start immediately

// ---------- speech in ----------
const ptt = new PushToTalk();
let recording = false, meterRaf = 0;
async function pttDown() {
  if (recording) return;
  if (!S.sttReady) { flash("음성 인식 모델이 아직 준비되지 않았습니다"); return; }
  recording = true; $("#ptt").classList.add("on");
  try { await ptt.start({ radio: $("#radioFx").checked }); } catch (e) { recording = false; $("#ptt").classList.remove("on"); flash("마이크를 사용할 수 없습니다"); return; }
  const tick = () => { $("#level").style.width = `${Math.round(ptt.level * 100)}%`; meterRaf = requestAnimationFrame(tick); };
  tick();
}
async function pttUp() {
  if (!recording) return;
  recording = false; $("#ptt").classList.remove("on"); cancelAnimationFrame(meterRaf); $("#level").style.width = "0";
  const audio = await ptt.stop();
  if (audio) await transcribe(audio, "마이크");
}
$("#ptt").addEventListener("pointerdown", (e) => { e.preventDefault(); pttDown(); });
addEventListener("pointerup", pttUp);
addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat && !/TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); pttDown(); } });
addEventListener("keyup", (e) => { if (e.code === "Space") pttUp(); });

async function transcribe(audio, source) {
  $("#ptt").classList.add("busy");
  $("#sttStat").textContent = "인식 중…";
  const res = await S.stt.call({ type: "transcribe", audio });
  $("#ptt").classList.remove("busy");
  if (res.type === "error") { $("#sttStat").textContent = "인식 실패"; return; }
  $("#sttStat").textContent = `${source} ${res.seconds.toFixed(1)}초 음성 → ${(res.ms / 1000).toFixed(1)}초 인식 (기기 내)`;
  $("#transcript").value = res.text;
  await handleText(res.text, { audioSeconds: res.seconds });
}

// ---------- samples ----------
fetch(`${BASE}samples/manifest.json`).then((r) => r.json()).then((list) => {
  $("#samples").innerHTML = list.map((s, i) => `<button class="sample" data-i="${i}"><b>${esc(s.title)}</b><small>${esc(s.file)}</small></button>`).join("");
  $("#samples").addEventListener("click", async (e) => {
    const b = e.target.closest(".sample"); if (!b) return;
    const s = list[b.dataset.i];
    const url = `${BASE}samples/${s.file}`;
    new Audio(url).play().catch(() => {});
    if (!S.sttReady) { flash("음성 인식 모델을 먼저 불러오세요"); return; }
    ptt.ctx ??= new AudioContext();
    const buf = await decodeUrl(url, ptt.ctx);
    await transcribe(await resampleTo16k(buf), "샘플");
  });
}).catch(() => {});

$("#reparse").addEventListener("click", () => handleText($("#transcript").value, {}));

// ---------- pipeline ----------
const FIELD_KEYS = ["type", "count", "direction_word", "distance_m", "altitude_m", "heading_word", "time", "activity", "reporter"];
const DIR_DEG = { 북: 0, 북동: 45, 동: 90, 남동: 135, 남: 180, 남서: 225, 서: 270, 북서: 315 };

async function handleText(text, meta) {
  text = String(text || "").trim();
  if (!text) return;
  if (S.pending && /^(맞음|맞습니다|맞아|확인|네|예|그렇다)/.test(text.replace(/[.,!\s]/g, ""))) return confirmPending();
  if (S.pending && /정정/.test(text)) return showReport(extractReport(`${S.pending.text} ${text}`), `${S.pending.text} ${text}`, meta);
  if (/요약|상황\s*정리|현황|브리핑/.test(text) && !extractReport(text).isSighting) return showSummary();
  if (isQuestion(text)) return answerSop(text);
  return showReport(extractReport(text), text, meta);
}

async function showReport(r, text, meta) {
  r.src = Object.fromEntries(FIELD_KEYS.map((k) => [k, r[k] != null ? "rule" : null]));
  S.pending = { r, text, meta };
  renderReport();
  $("#sopCard").hidden = true;
  speakReadback();
  if (S.llmReady) {
    const known = Object.fromEntries(FIELD_KEYS.map((k) => [k, r[k]]));
    if (Object.values(known).some((v) => v == null)) {
      const res = await S.llm.call({ type: "fill", text, known });
      if (S.pending?.r !== r) return;
      for (const k of FIELD_KEYS) {
        const v = res.parsed?.[k];
        if (r[k] == null && v != null && v !== "" && v !== "null" && String(text).includes(String(v).replace(/쪽$/, "").slice(0, 2))) { r[k] = v; r.src[k] = "ai"; }
      }
      if (r.bearing_deg == null && r.direction_word && DIR_DEG[r.direction_word] != null) { r.bearing_deg = DIR_DEG[r.direction_word]; r.bearing_from_word = true; }
      r.llmMs = res.ms;
      renderReport();
    }

  }
}

function renderReport() {
  const { r, meta } = S.pending;
  const rows = formatKoreanReport(r);
  const srcOf = { "S 규모": "count", "A 활동": "activity", "L 위치": "distance_m", "U 식별": "type", "T 시각": "time", "E 고도": "altitude_m", "보고자": "reporter" };
  $("#reportCard").innerHTML = `<table class="salute">${rows.map((row) => {
    const s = r.src?.[srcOf[row.k]];
    return `<tr><th>${esc(row.k)}</th><td class="${row.v === "미확인" ? "miss" : ""}">${esc(row.v)}${s === "ai" ? ' <span class="src ai">AI 보완</span>' : ""}</td></tr>`;
  }).join("")}</table>${r.corrected ? '<p class="note">정정 반영됨: 정정 이후 값을 사용</p>' : ""}${r.llmMs ? `<p class="stat">LLM 보완 ${(r.llmMs / 1000).toFixed(1)}초</p>` : ""}`;
  $("#confBadge").textContent = { high: "신뢰 높음", medium: "신뢰 보통", low: "정보 부족" }[r.confidence];
  $("#confBadge").className = `badge ${r.confidence}`;
  $("#readback").hidden = false;
  $("#rbText").textContent = readBack(r);
  $("#enCard").hidden = false;
  $("#enRule").textContent = englishLine(r);
  $("#enAi").textContent = "규칙 기반 변환 · 수치를 그대로 옮김 (LLM 번역은 시험에서 내용을 지어내 제외)";
  const msg = burstMessage(r);
  const bytes = new TextEncoder().encode(msg).length;
  const audioBytes = Math.round((meta?.audioSeconds ?? 0) * 16000 * 2);
  $("#burstCard").hidden = false;
  $("#burst").textContent = msg;
  $("#bw").textContent = audioBytes ? `${bytes} bytes (원본 음성 ${(audioBytes / 1024).toFixed(0)}KB 대비 ${(100 - (bytes / audioBytes) * 100).toFixed(2)}% 절감)` : `${bytes} bytes`;
}

function speakReadback() { if (S.pending && !speak(readBack(S.pending.r))) $("#rbSpeak").title = "이 기기에 오프라인 한국어 음성이 없어 화면 복창만 표시합니다"; }
$("#rbSpeak").addEventListener("click", speakReadback);
$("#rbOk").addEventListener("click", confirmPending);
$("#rbFix").addEventListener("click", () => { $("#transcript").focus(); flash("정정할 내용을 말하거나 인식 결과를 고친 뒤 '다시 분석'을 누르세요"); });

function confirmPending() {
  if (!S.pending) return;
  const { r, text } = S.pending;
  S.reports.unshift({ ...r, text, at: new Date().toISOString(), burst: burstMessage(r), en: englishLine(r) });
  S.reports = S.reports.slice(0, 50);
  LS("voxt.reports", JSON.stringify(S.reports));
  S.pending = null;
  $("#readback").hidden = true;
  speak("확정. 이상.");
  flash("보고 확정 · 상황도에 표시");
  paintMap(); paintLog();
}

async function answerSop(question) {
  const hits = searchSop(question, 3);
  S.pending = null;
  for (const id of ["#readback", "#enCard", "#burstCard"]) $(id).hidden = true;
  $("#confBadge").textContent = "교범 질의";
  $("#confBadge").className = "badge";
  $("#reportCard").innerHTML = `<p class="empty">질문으로 인식: "${esc(question)}"</p>`;
  $("#sopCard").hidden = false;
  $("#sopCites").innerHTML = hits.map((h) => `<details><summary>[${esc(h.id)}] ${esc(h.title)}</summary><p>${esc(h.body)}</p></details>`).join("");
  if (!hits.length) { $("#sopAns").textContent = "관련 교범 항목을 찾지 못했습니다."; return; }
  if (!S.llmReady) { $("#sopAns").innerHTML = `<p>${esc(hits[0].body)}</p><p class="stat">[${esc(hits[0].id)}] 원문 (LLM 꺼짐)</p>`; return; }
  $("#sopAns").innerHTML = '<p class="stat">기기 내 LLM이 교범에서 답을 찾는 중…</p>';
  const res = await S.llm.call({ type: "sop", question, passages: hits });
  $("#sopAns").innerHTML = `${esc(res.text).replace(/\[(SOP-\d+)\]/g, '<span class="cite">$1</span>').replace(/\n/g, "<br>")}<p class="stat">${(res.ms / 1000).toFixed(1)}초 · 근거 발췌만 사용</p>`;
}

// Deterministic situation brief from confirmed reports (no LLM: every number comes from a confirmed report).
export function situationBrief(reports, now = Date.now()) {
  const recent = reports.filter((r) => now - Date.parse(r.at) < 30 * 60_000);
  if (!recent.length) return "최근 30분 동안 확정된 보고가 없습니다.";
  const uav = recent.filter((r) => r.type === "드론"), bln = recent.filter((r) => r.type === "풍선");
  const sum = (a) => a.reduce((n, r) => n + (r.count ?? 1), 0);
  const nearest = recent.filter((r) => r.distance_m != null).sort((a, b) => a.distance_m - b.distance_m)[0];
  const approaching = recent.filter((r) => /접근/.test(r.activity ?? ""));
  const lines = [
    `최근 30분 확정 보고 ${recent.length}건: 드론 ${uav.length}건(${sum(uav)}대), 풍선 ${bln.length}건(${sum(bln)}개).`,
    nearest ? `가장 가까운 표적: ${nearest.type ?? "미상"} ${nearest.count ?? "?"}${nearest.type === "풍선" ? "개" : "대"}, 방위 ${String(nearest.bearing_deg ?? "-").padStart(3, "0")}, ${(nearest.distance_m / 1000).toFixed(1)}km (${nearest.time ?? "시각 미상"}).` : null,
    approaching.length ? `접근 중 보고 ${approaching.length}건 - 우선 대응 검토 필요.` : null,
    `가장 최근: ${recent[0].en}`
  ];
  return lines.filter(Boolean).join("\n");
}
function showSummary() {
  const text = situationBrief(S.reports);
  S.pending = null;
  for (const id of ["#readback", "#enCard", "#burstCard", "#sopCard"]) $(id).hidden = true;
  $("#confBadge").textContent = "상황 요약"; $("#confBadge").className = "badge";
  $("#reportCard").innerHTML = `<p class="brief">${esc(text).replace(/\n/g, "<br>")}</p><p class="stat">확정 보고에서 계산 · 기기 내</p>`;
  speak(text.split("\n").slice(0, 2).join(" "));
}
$("#summaryBtn")?.addEventListener("click", showSummary);

// ---------- map & log ----------
function paintMap() {
  const maxKm = Math.max(3, ...S.reports.filter((r) => r.distance_m).map((r) => Math.ceil(r.distance_m / 1000)));
  const scale = 100 / maxKm;
  let svg = "";
  for (let k = 1; k <= maxKm; k++) svg += `<circle r="${k * scale}" class="ring"/><text x="2" y="${-k * scale + 7}" class="rl">${k}km</text>`;
  svg += `<line x1="0" y1="-100" x2="0" y2="100" class="ax"/><line x1="-100" y1="0" x2="100" y2="0" class="ax"/>`;
  for (const [t, x, y] of [["N", 0, -103], ["E", 105, 3], ["S", 0, 109], ["W", -107, 3]]) svg += `<text x="${x}" y="${y}" class="cd">${t}</text>`;
  svg += `<circle r="3.5" class="me"/>`;
  S.reports.slice(0, 20).forEach((r, i) => {
    if (r.bearing_deg == null) return;
    const d = (r.distance_m ?? maxKm * 500) / 1000 * scale;
    const a = (r.bearing_deg - 90) * Math.PI / 180;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const cls = r.type === "풍선" ? "bln" : "uav";
    let arrow = "";
    const H = { 북: 0, 북동: 45, 동: 90, 남동: 135, 남: 180, 남서: 225, 서: 270, 북서: 315 }[r.heading_word];
    if (H != null) { const b = (H - 90) * Math.PI / 180; arrow = `<line x1="${x}" y1="${y}" x2="${x + Math.cos(b) * 14}" y2="${y + Math.sin(b) * 14}" class="hd"/>`; }
    svg += `${arrow}<g class="pt ${cls} ${i === 0 ? "new" : ""}"><circle cx="${x}" cy="${y}" r="${4 + Math.min(4, r.count ?? 1)}"/><text x="${x + 7}" y="${y - 6}">${r.type === "풍선" ? "풍선" : r.type === "드론" ? "UAV" : "?"}×${esc(r.count ?? "?")} ${esc(r.time ?? "")}</text></g>`;
  });
  $("#radar").innerHTML = svg;
}
function paintLog() {
  $("#log").innerHTML = S.reports.map((r) => `<li><b>${esc(r.time ?? new Date(r.at).toTimeString().slice(0, 5))}</b> ${esc(r.type ?? "미상")} ${esc(r.count ?? "?")} · 방위 ${r.bearing_deg != null ? String(r.bearing_deg).padStart(3, "0") : "-"} · ${r.distance_m ? esc((r.distance_m / 1000).toFixed(1)) + "km" : "-"}<code>${esc(r.burst)}</code></li>`).join("") || '<li class="empty">아직 확정된 보고가 없습니다.</li>';
}
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(S.reports, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `voxt-reports-${Date.now()}.json` });
  a.click();
});
paintMap(); paintLog();

let flashT;
function flash(text) {
  let el = $("#flash");
  if (!el) { el = Object.assign(document.createElement("div"), { id: "flash", className: "flash" }); document.body.append(el); }
  el.textContent = text; el.classList.add("show");
  clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove("show"), 2600);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
