import test from "node:test";
import assert from "node:assert/strict";
import { searchSop } from "../src/lib/sop.js";
test("sop search finds the right procedure", () => {
  assert.equal(searchSop("드론 목격 시 보고 절차 알려줘")[0].id, "SOP-01");
  assert.equal(searchSop("풍선 발견하면 어떻게 해")[0].id, "SOP-02");
  assert.equal(searchSop("군집 드론 접근")[0].id, "SOP-03");
  assert.equal(searchSop("통신 끊기면")[0].id, "SOP-07");
  assert.equal(searchSop("복창 정정 방법")[0].id, "SOP-05");
});
