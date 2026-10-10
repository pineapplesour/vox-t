// Deterministic Korean radio-report parser. Runs instantly on any device and never invents a value:
// a field it cannot find stays null. The on-device LLM only fills gaps / phrases the summary.
import { parseDigitReadout, parseSino, toNumber } from "./korean-num.js";

const NUM = "(\\d+(?:\\.\\d+)?|[영공일이삼사오육륙칠팔구십백천만]+|[한두세네석넉하나둘셋넷다섯여섯일곱여덟아홉열스물스무서른마흔쉰]+)";
const DIRS = ["북북동", "북북서", "남남동", "남남서", "동북동", "서북서", "동남동", "서남서", "북동", "북서", "남동", "남서", "북", "남", "동", "서"];
const DIR_DEG = { 북: 0, 북북동: 22, 북동: 45, 동북동: 67, 동: 90, 동남동: 112, 남동: 135, 남남동: 157, 남: 180, 남남서: 202, 남서: 225, 서남서: 247, 서: 270, 서북서: 292, 북서: 315, 북북서: 337 };
const DIR_RE = DIRS.join("|");

function last(re, text) {
  let m, out = null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(text))) out = m;
  return out;
}

// Text after the last "정정"/"correction" wins for every field it mentions.
function correctionTail(text) {
  const i = Math.max(text.lastIndexOf("정정"), text.toLowerCase().lastIndexOf("correction"));
  return i >= 0 ? text.slice(i) : "";
}

function pick(fn, text) {
  const tail = correctionTail(text);
  const fromTail = tail ? fn(tail) : null;
  return fromTail ?? fn(text);
}

function type(text) {
  if (/풍선|기구|balloon/i.test(text)) return "풍선";
  if (/드론|무인기|무인 항공기|UAV|UAS|쿼드콥터|멀티콥터|drone/i.test(text)) return "드론";
  if (/비행체|물체|항적|object/i.test(text)) return "미상";
  return null;
}

function count(text) {
  if (/군집|떼|스웜|swarm/i.test(text) && !last(new RegExp(`${NUM}\\s*(?:대|기|개|척)`), text)) return { value: null, note: "다수(군집)" };
  const m = last(new RegExp(`${NUM}\\s*(?:대|기|개|척)(?![가-힣]*방)`), text);
  if (!m) return null;
  const n = toNumber(m[1]);
  return n != null && n > 0 && n < 500 ? { value: n } : null;
}

// Whisper often hears "방위" as 방이/방의/바위 and digit words as near-homophones (오→어, 이→위).
const MISHEARD = { 어: "오", 위: "이", 일: "일", 요: "오", 사: "사", 하나: "일" };
function fixReadout(tok) {
  if (/^\d{3}$/.test(tok)) return tok;
  const mixed = [...tok].map((ch) => (/\d/.test(ch) ? "영일이삼사오육칠팔구"[Number(ch)] : MISHEARD[ch] ?? ch)).join("");
  return mixed;
}
function bearing(text) {
  const spaced = last(/(?:방위각|방위가|방위|방이|방의|바위)\s*([0-9영공일이삼사오육륙칠팔구위어요])\s?([0-9영공일이삼사오육륙칠팔구위어요])\s?([0-9영공일이삼사오육륙칠팔구위어요])(?![0-9가-힣])/, text);
  if (spaced && /\s/.test(spaced[0].replace(/^\S+\s*/, ""))) {
    const readout = parseDigitReadout(fixReadout(spaced.slice(1).join("")));
    if (readout != null && Number(readout) < 360) return Number(readout);
  }
  const m = last(new RegExp(`(?:방위각|방위가|방위|방이|방의|바위)\\s*([0-9영공일이삼사오육륙칠팔구십백위어요]{2,4}|\\d{1,3})(?![0-9.]*\\s*(?:킬로|km|미터|m)(?![a-z]))\\s*(?:도)?`), text);
  if (m) {
    m[1] = fixReadout(m[1]);
    const readout = parseDigitReadout(m[1]);
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : readout != null ? Number(readout) : parseSino(m[1]);
    if (n != null && n >= 0 && n < 360) return n;
  }
  const deg = last(/(\d{1,3})\s*도\s*방향/, text);
  if (deg && Number(deg[1]) < 360) return Number(deg[1]);
  return null;
}

// Where the object is, relative to the reporter ("북동쪽 2킬로", "북동 방향에서").
// A direction followed by "(쪽)으로 이동/진행…" is the movement heading, not the location.
function directionWord(text) {
  const re = new RegExp(`(${DIR_RE})\\s*(쪽|방향|방면)?`, "g");
  let m, out = null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/^\s*(?:으로|로)\s*(?:이동|진행|비행|향|선회|접근|기동|표류|떠내려)/.test(rest)) continue;
    if (!m[2] && !/^\s*(?:에서|약|\d|[일이삼사오육칠팔구십백천])/.test(rest)) continue;
    out = m[1];
  }
  return out;
}

function heading(text) {
  const m = last(new RegExp(`(${DIR_RE})\\s*(?:쪽|방향|방면)?\\s*(?:으로|로)\\s*(?:이동|진행|비행|향|선회|접근|기동|표류|떠내려)`), text);
  return m ? m[1] : null;
}

function distance(text) {
  const spoken = last(/([0-9]+|[일이삼사오육칠팔구]+)\s*점\s*([0-9]+|[일이삼사오육칠팔구]+)\s*(킬로미터|킬로|km)/i, text);
  if (spoken) {
    const a = toNumber(spoken[1]), b = toNumber(spoken[2]);
    if (a != null && b != null) return Math.round(Number(`${a}.${b}`) * 1000);
  }
  const re = new RegExp(`${NUM}\\s*(킬로미터|킬로|km|미터|m)(?![a-z])`, "gi");
  let m, out = null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (/고도|높이/.test(before)) continue;
    const n = toNumber(m[1]);
    if (n == null) continue;
    out = /킬로|km/i.test(m[2]) ? Math.round(n * 1000) : Math.round(n);
  }
  return out;
}

function altitude(text) {
  const m = last(new RegExp(`(?:고도|높이)\\s*(?:약|대략)?\\s*${NUM}\\s*(미터|m|피트|ft)?(?![0-9]|\\s*(?:킬로|km))`, "i"), text);
  if (!m) return null;
  const n = toNumber(m[1]);
  if (n == null) return null;
  return /피트|ft/i.test(m[2] ?? "") ? Math.round(n * 0.3048) : Math.round(n);
}

function time(text) {
  const hhmm = last(/\b([01]?\d|2[0-3]):([0-5]\d)\b/, text);
  if (hhmm) return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
  const NUMN = NUM.replace("(", "(?:");
  const m = last(new RegExp(`(?<h>${NUMN})\\s*시(?:\\s*(?:(?<m>${NUMN})\\s*분|(?<half>반)|(?<oclock>정각)))?`), text);
  if (!m) return null;
  const h = toNumber(m.groups.h);
  if (h == null || h > 24) return null;
  const min = m.groups.half ? 30 : m.groups.m ? toNumber(m.groups.m) : 0;
  if (min == null || min > 59) return null;
  return `${String(h % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const ACTIVITIES = [
  [/표류|떠내려/, "표류 중"],
  [/정지|호버링|체공|떠 있/, "정지 비행(호버링)"],
  [/선회|원을 그리/, "선회"],
  [/접근/, "접근 중"],
  [/촬영|정찰|감시/, "정찰·촬영 의심"],
  [/투하|낙하/, "투하 의심"],
  [/저공|낮게/, "저공 비행"],
  [/이동|진행|비행 중/, "이동 중"]
];
function activity(text) {
  for (const [re, label] of ACTIVITIES) if (re.test(text)) return label;
  return null;
}

function reporter(text) {
  const CS = "(?:하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|[0-9]{1,2})";
  const m = text.match(new RegExp(`여기는\\s*([가-힣A-Za-z]{1,6}\\s?${CS})(?![가-힣0-9])`)) ?? text.match(new RegExp(`^\\s*(?:긴급[,\\s]*)?([가-힣A-Za-z]{1,6}\\s?${CS})(?![가-힣0-9])`));
  if (!m) return null;
  const NATIVE_CS = ["", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
  return m[1].trim().replace(/\s?([1-9])$/, (_, d) => ` ${NATIVE_CS[d]}`).replace(/([가-힣A-Za-z])(하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉)$/, "$1 $2");
}

// Rewrites common STT output forms into what the parser expects (seen on real Whisper output).
export function normalizeStt(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim()
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")                                   // 2,000m
    .replace(/(\d+(?:\.\d+)?)\s*천(?=\s*(?:미터|m|피트|ft|킬로|km))/gi, (_, n) => String(Number(n) * 1000))   // 2천 미터
    .replace(/(\d+(?:\.\d+)?)\s*백(?=\s*(?:미터|m|피트|ft))/gi, (_, n) => String(Number(n) * 100))
    .replace(/(\d(?:\.\d+)?)\s*(?:킬로그램|kg)(?![a-z])/gi, "$1킬로")                 // "2.4kg" is a misheard 2.4킬로
    .replace(/(동남|동북|서남|서북)(?=\s*(?:쪽|방향|방면))/g, (d) => ({ 동남: "남동", 동북: "북동", 서남: "남서", 서북: "북서" })[d]);
}

export function extractReport(rawText) {
  const text = normalizeStt(rawText);
  const c = pick(count, text);
  const dirWord = pick(directionWord, text);
  const bear = pick(bearing, text);
  const r = {
    type: pick(type, text),
    count: c?.value ?? null,
    countNote: c?.note ?? null,
    bearing_deg: bear ?? (dirWord ? DIR_DEG[dirWord] : null),
    bearing_from_word: bear == null && dirWord != null,
    direction_word: dirWord,
    distance_m: pick(distance, text),
    altitude_m: pick(altitude, text),
    heading_word: pick(heading, text),
    time: pick(time, text),
    activity: activity(correctionTail(text) || text),
    reporter: reporter(text),
    corrected: correctionTail(text) !== ""
  };
  const filled = ["type", "count", "bearing_deg", "distance_m", "altitude_m", "time"].filter((k) => r[k] != null).length;
  r.isSighting = r.type != null && filled >= 2;
  r.confidence = filled >= 5 ? "high" : filled >= 3 ? "medium" : "low";
  return r;
}

export function isQuestion(text) {
  return /(알려|뭐|무엇|어떻게|절차|방법|해야|\?|규정|교범|SOP)/.test(String(text ?? "")) && !extractReport(text).isSighting;
}
