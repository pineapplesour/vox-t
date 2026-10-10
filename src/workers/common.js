// Shared runtime setup for both workers: ONNX Runtime WASM from our own origin (works offline),
// model files fetched once from the Hugging Face CDN and kept in the browser cache afterwards.
import { env } from "@huggingface/transformers";

export function setupEnv(base) {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = `${base}ort/`;
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
}

export async function pickDevice(prefer) {
  if (prefer === "wasm") return { device: "wasm", f16: false };
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) return { device: "webgpu", f16: adapter.features.has("shader-f16") };
  } catch {}
  return { device: "wasm", f16: false };
}

export function progressReporter(post, label) {
  const files = new Map();
  return (p) => {
    if (p.status === "progress" && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: "progress", label, loaded, total });
    } else if (p.status === "ready") {
      post({ type: "progress", label, done: true });
    }
  };
}
