// Turns an extracted report into (1) a standard Korean sighting report (SALUTE-style),
// (2) a short read-back sentence the operator confirms by voice/tap, (3) an English line for coalition partners.
const DIR_EN = { 북: "N", 북북동: "NNE", 북동: "NE", 동북동: "ENE", 동: "E", 동남동: "ESE", 남동: "SE", 남남동: "SSE", 남: "S", 남남서: "SSW", 남서: "SW", 서남서: "WSW", 서: "W", 서북서: "WNW", 북서: "NW", 북북서: "NNW" };
const TYPE_EN = { 드론: "drone", 풍선: "balloon", 미상: "unidentified object" };

const pad3 = (n) => String(n).padStart(3, "0");
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)}km` : `${m}m`);

export function formatKoreanReport(r, { now = new Date() } = {}) {
  const t = r.time ?? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}(수신)`;
  const loc = [r.bearing_deg != null ? `방위 ${pad3(r.bearing_deg)}°${r.bearing_from_word ? `(${r.direction_word}쪽)` : ""}` : null, r.distance_m != null ? `거리 ${km(r.distance_m)}` : null].filter(Boolean).join(", ");
  return [
    { k: "S 규모", v: r.count != null ? `${r.type ?? "비행체"} ${r.count}${r.type === "풍선" ? "개" : "대"}` : r.countNote ?? "미확인" },
    { k: "A 활동", v: [r.activity, r.heading_word ? `${r.heading_word}쪽으로 이동` : null].filter(Boolean).join(", ") || "미확인" },
    { k: "L 위치", v: loc || "미확인" },
    { k: "U 식별", v: r.type ?? "미상" },
    { k: "T 시각", v: t },
    { k: "E 고도", v: r.altitude_m != null ? `약 ${r.altitude_m}m` : "미확인" },
    { k: "보고자", v: r.reporter ?? "미상" }
  ];
}

// Short, unambiguous read-back. Numbers are read digit-by-digit like radio ("공사오").
const DIGIT_WORD = ["공", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const readDigits = (s) => [...String(s)].map((d) => DIGIT_WORD[Number(d)] ?? d).join("");

export function readBack(r) {
  const parts = [];
  if (r.type) parts.push(`${r.type}${r.count != null ? ` ${r.count}${r.type === "풍선" ? "개" : "대"}` : ""}`);
  if (r.bearing_deg != null) parts.push(`방위 ${readDigits(pad3(r.bearing_deg))}`);
  if (r.distance_m != null) parts.push(`거리 ${km(r.distance_m).replace("km", "킬로").replace("m", "미터")}`);
  if (r.altitude_m != null) parts.push(`고도 ${r.altitude_m}미터`);
  if (r.heading_word) parts.push(`${r.heading_word}쪽 이동`);
  if (r.time) parts.push(`${readDigits(r.time.replace(":", ""))} 시`);
  return parts.length ? `확인합니다. ${parts.join(", ")}. 맞습니까?` : "보고 내용을 인식하지 못했습니다. 다시 말씀해 주십시오.";
}

export function englishLine(r) {
  const what = `${r.count ?? "Unknown number of"} ${TYPE_EN[r.type] ?? "object"}${r.count > 1 ? "s" : ""}`;
  const where = [r.bearing_deg != null ? `bearing ${pad3(r.bearing_deg)}` : null, r.distance_m != null ? km(r.distance_m) : null].filter(Boolean).join(", ");
  const extra = [r.altitude_m != null ? `alt ~${r.altitude_m}m` : null, r.heading_word ? `moving ${DIR_EN[r.heading_word] ?? r.heading_word}` : null, r.time ? `at ${r.time}` : null].filter(Boolean).join(", ");
  return `SIGHTING: ${what}${where ? ` at ${where}` : ""}${extra ? `; ${extra}` : ""}${r.reporter ? ` (reported by ${r.reporter})` : ""}.`;
}

// Compact one-line message for a low-bandwidth link (what gets "sent" between devices).
export function burstMessage(r) {
  return [r.type === "풍선" ? "BLN" : r.type === "드론" ? "UAV" : "UNK", r.count ?? "?", r.bearing_deg != null ? pad3(r.bearing_deg) : "---", r.distance_m ?? "-", r.altitude_m ?? "-", r.heading_word ? DIR_EN[r.heading_word] : "-", (r.time ?? "").replace(":", "")].join("|");
}
