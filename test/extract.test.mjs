import test from "node:test";
import assert from "node:assert/strict";
import { extractReport, isQuestion } from "../src/lib/extract.js";
import { parseNative, parseSino, parseDigitReadout } from "../src/lib/korean-num.js";

test("korean numerals", () => {
  assert.equal(parseNative("두"), 2);
  assert.equal(parseNative("열네"), 14);
  assert.equal(parseNative("스물세"), 23);
  assert.equal(parseSino("천오백"), 1500);
  assert.equal(parseSino("백"), 100);
  assert.equal(parseSino("삼십"), 30);
  assert.equal(parseDigitReadout("공사오"), "045");
});

test("drone sighting with mixed number styles", () => {
  const r = extractReport("여기는 독수리 셋, 북동쪽 약 2킬로미터 지점에 드론 두 대 목격, 고도 약 백 미터, 남서 방향으로 이동 중, 14시 32분.");
  assert.equal(r.type, "드론");
  assert.equal(r.count, 2);
  assert.equal(r.direction_word, "북동");
  assert.equal(r.bearing_deg, 45);
  assert.equal(r.distance_m, 2000);
  assert.equal(r.altitude_m, 100);
  assert.equal(r.heading_word, "남서");
  assert.equal(r.time, "14:32");
  assert.equal(r.reporter, "독수리 셋");
  assert.equal(r.isSighting, true);
});

test("bearing readout, decimal km, half hour", () => {
  const r = extractReport("알파 둘, 방위 공사오 1.5킬로 풍선 한 개 정지 상태, 열네시 반");
  assert.equal(r.type, "풍선");
  assert.equal(r.count, 1);
  assert.equal(r.bearing_deg, 45);
  assert.equal(r.distance_m, 1500);
  assert.equal(r.time, "14:30");
  assert.equal(r.activity, "정지 비행(호버링)");
});

test("self-correction uses the corrected value", () => {
  const r = extractReport("드론 두 대 아니 정정, 세 대 서쪽 800미터 접근 중");
  assert.equal(r.count, 3);
  assert.equal(r.corrected, true);
  assert.equal(r.distance_m, 800);
  assert.equal(r.activity, "접근 중");
});

test("whisper-style digits and spoken decimal", () => {
  const r = extractReport("드론 3대, 방위각 120도, 일 점 오 킬로미터, 고도 150m, 09:05");
  assert.equal(r.count, 3);
  assert.equal(r.bearing_deg, 120);
  assert.equal(r.distance_m, 1500);
  assert.equal(r.altitude_m, 150);
  assert.equal(r.time, "09:05");
});

test("questions are not sightings", () => {
  assert.equal(isQuestion("드론 목격 시 보고 절차 알려줘"), true);
  assert.equal(isQuestion("드론 두 대 북쪽 1킬로 14시"), false);
});

test("missing facts stay null", () => {
  const r = extractReport("뭔가 보인다");
  assert.equal(r.count, null);
  assert.equal(r.time, null);
  assert.equal(r.isSighting, false);
});

test("whisper mishearings of bearing and callsign", () => {
  assert.equal(extractReport("북동쪽 방위각 공사어 1.5km, 드론 2대").bearing_deg, 45);
  assert.equal(extractReport("북쪽방이 350, 3km, 대형풍선 1개").bearing_deg, 350);
  assert.equal(extractReport("드론 세대 방위 1위공, 600m").bearing_deg, 120);
  assert.equal(extractReport("동초방이 090 드론 1대 200미터").bearing_deg, 90);
  assert.equal(extractReport("알파둘 여기는 매하나 14시 반 남동쪽 약 800미터 드론 한대").reporter, "매 하나");
  assert.equal(extractReport("독수리 3, 매 하나 동쪽 드론 1대").reporter, "독수리 셋");
});

test("방위각 heard as 방위가", () => {
  assert.equal(extractReport("북동쪽 방위가 공사어 1.5km. 드론 2대").bearing_deg, 45);
});

test("real STT output forms (benchmark 2026-10-11)", () => {
  const a = extractReport("여기는 독수리 3, 동남쪽 2,000m 지점 드론 2대, 고도 300, 북쪽으로 이동");
  assert.equal(a.reporter, "독수리 셋");
  assert.equal(a.direction_word, "남동");
  assert.equal(a.distance_m, 2000);
  assert.equal(a.altitude_m, 300);
  assert.equal(a.heading_word, "북");
  assert.equal(extractReport("매1, 방위 1위 공, 2.4kg, 드론 한 대").bearing_deg, 120);
  assert.equal(extractReport("매1, 방위 1위 공, 2.4kg, 드론 한 대").distance_m, 2400);
  assert.equal(extractReport("매1, 방위 1위 공, 2.4kg, 드론 한 대").reporter, "매 하나");
  assert.equal(extractReport("풍선 한 개 2천 미터, 고도 삼백").distance_m, 2000);
  assert.equal(extractReport("풍선 한 개 2천 미터, 고도 삼백").altitude_m, 300);
  // existing form still wins
  assert.equal(extractReport("알파 둘, 방위 공사오 1.5킬로 풍선 한 개").bearing_deg, 45);
});
