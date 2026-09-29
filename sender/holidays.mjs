// Fetches India's public holidays from Google's public holiday calendar and saves them for the app.
// Run by GitHub Actions once a week (see .github/workflows/holidays.yml).
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_ICS = 'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

export function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') { if (ev && ev.d && ev.n) out.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1);
      if (key === 'DTSTART') { const m = /(\d{4})(\d{2})(\d{2})/.exec(val); if (m) ev.d = `${m[1]}-${m[2]}-${m[3]}`; }
      else if (key === 'SUMMARY') ev.n = unesc(val).trim();
      else if (key === 'DESCRIPTION') ev.desc = unesc(val);
    }
  }
  return out.map(e => ({ d: e.d, n: e.n, t: /public holiday|gazetted/i.test(e.desc || '') ? 'public' : /restricted/i.test(e.desc || '') ? 'restricted' : 'observance' }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await fetch(URL_ICS);
  if (!r.ok) { console.log('Could not download the holiday calendar:', r.status); process.exit(1); }
  const all = parseIcs(await r.text());
  const now = new Date(), from = new Date(now); from.setDate(from.getDate() - 60);
  const to = new Date(now); to.setDate(to.getDate() + 450);
  const iso = d => d.toISOString().slice(0, 10);
  const seen = new Set();
  const events = all.filter(e => e.d >= iso(from) && e.d <= iso(to)).filter(e => { const k = e.d + e.n; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../data/holidays.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), source: 'Google Calendar: Holidays in India', events }, null, 1));
  console.log(`Saved ${events.length} holidays (${events.filter(e => e.t === 'public').length} public).`);
}
