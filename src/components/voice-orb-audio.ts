/**
 * Audio engine for the voice concierge orb.
 *
 * Two jobs:
 *  1. Produce a live 0..1 "level" from whatever is currently making sound (the
 *     shopper's microphone while listening, the agent's speech while talking)
 *     so the orb can react instead of looping a canned animation.
 *  2. Play a soft ambient hum while a session is open, so the advisor feels
 *     present rather than dead between turns.
 *
 * Everything degrades quietly: if the browser blocks the AudioContext or the
 * mic, the caller still gets a gently animated level and the agent works.
 */
export type OrbAudio = {
  /** Latest smoothed amplitude, 0..1. */
  level: () => number;
  attachMic: () => Promise<void>;
  detachMic: () => void;
  attachElement: (el: HTMLAudioElement) => void;
  startHum: () => void;
  stopHum: () => void;
  /** Short rising tone that signals "your turn to speak". */
  cue: () => void;
  dispose: () => void;
};

const SILENT: OrbAudio = {
  level: () => 0,
  attachMic: async () => {},
  detachMic: () => {},
  attachElement: () => {},
  startHum: () => {},
  stopHum: () => {},
  cue: () => {},
  dispose: () => {},
};

export function createOrbAudio(): OrbAudio {
  if (typeof window === "undefined") return SILENT;

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return SILENT;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return SILENT;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.75;
  const bins = new Uint8Array(analyser.frequencyBinCount);

  let smoothed = 0;
  let micStream: MediaStream | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let elementNode: MediaElementAudioSourceNode | null = null;
  let attachedElement: HTMLAudioElement | null = null;
  let hum: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  function resume() {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  }

  return {
    level() {
      analyser.getByteFrequencyData(bins);
      // Weight the low-mid band: voice energy lives there, and it keeps the orb
      // from twitching on hiss.
      let sum = 0;
      const upper = Math.floor(bins.length * 0.45);
      for (let i = 0; i < upper; i += 1) sum += bins[i];
      const raw = Math.min(1, sum / upper / 165);
      // Asymmetric smoothing: rise fast (feels responsive), fall slow (no flicker).
      smoothed = raw > smoothed ? smoothed + (raw - smoothed) * 0.45 : smoothed + (raw - smoothed) * 0.12;
      return smoothed;
    },

    async attachMic() {
      resume();
      if (micNode) return;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micNode = ctx.createMediaStreamSource(micStream);
        micNode.connect(analyser); // analyser only - never routed to output
      } catch {
        micStream = null;
        micNode = null;
      }
    },

    detachMic() {
      micNode?.disconnect();
      micNode = null;
      micStream?.getTracks().forEach((track) => track.stop());
      micStream = null;
    },

    attachElement(el) {
      resume();
      if (attachedElement === el && elementNode) return;
      try {
        elementNode?.disconnect();
        elementNode = ctx.createMediaElementSource(el);
        elementNode.connect(analyser);
        // Must also reach the speakers, or routing through the graph mutes it.
        elementNode.connect(ctx.destination);
        attachedElement = el;
      } catch {
        // A given element can only be attached once; ignore repeat attempts.
      }
    },

    startHum() {
      resume();
      if (hum) return;
      try {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 420;
        // Two slightly detuned voices produce a slow beat: warm, not a test tone.
        const osc = [110, 110.4, 165].map((freq, index) => {
          const o = ctx.createOscillator();
          o.type = index === 2 ? "sine" : "triangle";
          o.frequency.value = freq;
          o.connect(filter);
          o.start();
          return o;
        });
        filter.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 1.2);
        hum = { osc, gain };
      } catch {
        hum = null;
      }
    },

    stopHum() {
      if (!hum) return;
      const { osc, gain } = hum;
      hum = null;
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        window.setTimeout(() => {
          osc.forEach((o) => {
            try {
              o.stop();
              o.disconnect();
            } catch {
              // already stopped
            }
          });
          gain.disconnect();
        }, 500);
      } catch {
        // context already closed
      }
    },

    cue() {
      resume();
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.32);
      } catch {
        // non-essential
      }
    },

    dispose() {
      this.detachMic();
      this.stopHum();
      try {
        elementNode?.disconnect();
        void ctx.close();
      } catch {
        // already closed
      }
    },
  };
}
