// Korean number words → integers. Covers what radio reports actually use:
// native counters ("두 대", "열네시"), sino-Korean ("백 미터", "천오백"), digit-by-digit
// readouts ("공사오" = 045, "일사삼이"), and plain digits ("1.5킬로").

const NATIVE = { 한: 1, 하나: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 석: 3, 넷: 4, 네: 4, 넉: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50 };
const SINO_DIGIT = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SINO_UNIT = { 십: 10, 백: 100, 천: 1000, 만: 10000 };

// "열네" → 14, "스물세" → 23, "두" → 2
export function parseNative(word) {
  if (!word) return null;
  let total = 0;
  let rest = word;
  for (const tens of ["스물", "스무", "서른", "마흔", "쉰", "열"]) {
    if (rest.startsWith(tens)) { total += NATIVE[tens]; rest = rest.slice(tens.length); break; }
  }
  if (!rest) return total || null;
  const unit = Object.keys(NATIVE).filter((k) => NATIVE[k] < 10).sort((a, b) => b.length - a.length).find((k) => rest === k);
  if (unit) return total + NATIVE[unit];
  return null;
}

// "천오백" → 1500, "백" → 100, "삼십" → 30, "이천" → 2000
export function parseSino(word) {
  if (!word || !/^[영공일이삼사오육륙칠팔구십백천만]+$/.test(word)) return null;
  let total = 0, section = 0, digit = null;
  for (const ch of word) {
    if (ch in SINO_DIGIT) { digit = SINO_DIGIT[ch]; continue; }
    const unit = SINO_UNIT[ch];
    if (unit === 10000) { total += (section + (digit ?? 0)) * unit; section = 0; digit = null; continue; }
    section += (digit ?? 1) * unit;
    digit = null;
  }
  return total + section + (digit ?? 0);
}

// Digit-by-digit readout: "공사오" → "045", "일사삼이" → "1432". Only when no unit characters.
export function parseDigitReadout(word) {
  if (!word || !/^[영공일이삼사오육륙칠팔구]{2,4}$/.test(word)) return null;
  return [...word].map((ch) => SINO_DIGIT[ch]).join("");
}

// Any number-ish token: digits, native word, sino word.
export function toNumber(token) {
  if (token == null) return null;
  const t = String(token).replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return parseNative(t) ?? parseSino(t);
}
