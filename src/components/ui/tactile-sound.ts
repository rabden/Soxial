// Dynamic audio generator (for XL/2XL buttons)
type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const playTactilePopSound = () => {
  try {
    // Safely initialize Web Audio API
    const AudioContext = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Create a pleasant, snappy "pop" sound using a sine wave
    osc.type = "sine";
    const now = ctx.currentTime;

    // Pitch drops rapidly to simulate a physical click
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);

    // Volume fades out cleanly over 50ms
    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // Silently fail if audio context is restricted by the browser (e.g. before user interaction)
  }
};

export { playTactilePopSound };
