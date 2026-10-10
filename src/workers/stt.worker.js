// On-device Korean speech recognition (Whisper) — WebGPU when available, CPU (WASM) otherwise.
import { pipeline } from "@huggingface/transformers";
import { setupEnv, pickDevice, progressReporter } from "./common.js";

let asr = null;
let info = null;
const post = (m) => self.postMessage(m);

async function load({ base, model, prefer }) {
  setupEnv(base);
  const { device } = await pickDevice(prefer);
  const dtype = device === "webgpu"
    ? { encoder_model: "fp16", decoder_model_merged: "q4" }
    : { encoder_model: "q8", decoder_model_merged: "q8" };
  const t0 = performance.now();
  asr = await pipeline("automatic-speech-recognition", model, { device, dtype, progress_callback: progressReporter(post, "stt") });
  info = { model, device, loadMs: Math.round(performance.now() - t0) };
  // Warm-up so the first real transmission is not slow.
  await asr(new Float32Array(16000), { language: "korean", task: "transcribe" });
  post({ type: "ready", info });
}

async function transcribe({ id, audio }) {
  const t0 = performance.now();
  const out = await asr(audio, { language: "korean", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  post({ type: "result", id, text: String(out.text ?? "").trim(), ms: Math.round(performance.now() - t0), seconds: audio.length / 16000 });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load(data);
    else if (data.type === "transcribe") await transcribe(data);
  } catch (error) {
    post({ type: "error", id: data.id, message: String(error?.message ?? error) });
  }
};
