import test from "node:test";
import assert from "node:assert/strict";
import { extractReport } from "../src/lib/extract.js";
import { readBack, englishLine, burstMessage, formatKoreanReport } from "../src/lib/report.js";

test("read-back, english and burst formats", () => {
  const r = extractReport("여기는 독수리 셋, 북동쪽 약 2킬로미터 드론 두 대, 고도 약 백 미터, 남서 방향으로 이동 중, 14시 32분");
  assert.equal(readBack(r), "확인합니다. 드론 2대, 방위 공사오, 거리 2킬로, 고도 100미터, 남서쪽 이동, 일사삼이 시. 맞습니까?");
  assert.match(englishLine(r), /SIGHTING: 2 drones at bearing 045, 2km; alt ~100m, moving SW, at 14:32 \(reported by 독수리 셋\)\./);
  assert.equal(burstMessage(r), "UAV|2|045|2000|100|SW|1432");
  assert.equal(formatKoreanReport(r)[0].v, "드론 2대");
});
