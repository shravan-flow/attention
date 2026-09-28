// Garmin → intervals.icu → Attention sync. Runs on GitHub Actions every 2 hours.
// Reads your recent activities from intervals.icu (which syncs from Garmin Connect), encrypts them with
// your passphrase and saves data/activities.enc.json for the app. Nobody without the passphrase can read it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import crypto from 'node:crypto';

const KEY = (process.env.INTERVALS_API_KEY || '').trim(), PASS = (process.env.SYNC_PASSPHRASE || '').trim();
const API = process.env.INTERVALS_API || 'https://intervals.icu';
const DIR = new URL('../data/', import.meta.url);
const DATA_FILE = new URL('activities.enc.json', DIR), META_FILE = new URL('activities.meta.json', DIR);
function fail(msg) { console.log('>>> ' + msg); process.exit(1); }
if (!KEY) fail('Missing INTERVALS_API_KEY secret (intervals.icu → Settings → Developer Settings → API key).');
if (!PASS || PASS.length < 8) fail('Missing SYNC_PASSPHRASE secret (use at least 8 characters).');

function decrypts(box) {
  try {
    const key = crypto.pbkdf2Sync(PASS, Buffer.from(box.salt, 'base64'), 200000, 32, 'sha256');
    const raw = Buffer.from(box.ct, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    d.setAuthTag(raw.subarray(raw.length - 16)); d.update(raw.subarray(0, raw.length - 16)); d.final(); return true;
  } catch (e) { return false; }
}
function encrypt(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(PASS, salt, 200000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, kdf: 'PBKDF2-SHA256-200000', salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
const day = d => d.toISOString().slice(0, 10);
const oldest = day(new Date(Date.now() - 100 * 86400000)), newest = day(new Date(Date.now() + 86400000));
const r = await fetch(`${API}/api/v1/athlete/0/activities?oldest=${oldest}&newest=${newest}`, {
  headers: { Authorization: 'Basic ' + Buffer.from('API_KEY:' + KEY).toString('base64'), Accept: 'application/json' }
});
if (r.status === 401 || r.status === 403) fail(`intervals.icu refused the API key (${r.status}). Copy it again from intervals.icu → Settings → Developer Settings and update INTERVALS_API_KEY.`);
if (!r.ok) fail(`intervals.icu returned an error (${r.status}). It will try again in 2 hours.`);
const list = await r.json();
const sportOf = t => /Badminton|Racquet/i.test(t) ? 'badminton' : /Swim/i.test(t) ? 'swim' : /Ride|Cycl|Bike/i.test(t) ? 'bike' : /Run/i.test(t) ? 'run' : /Weight|Workout|Strength|Crossfit|Yoga|Pilates/i.test(t) ? 'strength' : /Walk|Hike/i.test(t) ? 'walk' : 'other';
const out = (Array.isArray(list) ? list : []).filter(a => a && a.start_date_local).map(a => ({
  id: 'sync:' + a.id, d: String(a.start_date_local).slice(0, 10), sport: sportOf(a.type || ''), type: a.type || '',
  min: Math.round((a.moving_time || a.elapsed_time || 0) / 60), dist: a.distance ? Math.round(a.distance / 10) / 100 : 0,
  kcal: a.calories ? Math.round(a.calories) : 0, hr: a.average_heartrate ? Math.round(a.average_heartrate) : null, title: a.name || ''
}));
if (!existsSync(DIR)) mkdirSync(DIR);
const fp = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 16);
const old = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE)).fp : '';
console.log(`Found ${out.length} activities between ${oldest} and ${newest}.`);
if (!out.length) console.log('>>> intervals.icu has no activities yet. Check that Garmin is connected there (Settings → Connections) and that your workouts show in its calendar.');
const sameKey = existsSync(DATA_FILE) && decrypts(JSON.parse(readFileSync(DATA_FILE)));
if (old === fp && sameKey) { console.log('No changes since last sync.'); process.exit(0); }
if (!sameKey && existsSync(DATA_FILE)) console.log('Passphrase changed: re-locking the data with the new one.');
writeFileSync(DATA_FILE, JSON.stringify(encrypt({ at: new Date().toISOString(), activities: out })));
writeFileSync(META_FILE, JSON.stringify({ fp, at: new Date().toISOString(), count: out.length }));
console.log('Saved encrypted activities.');
