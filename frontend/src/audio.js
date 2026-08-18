// Shared Web Audio context + first-interaction unlock.
//
// Browsers suspend an AudioContext until a user gesture, so a campaign
// started purely via the API (e.g. run_demo.sh) would otherwise be silent.
// The App calls unlockAudio() on the first pointer/key interaction anywhere
// in the app, after which campaign-impact sounds play from the first hit.
let ctx = null;

export function getAudioContext() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) ctx = new Ctx();
  }
  return ctx;
}

export function unlockAudio() {
  const c = getAudioContext();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

// ============================================================================
// Programmatic Audio Generators for Guided Demo
// ============================================================================

/** Plays a repeating tense 2-tone alarm. Returns a stop function. */
export function playAlarm(settings) {
  if (!settings?.sound) return () => {};
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return () => {};

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = "sawtooth";
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  gain.gain.value = 0.05;

  let isStopping = false;
  let interval;
  
  const step = () => {
    if (isStopping) return;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.setValueAtTime(800, now + 0.25);
  };
  
  osc.start();
  step();
  interval = setInterval(step, 500);

  // Safety cutoff after 20s
  const safety = setTimeout(() => stop(), 20000);

  const stop = () => {
    if (isStopping) return;
    isStopping = true;
    clearInterval(interval);
    clearTimeout(safety);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.stop(now + 0.1);
  };

  return stop;
}

/** Short subtle glitch/static blip for file corruption */
export function playCorruptionTick(settings) {
  if (!settings?.sound) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return;

  const bufferSize = ctx.sampleRate * 0.05; // 50ms of noise
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const gain = ctx.createGain();
  
  // Bandpass filter to make it sound like a sharp digital click
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 4000;
  
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
  
  noise.start(ctx.currentTime);
}

/** Distinct "caught it" sound when detection fires */
export function playDetectionStinger(settings) {
  if (!settings?.sound) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = "square";
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
  
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  
  osc.start(now);
  osc.stop(now + 0.3);
}

/** Soft ascending tone per restored file, pitched by index */
export function playRecoveryChime(settings, index) {
  if (!settings?.sound) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = "sine";
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  const now = ctx.currentTime;
  // Base 440Hz, goes up by a small harmonic step per index
  const freq = 440 + (index * 15);
  osc.frequency.setValueAtTime(freq, now);
  
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  
  osc.start(now);
  osc.stop(now + 0.3);
}

/** Clean success chord on completion */
export function playCompletionSound(settings) {
  if (!settings?.sound) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "suspended") return;

  const freqs = [523.25, 659.25, 783.99]; // C major chord
  const now = ctx.currentTime;

  freqs.forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "triangle";
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    
    osc.start(now);
    osc.stop(now + 1.5);
  });
}
