// Sends the mindful pings (random times) and the movement pings (every 30 minutes).
// Run by GitHub Actions every hour; each run covers the hour it starts in, so a late start only loses part of one hour.
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const MODE = process.env.MODE || 'schedule';
const LIB = JSON.parse(readFileSync(new URL('../moves.json', import.meta.url)));
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

async function sendOne(label, payload) {
  const [title, body] = payload ? [payload.title, payload.body] : MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ ...(payload || {}), title, body }), { TTL: 1800, urgency: 'high', vapidDetails: s.vapid });
      console.log(`${label}: sent "${title}" to phone …${s.sub.endpoint.slice(-6)}`);
    } catch (e) {
      console.log(`${label}: FAILED (${e.statusCode || ''}) ${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) console.log('>>> CODE 410/404: the phone connection has expired. Open the app → Reminders → Turn on reminders, and update the PUSH_SETUP secret with the new code.');
      else if (e.statusCode === 403 || e.statusCode === 401) console.log('>>> CODE 403: the setup code does not match this phone. Copy the code again from the app and update the PUSH_SETUP secret.');
      else console.log('>>> Could not reach the push service; this ping was lost. The next one will try again.');
      process.exitCode = 1;
    }
  }
}

// Deterministic "random" schedule for a date, so every run agrees on it.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function scheduleFor(ymd) {
  // n random times in [start, end), every two at least `gap` minutes apart (uniform over all such schedules)
  const r = rng(Number(ymd.replace(/-/g, '')) * 7919);
  const start = cfg.startHour * 60 + (cfg.goalPing ? 30 : 0), end = cfg.endHour * 60, n = cfg.pingsPerDay, gap = cfg.minGapMinutes;
  const free = end - start - (n - 1) * gap;
  if (free <= 0) return Array.from({ length: n }, (_, i) => start + Math.round(i * (end - start) / n));
  const u = Array.from({ length: n }, () => Math.floor(r() * free)).sort((a, b) => a - b);
  return u.map((v, i) => start + v + i * gap);
}

// Movement pings: every `moveEveryMinutes`, skipping any slot too close to a mindful ping.
// Morning leans yoga/stretch, the working day strength/cardio, the evening winds down.
function moveSlotsFor(ymd, mindful) {
  if (!cfg.movePings) return [];
  const r = rng(Number(ymd.replace(/-/g, '')) * 104729);
  const every = cfg.moveEveryMinutes || 30, start = cfg.startHour * 60 + every, end = cfg.endHour * 60;
  const used = new Set(), out = [];
  for (let m = start, i = 0; m < end; m += every, i++) {
    if (mindful.some(x => Math.abs(x - m) < 12)) continue;
    const h = m / 60;
    const pool = h < 11 ? ['yoga', 'stretch', 'yoga', 'cardio'] : h < 17 ? ['strength', 'cardio', 'stretch', 'strength', 'yoga'] : ['stretch', 'yoga', 'cardio', 'strength'];
    const cat = pool[i % pool.length];
    let opts = LIB.moves.filter(x => x.cat === cat && !used.has(x.id));
    if (!opts.length) opts = LIB.moves.filter(x => x.cat === cat);
    const mv = opts[Math.floor(r() * opts.length)];
    used.add(mv.id);
    out.push({ m, mv });
  }
  return out;
}
function movePayload(mv) {
  return { kind: 'move', url: './?move=' + mv.id, title: 'Move · ' + LIB.categories[mv.cat].name + ': ' + mv.name, body: mv.cue + ' Tap for how-to.' };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const local = () => new Date(Date.now() + cfg.utcOffsetMinutes * 60000); // "local" clock via UTC getters
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

if (MODE === 'test') {
  await sendOne('Test ping');
  await sleep(4000);
  await sendOne('Test move ping', movePayload(LIB.moves[Math.floor(Math.random() * LIB.moves.length)]));
} else if (MODE === 'goal') {
  await sendOne('Morning goal (test)', { kind: 'goal', url: './?goal=1', title: 'Good morning', body: 'What’s the one thing you want to get done today? Tap to set your goal.' });
} else if (MODE === 'move') {
  await sendOne('Move (test)', movePayload(LIB.moves[Math.floor(Math.random() * LIB.moves.length)]));
} else {
  const now = local();
  const ymd = now.toISOString().slice(0, 10);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const plan = scheduleFor(ymd);
  const moves = moveSlotsFor(ymd, plan.concat(cfg.goalPing ? [cfg.startHour * 60] : []));
  const WINDOW = 60; // each run covers one hour
  const slotStart = Math.floor((nowMin + 5) / WINDOW) * WINDOW; // +5: the 8:58 run covers 9:00–10:00
  const inWin = m => m >= slotStart && m < slotStart + WINDOW && m >= nowMin - 20;
  const events = plan.filter(inWin).map(m => ({ m, label: hhmm(m) + ' mindful', payload: null }))
    .concat(moves.filter(x => inWin(x.m)).map(x => ({ m: x.m, label: hhmm(x.m) + ' move (' + x.mv.name + ')', payload: movePayload(x.mv) })))
    .sort((a, b) => a.m - b.m);
  console.log(`Today (${ymd}) mindful pings at ${plan.map(hhmm).join(', ')}; ${moves.length} movement pings. This run covers ${hhmm(slotStart)}–${hhmm(slotStart + WINDOW)}; sending ${events.length}.`);
  const GOAL = { kind: 'goal', url: './?goal=1', title: 'Good morning', body: 'What’s the one thing you want to get done today? Tap to set your goal.' };
  if (cfg.goalPing && slotStart === cfg.startHour * 60 && nowMin <= slotStart + 50) await sendOne('Morning goal', GOAL);
  for (const ev of events) {
    const nowM = local().getUTCHours() * 60 + local().getUTCMinutes() + local().getUTCSeconds() / 60;
    if (ev.m > nowM) await sleep((ev.m - nowM) * 60000);
    await sendOne(ev.label, ev.payload);
  }
}
