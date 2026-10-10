// Small on-device LLM (Qwen3-4B via WebLLM; ONNX fallback). Three jobs, all offline:
//  - fill: complete fields the rule parser left empty (numbers it already found are never touched)
//  - translate: one English line for coalition partners
//  - sop: answer a procedure question only from the retrieved synthetic SOP passages, with [SOP-xx] citations
import { pipeline } from "@huggingface/transformers";
import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { setupEnv, pickDevice, progressReporter } from "./common.js";

let gen = null;
let mlc = null;
let currentModel = "";
const post = (m) => self.postMessage(m);

async function load({ base, model, prefer, dtype: forced }) {
  const t0 = performance.now();
  currentModel = model;
  // WebLLM (MLC) models run their own WebGPU kernels; far more reliable than ORT-WebGPU for chat models.
  if (/-MLC$/.test(model)) {
    // Models newer than the WebLLM prebuilt list: weights from mlc-ai on Hugging Face, kernels from binary-mlc-llm-libs.
    const extra = /Qwen3-4B-Instruct-2507/.test(model) && !prebuiltAppConfig.model_list.some((m) => m.model_id === model)
      ? [{ model_id: model, model: `https://huggingface.co/mlc-ai/${model}`, model_lib: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/${model.replace("-MLC", "")}-ctx4k_cs1k-webgpu.wasm`, overrides: { context_window_size: 4096 } }]
      : [];
    mlc = await CreateMLCEngine(model, {
      appConfig: { ...prebuiltAppConfig, model_list: [...prebuiltAppConfig.model_list, ...extra] },
      initProgressCallback: (p) => post({ type: "progress", label: "llm", loaded: Math.round(p.progress * 1000), total: 1000, text: p.text, ...(p.progress >= 1 ? { done: true } : {}) })
    });
    gen = true;
    post({ type: "ready", info: { model, device: "webgpu", dtype: "mlc", loadMs: Math.round(performance.now() - t0) } });
    return;
  }
  setupEnv(base);
  const { device, f16 } = await pickDevice(prefer);
  const dtype = forced || (f16 ? "q4f16" : "q4");
  gen = await pipeline("text-generation", model, { device, dtype, progress_callback: progressReporter(post, "llm") });
  post({ type: "ready", info: { model, device, dtype, loadMs: Math.round(performance.now() - t0) } });
}

async function chat(messages, max_new_tokens) {
  if (mlc) {
    const msgs = /Qwen3-(?!4B-Instruct)/.test(currentModel) ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content} /no_think` } : m)) : messages;
    const r = await mlc.chat.completions.create({ messages: msgs, temperature: 0, max_tokens: max_new_tokens + 64 });
    return String(r.choices[0].message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
  const out = await gen(messages, { max_new_tokens, do_sample: false, repetition_penalty: 1.05 });
  return String(out[0].generated_text.at(-1).content ?? "").trim();
}

const FILL_SYSTEM = `너는 군 무전 보고를 구조화하는 도우미다. 무전 원문에서 빈 칸(null)인 항목만 채운다.
규칙: 원문에 명시되지 않은 값은 절대 추측하지 말고 null로 둔다. 이미 값이 있는 항목은 그대로 둔다.
반드시 JSON 한 개만 출력한다. 키: type("드론"|"풍선"|"미상"|null), count(정수|null), direction_word("북"|"북동"|"동"|"남동"|"남"|"남서"|"서"|"북서"|null), distance_m(정수|null), altitude_m(정수|null), heading_word(위와 같은 8방위|null), time("HH:MM"|null), activity(짧은 한국어|null), reporter(호출부호|null).`;

async function fill({ id, text, known }) {
  const t0 = performance.now();
  const raw = await chat([
    { role: "system", content: FILL_SYSTEM },
    { role: "user", content: `무전 원문: "${text}"\n현재 값: ${JSON.stringify(known)}\nJSON:` }
  ], 160);
  let parsed = null;
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch {}
  post({ type: "fill", id, parsed, raw, ms: Math.round(performance.now() - t0) });
}

async function translate({ id, text }) {
  const t0 = performance.now();
  const out = await chat([
    { role: "system", content: "Translate the Korean military radio report into one concise English sentence for coalition partners. Keep every number exactly. Output only the English sentence." },
    { role: "user", content: text }
  ], 120);
  post({ type: "translate", id, text: out.split("\n")[0], ms: Math.round(performance.now() - t0) });
}

async function sop({ id, question, passages }) {
  const t0 = performance.now();
  const ctx = passages.map((p) => `[${p.id}] ${p.title}: ${p.body}`).join("\n");
  const out = await chat([
    { role: "system", content: "너는 전술 교범 도우미다. 아래 SOP 발췌만 근거로 한국어로 3~5줄로 답한다. 각 문장 끝에 근거 [SOP-xx]를 붙인다. 발췌에 없는 내용은 '교범에 없음'이라고 말한다." },
    { role: "user", content: `SOP 발췌:\n${ctx}\n\n질문: ${question}` }
  ], 220);
  post({ type: "sop", id, text: out, ms: Math.round(performance.now() - t0) });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load(data);
    else if (!gen) post({ type: "error", id: data.id, message: "LLM not loaded" });
    else if (data.type === "fill") await fill(data);
    else if (data.type === "translate") await translate(data);
    else if (data.type === "sop") await sop(data);
  } catch (error) {
    post({ type: "error", id: data.id, message: String(error?.message ?? error) });
  }
};
