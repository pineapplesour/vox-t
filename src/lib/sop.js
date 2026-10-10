// Synthetic SOP knowledge base for the hackathon demo (NOT a real field manual — public/synthetic data only,
// as the event rules require). Offline search uses character bigrams, which works for Korean without a tokenizer.

export const SOP = [
  { id: "SOP-01", title: "소형 무인기(드론) 목격 시 최초 보고", body: "1) 목격 즉시 '긴급' 접두로 무전 보고한다. 2) SALUTE 순서로 규모(수량)·활동·위치(방위·거리)·식별(기종)·시각·고도를 전한다. 3) 확인되지 않은 값은 '미확인'으로 말하고 추정하지 않는다. 4) 수신 측의 복창(read-back)을 듣고 틀리면 즉시 '정정'한다. 5) 추적이 가능하면 30초 간격으로 위치 갱신 보고를 한다." },
  { id: "SOP-02", title: "풍선(기구)형 침투체 발견 시 조치", body: "1) 풍선은 접근하거나 만지지 않는다. 2) 크기, 매달린 물체 유무, 고도, 표류 방향을 보고한다. 3) 낙하가 예상되면 낙하 예상 지역의 인원 대피를 건의한다. 4) 도심 상공에서는 부수피해 가능성 때문에 임의로 타격하지 않고 상급 결심을 기다린다." },
  { id: "SOP-03", title: "다수(군집) 무인기 접근 시", body: "1) '군집'이라는 단어를 먼저 말해 우선순위를 높인다. 2) 대략적인 수량과 편대 형태, 가장 가까운 개체의 방위·거리를 보고한다. 3) 접근 방향과 예상 도달 시간을 추정해 함께 보고한다. 4) 엄폐 위치로 이동하고 개인 전자장비 방출을 최소화한다." },
  { id: "SOP-04", title: "무전 보고 표준 양식 (SALUTE)", body: "S(Size) 규모·수량, A(Activity) 활동, L(Location) 위치 — 방위는 세 자리 숫자로 '공사오'처럼 한 자리씩 읽는다, U(Unit/Identification) 식별, T(Time) 시각 — 24시간제 네 자리, E(Equipment/Elevation) 장비·고도. 보고 끝에는 '이상'을 붙인다." },
  { id: "SOP-05", title: "복창(Read-back)과 정정 절차", body: "1) 수신자는 핵심 수치(수량·방위·거리·시각)를 그대로 복창한다. 2) 송신자는 '맞음' 또는 '정정, ○○'으로 답한다. 3) 정정이 있으면 정정 이후의 값만 유효하다. 4) 두 번 연속 인식이 실패하면 숫자를 한 자리씩 다시 읽는다." },
  { id: "SOP-06", title: "전파 방출 통제(EMCON) 상황의 보고", body: "1) 송신 시간을 최소화하기 위해 핵심 수치만 압축해 짧게 버스트로 보낸다. 2) 음성 대신 코드화된 단문(예: UAV|2|045|2000)을 우선 사용한다. 3) 같은 내용을 반복 송신하지 않는다. 4) 상급 망이 복구되면 저장된 보고를 일괄 동기화한다." },
  { id: "SOP-07", title: "통신 두절 시 행동", body: "1) 단말에 보고를 로컬 저장하고 시각을 기록한다. 2) 인접 분대 단말과 근거리 통신이 되면 그쪽으로 중계한다. 3) 사전 약속된 집결 지점과 시각을 따른다. 4) 복구 후 저장 보고를 시간순으로 전송한다." },
  { id: "SOP-08", title: "도심 지역 대응 시 부수피해 고려", body: "1) 인구 밀집 지역 상공에서는 물리적 타격(하드킬)보다 전자적 무력화(소프트킬)를 우선 검토한다. 2) 낙하 예상 지점의 인원·시설을 함께 보고한다. 3) 대응 결심은 상급 지휘관이 내리며 현장에서는 정확한 정보 보고에 집중한다." },
  { id: "SOP-09", title: "연합군(동맹) 전달 보고", body: "1) 영어 단문으로 핵심 수치를 전달한다(예: 2 drones at bearing 045, 2km, alt 100m, moving SW, at 14:32). 2) 방위·거리·시각은 숫자로만 표기한다. 3) 번역이 불확실한 부분은 원문 한국어를 함께 남긴다." },
  { id: "SOP-10", title: "보고 우선순위", body: "1) 군집 접근 > 아군 위치 근처 접근 > 정지 비행·정찰 의심 > 원거리 통과 순으로 보고한다. 2) 같은 개체의 중복 보고는 최초 보고자 호출부호를 언급해 통합한다." }
];

const bigrams = (s) => {
  const t = String(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
};

const docs = SOP.map((d) => ({ ...d, grams: bigrams(`${d.title} ${d.title} ${d.body}`) }));
const df = new Map();
for (const d of docs) for (const g of new Set(d.grams)) df.set(g, (df.get(g) ?? 0) + 1);

export function searchSop(query, k = 3) {
  const q = new Set(bigrams(query));
  return docs
    .map((d) => {
      let score = 0;
      const tf = new Map();
      for (const g of d.grams) tf.set(g, (tf.get(g) ?? 0) + 1);
      for (const g of q) if (tf.has(g)) score += (1 + Math.log(tf.get(g))) * Math.log(1 + docs.length / df.get(g));
      return { id: d.id, title: d.title, body: d.body, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
