/* Attention — thirty days on the trail, plus random mindful check-ins. */
(function () {
  'use strict';

  var STORE_KEY = 'attention.v1';
  var APP_VERSION = '17';
  var PINGS = 10; // random check-in pings per day (keep in step with config.json)
  var PING_INFO = 'A good-morning ping at 9am to set your daily goal, then 10 mindful pings at random times until 9pm. In between, a movement snack every 30 minutes: yoga, cardio, strength or stretching, no equipment needed.';

  // ---------- state ----------
  function blankDays() {
    var d = {};
    for (var i = 1; i <= 30; i++) d[i] = { sit: false, singleTask: false, sprint: false, note: '' };
    return d;
  }
  function fresh() {
    var s = { v: 1, startDate: '2026-09-23', days: blankDays(), checkins: [] };
    s.days[1].sit = true; s.days[1].note = 'Random things';
    return s;
  }
  var state;
  // ---------- storage: every change is saved at once to two places on the phone,
  // plus one automatic snapshot per day (the last 14 are kept) ----------
  var fromLocal = null;
  try { fromLocal = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
  state = fromLocal || fresh();
  var IDB = null;
  function idb() {
    if (IDB) return IDB;
    IDB = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no indexedDB'));
      var r = indexedDB.open('attention', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    IDB.catch(function () {});
    return IDB;
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', mode), st = tx.objectStore('kv'), out = fn(st);
        tx.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(k) { return idbDo('readonly', function (st) { return st.get(k); }); }
  function idbPut(k, v) { return idbDo('readwrite', function (st) { st.put(v, k); }); }
  function idbDel(k) { return idbDo('readwrite', function (st) { st.delete(k); }); }
  function idbKeys() { return idbDo('readonly', function (st) { return st.getAllKeys(); }); }
  var mirrorT;
  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    clearTimeout(mirrorT);
    mirrorT = setTimeout(mirror, 300);
  }
  function mirror() {
    var copy = JSON.parse(JSON.stringify(state));
    idbPut('state', copy).then(function () {
      var today = 'snap-' + dkey(new Date());
      return idbPut(today, copy).then(idbKeys).then(function (keys) {
        var snaps = keys.filter(function (k) { return String(k).indexOf('snap-') === 0; }).sort();
        return Promise.all(snaps.slice(0, Math.max(0, snaps.length - 14)).map(idbDel));
      });
    }).catch(function () {});
  }
  function hasData(st) { return st && ((st.checkins && st.checkins.length) || Object.keys(st.goals || {}).length || Object.keys(st.days || {}).some(function (k) { var d = st.days[k]; return d.sit || d.singleTask || d.sprint || d.note; })); }
  // If this phone's quick storage was wiped but the second copy survived, bring it back.
  idbGet('state').then(function (copy) {
    if (copy && (!fromLocal || (copy.savedAt || 0) > (state.savedAt || 0))) {
      state = copy;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
      render(); if (!fromLocal && hasData(copy)) toast('Your data was restored');
    } else if (fromLocal) mirror();
  }).catch(function () {});
  var persisted = null;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (p) { persisted = p; }).catch(function () {});
  window.addEventListener('pagehide', function () { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} mirror(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} mirror(); } });

  var ui = { tab: 'trail', sel: null, timer: null };

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function startDate() { return new Date(state.startDate + 'T00:00:00'); }
  function dayNumFor(date) {
    var s = startDate();
    var t = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((t - s) / 86400000) + 1;
  }
  function todayNum() { return Math.min(Math.max(dayNumFor(new Date()), 1), 30); }
  function dateOf(n) { var d = startDate(); d.setDate(d.getDate() + n - 1); return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }); }
  function phaseFor(n) { return n <= 5 ? 1 : n <= 12 ? 2 : n <= 20 ? 3 : 4; }
  var Z = {
    1: { name: 'Ring 1 · Notice', desc: 'Just notice, don’t fix.', first: 1, last: 5 },
    2: { name: 'Ring 2 · Single-task', desc: 'Add a single-tasking rule.', first: 6, last: 12 },
    3: { name: 'Ring 3 · Sprint', desc: 'Extend the sit, add a focus sprint.', first: 13, last: 20 },
    4: { name: 'Ring 4 · Stack', desc: 'Stack it, and start noticing your triggers.', first: 21, last: 30 }
  };
  function checkinsOn(n) { return state.checkins.filter(function (c) { return dayNumFor(new Date(c.t)) === n; }); }
  // ---------- daily goal ----------
  function dkey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayDate(n) { var d = startDate(); d.setDate(d.getDate() + n - 1); return d; }
  function goalFor(key) { return (state.goals || {})[key]; }
  function todayGoal() { return goalFor(dkey(new Date())); }
  function isAchievedText(t) { return /^\s*achieved[.!\s]*$/i.test(t || ''); }
  function setGoal(text) {
    state.goals = state.goals || {};
    var k = dkey(new Date()), g = state.goals[k];
    if (g) g.text = text; else state.goals[k] = { text: text, setAt: new Date().toISOString(), updates: [], achievedAt: null };
  }
  function goalUpdate(text, achieved) {
    var g = todayGoal(); if (!g) return;
    text = (text || '').trim();
    if (isAchievedText(text)) { achieved = true; text = ''; }
    if (text) g.updates.push({ t: new Date().toISOString(), text: text });
    if (achieved && !g.achievedAt) g.achievedAt = new Date().toISOString();
  }
  function syncGoal() {
    try {
      var g = todayGoal();
      caches.open('attention-data').then(function (c) {
        return c.put('goal.json', new Response(JSON.stringify(g && !g.achievedAt ? { day: dkey(new Date()), text: g.text } : {}), { headers: { 'Content-Type': 'application/json' } }));
      }).catch(function () {});
    } catch (e) {}
  }
  function timeOf(iso) { return new Date(iso).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }); }

  function dayXp(n) {
    var d = state.days[n], pn = phaseFor(n), xp = 0, need = 2, got = 0;
    if (d.sit) { xp += 10; got++; }
    if ((d.note || '').trim()) { xp += 5; got++; }
    if (pn >= 2) { need++; if (d.singleTask) { xp += 15; got++; } }
    if (pn >= 3) { need++; if (d.sprint) { xp += 20; got++; } }
    if (got === need) xp += 10;
    xp += Math.min(checkinsOn(n).length, PINGS) * 5;
    var g = goalFor(dkey(dayDate(n)));
    if (g) { xp += 5; if (g.achievedAt) xp += 20; }
    xp += Math.min(movesOn(dkey(dayDate(n))).length, 12) * 5;
    xp += Math.min(trainingOn(dkey(dayDate(n))), 2) * 10;
    return xp;
  }
  function totalXp() { var t = 0; for (var i = 1; i <= 30; i++) t += dayXp(i); return t; }
  var LEVELS = [[0, 'Learner'], [40, 'Rookie'], [110, 'Club Racer'], [230, 'Privateer'], [400, 'Works Rider'], [620, 'Podium'], [900, 'Champion'], [1250, 'Legend']];
  function levelFor(xp) {
    var i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
    var nx = LEVELS[i + 1];
    return { num: i + 1, title: LEVELS[i][1], floor: LEVELS[i][0], next: nx ? nx[0] : null, nextTitle: nx ? nx[1] : null };
  }
  function streak() {
    var t = todayNum(), s = 0, i = state.days[t].sit ? t : t - 1;
    for (; i >= 1; i--) { if (state.days[i].sit) s++; else break; }
    return s;
  }
  function bestStreak() { var b = 0, r = 0; for (var i = 1; i <= 30; i++) { if (state.days[i].sit) { r++; b = Math.max(b, r); } else r = 0; } return b; }

  var toastT;
  function toast(text) {
    var el = document.getElementById('toast');
    el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" fill="#FFB23F"/></svg><span>' + esc(text) + '</span>';
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2000);
  }
  function mutate(fn) {
    var before = totalXp(), lv = levelFor(before).num;
    fn(); save(); syncGoal();
    var after = totalXp(), nl = levelFor(after);
    if (nl.num > lv) toast('Level up · ' + nl.title);
    else if (after > before) toast('+' + (after - before) + ' XP');
    render();
  }

  // ---------- race view ----------
  var SEC = { 1: '#12A39A', 2: '#F28C28', 3: '#FF6B57', 4: '#E8457A' };
  var ICON = {
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    three: 'M8 6h8l-4.5 5a4.5 4.5 0 1 1-3.5 7.5',
    seven: 'M7 5h10l-6 14',
    wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.3-.6-.6-2.3z',
    gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4.5-5M7 17h.01M17 17h.01',
    curve: 'M5 20c1-8 6-9 9-9s6-2 6-7M4 20h3',
    cup: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8.5 20h7',
    helmet: 'M3.5 16a8.5 8.5 0 0 1 17 0v2h-17zM12 16h8.5M7 11.5h7',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    grid4: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'
  };
  var FLAME = 'M12 2c2 4-3 5-3 9a3 3 0 1 0 6 0c0-1-1-2-1-3 2 1 3 3 3 5a5 5 0 0 1-10 0c0-5 3-6 5-11z';

  // ---------- tropical UI helpers ----------
  var T = { jungle: '#0F4D40', lagoon: '#12A39A', coral: '#FF6B57', mango: '#FFB23F', hib: '#E8457A', sand: '#FBF1E3', ink: '#16302A' };
  var SEC = { 1: '#12A39A', 2: '#F28C28', 3: '#FF6B57', 4: '#E8457A' };
  var CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
  function sun(col, size, right, top) { return '<span class="sun" aria-hidden="true" style="width:' + size + 'px;height:' + size + 'px;background:' + col + ';right:' + right + 'px;top:' + top + 'px"></span>'; }
  function wave(col, op, h, y) {
    var p = function (a) { return 'M0 ' + a + ' C 40 ' + (a - 12) + ', 80 ' + (a + 12) + ', 118 ' + a + ' S 196 ' + (a - 12) + ', 236 ' + a + ' S 314 ' + (a + 12) + ', 354 ' + a + ' L354 ' + h + ' L0 ' + h + ' Z'; };
    return '<svg class="wave" aria-hidden="true" width="100%" height="' + h + '" viewBox="0 0 354 ' + h + '" preserveAspectRatio="none"><path d="' + p(y) + '" fill="' + col + '" fill-opacity="' + op + '"/><path d="' + p(y + 10) + '" fill="' + col + '" fill-opacity="' + op + '"/></svg>';
  }
  // one list row; o = { t, sub, v, sheet, tab, dot, lead }
  function row(o) {
    var link = o.sheet || o.tab, attrs = o.sheet ? ' data-sheet="' + o.sheet + '"' : o.tab ? ' data-tab-go="' + o.tab + '"' : '';
    var tag = link ? 'button' : 'div';
    return '<' + tag + (link ? ' type="button"' : '') + ' class="r"' + attrs + '>' + (o.lead || '') + (o.dot ? '<span class="dot" style="background:' + o.dot + '"></span>' : '') +
      '<span class="t">' + o.t + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span>' + (o.v != null && o.v !== '' ? '<span class="v">' + o.v + '</span>' : '') + (link ? CHEV : '') + '</' + tag + '>';
  }
  function fmtN(x) { return Math.round(x || 0).toLocaleString('en'); }
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  }
  function myName() { return state.name || 'Shravan'; }
  function topbar(label) {
    return '<header class="top"><span class="cap">' + label + '</span><button type="button" class="av" data-tab-go="settings" aria-label="Settings">' + esc(myName().charAt(0).toUpperCase()) + '</button></header>';
  }
  // 30 short arcs, one per day
  function dayRing(size, sw) {
    var C = size / 2, R = C - sw, h = '', today = todayNum();
    var pt = function (a) { var t = (a - 90) * Math.PI / 180; return (C + R * Math.cos(t)).toFixed(2) + ' ' + (C + R * Math.sin(t)).toFixed(2); };
    for (var i = 1; i <= 30; i++) {
      var d = state.days[i], col = d.sit ? '#FFFFFF' : i === today ? T.mango : i < today ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.14)';
      h += '<path d="M' + pt((i - 1) * 12 + 2.2) + ' A' + R + ' ' + R + ' 0 0 1 ' + pt(i * 12 - 2.2) + '" stroke="' + col + '" stroke-width="' + sw + '" fill="none" stroke-linecap="round"/>';
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + h + '</svg>';
  }
  function greet() { var h = new Date().getHours(); return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,'; }
  function questsFor(n) {
    var pn = phaseFor(n), sitM = pn <= 2 ? 5 : pn === 3 ? 10 : 15, sprM = pn === 3 ? 20 : 25;
    var q = [{ f: 'sit', n: 'Sit quietly', dd: sitM + ' min · just notice', xp: 10, mins: sitM }];
    if (pn >= 2) q.push({ f: 'singleTask', n: 'One thing, fully', dd: 'no phone while you do it', xp: 15 });
    if (pn >= 3) q.push({ f: 'sprint', n: 'Focus sprint', dd: sprM + ' min · one task only', xp: 20, mins: sprM });
    return q;
  }
  function questRow(q, d, n, locked) {
    var today = todayNum();
    return '<div class="r"><label class="ql"><input class="qchk" type="checkbox" data-q="' + q.f + '"' + (d[q.f] ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
      '<span class="t' + (d[q.f] ? ' done' : '') + '">' + q.n + '<small>' + q.dd + '</small></span></label>' +
      (q.mins && !d[q.f] && n === today ? '<button type="button" class="gob" data-begin="' + q.f + '" data-mins="' + q.mins + '" aria-label="Start the ' + q.n + ' timer">' + PLAY + '</button>' : '<span class="v">+' + q.xp + '</span>') + '</div>';
  }
  function timerBlock() {
    var t = ui.timer; if (!t) return '';
    var m = Math.floor(t.remaining / 60), s = t.remaining % 60;
    return '<div class="timer"><div class="ring"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="5"/><circle id="tRing" cx="32" cy="32" r="27" fill="none" stroke="' + T.mango + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="' + (169.6 * (1 - t.remaining / t.total)).toFixed(1) + '"/></svg><span id="tText">' + m + ':' + (s < 10 ? '0' : '') + s + '</span></div>' +
      '<div style="flex:1;display:flex;flex-direction:column;gap:8px"><span style="font-size:14px">' + (t.kind === 'sit' ? 'Sitting quietly' : 'Focus sprint') + '. Breathing is enough. Finish for +' + (t.kind === 'sit' ? 10 : 20) + ' XP.</span><button type="button" class="btn small ghostw" id="stopT" style="align-self:flex-start">Stop</button></div></div>';
  }

  function renderToday() {
    var today = todayNum(), st = streak(), d = state.days[today], key = dkey(new Date());
    var h = '<div class="stack">' + topbar(new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' }));
    h += '<button type="button" class="hero tall" data-sheet="progress" aria-label="Your 30-day progress" style="background:' + T.jungle + ';color:#fff">' + sun(T.mango, 150, -40, -50) + wave(T.lagoon, .45, 56, 26) +
      '<span class="cap">Day ' + today + ' of 30' + (st ? ' · ' + st + '-day streak' : '') + '</span>' +
      '<span class="hrow"><span class="dring">' + dayRing(112, 6) + '<b class="display">' + today + '</b></span><span class="display greet">' + greet() + '<br><i>' + esc(myName()) + '</i></span></span></button>';
    h += goalCard();
    h += timerBlock();
    var hasNote = !!(d.note || '').trim();
    h += '<div class="list">' + questsFor(today).map(function (q) { return questRow(q, d, today, false); }).join('') +
      row({ t: 'Journal', sub: hasNote ? esc(d.note) : 'what pulled you away today?', v: hasNote ? '✓' : '+5', sheet: 'day' }) + '</div>';
    var mvN = LIB ? movesOn(key).length : 0, cN = checkinsOn(today).length, bc = bodyCalc(), eaten = sumItems(foodDay(key).filter(function (i) { return !i.planned; }));
    h += '<div class="chips">' +
      '<button type="button" class="chip" data-sheet="move" style="background:#FFE6B8"><b class="display">' + mvN + '</b><small>moves today</small></button>' +
      '<button type="button" class="chip" data-tab-go="log" style="background:#CDEFEA"><b class="display">' + cN + '<span>/' + PINGS + '</span></b><small>check-ins</small></button>' +
      '<button type="button" class="chip" data-tab-go="fit:food" style="background:#FFD9D3"><b class="display">' + (bc ? fmtN(Math.max(0, bc.kcal - eaten.kcal)) : fmtN(eaten.kcal)) + '</b><small>' + (bc ? 'kcal left' : 'kcal eaten') + '</small></button></div>';
    return h + '</div>';
  }

  function goalCard() {
    var g = todayGoal();
    var open = function (bg, cap, text, extra, go) {
      return '<button type="button" class="hero goalc" data-goal="open" style="background:' + bg + ';color:#fff">' + sun('rgba(255,255,255,.18)', 90, -26, -30) +
        '<span class="cap">' + cap + '</span><span class="display gt">' + text + '</span>' + (extra || '') + '<span class="go">' + go + '</span></button>';
    };
    if (!g) return open(T.coral, 'Today’s target · +5 XP', 'What’s the one thing you want to get done today?', '', 'Set today’s target →');
    if (g.achievedAt) return open(T.lagoon, 'Target hit · ' + timeOf(g.achievedAt), esc(g.text), '', 'See how it went →');
    var last = g.updates[g.updates.length - 1];
    return open(T.coral, 'Today’s target', esc(g.text), last ? '<span class="gl">Latest: ' + esc(last.text) + '</span>' : '', 'Add an update →');
  }

  // --- Today detail sheets ---
  function progressSheet() {
    var xp = totalXp(), lv = levelFor(xp), today = todayNum(), done = 0;
    for (var i = 1; i <= 30; i++) if (state.days[i].sit) done++;
    var pct = lv.next ? Math.round((xp - lv.floor) / (lv.next - lv.floor) * 100) : 100;
    var h = '<div class="hero center" style="background:' + T.jungle + ';color:#fff">' + sun(T.mango, 120, -30, -40) +
      '<span class="dring big">' + dayRing(210, 10) + '<span class="mid"><b class="display">' + done + '</b><span class="cap">days done</span></span></span></div>';
    h += '<div class="lvl"><div class="row between"><b>' + lv.title + (lv.next ? ' → ' + lv.nextTitle : '') + '</b><span class="cap">' + (lv.next ? xp + ' / ' + lv.next + ' XP' : xp + ' XP') + '</span></div><div class="bar" style="background:#F1E6D6"><i style="width:' + pct + '%;background:' + T.coral + '"></i></div></div>';
    h += '<h3 class="sh">Thirty days <span class="cap">tap a day</span></h3><div class="daygrid">';
    for (var n = 1; n <= 30; n++) {
      var dd = state.days[n], cls = dd.sit ? 'on' : n === today ? 'now' : n < today ? 'miss' : '';
      h += '<button type="button" class="dg ' + cls + '" data-day="' + n + '" aria-label="Day ' + n + ', ' + dateOf(n) + (dd.sit ? ', done' : n === today ? ', today' : n < today ? ', missed' : '') + '">' + n + '</button>';
    }
    h += '</div><h3 class="sh">Phases</h3><div class="list">';
    [1, 2, 3, 4].forEach(function (p) {
      var z = Z[p], c = 0; for (var j = z.first; j <= z.last; j++) if (state.days[j].sit) c++;
      h += row({ t: z.name, sub: z.desc, v: c + '/' + (z.last - z.first + 1), dot: SEC[p] });
    });
    h += '</div>';
    // badges
    var sits = 0, sprints = 0, p1 = 0; for (var k = 1; k <= 30; k++) { if (state.days[k].sit) sits++; if (state.days[k].sprint) sprints++; if (k <= 5 && state.days[k].sit) p1++; }
    var nMv = (state.moves || []).filter(function (m) { return !m.skipped; }).length, allRound = false, perDay = {};
    (state.moves || []).forEach(function (m) { if (m.skipped) return; var dk = dkey(new Date(m.t)); (perDay[dk] = perDay[dk] || {})[m.cat] = 1; });
    Object.keys(perDay).forEach(function (dk) { if (Object.keys(perDay[dk]).length >= 4) allRound = true; });
    var best = bestStreak(), nC = state.checkins.length, nG = Object.keys(state.goals || {}).filter(function (x) { return state.goals[x].achievedAt; }).length;
    var B = [['First sit', 'flag', T.lagoon, sits >= 1, '0/1 sit'], ['Hat-trick', 'three', '#F28C28', best >= 3, Math.min(best, 3) + '/3 days'], ['Seven straight', 'seven', T.coral, best >= 7, Math.min(best, 7) + '/7 days'],
      ['Ten check-ins', 'wrench', T.lagoon, nC >= 10, Math.min(nC, 10) + '/10'], ['Flat out', 'gauge', T.jungle, sprints >= 1, '0/1 sprint'], ['Phase one', 'curve', T.hib, p1 >= 5, p1 + '/5 sits'],
      ['Five targets', 'cup', T.mango, nG >= 5, Math.min(nG, 5) + '/5'], ['Full distance', 'helmet', T.jungle, sits >= 30, sits + '/30'],
      ['Mover', 'bolt', T.coral, nMv >= 25, Math.min(nMv, 25) + '/25 moves'], ['All-rounder', 'grid4', T.hib, allRound, 'all 4 in a day']];
    var earned = B.filter(function (b) { return b[3]; }).length;
    h += '<h3 class="sh">Badges <span class="cap">' + earned + ' of ' + B.length + '</span></h3><div class="badges">';
    B.forEach(function (b) {
      h += '<div class="badge"><div class="roundel' + (b[3] ? ' on' : '') + '" style="' + (b[3] ? 'background:' + b[2] : '') + '"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[b[1]] + '" fill="none" stroke="' + (b[3] ? '#fff' : '#B9C4BD') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<b>' + b[0] + '</b><small>' + (b[3] ? 'Earned' : b[4]) + '</small></div>';
    });
    h += '</div><p class="muted small">XP: sit +10 · one thing fully +15 · focus sprint +20 · journal +5 · check-in +5 (up to ' + PINGS + ' a day) · perfect day +10 · daily target set +5, hit +20 · movement snack +5 · training session +10.</p>';
    return { title: 'Progress', cap: 'Day ' + today + ' / 30', html: h, bind: function (r) { bindTrail(r, today); } };
  }

  function daySheet(sel) {
    var today = todayNum(), d = state.days[sel], pn = phaseFor(sel), locked = sel > today, qs = questsFor(sel);
    var hasNote = !!(d.note || '').trim(), flags = qs.map(function (q) { return d[q.f]; }).concat([hasNote]);
    var got = flags.filter(Boolean).length, perfect = got === flags.length, cins = checkinsOn(sel).length;
    var h = '<p class="muted" style="margin:0">' + Z[pn].name + ' · ' + Z[pn].desc + '</p>';
    if (locked) h += '<div class="notice">This day opens on ' + dateOf(sel) + '. Here’s what’s waiting.</div>';
    h += '<div class="list">' + qs.map(function (q) { return questRow(q, d, sel, locked); }).join('') +
      row({ t: 'Mindful check-ins', sub: 'from your pings', v: cins + '/' + PINGS }) + '</div>';
    h += '<div class="stack" style="gap:8px"><label for="journal" class="lab">Journal: what pulled your attention away? <span class="muted">+5</span></label>' +
      '<textarea class="text" id="journal" placeholder="a thought, a ping, a craving…"' + (locked ? ' disabled' : '') + '>' + esc(d.note) + '</textarea></div>';
    h += '<div class="perfect' + (perfect ? ' on' : '') + '"><div style="flex:1"><span style="font-size:14px;font-weight:600">' + (perfect ? 'Perfect day. Bonus claimed.' : 'Perfect day bonus: ' + got + ' of ' + flags.length) + '</span><div class="segs" aria-hidden="true">' +
      flags.map(function (f) { return '<i' + (f ? ' class="on"' : '') + '></i>'; }).join('') + '</div></div><span class="cap" style="color:inherit">+10</span></div>';
    return { title: sel === today ? 'Today' : 'Day ' + sel, cap: dateOf(sel), html: h, bind: function (r) { bindTrail(r, sel); } };
  }

  function bindTrail(view, sel) {
    var mn = view.querySelector('#moveNow'); if (mn) mn.addEventListener('click', function () { openMove(suggestMove()); });
    view.querySelectorAll('[data-q]').forEach(function (cb) {
      cb.addEventListener('change', function () { var f = cb.dataset.q, v = cb.checked; mutate(function () { state.days[sel][f] = v; }); });
    });
    var j = view.querySelector('#journal');
    if (j) {
      var had = !!(state.days[sel].note || '').trim();
      j.addEventListener('input', function () { state.days[sel].note = j.value; save(); });
      j.addEventListener('change', function () { if (!had && j.value.trim()) toast('+5 XP'); render(); });
    }
    view.querySelectorAll('[data-begin]').forEach(function (b) {
      b.addEventListener('click', function () { closeSheet(); ui.tab = 'trail'; startTimer(sel, b.dataset.begin, +b.dataset.mins); window.scrollTo(0, 0); });
    });
    var stop = view.querySelector('#stopT');
    if (stop) stop.addEventListener('click', function () { clearInterval(ui.timer.iv); ui.timer = null; render(); });
    view.querySelectorAll('[data-goal]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.goal === 'win') mutate(function () { goalUpdate('', true); });
        else openGoal();
      });
    });
    view.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () { ui.sel = +b.dataset.day; openSheet('day'); });
    });
  }
  function startTimer(day, kind, mins) {
    if (ui.timer) clearInterval(ui.timer.iv);
    ui.timer = { day: day, kind: kind, remaining: mins * 60, total: mins * 60, iv: setInterval(tick, 1000) };
    render();
  }
  function tick() {
    var t = ui.timer; if (!t) return;
    t.remaining--;
    if (t.remaining <= 0) {
      clearInterval(t.iv); ui.timer = null;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      mutate(function () { state.days[t.day][t.kind] = true; });
      return;
    }
    var tx = document.getElementById('tText'), rg = document.getElementById('tRing');
    if (tx) { var m = Math.floor(t.remaining / 60), s = t.remaining % 60; tx.textContent = m + ':' + (s < 10 ? '0' : '') + s; }
    if (rg) rg.setAttribute('stroke-dashoffset', (169.6 * (1 - t.remaining / t.total)).toFixed(1));
  }

  // ---------- check-in flow ----------
  var DISTRACTIONS = ['Phone / notifications', 'Social media', 'Work worries', 'Planning ahead', 'Replaying the past', 'People around me', 'Tired or hungry', 'Daydreaming', 'Noise / surroundings', 'Nothing, I was present'];
  var DCOL = ['#FF6B57', '#E8457A', '#0F4D40', '#12A39A', '#F28C28', '#B83280', '#C98A12', '#5B7BD5', '#6F7D74', '#2BB673'];
  var ci = null;
  function openCheckin() {
    if (typeof stopMoveTimer === 'function') { stopMoveTimer(); mv = null; }
    var dr = state.ciDraft;
    if (dr && Date.now() - dr.at < 10 * 60000) { ci = Object.assign({ stage: 'reflect', secs: 60, running: false, left: 60 }, dr.ci); drawCheckin(); document.getElementById('overlay').hidden = false; document.body.style.overflow = 'hidden'; return; }
    var tg = todayGoal();
    ci = { stage: tg && !tg.achievedAt ? 'goal' : 'breathe', secs: 60, running: false, left: 60, picks: [], presence: 0, note: '', gUpd: '', gWin: false, gNew: '' };
    drawCheckin();
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeCheckin() {
    gv = null;
    document.getElementById('overlay').classList.remove('dark');
    if (ci && ci.iv) clearInterval(ci.iv);
    if (ci && ci.bt) clearTimeout(ci.bt);
    ci = null;
    document.getElementById('overlay').hidden = true;
    document.body.style.overflow = '';
    if (location.search) history.replaceState(history.state, '', location.pathname);
  }
  function drawCheckin() {
    var o = document.getElementById('overlay'), h = '<div class="inner">';
    o.classList.toggle('dark', ci.stage === 'breathe');
    h += '<div class="row between"><span class="eyebrow">Mindful check-in</span><div class="row" style="gap:8px">' + (ci.stage === 'reflect' ? '<button type="button" class="btn ghost small" id="ciDiscard">Discard</button>' : '') + '<button type="button" class="btn ghost small" id="ciClose">Close</button></div></div>';
    if (ci.stage === 'reflect') h += '<span class="muted" style="font-size:12px;margin-top:-10px">Saved as you type. Close any time and come back.</span>';
    if (ci.stage === 'goal') {
      var gg = todayGoal(), lu = gg.updates[gg.updates.length - 1];
      h += '<section class="card goal" style="gap:10px"><span class="eyebrow">Goal check · 1 of 3</span><p class="gtext">' + esc(gg.text) + '</p>' +
        (lu ? '<div class="upd"><span style="font-family:var(--mono);font-size:11px;color:#7A4B00">LAST UPDATE · ' + timeOf(lu.t) + '</span><span style="font-size:14px">' + esc(lu.text) + '</span></div>' : '') + '</section>';
      h += '<div class="stack" style="gap:8px"><label for="gcText"><h1 style="font-size:22px">How’s it going?</h1></label><textarea class="text" id="gcText" style="min-height:90px;font-size:16px" placeholder="e.g. base plate done, clamps next · or type “achieved”"></textarea></div>';
      h += '<button type="button" class="btn solid" id="gcSave">Save update → breathe</button>';
      h += '<button type="button" class="btn" id="gcWin" style="background:var(--green);border-color:var(--green);color:#fff">✓ Achieved it · +20 XP</button>';
      h += '<button type="button" class="btn ghost" id="gcSkip">Skip the goal this time</button>';
    } else if (ci.stage === 'breathe') {
      h += '<div><h1>Pause here.</h1><p class="muted" style="margin:6px 0 0">Let whatever you were doing wait for a minute. Just follow the light.</p></div>';
      h += '<div class="breath"><svg class="rings" id="orb" viewBox="0 0 260 260" width="260" height="260" aria-hidden="true"><g><circle cx="130" cy="130" r="24" fill="none" stroke="#FFD27A" stroke-width="7" stroke-linecap="round" stroke-dasharray="18.1 7.0"/></g><g class="rev"><circle cx="130" cy="130" r="37" fill="none" stroke="#FFB23F" stroke-width="7" stroke-linecap="round" stroke-dasharray="20.9 8.1"/></g><g><circle cx="130" cy="130" r="50" fill="none" stroke="#FF9A4D" stroke-width="7" stroke-linecap="round" stroke-dasharray="22.6 8.8"/></g><g class="rev"><circle cx="130" cy="130" r="63" fill="none" stroke="#FF6B57" stroke-width="7" stroke-linecap="round" stroke-dasharray="23.8 9.2"/></g><g><circle cx="130" cy="130" r="76" fill="none" stroke="#F0587A" stroke-width="7" stroke-linecap="round" stroke-dasharray="24.6 9.6"/></g><g class="rev"><circle cx="130" cy="130" r="89" fill="none" stroke="#C95B9A" stroke-width="7" stroke-linecap="round" stroke-dasharray="25.2 9.8"/></g><g><circle cx="130" cy="130" r="102" fill="none" stroke="#3FB3A6" stroke-width="7" stroke-linecap="round" stroke-dasharray="25.6 10.0"/></g><g class="rev"><circle cx="130" cy="130" r="115" fill="none" stroke="#12A39A" stroke-width="7" stroke-linecap="round" stroke-dasharray="26.0 10.1"/></g></svg><svg class="prog" viewBox="0 0 260 260" width="260" height="260" aria-hidden="true"><circle id="ciRing" cx="130" cy="130" r="127" fill="none" stroke="#FFB23F" stroke-width="3" stroke-linecap="round" stroke-dasharray="798" stroke-dashoffset="798"/></svg>' +
        '<div class="cue" aria-live="polite"><b id="cue">' + (ci.running ? 'Breathe in' : 'Ready') + '</b><span id="left">' + fmt(ci.left) + '</span></div></div>';
      if (!ci.running) {
        h += '<div class="seg" role="group" aria-label="Length"><button type="button" data-secs="60" class="' + (ci.secs === 60 ? 'on' : '') + '">1 minute</button><button type="button" data-secs="120" class="' + (ci.secs === 120 ? 'on' : '') + '">2 minutes</button></div>';
        h += '<button type="button" class="btn solid" id="ciStart">Begin</button><button type="button" class="btn ghost" id="ciSkip">Skip to reflection</button>';
      } else {
        h += '<button type="button" class="btn ghost" id="ciSkip">Finish early</button>';
      }
    } else {
      var g = todayGoal();
      if (g && !g.achievedAt && ci.asked) {
        h += '<div class="notice"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#FFB23F" stroke="#16302A" stroke-width="1.4"/></svg><span>Goal: ' + esc(g.text) + (g.updates.length ? ' · last update ' + timeOf(g.updates[g.updates.length - 1].t) : '') + '</span></div>';
      } else if (g && !g.achievedAt) {
        h += '<section class="card stack" style="gap:10px"><span class="eyebrow">Today’s goal</span><p style="margin:0;font-family:var(--serif);font-size:18px;line-height:1.3">' + esc(g.text) + '</p>' +
          '<label for="ciGoal" style="font-size:14px;color:var(--bone2)">How’s it going? <span class="muted">(type “achieved” when it’s done)</span></label>' +
          '<textarea class="text" id="ciGoal" placeholder="e.g. drafted two sections, stuck on the budget">' + esc(ci.gUpd) + '</textarea>' +
          '<button type="button" class="dchip" id="ciWin" aria-pressed="' + ci.gWin + '" style="align-self:flex-start">' + (ci.gWin ? '✓ Achieved' : 'Mark as achieved') + '</button></section>';
      } else if (g) {
        h += '<div class="notice" style="color:var(--ember)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#FF6B57" stroke="#FF6B57" stroke-width="1.6"/></svg><span>Goal achieved at ' + timeOf(g.achievedAt) + '. Just the check-in now.</span></div>';
      } else {
        h += '<section class="card stack" style="gap:8px"><label for="ciGoalNew" style="font-size:14px;color:var(--bone2)">No goal set for today. Add one? <span class="muted">(optional)</span></label><input class="text" id="ciGoalNew" type="text" value="' + esc(ci.gNew) + '" placeholder="the one thing you want to get done"></section>';
      }
      h += '<div><h1>What pulled you away?</h1><p class="muted" style="margin:6px 0 0">No judgement. Noticing is the practice.</p></div>';
      h += '<div class="stack" style="gap:10px"><span style="font-size:14px;color:var(--bone2)">Just before the ping, how present were you?</span><div class="scale" role="group" aria-label="Presence from 1 to 5">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-pres="' + n + '" aria-pressed="' + (ci.presence === n) + '">' + n + '</button>'; }).join('') +
        '</div><div class="row between muted" style="font-size:12px"><span>Lost in thought</span><span>Fully here</span></div></div>';
      h += '<div class="stack" style="gap:10px"><span style="font-size:14px;color:var(--bone2)">What was on your mind? Pick any.</span><div class="dchips">' +
        DISTRACTIONS.map(function (d, i) { return '<button type="button" class="dchip" style="--c:' + DCOL[i] + '" data-pick="' + i + '" aria-pressed="' + (ci.picks.indexOf(i) >= 0) + '">' + d + '</button>'; }).join('') + '</div></div>';
      h += '<div class="stack" style="gap:8px"><label for="ciNote" style="font-size:14px;color:var(--bone2)">Anything else? <span class="muted">(optional)</span></label><textarea class="text" id="ciNote" placeholder="e.g. kept checking email for a reply">' + esc(ci.note) + '</textarea></div>';
      h += '<button type="button" class="btn solid" id="ciSave">Save check-in · +5 XP</button>';
    }
    h += '</div>';
    o.innerHTML = h;
    o.querySelector('#ciClose').onclick = function () { saveNote(); closeCheckin(); };
    var dc = o.querySelector('#ciDiscard'); if (dc) dc.onclick = function () { delete state.ciDraft; save(); closeCheckin(); };
    o.querySelectorAll('[data-secs]').forEach(function (b) { b.onclick = function () { ci.secs = +b.dataset.secs; ci.left = ci.secs; drawCheckin(); }; });
    var st = o.querySelector('#ciStart'); if (st) st.onclick = startBreath;
    var gcs = o.querySelector('#gcSave'), gcw = o.querySelector('#gcWin'), gck = o.querySelector('#gcSkip'), gct = o.querySelector('#gcText');
    function goalStep(win) {
      var t = gct.value, achieved = win || isAchievedText(t);
      if (t.trim() || win) mutate(function () { goalUpdate(t, win); });
      ci.asked = true; ci.stage = 'breathe'; drawCheckin();
      if (achieved) setTimeout(function () { toast('Goal achieved · +20 XP'); }, 2100);
      else if (t.trim()) toast('Update saved');
    }
    if (gcs) gcs.onclick = function () { if (!gct.value.trim()) { gct.focus(); return; } goalStep(false); };
    if (gcw) gcw.onclick = function () { goalStep(true); };
    if (gck) gck.onclick = function () { ci.asked = true; ci.stage = 'breathe'; drawCheckin(); };
    if (gct) setTimeout(function () { try { gct.focus(); } catch (e) {} }, 50);
    var sk = o.querySelector('#ciSkip'); if (sk) sk.onclick = function () { if (ci.iv) clearInterval(ci.iv); clearTimeout(ci.bt); ci.stage = 'reflect'; drawCheckin(); };
    o.querySelectorAll('[data-pres]').forEach(function (b) { b.onclick = function () { ci.presence = +b.dataset.pres; saveNote(); drawCheckin(); }; });
    o.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.pick, at = ci.picks.indexOf(i); if (at >= 0) ci.picks.splice(at, 1); else ci.picks.push(i); saveNote(); drawCheckin(); };
    });
    ['#ciNote', '#ciGoal', '#ciGoalNew'].forEach(function (id) { var el = o.querySelector(id); if (el) el.addEventListener('input', saveNote); });
    if (ci.stage === 'reflect' && !state.ciDraft) saveNote();
    var cw = o.querySelector('#ciWin'); if (cw) cw.onclick = function () { saveNote(); ci.gWin = !ci.gWin; drawCheckin(); };
    var sv = o.querySelector('#ciSave');
    if (sv) sv.onclick = function () {
      saveNote();
      var gU = ci.gUpd, gW = ci.gWin, gN = ci.gNew.trim(), ci_asked = !!ci.asked;
      var entry = { t: new Date().toISOString(), secs: ci.done || 0, presence: ci.presence || null, distractions: ci.picks.map(function (i) { return DISTRACTIONS[i]; }), note: ci.note.trim() };
      closeCheckin();
      mutate(function () {
        delete state.ciDraft;
        state.checkins.push(entry);
        if (gN && !todayGoal()) setGoal(gN);
        else if (todayGoal() && !todayGoal().achievedAt && !ci_asked) goalUpdate(gU, gW);
      });
      if (!ci_asked && (gW || isAchievedText(gU))) setTimeout(function () { toast('Goal achieved · +20 XP'); }, 2100);
    };
  }
  function saveNote() {
    if (!ci) return;
    var n = document.getElementById('ciNote'); if (n) ci.note = n.value;
    var a = document.getElementById('ciGoal'); if (a) ci.gUpd = a.value;
    var b = document.getElementById('ciGoalNew'); if (b) ci.gNew = b.value;
    if (ci.stage === 'reflect') { state.ciDraft = { at: Date.now(), ci: { picks: ci.picks.slice(), presence: ci.presence, note: ci.note, gUpd: ci.gUpd, gWin: ci.gWin, gNew: ci.gNew, done: ci.done || 0, asked: !!ci.asked } }; save(); }
  }

  // ---------- goal screen ----------
  var gv = null;
  function openGoal() {
    gv = { edit: !todayGoal() };
    drawGoal();
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function drawGoal() {
    var o = document.getElementById('overlay'); o.classList.remove('dark'); var g = todayGoal(), hr = new Date().getHours();
    var h = '<div class="inner"><div class="row between"><span class="eyebrow">Today’s goal · ' + new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + '</span><button type="button" class="btn ghost small" id="gClose">Close</button></div>';
    if (gv.edit) {
      h += '<div><h1>' + (g ? 'Edit today’s goal' : (hr < 12 ? 'Good morning.' : 'Set a goal for today.')) + '</h1><p class="muted" style="margin:6px 0 0">One clear thing. Each ping through the day will ask how it’s going.</p></div>' +
        '<label for="gText" class="sr">Goal</label><textarea class="text" id="gText" style="min-height:96px;font-size:17px" placeholder="e.g. finish the fixture drawing and send it for review">' + esc(g ? g.text : '') + '</textarea>' +
        '<button type="button" class="btn solid" id="gSet">' + (g ? 'Save goal' : 'Set goal · +5 XP') + '</button>';
    } else {
      h += '<div class="stack" style="gap:6px"><h1 style="line-height:1.25">' + esc(g.text) + '</h1><span class="muted" style="font-size:13px">Set at ' + timeOf(g.setAt) + (g.achievedAt ? ' · achieved at ' + timeOf(g.achievedAt) : '') + ' · <button type="button" class="link" id="gEdit">edit</button></span></div>';
      if (g.updates.length) {
        h += '<section class="card"><h2 style="margin-bottom:6px;font-size:17px">Progress</h2>' + g.updates.map(function (u) {
          return '<div class="entry"><span class="muted" style="font-size:12px">' + timeOf(u.t) + '</span><span style="font-size:14px">' + esc(u.text) + '</span></div>';
        }).join('') + '</section>';
      }
      if (!g.achievedAt) {
        h += '<div class="stack" style="gap:8px"><label for="gUpd" style="font-size:14px;color:var(--bone2)">Add an update <span class="muted">(or type “achieved”)</span></label><textarea class="text" id="gUpd" placeholder="where you are with it"></textarea>' +
          '<div class="row"><button type="button" class="btn" id="gAdd" style="flex:1">Save update</button><button type="button" class="btn solid" id="gWin" style="flex:1">Achieved · +20</button></div></div>';
      } else {
        h += '<div class="perfect on"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#FF6B57" stroke="#FF6B57" stroke-width="1.6"/></svg><span style="font-size:14px">Done. Progress checks have stopped for today; mindful check-ins carry on.</span></div>';
      }
    }
    h += '</div>';
    o.innerHTML = h;
    o.querySelector('#gClose').onclick = closeCheckin;
    var e = o.querySelector('#gEdit'); if (e) e.onclick = function () { gv.edit = true; drawGoal(); };
    var gt = o.querySelector('#gText'); if (gt) { if (!gt.value && state.goalDraft) gt.value = state.goalDraft; gt.addEventListener('input', function () { state.goalDraft = gt.value; save(); }); }
    var gu = o.querySelector('#gUpd'); if (gu) { setTimeout(function () { try { gu.focus(); } catch (e) {} }, 50); if (state.updDraft) gu.value = state.updDraft; gu.addEventListener('input', function () { state.updDraft = gu.value; save(); }); }
    var st = o.querySelector('#gSet');
    if (st) st.onclick = function () {
      var t = o.querySelector('#gText').value.trim(); if (!t) { o.querySelector('#gText').focus(); return; }
      mutate(function () { setGoal(t); delete state.goalDraft; }); gv.edit = false; drawGoal();
    };
    var ad = o.querySelector('#gAdd');
    if (ad) ad.onclick = function () {
      var t = o.querySelector('#gUpd').value; if (!t.trim()) return;
      var win = isAchievedText(t);
      mutate(function () { goalUpdate(t, false); delete state.updDraft; }); drawGoal();
      if (win) setTimeout(function () { toast('Goal achieved · +20 XP'); }, 50);
    };
    var wn = o.querySelector('#gWin');
    if (wn) wn.onclick = function () {
      var t = o.querySelector('#gUpd').value;
      mutate(function () { goalUpdate(t, true); delete state.updDraft; }); drawGoal();
    };
  }
  function fmt(s) { return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function startBreath() {
    ci.running = true; ci.left = ci.secs; ci.done = 0; drawCheckin();
    var ring = document.getElementById('ciRing'), orb = document.getElementById('orb'), cue = document.getElementById('cue');
    function breathe(inhale) {
      if (!ci || ci.stage !== 'breathe') return;
      orb.setAttribute('class', 'rings ' + (inhale ? 'in' : 'out'));
      cue.textContent = inhale ? 'Breathe in' : 'Breathe out';
      ci.bt = setTimeout(function () { breathe(!inhale); }, inhale ? 4000 : 6000);
    }
    requestAnimationFrame(function () { breathe(true); });
    ci.iv = setInterval(function () {
      ci.left--; ci.done++;
      var l = document.getElementById('left'); if (l) l.textContent = fmt(Math.max(ci.left, 0));
      if (ring) ring.setAttribute('stroke-dashoffset', (798 * (ci.left / ci.secs)).toFixed(1));
      if (ci.left <= 0) {
        clearInterval(ci.iv); clearTimeout(ci.bt);
        if (navigator.vibrate) navigator.vibrate(150);
        ci.stage = 'reflect'; drawCheckin();
      }
    }, 1000);
  }

  // ---------- movement snacks ----------
  var LIB = null;
  fetch('moves.json').then(function (r) { return r.json(); }).then(function (j) {
    LIB = j; render();
    var mm = /[?&]move=([a-z0-9]+)/.exec(location.search); if (mm) openMove(mm[1]);
  }).catch(function () {});
  function moveById(id) { return LIB && LIB.moves.filter(function (m) { return m.id === id; })[0]; }
  function movesOn(key) { return (state.moves || []).filter(function (m) { return dkey(new Date(m.t)) === key && !m.skipped; }); }
  function dose(mv) {
    var ph = phaseFor(todayNum()), k = mv.inc * (ph - 1);
    if (mv.secs) { var s = mv.secs + k; return { secs: s, text: s >= 120 ? Math.round(s / 60) + ' min' : s + ' sec' }; }
    return { reps: mv.reps + k, text: (mv.reps + k) + ' ' + (mv.unit || 'reps') + (mv.per ? ' ' + mv.per : '') };
  }
  function suggestMove() {
    var h = new Date().getHours(), pool = h < 11 ? ['yoga', 'stretch'] : h < 17 ? ['strength', 'cardio', 'stretch'] : ['stretch', 'yoga', 'cardio'];
    var done = movesOn(dkey(new Date())).map(function (m) { return m.id; });
    var opts = LIB.moves.filter(function (m) { return pool.indexOf(m.cat) >= 0 && done.indexOf(m.id) < 0; });
    if (!opts.length) opts = LIB.moves;
    return opts[Math.floor(Math.random() * opts.length)].id;
  }
  var BODY_SLOTS = []; for (var bm = 9 * 60 + 30; bm < 21 * 60; bm += 30) BODY_SLOTS.push(bm);
  function bodyCard() {
    if (!LIB) return '';
    var key = dkey(new Date()), done = movesOn(key), now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    var byCat = { yoga: 0, cardio: 0, strength: 0, stretch: 0 }, secs = 0;
    done.forEach(function (m) { byCat[m.cat]++; secs += m.secs || 45; });
    var h = '<section class="card stack body" style="gap:14px" aria-label="Movement today"><div class="row between"><div style="display:flex;flex-direction:column;gap:2px"><span class="cap">Body clock</span><span style="font-size:14px">a snack every 30 minutes</span></div>' +
      '<div class="bignum"><b>' + done.length + '</b><small>moves · ~' + Math.max(0, Math.round(secs / 60)) + ' min</small></div></div>';
    h += '<div class="clock" role="img" aria-label="' + done.length + ' movement snacks done today">';
    BODY_SLOTS.forEach(function (sm) {
      var hit = done.filter(function (m) { var d = new Date(m.t), x = d.getHours() * 60 + d.getMinutes(); return x >= sm - 15 && x < sm + 15; })[0];
      var cls = hit ? 'on' : (nowM >= sm - 15 && nowM < sm + 15 ? 'now' : (nowM >= sm + 15 ? 'past' : ''));
      h += '<i class="' + cls + '"' + (hit ? ' style="background:' + LIB.categories[hit.cat].color + '"' : '') + '></i>';
    });
    h += '</div><div class="clockax"><span>9:30</span><span>12</span><span>3pm</span><span>6pm</span><span>9</span></div>';
    h += '<div class="cats">' + Object.keys(LIB.categories).map(function (c) {
      return '<span class="cat" style="--c:' + LIB.categories[c].color + '"><i></i>' + LIB.categories[c].name + ' <b>' + byCat[c] + '</b></span>';
    }).join('') + '</div>';
    h += '<button type="button" class="btn red" id="moveNow">Move now · +5 XP</button></section>';
    return h;
  }

  var mv = null;
  function openMove(id) {
    if (!LIB) return;
    var m = moveById(id) || moveById(suggestMove());
    if (ci) closeCheckin();
    mv = { id: m.id, left: 0, total: 0, iv: null };
    drawMove();
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function drawMove() {
    var o = document.getElementById('overlay'), m = moveById(mv.id), cat = LIB.categories[m.cat], d = dose(m);
    o.classList.remove('dark');
    var h = '<div class="inner">';
    h += '<div class="row between"><span class="eyebrow">Movement snack</span><button type="button" class="btn ghost small" id="mClose">Close</button></div>';
    h += '<section class="movehero" style="background:' + cat.color + '"><span class="lbl">' + cat.name.toUpperCase() + '</span><h1>' + m.name + '</h1><div class="dose">' + d.text + '</div><span class="cue">' + m.cue + '</span></section>';
    h += '<ol class="howto">' + m.how.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>';
    if (d.secs) {
      var left = mv.iv ? mv.left : d.secs, tot = d.secs;
      h += '<div class="timer" style="background:' + cat.color + '"><div class="ring"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="5"/><circle id="mRing" cx="32" cy="32" r="27" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="' + (169.6 * (1 - left / tot)).toFixed(1) + '"/></svg><span id="mText">' + fmt(left) + '</span></div>' +
        '<div style="flex:1"><button type="button" class="btn small" id="mGo" style="color:#fff;border-color:#fff">' + (mv.iv ? 'Pause' : 'Start timer') + '</button></div></div>';
    }
    h += '<div class="row"><button type="button" class="btn ghost" id="mSkip" style="flex:1">Skip</button><button type="button" class="btn ghost" id="mSwap" style="flex:1">Swap</button></div>';
    h += '<button type="button" class="btn solid" id="mDone">Done · +5 XP</button>';
    h += '<p class="muted" style="margin:0;font-size:12px;text-align:center">Move within what feels good; stop if anything hurts.</p></div>';
    o.innerHTML = h;
    o.querySelector('#mClose').onclick = closeMove;
    o.querySelector('#mSwap').onclick = function () {
      stopMoveTimer();
      var same = LIB.moves.filter(function (x) { return x.cat === m.cat && x.id !== m.id; });
      mv.id = same[Math.floor(Math.random() * same.length)].id; drawMove();
    };
    o.querySelector('#mSkip').onclick = function () { logMove(m, d, true); closeMove(); toast('Skipped. Next one in 30 min'); };
    o.querySelector('#mDone').onclick = function () { closeMove(); mutate(function () { logMove(m, d, false); }); };
    var go = o.querySelector('#mGo');
    if (go) go.onclick = function () {
      if (mv.iv) { stopMoveTimer(); drawMove(); return; }
      if (!mv.left) { mv.left = d.secs; }
      mv.total = d.secs;
      mv.iv = setInterval(function () {
        mv.left--;
        var t = document.getElementById('mText'), r = document.getElementById('mRing');
        if (t) t.textContent = fmt(Math.max(mv.left, 0));
        if (r) r.setAttribute('stroke-dashoffset', (169.6 * (1 - mv.left / mv.total)).toFixed(1));
        if (mv.left <= 0) { stopMoveTimer(); mv.left = 0; if (navigator.vibrate) navigator.vibrate([150, 80, 150]); var b = document.getElementById('mGo'); if (b) b.textContent = 'Done? Tap below'; }
      }, 1000);
      drawMove();
    };
  }
  function stopMoveTimer() { if (mv && mv.iv) { clearInterval(mv.iv); mv.iv = null; } }
  function closeMove() { stopMoveTimer(); mv = null; document.getElementById('overlay').hidden = true; document.body.style.overflow = ''; if (location.search) history.replaceState(history.state, '', location.pathname); }
  function logMove(m, d, skipped) {
    state.moves = state.moves || [];
    state.moves.push({ t: new Date().toISOString(), id: m.id, cat: m.cat, secs: d.secs || null, reps: d.reps || null, skipped: !!skipped });
    save();
  }

  // ---------- fit: food, body, 12-week plan ----------
  var FOODS = [];
  fetch('foods.json').then(function (r) { return r.json(); }).then(function (j) { FOODS = j.foods; }).catch(function () {});
  var MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['snack', 'Snacks'], ['dinner', 'Dinner']];
  var fitUi = { view: 'food', day: null };
  function r1(x) { return Math.round(x * 10) / 10; }
  function prof() { return state.profile || {}; }
  function foodDay(key) { state.food = state.food || {}; return state.food[key] || []; }
  function sumItems(items) {
    return items.reduce(function (a, it) { a.kcal += it.kcal; a.p += it.p; a.c += it.c; a.f += it.f; return a; }, { kcal: 0, p: 0, c: 0, f: 0 });
  }
  function latestWeight() { var w = (state.weights || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; }); return w.length ? w[w.length - 1].kg : prof().weight; }
  function bodyCalc() {
    var p = prof(), w = latestWeight();
    if (!p.height || !w || !p.age || !p.sex) return null;
    var hm = p.height / 100, bmi = w / (hm * hm);
    var bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
    var tdee = bmr * (p.activity || 1.375);
    var lo = 18.5 * hm * hm, hi = 24.9 * hm * hm, ideal = 23 * hm * hm;
    var losing = bmi > 23;
    var kcal = Math.round((losing ? Math.max(tdee - 500, p.sex === 'm' ? 1500 : 1200) : tdee) / 10) * 10;
    var start = (state.weights && state.weights.length ? state.weights.slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; })[0].kg : w);
    var m3 = losing ? Math.max(ideal, start - 7) : start;
    var protein = Math.round(1.8 * Math.min(w, Math.max(ideal, m3)));
    var fat = Math.round(kcal * 0.27 / 9);
    var carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { w: w, bmi: bmi, bmr: bmr, tdee: tdee, lo: lo, hi: hi, ideal: ideal, kcal: kcal, protein: protein, fat: fat, carbs: carbs, m3: m3, start: start, losing: losing };
  }

  // 12-week roadmap towards a first sprint triathlon (750 m swim · 20 km bike · 5 km run)
  var PHASES = [
    { name: 'Foundation', color: '#12A39A', weeks: [1, 2, 3, 4], food: 'Log everything. Hit your protein target every day; no other rules yet.' },
    { name: 'Build', color: '#0F4D40', weeks: [5, 6, 7, 8], food: 'Keep the calorie target. Eat carbs around training, protein at every meal.' },
    { name: 'Race prep', color: '#F28C28', weeks: [9, 10, 11], food: 'Fuel the long sessions; practise what you’ll eat before a race.' },
    { name: 'Taper & race', color: '#E8457A', weeks: [12], food: 'Eat at maintenance this week; sleep well; carbs the night before.' }
  ];
  function weekPlan(w) {
    var S = function (day, sport, text, min) { return { day: day, sport: sport, text: text, min: min }; };
    if (w <= 4) {
      var k = w - 1;
      return [S(1, 'swim', 'Technique: 8 × 25 m easy with rests; kick drills', 20 + k * 5), S(2, 'run', 'Run–walk: ' + (4 + k) + ' × (2 min jog / 1 min walk)', 20 + k * 3),
        S(3, 'strength', 'Bodyweight circuit: squats, push-ups, lunges, plank × 3', 20), S(4, 'bike', 'Easy ride, can hold a conversation', 30 + k * 5),
        S(5, 'swim', 'Technique + ' + (100 + k * 50) + ' m continuous at the end', 25 + k * 5), S(6, 'run', 'Run–walk, easy: ' + (5 + k) + ' × (3 min / 1 min)', 25 + k * 3), S(0, 'rest', 'Rest or a gentle walk', 0)];
    }
    if (w <= 8) {
      var b = w - 5;
      return [S(1, 'swim', (300 + b * 100) + ' m continuous + 4 × 50 m', 30 + b * 5), S(2, 'run', 'Easy continuous run ' + (20 + b * 5) + ' min', 20 + b * 5),
        S(3, 'strength', 'Strength circuit + core, 25 min', 25), S(4, 'bike', 'Ride with 4 × 4 min harder efforts', 45 + b * 5),
        S(5, 'swim', 'Drills + ' + (400 + b * 100) + ' m continuous', 35), S(6, 'brick', 'Brick: bike ' + (30 + b * 5) + ' min, then run 10 min', 40 + b * 5), S(0, 'rest', 'Rest', 0)];
    }
    if (w <= 11) {
      var c = w - 9;
      return [S(1, 'swim', (600 + c * 100) + ' m continuous, sighting practice', 40), S(2, 'run', 'Intervals: 5 × 3 min at 5 km pace, 2 min easy', 40),
        S(3, 'strength', 'Strength + mobility, 25 min', 25), S(4, 'bike', (15 + c * 3) + ' km ride, last 5 km at race effort', 55 + c * 5),
        S(5, 'swim', '750 m continuous (race distance)', 40), S(6, 'brick', 'Brick: bike 45 min, then run ' + (15 + c * 5) + ' min', 60 + c * 5), S(0, 'rest', 'Rest', 0)];
    }
    return [S(1, 'swim', '400 m easy + 4 × 50 m brisk', 25), S(2, 'run', 'Easy 20 min with 4 short strides', 20), S(3, 'strength', 'Mobility only, 15 min', 15),
      S(4, 'bike', 'Easy 30 min', 30), S(5, 'rest', 'Rest; lay out your kit', 0), S(6, 'race', 'Your test: 750 m swim · 20 km bike · 5 km run', 90), S(0, 'rest', 'Recover. Well done.', 0)];
  }
  var SPORT = { swim: ['Swim', '#12A39A'], bike: ['Bike', '#F28C28'], run: ['Run', '#FF6B57'], strength: ['Strength', '#0F4D40'], brick: ['Brick', '#E8457A'], rest: ['Rest', '#B9C4BD'], race: ['Race', '#FF6B57'] };
  function planStart() { if (!state.planStart) { var t = new Date(); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); state.planStart = dkey(t); save(); } return state.planStart; }
  function planWeek(d) { var s = new Date(planStart() + 'T00:00:00'), t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return Math.floor((t - s) / 86400000 / 7) + 1; }
  function trainDone(key, i) { return !!((state.train || {})[key] || {})[i]; }
  function trainingOn(key) { var t = (state.train || {})[key] || {}; return Object.keys(t).filter(function (k) { return t[k]; }).length; }

  function renderFit() {
    var h = '<div class="stack">' + topbar('Fit') + '<div class="seg2" role="tablist" aria-label="Fit sections">' + [['food', 'Food'], ['body', 'Body'], ['plan', 'Plan']].map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (fitUi.view === t[0]) + '" data-fv="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
    h += fitUi.view === 'food' ? foodMain() : fitUi.view === 'body' ? bodyMain() : planMain();
    return h + '</div>';
  }
  function mealNow() { var hr = new Date().getHours(); return hr < 11 ? 'breakfast' : hr < 15 ? 'lunch' : hr < 18 ? 'snack' : 'dinner'; }
  function sortedWeights() { return (state.weights || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; }); }

  function foodMain() {
    var key = fitUi.day || dkey(new Date()), items = foodDay(key), bc = bodyCalc(), isToday = key === dkey(new Date());
    var eaten = sumItems(items.filter(function (i) { return !i.planned; })), planned = sumItems(items.filter(function (i) { return i.planned; }));
    var d = new Date(key + 'T00:00:00');
    var h = '<div class="daynav"><button type="button" class="rb" data-fd="-1" aria-label="Previous day">‹</button><b>' + (isToday ? 'Today' : d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })) + '</b><button type="button" class="rb" data-fd="1" aria-label="Next day">›</button></div>';
    var tk = bc ? bc.kcal : 0, left = tk - eaten.kcal, pct = tk ? Math.min(100, Math.round(eaten.kcal / tk * 100)) : 0;
    h += '<section class="hero w" style="background:' + T.mango + ';color:' + T.jungle + '">' + sun('rgba(255,255,255,.35)', 130, -30, -40) + wave('#FFFFFF', .25, 40, 20);
    if (tk) {
      h += '<span class="cap">' + (left >= 0 ? 'Kcal left' : 'Kcal over') + (isToday ? ' today' : '') + '</span><span class="display big">' + fmtN(Math.abs(left)) + '</span>' +
        '<div class="bar" style="background:rgba(15,77,64,.18)"><i style="width:' + pct + '%;background:' + (left < 0 ? T.coral : T.jungle) + '"></i></div>' +
        '<div class="row between small"><span>' + fmtN(eaten.kcal) + ' eaten</span><span>of ' + fmtN(tk) + '</span></div>';
    } else {
      h += '<span class="cap">Kcal eaten</span><span class="display big">' + fmtN(eaten.kcal) + '</span>';
    }
    if (planned.kcal) h += '<span class="small">+ ' + fmtN(planned.kcal) + ' kcal planned, not eaten yet</span>';
    h += '</section>';
    var chip = function (v, tgt, lab) { return '<div class="chip" style="background:#fff"><b class="display">' + Math.round(v) + '<span>g</span></b><small>' + lab + (tgt ? ' · ' + tgt : '') + '</small></div>'; };
    h += '<div class="chips">' + chip(eaten.p, bc && bc.protein, 'protein') + chip(eaten.f, bc && bc.fat, 'fat') + chip(eaten.c, bc && bc.carbs, 'carbs') + '</div>';
    h += '<div class="list">' + MEALS.map(function (m) {
      var its = items.filter(function (i) { return i.meal === m[0]; });
      return row({ t: m[1], v: its.length ? fmtN(sumItems(its).kcal) : '—', sheet: 'meal:' + m[0] });
    }).join('') + (bc ? '' : row({ t: 'Set up your body stats', sub: 'for calorie and protein targets', dot: T.coral, sheet: 'about' })) + '</div>';
    h += '<button type="button" class="btn coral" data-fadd="' + mealNow() + '">Add food</button>';
    return h;
  }
  function mealSheet(meal) {
    var key = fitUi.day || dkey(new Date()), items = foodDay(key), mn = MEALS.filter(function (m) { return m[0] === meal; })[0];
    var its = items.map(function (it, ix) { return { it: it, ix: ix }; }).filter(function (x) { return x.it.meal === meal; }), tot = sumItems(its.map(function (x) { return x.it; }));
    var h = '';
    if (its.length) {
      h += '<div class="list">' + its.map(function (x) {
        var it = x.it;
        return '<div class="r fitem' + (it.planned ? ' planned' : '') + '"><button type="button" class="fchk" data-ftog="' + x.ix + '" aria-label="' + (it.planned ? 'Mark as eaten' : 'Mark as planned') + '" aria-pressed="' + !it.planned + '"></button>' +
          '<span class="t">' + esc(it.name) + '<small>' + r1(it.qty) + ' × ' + esc(it.serving) + (it.planned ? ' · planned' : '') + ' · ' + Math.round(it.p) + ' g protein</small></span>' +
          '<span class="v strong">' + Math.round(it.kcal) + '</span><button type="button" class="fx" data-fdel="' + x.ix + '" aria-label="Remove ' + esc(it.name) + '">×</button></div>';
      }).join('') + '</div>';
      h += '<div class="chips"><div class="chip" style="background:#CDEFEA"><b class="display">' + Math.round(tot.p) + '<span>g</span></b><small>protein</small></div><div class="chip" style="background:#FFE6B8"><b class="display">' + Math.round(tot.f) + '<span>g</span></b><small>fat</small></div><div class="chip" style="background:#FFD9D3"><b class="display">' + Math.round(tot.c) + '<span>g</span></b><small>carbs</small></div></div>';
    } else h += '<p class="muted" style="margin:0">Nothing logged for ' + mn[1].toLowerCase() + ' yet.</p>';
    h += '<div class="row"><button type="button" class="btn coral" data-fadd="' + meal + '" style="flex:1">Add food</button>' + (its.length ? '<button type="button" class="btn line" data-fsave="' + meal + '" style="flex:1">Save as usual</button>' : '') + '</div>';
    var saved = (state.savedMeals || []).filter(function (s) { return s.meal === meal; });
    if (saved.length) h += '<div class="stack" style="gap:8px"><span class="lab">Your usual meals</span><div class="dchips">' + saved.map(function (s) { return '<button type="button" class="dchip" data-fsaved="' + state.savedMeals.indexOf(s) + '">↺ ' + esc(s.name) + '</button>'; }).join('') + '</div></div>';
    h += '<p class="muted small">Tap the circle to switch between planned and eaten. Values are typical estimates; home recipes vary.</p>';
    return { title: mn[1], cap: fmtN(tot.kcal) + ' kcal', html: h, bind: bindFit };
  }

  function bodyMain() {
    var bc = bodyCalc(), ws = sortedWeights(), p = prof(), h = '';
    if (!bc) {
      return '<button type="button" class="hero tall" data-sheet="about" style="background:' + T.lagoon + ';color:#fff">' + sun('rgba(255,255,255,.18)', 140, -40, -50) + wave('#FFFFFF', .15, 50, 24) +
        '<span class="cap">Body</span><span class="display h1">Tell me<br><i>about you</i></span><span class="go">Age, height and weight give you daily targets →</span></button>' +
        '<p class="muted small">General guidelines, not medical advice.</p>';
    }
    var last = ws[ws.length - 1], delta = null;
    if (ws.length > 1) {
      var cut = new Date(last.d + 'T00:00:00'); cut.setDate(cut.getDate() - 6);
      var ref = ws.filter(function (x) { return x.d <= dkey(cut); }).pop() || ws[0];
      delta = last.kg - ref.kg;
    }
    h += '<button type="button" class="hero" data-sheet="weight" style="background:' + T.lagoon + ';color:#fff;gap:6px">' + sun('rgba(255,255,255,.18)', 140, -40, -50) +
      '<span class="row between"><span class="cap">Weight</span>' + (delta !== null ? '<span class="pill">' + (delta > 0 ? '+' : delta < 0 ? '−' : '±') + r1(Math.abs(delta)) + ' this week</span>' : '') + '</span>' +
      '<span class="row" style="align-items:baseline;gap:8px"><span class="display big">' + Number(bc.w).toFixed(1) + '</span><span>kg</span></span>' + weightChart(ws, bc, true) + '</button>';
    h += '<div class="list">' + row({ t: 'Daily targets', v: fmtN(bc.kcal) + ' kcal', sheet: 'targets' }) + row({ t: 'Healthy range', v: Math.round(bc.lo) + '–' + Math.round(bc.hi) + ' kg', sheet: 'targets' }) +
      row({ t: 'About you', v: (p.age || '–') + ' · ' + (p.height || '–') + ' cm', sheet: 'about' }) + row({ t: 'Weight log', v: ws.length + (ws.length === 1 ? ' entry' : ' entries'), sheet: 'weight' }) + '</div>';
    h += '<button type="button" class="btn line" data-sheet="weight">Log today’s weight</button>';
    return h;
  }
  function aboutSheet() {
    var p = prof();
    var h = '<div class="formgrid">' +
      '<label>Sex<select id="bSex"><option value="">–</option><option value="m"' + (p.sex === 'm' ? ' selected' : '') + '>Male</option><option value="f"' + (p.sex === 'f' ? ' selected' : '') + '>Female</option></select></label>' +
      '<label>Age<input id="bAge" type="number" inputmode="numeric" value="' + (p.age || '') + '" placeholder="years"></label>' +
      '<label>Height<input id="bHeight" type="number" inputmode="decimal" value="' + (p.height || '') + '" placeholder="cm"></label>' +
      '<label>Weight<input id="bWeight" type="number" inputmode="decimal" step="0.1" value="' + (latestWeight() || '') + '" placeholder="kg"></label>' +
      '<label class="wide">How active are you (before training)?<select id="bAct">' + [[1.2, 'Mostly sitting'], [1.375, 'Lightly active'], [1.55, 'Active most days'], [1.725, 'Very active']].map(function (a) {
        return '<option value="' + a[0] + '"' + ((p.activity || 1.375) == a[0] ? ' selected' : '') + '>' + a[1] + '</option>';
      }).join('') + '</select></label></div><button type="button" class="btn solid" id="bSave">Save</button>' +
      '<p class="muted small">These are general guidelines, not medical advice. If you have a health condition, check with a doctor before starting.</p>';
    return { title: 'About you', cap: 'Body', html: h, bind: bindFit };
  }
  function targetsSheet() {
    var bc = bodyCalc(); if (!bc) return aboutSheet();
    var pos = Math.max(0, Math.min(100, (bc.bmi - 15) / (35 - 15) * 100));
    var h = '<div class="stack" style="gap:8px"><div class="row between"><span class="lab">BMI</span><b class="display" style="font-size:22px">' + r1(bc.bmi) + '</b></div><div class="bmiscale"><i style="left:' + pos + '%"></i></div><div class="clockax"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>35</span></div></div>' +
      '<div class="tgrid"><div><b>' + bc.kcal + '</b><small>kcal / day</small></div><div><b>' + bc.protein + 'g</b><small>protein</small></div><div><b>' + bc.fat + 'g</b><small>fat</small></div><div><b>' + bc.carbs + 'g</b><small>carbs</small></div></div>' +
      '<div class="list">' + row({ t: 'Healthy range', v: Math.round(bc.lo) + '–' + Math.round(bc.hi) + ' kg' }) + row({ t: 'Suggested target', v: Math.round(bc.ideal) + ' kg' }) + row({ t: '3-month goal', v: r1(bc.m3) + ' kg' }) + row({ t: 'You burn before training', v: '≈ ' + fmtN(bc.tdee) + ' kcal' }) + '</div>' +
      '<p class="muted small">' + (bc.losing ? 'A ~500 kcal daily gap loses about 0.5 kg a week; training on top adds a little more. Fat loss, not crash dieting.' : 'You’re already in a healthy range: eat at maintenance and let training reshape you.') + ' Suggested target = BMI 23; the 3-month goal is capped at about 7 kg so it stays sustainable. General guidelines, not medical advice.</p>';
    return { title: 'Daily targets', cap: 'Body', html: h, bind: bindFit };
  }
  function weightSheet() {
    var bc = bodyCalc(), ws = sortedWeights();
    var h = '<div class="row"><input id="wIn" class="text" type="number" inputmode="decimal" step="0.1" placeholder="today’s weight, kg" style="flex:1"><button type="button" class="btn solid" id="wAdd">Log</button></div>';
    if (bc && ws.length) h += '<div class="chartbox">' + weightChart(ws, bc, false) + '</div>';
    if (ws.length) h += '<div class="list">' + ws.slice().reverse().slice(0, 12).map(function (x) {
      return '<div class="r"><span class="t">' + new Date(x.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span><span class="v strong">' + Number(x.kg).toFixed(1) + ' kg</span><button type="button" class="fx" data-wdel="' + x.d + '" aria-label="Delete this entry">×</button></div>';
    }).join('') + '</div>';
    h += '<p class="muted small">Weigh in once a week, same day, in the morning before breakfast.</p>';
    return { title: 'Weight', cap: ws.length + ' entries', html: h, bind: bindFit };
  }
  function weightChart(ws, bc, light) {
    if (!ws.length) return '';
    var s0 = new Date(planStart() + 'T00:00:00'), W = 320, H = light ? 110 : 150, days = 84;
    var ink = light ? '#FFFFFF' : T.ink, line = light ? '#FFFFFF' : T.coral, dot = light ? T.mango : T.coral, goal = light ? '#FFFFFF' : T.lagoon;
    var ys = ws.map(function (x) { return x.kg; }).concat([bc.m3, bc.start]), ymin = Math.floor(Math.min.apply(null, ys) - 1), ymax = Math.ceil(Math.max.apply(null, ys) + 1);
    var X = function (d) { return 30 + Math.max(0, Math.min(days, (new Date(d + 'T00:00:00') - s0) / 86400000)) / days * (W - 40); };
    var Y = function (kg) { return 10 + (ymax - kg) / (ymax - ymin) * (H - 30); };
    var e = new Date(s0); e.setDate(e.getDate() + days);
    var path = ws.map(function (x, i) { return (i ? 'L' : 'M') + X(x.d).toFixed(1) + ' ' + Y(x.kg).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="wchart" role="img" aria-label="Weight over the 12 weeks">' +
      '<line x1="30" x2="' + (W - 10) + '" y1="' + Y(bc.m3) + '" y2="' + Y(bc.m3) + '" stroke="' + goal + '" stroke-opacity=".8" stroke-width="1.3" stroke-dasharray="3 5"/>' +
      '<text x="' + (W - 10) + '" y="' + (Y(bc.m3) - 5) + '" text-anchor="end" class="ax" fill="' + ink + '">goal ' + r1(bc.m3) + ' kg</text>' +
      '<line x1="' + X(planStart()) + '" y1="' + Y(bc.start) + '" x2="' + X(dkey(e)) + '" y2="' + Y(bc.m3) + '" stroke="' + ink + '" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="2 5"/>' +
      '<path d="' + path + '" fill="none" stroke="' + line + '" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      ws.map(function (x) { return '<circle cx="' + X(x.d).toFixed(1) + '" cy="' + Y(x.kg).toFixed(1) + '" r="3.5" fill="' + dot + '"/>'; }).join('') +
      '<text x="4" y="' + (Y(ymax) + 4) + '" class="ax" fill="' + ink + '">' + ymax + '</text><text x="4" y="' + (Y(ymin) + 4) + '" class="ax" fill="' + ink + '">' + ymin + '</text>' +
      '<text x="30" y="' + (H - 4) + '" class="ax" fill="' + ink + '">wk 1</text><text x="' + (W - 10) + '" y="' + (H - 4) + '" text-anchor="end" class="ax" fill="' + ink + '">wk 12</text></svg>';
  }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function weekDates(w) {
    var s0 = new Date(planStart() + 'T00:00:00'), plan = weekPlan(w);
    return plan.slice().sort(function (a, b) { return ((a.day + 6) % 7) - ((b.day + 6) % 7); }).map(function (s) {
      var dt = new Date(s0); dt.setDate(dt.getDate() + (w - 1) * 7 + (s.day + 6) % 7);
      return { s: s, i: plan.indexOf(s), dt: dt, key: dkey(dt) };
    });
  }
  function planMain() {
    var wk = planWeek(new Date()), tk = dkey(new Date()), h = '';
    if (wk > 12) {
      h += '<section class="hero tall" style="background:' + T.coral + ';color:#fff">' + sun(T.mango, 120, -30, -36) + wave('#FFFFFF', .18, 60, 30) +
        '<span class="cap">12-week road map</span><span class="display h1">Road map<br><i>complete</i></span><span style="font-size:15px;max-width:250px">Twelve weeks done. Keep training the way you enjoyed most.</span></section>';
      return h + '<div class="list">' + row({ t: '12-week road map', v: 'done', sheet: 'roadmap' }) + row({ t: 'Garmin', v: garminStatus(), sheet: 'garmin', dot: garminDot() }) + '</div>';
    }
    var ph = PHASES.filter(function (p) { return p.weeks.indexOf(wk) >= 0; })[0], days = weekDates(wk);
    var t = days.filter(function (x) { return x.key === tk; })[0];
    if (!t) return '<div class="list">' + row({ t: 'Your 12-week plan starts ' + new Date(planStart() + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' }), sheet: 'week' }) + '</div>';
    var s = t.s, sp = SPORT[s.sport], done = trainDone(tk, t.i);
    var title = s.sport === 'rest' ? 'Rest day,<br><i>recover</i>' : s.sport === 'race' ? 'Race day,<br><i>you’ve got this</i>' : sp[0] + ',<br><i>' + s.min + ' minutes</i>';
    h += '<section class="hero tall" style="background:' + T.coral + ';color:#fff">' + sun(T.mango, 120, -30, -36) + wave('#FFFFFF', .18, 60, 30) +
      '<span class="cap">Today · Week ' + wk + ' · ' + ph.name + '</span><span class="display h1">' + title + '</span><span style="font-size:15px;line-height:1.45;max-width:260px">' + s.text + '</span></section>';
    if (s.sport !== 'rest') h += '<button type="button" class="btn ' + (done ? 'lagoon' : 'jungle') + '" data-tr="' + tk + '|' + t.i + '">' + (done ? '✓ Done · nice work' : 'Mark done · +10 XP') + '</button>';
    var nDone = 0, nAll = 0;
    h += '<div class="list weekstrip" aria-label="This week">' + days.map(function (x) {
      var rest = x.s.sport === 'rest', dn = trainDone(x.key, x.i); if (!rest) { nAll++; if (dn) nDone++; }
      var st = rest ? 'rest' : dn ? 'done' : x.key === tk ? 'today' : x.key < tk ? 'miss' : '';
      return '<span class="wd"><span class="cap">' + DOW[x.dt.getDay()].charAt(0) + '</span><i class="' + st + '" style="' + (st === 'done' ? 'background:' + (SPORT[x.s.sport] || sp)[1] : '') + '"></i></span>';
    }).join('') + '</div>';
    h += '<div class="list">' + row({ t: 'This week', v: nDone + ' of ' + nAll, sheet: 'week' }) + row({ t: '12-week road map', v: 'Week ' + wk, sheet: 'roadmap' }) + row({ t: 'Garmin', v: garminStatus(), sheet: 'garmin', dot: garminDot() }) + '</div>';
    return h;
  }
  function garminStatus() { var sv = state.strava || {}; return !sv.pass ? 'set up' : sv.error ? 'needs a look' : sv.syncedAt ? ago(sv.syncedAt) : 'waiting'; }
  function garminDot() { var sv = state.strava || {}; return !sv.pass ? '#C8D3CC' : sv.error ? T.coral : T.lagoon; }

  function weekSheet() {
    var wk = Math.max(1, Math.min(12, planWeek(new Date()))), sel = fitUi.week || wk, tk = dkey(new Date());
    var sph = PHASES.filter(function (x) { return x.weeks.indexOf(sel) >= 0; })[0];
    var h = '<div class="weeks">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (w) {
      var p = PHASES.filter(function (x) { return x.weeks.indexOf(w) >= 0; })[0];
      return '<button type="button" data-pw="' + w + '" aria-label="Week ' + w + '" aria-pressed="' + (w === sel) + '" style="--c:' + p.color + '" class="' + (w < wk ? 'past' : w === wk ? 'now' : '') + '">' + w + '</button>';
    }).join('') + '</div>';
    h += '<div class="list">' + weekDates(sel).map(function (x) {
      var s = x.s, sp = SPORT[s.sport], dn = trainDone(x.key, x.i), isT = x.key === tk;
      return '<div class="r sess' + (isT ? ' today' : '') + '">' + (s.sport === 'rest' ? '<span class="fchk rest"></span>' : '<button type="button" class="fchk" data-tr="' + x.key + '|' + x.i + '" aria-pressed="' + dn + '" aria-label="Mark ' + sp[0] + ' done"></button>') +
        '<span class="t"><span class="st"><i style="background:' + sp[1] + '"></i>' + sp[0] + (s.min ? ' · ' + s.min + ' min' : '') + '</span><small>' + s.text + '</small></span><span class="cap"' + (isT ? ' style="color:' + T.coral + '"' : '') + '>' + DOW[x.dt.getDay()] + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="notice">Food this phase: ' + sph.food + '</div>';
    return { title: 'Week ' + sel, cap: sph.name, html: h, bind: bindFit };
  }
  function roadmapSheet() {
    var wk = Math.max(1, Math.min(12, planWeek(new Date()))), bc = bodyCalc();
    var h = '<p class="muted" style="margin:0">Towards a first sprint triathlon: 750 m swim · 20 km bike · 5 km run' + (bc && bc.losing ? ', and ' + r1(bc.start) + ' → ' + r1(bc.m3) + ' kg' : '') + '.</p>';
    h += '<h3 class="sh">Phases</h3><div class="list">' + PHASES.map(function (p) {
      var now = p.weeks.indexOf(wk) >= 0, past = p.weeks[p.weeks.length - 1] < wk;
      return row({ t: p.name, sub: 'Week' + (p.weeks.length > 1 ? 's ' + p.weeks[0] + '–' + p.weeks[p.weeks.length - 1] : ' ' + p.weeks[0]) + ' · ' + p.food, v: now ? 'now' : past ? '✓' : '', dot: p.color });
    }).join('') + '</div>';
    var ms = [[4, 'Swim 200 m non-stop · run 20 min without walking'], [8, 'Swim 500 m · ride 20 km · first brick session'], [11, 'Swim 750 m · run 5 km continuously'], [12, 'Sprint triathlon distance, done']];
    h += '<h3 class="sh">Checkpoints</h3><div class="list">' + ms.map(function (m) {
      var kg = bc && bc.losing ? r1(bc.start - (bc.start - bc.m3) * m[0] / 12) : null;
      return row({ t: m[1], sub: 'Week ' + m[0] + (kg ? ' · ~' + kg + ' kg' : ''), v: m[0] <= wk ? '✓' : '', dot: m[0] <= wk ? T.lagoon : '#C8D3CC' });
    }).join('') + '</div>';
    return { title: '12-week road map', cap: 'Week ' + wk, html: h, bind: bindFit };
  }
  function garminSheet() {
    var wk = Math.max(1, Math.min(12, planWeek(new Date()))), acts = activitiesDeduped(), wkActs = acts.filter(function (a) { return planWeek(new Date(a.d + 'T00:00:00')) === wk; });
    var bySport = {}; wkActs.forEach(function (a) { bySport[a.sport] = (bySport[a.sport] || 0) + a.min; });
    var h = stravaCard();
    h += '<section class="card stack" style="gap:10px"><div class="row between"><h2>This week’s training</h2><span class="cap">' + acts.length + ' in total</span></div>' +
      (wkActs.length ? '<div class="cats">' + Object.keys(bySport).map(function (k) { return '<span class="cat" style="--c:' + (SPORT[k] ? SPORT[k][1] : '#6F7D74') + '"><i></i>' + (SPORT[k] ? SPORT[k][0] : k) + ' <b>' + Math.round(bySport[k]) + ' min</b></span>'; }).join('') + '</div>' : '<span class="muted" style="font-size:13px">No Garmin activities for week ' + wk + ' yet.</span>') +
      '<button type="button" class="btn line" id="gImp">Or import a Garmin Connect CSV</button><input type="file" id="gFile" accept=".csv,text/csv" hidden>' +
      '<details><summary class="muted" style="font-size:13px">How to get the file</summary><ol class="steps" style="margin-top:8px"><li>On a computer, open <b>connect.garmin.com</b> and sign in.</li><li>Go to <b>Activities → All Activities</b>.</li><li>Scroll to load the weeks you want, then click <b>Export CSV</b> (top right).</li><li>Send the file to your phone (e.g. email or Drive) and tap Import above.</li></ol><p class="muted" style="font-size:12px;margin:6px 0 0">Re-importing is safe: duplicates are skipped.</p></details></section>';
    return { title: 'Garmin', cap: garminStatus(), html: h, bind: bindFit };
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.join('').trim(); });
  }
  function importGarmin(text) {
    var rows = parseCsv(text); if (rows.length < 2) throw new Error('empty file');
    var hd = rows[0].map(function (x) { return x.trim().toLowerCase(); });
    var col = function (names) { for (var i = 0; i < names.length; i++) { var ix = hd.indexOf(names[i]); if (ix >= 0) return ix; } return -1; };
    var cT = col(['activity type']), cD = col(['date', 'start time']), cTime = col(['time', 'elapsed time', 'moving time']), cKcal = col(['calories']), cDist = col(['distance']), cTitle = col(['title']);
    if (cT < 0 || cD < 0) throw new Error('this doesn’t look like a Garmin activities CSV');
    state.activities = state.activities || [];
    var seen = {}; state.activities.forEach(function (a) { seen[a.id] = 1; });
    var added = 0;
    rows.slice(1).forEach(function (r) {
      var type = (r[cT] || '').toLowerCase(), dt = (r[cD] || '').trim(); if (!dt) return;
      var d = dt.slice(0, 10), t = (cTime >= 0 ? r[cTime] : '') || '0:0:0', parts = t.split(':').map(Number);
      var min = parts.length === 3 ? parts[0] * 60 + parts[1] + parts[2] / 60 : parts.length === 2 ? parts[0] + parts[1] / 60 : 0;
      var sport = /swim/.test(type) ? 'swim' : /cycl|bik|ride/.test(type) ? 'bike' : /run/.test(type) ? 'run' : /strength|train/.test(type) ? 'strength' : type || 'other';
      var id = dt + '|' + type;
      if (seen[id]) return;
      seen[id] = 1; added++;
      state.activities.push({ id: id, d: d, sport: sport, type: r[cT], min: Math.round(min), kcal: cKcal >= 0 ? Number(String(r[cKcal]).replace(/,/g, '')) || 0 : 0, dist: cDist >= 0 ? r[cDist] : '', title: cTitle >= 0 ? r[cTitle] : '' });
    });
    return added;
  }

  function bindFit(view) {
    view.querySelectorAll('[data-fv]').forEach(function (b) { b.onclick = function () { fitUi.view = b.dataset.fv; render(); }; });
    view.querySelectorAll('[data-fd]').forEach(function (b) { b.onclick = function () { var d = new Date((fitUi.day || dkey(new Date())) + 'T00:00:00'); d.setDate(d.getDate() + +b.dataset.fd); fitUi.day = dkey(d); render(); }; });
    var key = fitUi.day || dkey(new Date());
    view.querySelectorAll('[data-ftog]').forEach(function (b) { b.onclick = function () { var it = state.food[key][+b.dataset.ftog]; it.planned = !it.planned; save(); render(); if (!it.planned) toast('Eaten · ' + Math.round(it.kcal) + ' kcal'); }; });
    view.querySelectorAll('[data-fdel]').forEach(function (b) { b.onclick = function () { state.food[key].splice(+b.dataset.fdel, 1); save(); render(); }; });
    view.querySelectorAll('[data-fadd]').forEach(function (b) { b.onclick = function () { openFoodPicker(key, b.dataset.fadd); }; });
    view.querySelectorAll('[data-fsave]').forEach(function (b) {
      b.onclick = function () {
        var meal = b.dataset.fsave, name = prompt('Name this meal (e.g. “Usual breakfast”)'); if (!name) return;
        state.savedMeals = state.savedMeals || [];
        state.savedMeals.push({ name: name.slice(0, 30), meal: meal, items: foodDay(key).filter(function (i) { return i.meal === meal; }).map(function (i) { var c = Object.assign({}, i); delete c.planned; return c; }) });
        save(); render(); toast('Saved “' + name + '”');
      };
    });
    view.querySelectorAll('[data-fsaved]').forEach(function (b) {
      b.onclick = function () {
        var s = state.savedMeals[+b.dataset.fsaved]; state.food = state.food || {}; state.food[key] = state.food[key] || [];
        s.items.forEach(function (i) { state.food[key].push(Object.assign({}, i, { meal: s.meal, planned: key > dkey(new Date()) })); });
        save(); render(); toast('Added ' + s.name);
      };
    });
    var bs = view.querySelector('#bSave');
    if (bs) bs.onclick = function () {
      var v = function (id) { return view.querySelector(id).value; };
      state.profile = { sex: v('#bSex'), age: +v('#bAge') || null, height: +v('#bHeight') || null, weight: +v('#bWeight') || null, activity: +v('#bAct') };
      if (state.profile.weight && !(state.weights || []).length) state.weights = [{ d: dkey(new Date()), kg: state.profile.weight }];
      planStart(); save(); closeSheet(); render(); toast('Saved');
    };
    var wa = view.querySelector('#wAdd');
    if (wa) wa.onclick = function () {
      var kg = +view.querySelector('#wIn').value; if (!kg || kg < 30 || kg > 250) { toast('Enter your weight in kg'); return; }
      state.weights = (state.weights || []).filter(function (x) { return x.d !== dkey(new Date()); });
      state.weights.push({ d: dkey(new Date()), kg: kg }); save(); render(); toast('Logged ' + kg + ' kg');
    };
    view.querySelectorAll('[data-wdel]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this weight entry?')) return; state.weights = (state.weights || []).filter(function (x) { return x.d !== b.dataset.wdel; }); save(); render(); }; });
    view.querySelectorAll('[data-pw]').forEach(function (b) { b.onclick = function () { fitUi.week = +b.dataset.pw; render(); }; });
    view.querySelectorAll('[data-tr]').forEach(function (b) {
      b.onclick = function () {
        var pr = b.dataset.tr.split('|'), k = pr[0], i = pr[1];
        mutate(function () { state.train = state.train || {}; state.train[k] = state.train[k] || {}; state.train[k][i] = !state.train[k][i]; });
      };
    });
    bindStrava(view);
    var gi = view.querySelector('#gImp'), gf = view.querySelector('#gFile');
    if (gi) gi.onclick = function () { gf.click(); };
    if (gf) gf.onchange = function () {
      var f = gf.files[0]; if (!f) return;
      f.text().then(function (t) { var n = importGarmin(t); save(); render(); toast(n ? 'Imported ' + n + ' activities' : 'Nothing new to import'); })
        .catch(function (e) { toast('Could not import: ' + e.message); });
    };
  }

  // food picker overlay
  var fp = null;
  function openFoodPicker(key, meal) {
    fp = { key: key, meal: meal, q: '', pick: null, qty: 1, custom: false };
    drawFoodPicker();
    var o = document.getElementById('overlay'); o.classList.remove('dark'); o.hidden = false; document.body.style.overflow = 'hidden';
  }
  function allFoods() { return (state.customFoods || []).map(function (f) { return Object.assign({ mine: true }, f); }).concat(FOODS); }
  function drawFoodPicker() {
    var o = document.getElementById('overlay'), mealName = MEALS.filter(function (m) { return m[0] === fp.meal; })[0][1];
    var h = '<div class="inner"><div class="row between"><span class="eyebrow">Add to ' + mealName + '</span><button type="button" class="btn ghost small" id="fpClose">Close</button></div>';
    if (fp.custom) {
      h += '<h1>Add your own dish</h1><p class="muted" style="margin:0;font-size:13px">Enter it once; it’s saved for next time. Check the packet, or estimate.</p><div class="formgrid">' +
        '<label class="wide">Name<input id="cName" placeholder="e.g. Amma’s chicken curry"></label><label class="wide">Serving<input id="cServ" placeholder="e.g. 1 bowl"></label>' +
        '<label>Calories<input id="cK" type="number" inputmode="decimal" placeholder="kcal"></label><label>Protein<input id="cP" type="number" inputmode="decimal" placeholder="g"></label>' +
        '<label>Carbs<input id="cC" type="number" inputmode="decimal" placeholder="g"></label><label>Fat<input id="cF" type="number" inputmode="decimal" placeholder="g"></label></div>' +
        '<button type="button" class="btn solid" id="cSave">Save & choose</button><button type="button" class="btn ghost" id="cBack">Back to search</button>';
    } else if (!fp.pick) {
      var q = fp.q.toLowerCase().trim(), list = allFoods().filter(function (f) { return !q || (f.name + ' ' + (f.tags || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 30);
      h += '<input class="text" id="fpQ" placeholder="Search: dosa, rice, chicken, banana…" value="' + esc(fp.q) + '" autocomplete="off">';
      h += '<div class="flist">' + list.map(function (f) {
        return '<button type="button" class="fopt" data-fp="' + esc(f.name) + '"><span><b>' + esc(f.name) + (f.mine ? ' ★' : '') + '</b><small>' + esc(f.serving) + '</small></span><span class="fnum"><b>' + Math.round(f.kcal) + '</b><small>' + r1(f.p) + 'P · ' + r1(f.f) + 'F</small></span></button>';
      }).join('') + (list.length ? '' : '<p class="muted">No match. Add it as your own dish below.</p>') + '</div>';
      h += '<button type="button" class="btn" id="fpCustom">+ My own dish / packet food</button>';
    } else {
      var f = fp.pick, k = fp.qty;
      h += '<section class="card stack" style="gap:6px"><h1>' + esc(f.name) + '</h1><span class="muted">' + esc(f.serving) + (f.g ? ' ≈ ' + f.g + ' g' : '') + '</span></section>';
      h += '<div class="qty"><button type="button" class="btn" data-q="-0.5" aria-label="Less">−</button><b>' + r1(k) + '</b><button type="button" class="btn" data-q="0.5" aria-label="More">+</button><span class="muted">× ' + esc(f.serving) + '</span></div>';
      h += '<div class="tgrid"><div><b>' + Math.round(f.kcal * k) + '</b><small>kcal</small></div><div><b>' + r1(f.p * k) + 'g</b><small>protein</small></div><div><b>' + r1(f.f * k) + 'g</b><small>fat</small></div><div><b>' + r1(f.c * k) + 'g</b><small>carbs</small></div></div>';
      h += '<button type="button" class="btn solid" id="fpEat">Add · eaten</button><button type="button" class="btn" id="fpPlan">Add · planned</button><button type="button" class="btn ghost" id="fpBack">Choose something else</button>';
    }
    o.innerHTML = h + '</div>';
    o.querySelector('#fpClose').onclick = function () { fp = null; closeCheckin(); render(); };
    var qi = o.querySelector('#fpQ');
    if (qi) { qi.oninput = function () { fp.q = qi.value; var pos = qi.selectionStart; drawFoodPicker(); var n = document.getElementById('fpQ'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }; if (!fp.q) setTimeout(function () { try { qi.focus(); } catch (e) {} }, 50); }
    o.querySelectorAll('[data-fp]').forEach(function (b) { b.onclick = function () { fp.pick = allFoods().filter(function (f) { return f.name === b.dataset.fp; })[0]; fp.qty = 1; drawFoodPicker(); }; });
    o.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { fp.qty = Math.max(0.5, fp.qty + +b.dataset.q); drawFoodPicker(); }; });
    var add = function (planned) {
      var f = fp.pick, k = fp.qty;
      state.food = state.food || {}; state.food[fp.key] = state.food[fp.key] || [];
      state.food[fp.key].push({ meal: fp.meal, name: f.name, serving: f.serving, qty: k, kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k, planned: planned });
      save(); var n = f.name; fp = null; closeCheckin(); render(); toast((planned ? 'Planned · ' : 'Added · ') + n);
    };
    var e1 = o.querySelector('#fpEat'); if (e1) e1.onclick = function () { add(false); };
    var e2 = o.querySelector('#fpPlan'); if (e2) e2.onclick = function () { add(true); };
    var bk = o.querySelector('#fpBack'); if (bk) bk.onclick = function () { fp.pick = null; drawFoodPicker(); };
    var cu = o.querySelector('#fpCustom'); if (cu) cu.onclick = function () { fp.custom = true; drawFoodPicker(); };
    var cb = o.querySelector('#cBack'); if (cb) cb.onclick = function () { fp.custom = false; drawFoodPicker(); };
    var cs = o.querySelector('#cSave');
    if (cs) cs.onclick = function () {
      var g = function (id) { return o.querySelector(id).value; }, name = g('#cName').trim();
      if (!name || !(+g('#cK') >= 0) || g('#cK') === '') { toast('Add at least a name and calories'); return; }
      var f = { name: name, serving: g('#cServ').trim() || '1 serving', kcal: +g('#cK'), p: +g('#cP') || 0, c: +g('#cC') || 0, f: +g('#cF') || 0 };
      state.customFoods = (state.customFoods || []).filter(function (x) { return x.name !== name; }); state.customFoods.push(f); save();
      fp.custom = false; fp.pick = f; fp.qty = 1; drawFoodPicker();
    };
  }

  // ---------- Garmin sync (Garmin → intervals.icu → encrypted file on GitHub → here) ----------
  function repoRaw() {
    var owner = location.hostname.split('.')[0], repo = location.pathname.split('/').filter(Boolean)[0];
    return location.hostname.indexOf('github.io') > 0 && repo ? 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/main/data/activities.enc.json' : 'data/activities.enc.json';
  }
  function repoActions() {
    var owner = location.hostname.split('.')[0], repo = location.pathname.split('/').filter(Boolean)[0];
    return 'https://github.com/' + owner + '/' + (repo || 'attention') + '/actions/workflows/sync.yml';
  }
  function b64bytes(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function decryptBox(box, pass) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64bytes(box.salt), iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    }).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(box.iv) }, key, b64bytes(box.ct));
    }).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }
  var syncing = false;
  function stravaSync(manual) {
    var sv = state.strava || {};
    if (!sv.pass || syncing) return Promise.resolve();
    if (!manual && sv.lastTry && Date.now() - sv.lastTry < 20 * 60000) return Promise.resolve();
    syncing = true; sv.lastTry = Date.now(); state.strava = sv; save();
    return fetch(repoRaw() + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) throw new Error('nothing synced yet: run “Garmin sync” on GitHub first');
      if (!r.ok) throw new Error('download failed (' + r.status + ')');
      return r.json();
    }).then(function (box) { return decryptBox(box, sv.pass).catch(function () { throw new Error('wrong passphrase: it must match SYNC_PASSPHRASE on GitHub'); }); })
      .then(function (data) {
        var mine = (state.activities || []).filter(function (a) { return !isSynced(a); });
        state.activities = mine.concat(data.activities);
        sv.syncedAt = data.at; sv.count = data.activities.length; sv.error = null; save(); syncing = false;
        if (manual) toast('Synced ' + data.activities.length + ' Garmin activities');
        render();
      }).catch(function (e) { syncing = false; sv.error = e.message; save(); if (manual) toast('Sync failed: ' + e.message); render(); });
  }
  // CSV and the automatic sync may both hold the same workout: prefer the sync, drop near-identical CSV rows.
  function isSynced(a) { return /^(sync|strava):/.test(String(a.id)); }
  function activitiesDeduped() {
    var all = state.activities || [], st = all.filter(isSynced);
    return all.filter(function (a) {
      if (isSynced(a)) return true;
      return !st.some(function (s) { return s.d === a.d && s.sport === a.sport && Math.abs(s.min - a.min) <= 3; });
    });
  }
  function stravaCard() {
    var sv = state.strava || {}, h = '<section class="card stack" style="gap:10px"><div class="row between"><h2>Garmin sync</h2><span class="eyebrow">Garmin → intervals.icu → here</span></div>';
    if (!sv.pass) {
      h += '<p class="muted" style="margin:0;font-size:13px">Pulls your Garmin workouts automatically: Garmin sends them to intervals.icu, GitHub collects them every 2 hours and locks them with your passphrase.</p>' +
        '<div class="formgrid"><label class="wide">Sync passphrase<input id="svPass" type="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="same as SYNC_PASSPHRASE on GitHub"></label></div>' +
        '<button type="button" class="btn solid" id="svSave">Save passphrase & sync</button>';
    } else {
      h += '<div class="notice" style="' + (sv.error ? 'background:#FFE1DB' : '') + '">' + (sv.error ? 'Last sync failed: ' + esc(sv.error) : sv.syncedAt ? '✓ ' + sv.count + ' activities · updated ' + new Date(sv.syncedAt).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Waiting for the first sync from GitHub.') + '</div>' +
        '<div class="row"><button type="button" class="btn solid" id="svSync" style="flex:1">Sync now</button><button type="button" class="btn ghost" id="svReset">Passphrase</button></div>' +
        '<a class="link" href="' + repoActions() + '" target="_blank" rel="noopener">Open the Garmin sync page on GitHub</a>';
      var recent = (state.activities || []).filter(isSynced).sort(function (a, b) { return a.d < b.d ? 1 : -1; }).slice(0, 4);
      recent.forEach(function (a) {
        var sp = SPORT[a.sport] || [a.type, '#6F7D74'];
        h += '<div class="sess"><span class="fchk" aria-hidden="true" style="border:0;background:' + sp[1] + '"></span><div style="flex:1;min-width:0"><span class="d">' + new Date(a.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span><span class="t">' + esc(a.title || sp[0]) + '</span><span class="d" style="font-family:var(--sans)">' + a.min + ' min' + (a.dist ? ' · ' + a.dist + ' km' : '') + (a.hr ? ' · ' + a.hr + ' bpm' : '') + (a.kcal ? ' · ' + a.kcal + ' kcal' : '') + '</span></div></div>';
      });
    }
    return h + '</section>';
  }
  function bindStrava(view) {
    var s = view.querySelector('#svSave');
    if (s) s.onclick = function () {
      var p = view.querySelector('#svPass').value.trim(); if (p.length < 8) { toast('Passphrase: at least 8 characters'); return; }
      state.strava = Object.assign(state.strava || {}, { pass: p, error: null }); save(); render(); stravaSync(true);
    };
    var y = view.querySelector('#svSync'); if (y) y.onclick = function () { stravaSync(true); };
    var r = view.querySelector('#svReset'); if (r) r.onclick = function () { delete state.strava.pass; save(); render(); };
  }
  // ---------- insights ----------
  function distCounts() {
    var counts = {};
    state.checkins.forEach(function (c) { c.distractions.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; }); });
    return counts;
  }
  function hourLabel(h) { return (h % 12 || 12) + (h < 12 ? ' am' : ' pm'); }
  function renderLog() {
    var counts = distCounts(), top = Object.keys(counts).filter(function (d) { return d !== 'Nothing, I was present'; }).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var pres = state.checkins.filter(function (c) { return c.presence; });
    var avg = pres.length ? (pres.reduce(function (a, c) { return a + c.presence; }, 0) / pres.length).toFixed(1) : '–';
    var gk = Object.keys(state.goals || {}), won = gk.filter(function (k) { return state.goals[k].achievedAt; }).length;
    var h = '<div class="stack">' + topbar('Insights');
    var title;
    if (top) {
      var hrs = {}; state.checkins.forEach(function (c) { if (c.distractions.indexOf(top) >= 0) { var x = new Date(c.t).getHours(); hrs[x] = (hrs[x] || 0) + 1; } });
      var ph = +Object.keys(hrs).sort(function (a, b) { return hrs[b] - hrs[a]; })[0];
      title = esc(top.split(' / ')[0]) + ',<br><i>around ' + hourLabel(ph) + '</i>';
    } else title = state.checkins.length ? 'Nothing much,<br><i>well done</i>' : 'Nothing yet,<br><i>check in to start</i>';
    h += '<button type="button" class="hero w" data-sheet="dist" style="background:' + T.hib + ';color:#fff">' + sun('rgba(255,255,255,.16)', 150, -50, -50) + wave('#FFFFFF', .15, 44, 22) +
      '<span class="cap">Most pulled away by</span><span class="display h2">' + title + '</span></button>';
    h += '<div class="chips"><div class="chip" style="background:#fff"><b class="display">' + avg + '</b><small>avg presence</small></div><div class="chip" style="background:#fff"><b class="display">' + state.checkins.length + '</b><small>check-ins</small></div><div class="chip" style="background:#fff"><b class="display">' + won + '<span>/' + gk.length + '</span></b><small>targets hit</small></div></div>';
    var nMv = (state.moves || []).filter(function (m) { return !m.skipped; }).length;
    h += '<div class="list">' + row({ t: 'Distractions', v: Object.keys(counts).length + ' kinds', dot: T.hib, sheet: 'dist' }) + row({ t: 'Movement', v: nMv + ' snacks', dot: T.mango, sheet: 'mvstat' }) +
      row({ t: 'Daily targets', v: won + ' of ' + gk.length, dot: T.coral, sheet: 'goals' }) + row({ t: 'Check-in history', v: state.checkins.length, dot: T.lagoon, sheet: 'history' }) + '</div>';
    return h + '</div>';
  }
  function distSheet() {
    var counts = distCounts(), top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var max = top.length ? counts[top[0]] : 1, todayC = checkinsOn(dayNumFor(new Date())).length;
    var h = '<p class="muted" style="margin:0">What keeps pulling you away, from ' + state.checkins.length + ' check-ins (' + todayC + ' today).</p>';
    if (!top.length) h += '<p class="muted">Nothing yet. Your first check-in will start this chart.</p>';
    else h += '<div class="card stack" style="gap:12px">' + top.map(function (d) { var ix = DISTRACTIONS.indexOf(d); return '<div class="hbar"><span>' + esc(d) + '</span><span class="b"><i style="background:' + (ix >= 0 ? DCOL[ix] : T.ink) + ';width:' + Math.round(counts[d] / max * 100) + '%"></i></span><span style="text-align:right">' + counts[d] + '</span></div>'; }).join('') + '</div>';
    return { title: 'Distractions', cap: top.length + ' kinds', html: h, bind: bindLog };
  }
  function mvstatSheet() {
    var h = '';
    if (LIB) {
      var all = (state.moves || []).filter(function (m) { return !m.skipped; }), tk = dkey(new Date()), tmv = all.filter(function (m) { return dkey(new Date(m.t)) === tk; });
      var sk = (state.moves || []).filter(function (m) { return m.skipped && dkey(new Date(m.t)) === tk; }).length;
      var cc = { yoga: 0, cardio: 0, strength: 0, stretch: 0 }; all.forEach(function (m) { cc[m.cat]++; });
      var mx = Math.max(1, cc.yoga, cc.cardio, cc.strength, cc.stretch);
      h += '<p class="muted" style="margin:0">Today: ' + tmv.length + ' done, ' + sk + ' skipped. ' + all.length + ' movement snacks in total.</p><div class="card stack" style="gap:12px">';
      Object.keys(cc).forEach(function (c) { h += '<div class="hbar"><span>' + LIB.categories[c].name + '</span><span class="b"><i style="background:' + LIB.categories[c].color + ';width:' + Math.round(cc[c] / mx * 100) + '%"></i></span><span style="text-align:right">' + cc[c] + '</span></div>'; });
      h += '</div><button type="button" class="btn coral" data-sheet="move">Today’s movement</button>';
    }
    return { title: 'Movement', cap: 'all time', html: h, bind: bindLog };
  }
  function goalsSheet() {
    var gk = Object.keys(state.goals || {}).sort().reverse(), won = gk.filter(function (k) { return state.goals[k].achievedAt; }).length;
    var h = '';
    if (!gk.length) h += '<p class="muted">Set a target on the Today tab and it will show up here.</p>';
    else h += '<div class="list">' + gk.slice(0, 30).map(function (k) {
      var g = state.goals[k], d = new Date(k + 'T00:00:00');
      return '<div class="r entry"><span class="t">' + esc(g.text) + '<small>' + d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + (g.achievedAt ? 'hit at ' + timeOf(g.achievedAt) : 'not marked') +
        (g.updates.length ? ' · ' + g.updates.length + ' update' + (g.updates.length === 1 ? '' : 's') : '') + '</small></span>' +
        '<span class="dot" style="background:' + (g.achievedAt ? T.lagoon : '#C8D3CC') + '"></span><button type="button" class="fx" data-delgoal="' + k + '" aria-label="Delete this goal">×</button></div>';
    }).join('') + '</div>';
    return { title: 'Daily targets', cap: won + ' of ' + gk.length + ' hit', html: h, bind: bindLog };
  }
  function historySheet() {
    var list = state.checkins.slice().reverse(), h = '';
    if (!list.length) h += '<p class="muted">Tap the coral button below, or wait for your next ping.</p>';
    else h += '<div class="list">' + list.slice(0, 50).map(function (c) {
      var t = new Date(c.t);
      return '<div class="r entry"><span class="t">' + (c.distractions.length ? esc(c.distractions.join(', ')) : 'Check-in') + '<small>' + t.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) + (c.note ? ' · “' + esc(c.note) + '”' : '') + '</small></span>' +
        (c.presence ? '<span class="v">' + c.presence + '/5</span>' : '') + '<button type="button" class="fx" data-delci="' + esc(c.t) + '" aria-label="Delete this check-in">×</button></div>';
    }).join('') + '</div>';
    return { title: 'Check-ins', cap: list.length + ' in total', html: h, bind: bindLog };
  }

  function bindLog(view) {
    view.querySelectorAll('[data-delci]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this check-in?')) return;
        var t = b.dataset.delci; state.checkins = state.checkins.filter(function (c) { return c.t !== t; }); save(); render(); toast('Check-in deleted');
      };
    });
    view.querySelectorAll('[data-delgoal]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this goal and its updates?')) return;
        delete state.goals[b.dataset.delgoal]; save(); syncGoal(); render(); toast('Goal deleted');
      };
    });
  }

  // ---------- reminders / settings ----------
  function b64url(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function keyBytes(k) { var p = '='.repeat((4 - k.length % 4) % 4), b = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  // This phone makes its own private reminder key; it only ever leaves the phone inside the code you paste into GitHub.
  function ensureKeys() {
    if (state.keys) return Promise.resolve(state.keys);
    return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']).then(function (kp) {
      return Promise.all([crypto.subtle.exportKey('raw', kp.publicKey), crypto.subtle.exportKey('jwk', kp.privateKey)]);
    }).then(function (r) {
      state.keys = { pub: b64url(r[0]), priv: r[1].d };
      save();
      return state.keys;
    });
  }
  function pushState() {
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    return { supported: supported, perm: supported ? Notification.permission : 'unsupported', on: supported && Notification.permission === 'granted' && !!state.code };
  }
  function renderSettings() {
    var ps = pushState(), sv = state.strava || {}, garminBad = sv.pass && sv.error;
    var ok = ps.on && !garminBad;
    var h = '<div class="stack">' + topbar('Settings');
    h += '<section class="hero" style="background:' + (ok ? T.jungle : T.coral) + ';color:#fff">' + sun(ok ? T.mango : 'rgba(255,255,255,.2)', 110, -26, -34) +
      '<span class="cap">Status</span><span class="display h2">' + (ok ? 'All systems<br><i>running</i>' : !ps.on ? 'Reminders<br><i>are off</i>' : 'Garmin sync<br><i>needs a look</i>') + '</span></section>';
    var last = state.lastBackup ? ago(state.lastBackup) : 'never';
    h += '<div class="list">' + row({ t: 'Reminders', v: ps.on ? 'connected' : 'off', dot: ps.on ? T.lagoon : T.coral, sheet: 'reminders' }) +
      row({ t: 'Garmin sync', v: garminStatus(), dot: garminDot(), sheet: 'garmin' }) +
      row({ t: 'Backup', v: last, dot: state.lastBackup && Date.now() - new Date(state.lastBackup) < 8 * 86400000 ? T.lagoon : T.mango, sheet: 'data' }) +
      row({ t: 'Ping schedule', v: '9 am – 9 pm', sheet: 'schedule' }) + row({ t: 'App version', v: APP_VERSION }) + '</div>';
    return h + '</div>';
  }
  function remindersSheet() {
    var ps = pushState(), standalone = window.matchMedia('(display-mode: standalone)').matches, n = 1;
    var h = '';
    if (!standalone) h += '<section class="card stack" style="gap:10px"><h2>' + (n++) + ' · Put the app on your home screen</h2><ol class="steps"><li>In Chrome, tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</li><li>Open <b>Attention</b> from your home screen and come back here.</li></ol></section>';
    h += '<section class="card stack" style="gap:12px"><h2>' + (n++) + ' · Turn on notifications</h2>';
    if (!ps.supported) h += '<p class="muted" style="margin:0">This browser can’t receive reminders. Open the app in Chrome.</p>';
    else if (ps.perm === 'denied') h += '<p style="margin:0">Notifications are blocked. Long-press the Attention icon → <b>App info</b> → <b>Notifications</b> → turn on, then reopen the app.</p>';
    else h += '<p class="muted" style="margin:0;font-size:14px">Tap the button and choose <b>Allow</b>. You’ll get a private setup code to paste into GitHub.</p><button type="button" class="btn solid" id="subBtn">' + (state.code ? 'Refresh my code' : 'Turn on reminders') + '</button>';
    if (state.code) {
      try { var ep = JSON.parse(atob(state.code.slice(6))).s.endpoint; h += '<span class="cap">Connection ID …' + esc(ep.slice(-6)) + '</span>'; } catch (e) {}
      h += '<div id="connCheck" class="notice">Checking this phone’s connection…</div>';
      h += '<label for="code" class="lab">Your private setup code</label><textarea class="code" id="code" readonly>' + esc(state.code) + '</textarea><button type="button" class="btn line" id="copyBtn">Copy code</button>' +
        '<p class="muted" style="margin:0;font-size:13px">Paste it only into GitHub: your <b>attention</b> project → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → secret <b>PUSH_SETUP</b>. Don’t share it anywhere else.</p>';
    }
    h += '</section>';
    if (ps.supported && ps.perm === 'granted') h += '<section class="card stack" style="gap:10px"><h2>Test on this phone</h2><p class="muted" style="margin:0;font-size:14px">Shows a sample reminder right now. Tap it to open a check-in.</p><button type="button" class="btn line" id="testBtn">Show a sample reminder</button></section>';
    return { title: 'Reminders', cap: ps.on ? 'connected' : 'off', html: h, bind: bindSettings };
  }
  function dataSheet() {
    var last = state.savedAt ? new Date(state.savedAt) : null;
    var h = '<div class="notice ok"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Auto-save is on' + (last ? ' · last saved ' + last.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '') + '</span></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Every tap is saved instantly on this phone, plus a daily snapshot (last 14 days). Clearing Chrome’s data or uninstalling would erase it, so save a backup file once a week.</p>' +
      '<div class="row"><button type="button" class="btn coral" id="expBtn" style="flex:1">Save backup</button><button type="button" class="btn line" id="impBtn" style="flex:1">Restore file</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>' +
      '<div class="stack" style="gap:8px"><span class="lab">Go back to an earlier day</span><div id="snaps" class="dchips"><span class="muted" style="font-size:13px">Loading…</span></div></div>' +
      '<div class="stack" style="gap:8px;padding-top:12px;border-top:1px solid #EADCC6"><span class="lab">Delete</span>' +
      '<p class="muted" style="margin:0;font-size:13px">Remove single check-ins or targets from Insights. Or:</p>' +
      '<div class="row" style="flex-wrap:wrap"><button type="button" class="btn line small" id="delCi">Delete all check-ins</button><button type="button" class="btn line small danger" id="resetBtn">Erase everything</button></div></div>';
    return { title: 'Your data', cap: state.lastBackup ? 'backup ' + ago(state.lastBackup) : 'no backup yet', html: h, bind: bindSettings };
  }
  function scheduleSheet() {
    var h = '<div class="list">' + row({ t: 'Morning target', sub: 'set your one thing for the day', v: '9 am', dot: T.coral }) + row({ t: 'Mindful pings', sub: 'random times, at least a little apart', v: PINGS + ' a day', dot: T.lagoon }) +
      row({ t: 'Movement snacks', sub: 'yoga, cardio, strength or stretching', v: 'every 30 min', dot: T.mango }) + row({ t: 'Last ping', v: '9 pm', dot: T.jungle }) + '</div>' +
      '<p class="muted small">' + esc(PING_INFO) + ' GitHub sends them, so a ping can arrive a few minutes late.</p>';
    return { title: 'Ping schedule', cap: '9 am – 9 pm', html: h, bind: bindSettings };
  }
  function bindSettings(view) {
    var cc = view.querySelector('#connCheck');
    if (cc && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        var stored = null; try { stored = JSON.parse(atob(state.code.slice(6))).s.endpoint; } catch (e) {}
        if (!sub) { cc.style.background = '#FFE1DB'; cc.innerHTML = '<b>Not connected.</b>&nbsp;This phone has no active reminder connection. Tap the button above, then update PUSH_SETUP on GitHub with the new code.'; state.code = null; save(); return; }
        if (sub.endpoint !== stored) {
          state.code = 'ATTN2.' + btoa(JSON.stringify({ s: sub.toJSON(), k: state.keys.pub, p: state.keys.priv })); save();
          cc.style.background = '#FFE1DB'; cc.innerHTML = '<b>Your code changed.</b>&nbsp;Copy the new code below and update PUSH_SETUP on GitHub.'; setTimeout(render, 2500); return;
        }
        cc.style.background = 'rgba(23,168,100,.14)'; cc.innerHTML = '✓ This phone is connected. If GitHub still says 410, the code saved on GitHub is an older one: copy this one and update PUSH_SETUP.';
      }).catch(function () { cc.textContent = 'Could not check the connection.'; });
    }
    var sb = view.querySelector('#subBtn');
    if (sb) sb.onclick = function () {
      sb.disabled = true; sb.textContent = 'Working…';
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') { render(); return; }
        return ensureKeys().then(function (keys) {
          return navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.getSubscription().then(function (sub) {
              var want = b64url(keyBytes(keys.pub));
              if (sub && sub.options && sub.options.applicationServerKey && b64url(sub.options.applicationServerKey) !== want) return sub.unsubscribe().then(function () { return null; });
              return sub;
            }).then(function (sub) {
              return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(keys.pub) });
            });
          });
        }).then(function (sub) {
          state.code = 'ATTN2.' + btoa(JSON.stringify({ s: sub.toJSON(), k: state.keys.pub, p: state.keys.priv }));
          save(); render();
          var c = document.getElementById('code'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }).catch(function (e) { toast('Could not turn on: ' + e.message); render(); });
    };
    var cp = view.querySelector('#copyBtn');
    if (cp) cp.onclick = function () {
      var c = view.querySelector('#code');
      (navigator.clipboard ? navigator.clipboard.writeText(c.value) : Promise.reject()).then(function () { toast('Copied'); }, function () { c.select(); document.execCommand('copy'); toast('Copied'); });
    };
    var tb = view.querySelector('#testBtn');
    if (tb) tb.onclick = function () {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification('Pause for a minute', { body: 'Where is your attention right now? Tap to check in.', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'attention-ping', data: { url: './?checkin=1' } });
      });
    };
    var eb = view.querySelector('#expBtn');
    if (eb) eb.onclick = function () {
      state.lastBackup = new Date().toISOString(); save(); setTimeout(render, 300);
      var a = document.createElement('a'), copy = JSON.parse(JSON.stringify(state));
      delete copy.keys; delete copy.code;
      a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
      a.download = 'attention-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    };
    var imp = view.querySelector('#impFile');
    if (!imp) return;
    view.querySelector('#impBtn').onclick = function () { imp.click(); };
    imp.onchange = function () {
      var f = imp.files[0]; if (!f) return;
      f.text().then(function (txt) {
        var d = JSON.parse(txt);
        if (!d || !d.days || !d.startDate) throw new Error('not an Attention backup');
        if (!confirm('Replace what’s on this phone with the backup from ' + (d.savedAt ? new Date(d.savedAt).toLocaleString('en') : f.name) + '?')) return;
        var code = state.code, keys = state.keys;
        state = d; state.code = state.code || code; state.keys = state.keys || keys;
        save(); syncGoal(); render(); toast('Backup restored');
      }).catch(function (e) { toast('Could not restore: ' + e.message); });
    };
    idbKeys().then(function (keys) {
      var snaps = keys.filter(function (k) { return String(k).indexOf('snap-') === 0; }).sort().reverse();
      var el = document.getElementById('snaps'); if (!el) return;
      if (!snaps.length) { el.innerHTML = '<span class="muted" style="font-size:13px">Snapshots will appear here from tomorrow.</span>'; return; }
      el.innerHTML = snaps.map(function (k) {
        var d = new Date(k.slice(5) + 'T00:00:00');
        return '<button type="button" class="dchip" data-snap="' + k + '">' + d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + '</button>';
      }).join('');
      el.querySelectorAll('[data-snap]').forEach(function (b) {
        b.onclick = function () {
          idbGet(b.dataset.snap).then(function (d) {
            if (!d || !confirm('Go back to how things were at the end of ' + b.textContent + '? Anything logged after that will be replaced.')) return;
            var code = state.code, keys = state.keys;
            state = d; state.code = code; state.keys = keys; save(); syncGoal(); render(); toast('Restored ' + b.textContent);
          });
        };
      });
    }).catch(function () { var el = document.getElementById('snaps'); if (el) el.innerHTML = '<span class="muted" style="font-size:13px">Not available in this browser.</span>'; });
    view.querySelector('#delCi').onclick = function () {
      if (!state.checkins.length) { toast('No check-ins to delete'); return; }
      if (!confirm('Delete all ' + state.checkins.length + ' check-ins? Your progress, goals and journal stay.')) return;
      state.checkins = []; save(); render(); toast('Check-ins deleted');
    };
    view.querySelector('#resetBtn').onclick = function () {
      if (!confirm('Erase everything: progress, goals, journal and check-ins? The 30 days restart from today. (Tip: save a backup file first.)')) return;
      if (prompt('Type ERASE to confirm') !== 'ERASE') { toast('Nothing was erased'); return; }
      var code = state.code, keys = state.keys; state = fresh(); state.code = code; state.keys = keys;
      state.days[1].sit = false; state.days[1].note = '';
      var t = new Date(); state.startDate = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      save(); ui.sel = null; ui.tab = 'trail'; closeSheet(); render();
    };
  }

  // ---------- detail sheets (slide up from the bottom) ----------
  function sheetFor(kind, arg) {
    switch (kind) {
      case 'progress': return progressSheet();
      case 'day': return daySheet(ui.sel || todayNum());
      case 'move': return { title: 'Movement', cap: 'every 30 min', html: bodyCard(), bind: function (r) { bindTrail(r, todayNum()); } };
      case 'meal': return mealSheet(arg || 'breakfast');
      case 'about': return aboutSheet();
      case 'targets': return targetsSheet();
      case 'weight': return weightSheet();
      case 'week': return weekSheet();
      case 'roadmap': return roadmapSheet();
      case 'garmin': return garminSheet();
      case 'dist': return distSheet();
      case 'mvstat': return mvstatSheet();
      case 'goals': return goalsSheet();
      case 'history': return historySheet();
      case 'reminders': return remindersSheet();
      case 'data': return dataSheet();
      case 'schedule': return scheduleSheet();
    }
    return null;
  }
  function drawSheet() {
    var w = document.getElementById('sheet');
    if (!ui.sheet) { w.hidden = true; return; }
    var s = sheetFor(ui.sheet.kind, ui.sheet.arg);
    if (!s) { ui.sheet = null; w.hidden = true; return; }
    var body = w.querySelector('.sbody'), top = body.scrollTop;
    w.querySelector('.stitle').innerHTML = s.title;
    w.querySelector('.scap').innerHTML = s.cap || '';
    body.innerHTML = s.html;
    body.scrollTop = top;
    w.hidden = false;
    document.body.style.overflow = 'hidden';
    s.bind(body);
  }
  function openSheet(spec) {
    var p = String(spec).split(':'), w = document.getElementById('sheet'), first = !ui.sheet;
    ui.sheet = { kind: p[0], arg: p.slice(1).join(':') };
    w.querySelector('.sbody').scrollTop = 0;
    if (first) { try { history.pushState({ sheet: 1 }, ''); } catch (e) {} w.classList.remove('in'); }
    drawSheet();
    if (first) requestAnimationFrame(function () { requestAnimationFrame(function () { w.classList.add('in'); }); });
    if (p[0] === 'garmin') stravaSync(false);
  }
  function closeSheet(fromPop) {
    if (!ui.sheet) return;
    ui.sheet = null;
    var w = document.getElementById('sheet');
    w.classList.remove('in'); w.hidden = true; w.querySelector('.panel').style.transform = '';
    document.body.style.overflow = '';
    if (!fromPop && history.state && history.state.sheet) { try { history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { if (ui.sheet) closeSheet(true); });
  (function () {
    var w = document.getElementById('sheet'), panel = w.querySelector('.panel'), y0 = null, dy = 0;
    w.querySelector('.dim').addEventListener('click', function () { closeSheet(); });
    w.querySelector('.sclose').addEventListener('click', function () { closeSheet(); });
    var head = w.querySelector('.shead');
    head.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none'; }, { passive: true });
    head.addEventListener('touchmove', function (e) { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
    head.addEventListener('touchend', function () { panel.style.transition = ''; if (dy > 90) closeSheet(); else panel.style.transform = ''; y0 = null; });
  })();
  // rows and cards that open a sheet or jump to another tab
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-sheet],[data-tab-go]');
    if (!t) return;
    if (t.dataset.sheet) { openSheet(t.dataset.sheet); return; }
    var g = t.dataset.tabGo.split(':');
    closeSheet(); ui.tab = g[0]; if (g[1]) fitUi.view = g[1];
    render(); window.scrollTo(0, 0);
  });

  // ---------- shell ----------
  function render() {
    var view = document.getElementById('view');
    if (ui.tab === 'trail') { view.innerHTML = renderToday(); bindTrail(view, todayNum()); }
    else if (ui.tab === 'log') { view.innerHTML = renderLog(); bindLog(view); }
    else if (ui.tab === 'fit') { view.innerHTML = renderFit(); bindFit(view); if (fitUi.view === 'plan') stravaSync(false); }
    else { view.innerHTML = renderSettings(); bindSettings(view); stravaSync(false); }
    document.querySelectorAll('.tab[data-tab]').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); t.setAttribute('aria-current', t.dataset.tab === ui.tab ? 'page' : 'false'); });
    drawSheet();
  }
  document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { closeSheet(); ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); });
  });
  document.getElementById('checkinBtn').addEventListener('click', openCheckin);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.type === 'move') { var mm = /move=([a-z0-9]+)/.exec(e.data.url || ''); if (gv || ci) closeCheckin(); openMove(mm ? mm[1] : suggestMove()); return; }
      if (e.data.type === 'goal') { if (ci) closeCheckin(); if (/win=1/.test(e.data.url || '') && todayGoal() && !todayGoal().achievedAt) mutate(function () { goalUpdate('', true); }); openGoal(); return; }
      else if (e.data.type === 'checkin' && !ci) { if (gv) closeCheckin(); openCheckin(); }
    });
  }
  var lastDay = todayNum();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && todayNum() !== lastDay) { lastDay = todayNum(); ui.sel = null; render(); } });

  render();
  syncGoal();
  if (/[?&]win=1/.test(location.search)) { if (todayGoal() && !todayGoal().achievedAt) mutate(function () { goalUpdate('', true); }); openGoal(); }
  else if (/[?&]goal=1/.test(location.search)) openGoal();
  else if (/[?&]checkin=1/.test(location.search)) openCheckin();
})();
