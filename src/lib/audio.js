// Push-to-talk capture → 16 kHz mono Float32 for Whisper. The optional "radio" chain band-limits the mic
// to 300–3400 Hz, adds noise and soft clipping, so the demo shows recognition under radio-quality audio.
const TARGET = 16000;

export async function resampleTo16k(buffer) {
  if (buffer.sampleRate === TARGET && buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const length = Math.ceil(buffer.duration * TARGET);
  const ctx = new OfflineAudioContext(1, length, TARGET);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

export async function decodeUrl(url, ctx) {
  const bytes = await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(bytes);
}

function radioChain(ctx, input) {
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(2.2 * x); }
  shaper.curve = curve;
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.06;
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true; noise.start();
  const mix = ctx.createGain();
  input.connect(hp).connect(lp).connect(shaper).connect(mix);
  noise.connect(mix);
  return { out: mix, stop: () => noise.stop() };
}

export class PushToTalk {
  constructor() { this.ctx = null; this.stream = null; this.chunks = []; this.level = 0; }

  async start({ radio = false } = {}) {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: !radio } });
    const src = this.ctx.createMediaStreamSource(this.stream);
    const chain = radio ? radioChain(this.ctx, src) : { out: src, stop: () => {} };
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(d));
      let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(s / (d.length / 16)) * 4);
    };
    chain.out.connect(proc);
    proc.connect(this.ctx.destination);
    this.active = { proc, chain, src };
  }

  async stop() {
    if (!this.active) return null;
    const { proc, chain, src } = this.active;
    proc.disconnect(); src.disconnect(); chain.stop();
    this.active = null; this.level = 0;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (total < this.ctx.sampleRate * 0.3) return null;
    const buf = this.ctx.createBuffer(1, total, this.ctx.sampleRate);
    let o = 0; for (const c of this.chunks) { buf.getChannelData(0).set(c, o); o += c.length; }
    return resampleTo16k(buf);
  }
}

// Read-back through the OS speech engine (offline voices only; never a network voice).
export function speak(text, { lang = "ko-KR" } = {}) {
  if (!("speechSynthesis" in window)) return false;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith(lang.slice(0, 2)) && v.localService);
  if (!voices.length) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voices[0]; u.lang = lang; u.rate = 1.05;
  speechSynthesis.speak(u);
  return true;
}
