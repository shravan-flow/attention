// Sends the random mindful pings. Run by GitHub Actions three times a day
// (9am, 1pm, 5pm India time); each run covers the next 4 hours.
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const MODE = process.env.MODE || 'schedule';
// PUSH_SETUP holds one code per phone, made by the app (Reminders tab).
const subs = (process.env.PUSH_SETUP || '').split(/\s+/).filter(Boolean).map(code => {
  const j = JSON.parse(Buffer.from(code.replace(/^ATTN2\./, ''), 'base64').toString('utf8'));
  return { sub: j.s, vapid: { subject: 'mailto:attention@users.noreply.github.com', publicKey: j.k, privateKey: j.p } };
});
if (!subs.length) { console.log('No phone connected yet: add the PUSH_SETUP secret.'); process.exit(0); }

const MESSAGES = [
  ['Pause for a minute', 'Where is your attention right now? Tap to check in.'],
  ['Three breaths', 'Stop what you’re doing. Breathe. Then notice what pulled you away.'],
  ['Come back', 'Feel your feet on the ground. One mindful minute?'],
  ['Notice', 'What’s on your mind this very second? Tap to name it.'],
  ['Right here', 'Drop your shoulders, soften your jaw. Check in for a minute.'],
  ['A small return', 'Wherever you wandered, you can come back now.'],
  ['What are you doing?', 'Is it the thing you meant to be doing? Take a minute.'],
];

async function sendOne(label) {
  const [title, body] = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title, body }), { TTL: 1800, urgency: 'high', vapidDetails: s.vapid });
      console.log(`${label}: sent "${title}"`);
    } catch (e) {
      console.log(`${label}: FAILED (${e.statusCode || ''}) ${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) console.log('The phone connection has expired. Open the app → Reminders → Turn on reminders, and update the PUSH_SETUP secret with the new code.');
      process.exitCode = 1;
    }
  }
}

// Deterministic "random" schedule for a date, so every run agrees on it.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function scheduleFor(ymd) {
  const r = rng(Number(ymd.replace(/-/g, '')) * 7919);
  const start = cfg.startHour * 60, end = cfg.endHour * 60, n = cfg.pingsPerDay, gap = cfg.minGapMinutes;
  for (let tries = 0; tries < 5000; tries++) {
    const t = Array.from({ length: n }, () => start + Math.floor(r() * (end - start))).sort((a, b) => a - b);
    if (t.every((v, i) => i === 0 || v - t[i - 1] >= gap)) return t;
  }
  return Array.from({ length: n }, (_, i) => start + Math.round((i + 0.5) * (end - start) / n));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = () => new Date(Date.now() + cfg.utcOffsetMinutes * 60000); // "local" clock via UTC getters
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

if (MODE === 'test') {
  await sendOne('Test ping');
} else {
  const now = local();
  const ymd = now.toISOString().slice(0, 10);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const plan = scheduleFor(ymd);
  const WINDOW = 240; // each run covers 4 hours
  const slotStart = cfg.startHour * 60 + Math.floor((nowMin - cfg.startHour * 60 + 5) / WINDOW) * WINDOW; // +5: tolerate starting slightly early
  const mine = plan.filter(m => m >= slotStart && m < slotStart + WINDOW && m >= nowMin - 45);
  console.log(`Today (${ymd}) pings at ${plan.map(hhmm).join(', ')}. This run covers ${hhmm(slotStart)}–${hhmm(slotStart + WINDOW)}; sending ${mine.map(hhmm).join(', ') || 'none'}.`);
  for (const m of mine) {
    const nowM = local().getUTCHours() * 60 + local().getUTCMinutes() + local().getUTCSeconds() / 60;
    if (m > nowM) await sleep((m - nowM) * 60000);
    await sendOne(hhmm(m));
  }
}
