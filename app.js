/* Attention — thirty days on the trail, plus random mindful check-ins. */
(function () {
  'use strict';

  var STORE_KEY = 'attention.v1';
  var APP_VERSION = '48';
  var PINGS = 10; // random check-in pings per day (keep in step with config.json)
  var PING_INFO = 'A good-morning ping at 9am for your visualization and today’s targets, then 10 mindful pings at random times until 9pm and a before-bed ping at 10pm. In between, a movement snack every 30 minutes: yoga, cardio, strength or stretching, no equipment needed.';

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
  // ---------- daily targets: several a day; tonight you can plan tomorrow's ----------
  function dkey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayDate(n) { var d = startDate(); d.setDate(d.getDate() + n - 1); return d; }
  // older versions kept one "goal" per day: turn those into targets
  function migrate(st) {
    if (!st) return;
    if (!st.targets) {
      st.targets = {};
      Object.keys(st.goals || {}).forEach(function (k) {
        var g = st.goals[k];
        if (g && g.text) st.targets[k] = [{ id: 'g' + k.replace(/-/g, ''), text: g.text, setAt: g.setAt, updates: g.updates || [], achievedAt: g.achievedAt || null }];
      });
      delete st.goals;
    }
    st.journal = st.journal || {};
  }
  migrate(state);
  function targetsFor(key) { return (state.targets || {})[key] || []; }
  function todayTargets() { return targetsFor(dkey(new Date())); }
  function openTargets() { return todayTargets().filter(function (t) { return !t.achievedAt; }); }
  function tomorrowKey() { var d = new Date(); d.setDate(d.getDate() + 1); return dkey(d); }
  function findTarget(id) {
    var ks = Object.keys(state.targets || {});
    for (var i = 0; i < ks.length; i++) { var a = state.targets[ks[i]]; for (var j = 0; j < a.length; j++) if (a[j].id === id) return { t: a[j], key: ks[i], list: a }; }
    return null;
  }
  function addTarget(key, text, pri) {
    state.targets = state.targets || {};
    (state.targets[key] = state.targets[key] || []).push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text, pri: pri || 'm', setAt: new Date().toISOString(), updates: [], achievedAt: null, planned: key > dkey(new Date()) });
  }
  function isAchievedText(t) { return /^\s*(achieved|done|hit)[.!\s]*$/i.test(t || ''); }
  function targetUpdate(t, text, achieved) {
    text = (text || '').trim();
    if (isAchievedText(text)) { achieved = true; text = ''; }
    if (text) t.updates.push({ t: new Date().toISOString(), text: text });
    if (achieved && !t.achievedAt) t.achievedAt = new Date().toISOString();
  }
  function hitCount(key) { return targetsFor(key).filter(function (t) { return t.achievedAt; }).length; }
  // the service worker adds the open targets to each ping
  function syncGoal() {
    try {
      var o = openTargets();
      caches.open('attention-data').then(function (c) {
        return c.put('goal.json', new Response(JSON.stringify(o.length ? { day: dkey(new Date()), text: o.map(function (t) { return t.text; }).join(' · '), n: o.length } : {}), { headers: { 'Content-Type': 'application/json' } }));
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
    var dk = dkey(dayDate(n)), ts = targetsFor(dk);
    xp += Math.min(ts.length, 5) * 5 + Math.min(hitCount(dk), 5) * 20;
    if ((state.vizDone || {})[dk]) xp += 5;
    xp += Math.min(movesOn(dkey(dayDate(n))).length, 12) * 5;
    xp += Math.min(trainingOn(dkey(dayDate(n))) + badmintonOn(dkey(dayDate(n))), 2) * 10;
    xp += chessXp(dk) + thinkXp(dk);
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
    var link = o.sheet || o.tab || o.id, attrs = o.sheet ? ' data-sheet="' + o.sheet + '"' : o.tab ? ' data-tab-go="' + o.tab + '"' : o.id ? ' id="' + o.id + '"' : '';
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
    // top card: greeting, three live numbers, and today's practices (done ones disappear)
    var mvN = LIB ? movesOn(key).length : 0, cN = checkinsOn(today).length, bc = bodyCalc(), eaten = sumItems(foodDay(key).filter(function (i) { return !i.planned; }));
    var ex = Math.round(exerciseKcal(key)), wz = wellnessRecent('steps', 1);
    var tile = function (attr, v, l) { return '<button type="button" class="htile" ' + attr + '><b class="display">' + v + '</b><small>' + l + '</small></button>'; };
    h += '<div class="hero htop" role="button" tabindex="0" data-sheet="progress" aria-label="Your 30-day progress" style="background:' + T.jungle + ';color:#fff">' + sun(T.mango, 120, -40, -50) + wave(T.lagoon, .4, 40, 20) +
      '<span class="cap">Day ' + today + ' of 30' + (st ? ' · ' + st + '-day streak' : '') + '</span>' +
      '<span class="hrow"><span class="dring">' + dayRing(78, 5) + '<b class="display">' + today + '</b></span><span class="display greet">' + greet() + '<br><i>' + esc(myName()) + '</i></span></span>' +
      '<div class="htiles">' + tile('data-sheet="move"', mvN, 'moves today') +
      (wz ? tile('data-sheet="garminday"', fmtN(wz.v), 'steps' + (wz.d === key ? '' : ' · yesterday')) : tile('data-tab-go="log"', cN + '<span>/' + PINGS + '</span>', 'check-ins')) +
      tile('data-tab-go="fit:food"', bc ? fmtN(Math.max(0, bc.kcal + ex - eaten.kcal)) : fmtN(eaten.kcal), bc ? 'kcal left' : 'kcal eaten') + '</div>';
    var vd = (state.vizDone || {})[key], vs = vizSettings(), pills = '';
    if (!vd) pills += '<button type="button" class="hpill" data-viz="1"><span class="pp">' + PLAY + '</span>Visualize <i>' + vs.mins + ' min</i></button>';
    if (new Date().getHours() >= 12 && !brDone(key)) pills += '<button type="button" class="hpill" data-breath="1"><span class="pp">🌬</span>Breathe <i>' + brMins() + ' min</i></button>';
    if (!drillDoneToday()) pills += '<button type="button" class="hpill" data-drill="1"><span class="pp">🧠</span>Think <i>3 min</i></button>';
    questsFor(today).forEach(function (q) {
      if (d[q.f]) return;
      pills += q.mins ? '<button type="button" class="hpill" data-begin="' + q.f + '" data-mins="' + q.mins + '"><span class="pp">' + PLAY + '</span>' + q.n + ' <i>' + q.mins + ' min</i></button>'
        : '<button type="button" class="hpill" data-qt="' + q.f + '" aria-label="Mark done: ' + q.n + '"><span class="pp o"></span>' + q.n + '</button>';
    });
    h += '<div class="hpills">' + (pills || '<span class="hdone">✓ Today’s practices are done</span>') + '<button type="button" class="hpill" data-spend="1"><span class="pp">₹</span>Spend</button></div></div>';
    if (backupDue()) h += '<div class="list"><button type="button" class="r" data-bkup="1"><span class="dot" style="background:' + T.lagoon + '"></span><span class="t">☁ Back up today<small>' + (state.gdrive && state.gdrive.cid ? 'one tap: everything goes to your Google Drive' : 'pack everything and save it to Drive') + '</small></span>' + CHEV + '</button></div>';
    if (new Date().getHours() < 12) h += breathCard();
    h += timerBlock();
    h += goalCard();
    var up = [], dd0 = new Date();
    for (var hi = 0; hi < 8; hi++) { var dk = dkey(dd0); holidaysOn(dk).filter(function (x) { return x.t === 'public'; }).forEach(function (x) { up.push({ d: dk, n: x.n }); }); dd0.setDate(dd0.getDate() + 1); }
    if (up.length) h += '<div class="list">' + up.slice(0, 2).map(function (x) { return '<button type="button" class="r" data-ocal="' + x.d + '"><span class="dot" style="background:' + T.hib + '"></span><span class="t">' + esc(x.n) + '<small>' + (x.d === key ? 'today · public holiday' : new Date(x.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · public holiday') + '</small></span>' + CHEV + '</button>'; }).join('') + '</div>';
    var hasNote = !!(d.note || '').trim(), jn = state.journal[key] || {};
    h += '<div class="list">' + row({ t: 'Journal', sub: missedYesterday() ? 'yesterday is still empty: fill it in tonight' : jn.well ? esc(jn.well) : hasNote ? esc(d.note) : 'tonight: your day, and tomorrow’s targets', v: hasNote || jn.well ? '✓' : '+5', sheet: missedYesterday() ? 'tonight:' + yesterdayKey() : 'tonight' }) + '</div>';
    return h + '</div>';
  }

  var PRI = { h: ['#E5484D', 'High'], m: ['#F5B82E', 'Medium'], l: ['#2FA36B', 'Low'] };
  function priOf(t) { return PRI[t.pri] ? t.pri : 'm'; }
  // open targets first (high → low priority), finished ones at the bottom
  function sortTargets(ts) {
    var rank = { h: 0, m: 1, l: 2 };
    return ts.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) {
      return (!!a.t.achievedAt - !!b.t.achievedAt) || (a.t.achievedAt ? 0 : rank[priOf(a.t)] - rank[priOf(b.t)]) || (a.t.achievedAt && b.t.achievedAt ? (a.t.achievedAt < b.t.achievedAt ? -1 : 1) : a.i - b.i);
    }).map(function (x) { return x.t; });
  }

  var TICK = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function tsub(t) {
    var lu = t.updates[t.updates.length - 1];
    return t.achievedAt ? 'hit at ' + timeOf(t.achievedAt) : t.calId && !lu ? '📅 from your calendar' : lu ? 'Latest: ' + esc(lu.text) + ' · ' + timeOf(lu.t) : t.planned ? 'planned the night before' : 'no update yet';
  }
  function tickBtn(t, cls) { return '<button type="button" class="tck ' + (cls || '') + (t.achievedAt ? ' on' : '') + '"' + (t.achievedAt ? '' : ' style="border-color:' + PRI[priOf(t)][0] + '"') + ' data-thit="' + t.id + '" aria-pressed="' + !!t.achievedAt + '" aria-label="' + (t.achievedAt ? 'Mark as not hit: ' : 'Mark as hit: ') + esc(t.text) + '">' + (t.achievedAt ? TICK : '') + '</button>'; }
  function goalCard() {
    var ts = todayTargets(), hit = ts.filter(function (t) { return t.achievedAt; }).length;
    if (!ts.length) return '<button type="button" class="hero goalc" data-sheet="targets" style="background:' + T.coral + ';color:#fff">' + sun('rgba(255,255,255,.18)', 90, -26, -30) +
      '<span class="cap">Today’s targets · +5 XP each</span><span class="display gt">What do you want to get done today?</span><span class="go">Set today’s targets →</span></button>';
    var h = '<div class="hero goalc tcard" role="button" tabindex="0" data-sheet="targets" aria-label="Today’s targets">' + sun('#FFE6B8', 80, -24, -30) +
      '<span class="row between"><span class="cap" style="color:' + T.coral + ';opacity:1">Today’s targets</span><span class="pill">' + hit + ' of ' + ts.length + ' hit</span></span><div class="tgl">';
    sortTargets(ts).slice(0, 6).forEach(function (t) {
      var p = priOf(t);
      h += '<div class="tg">' + tickBtn(t) + '<span class="tt' + (t.achievedAt ? ' done' : '') + '">' + esc(t.text) + '<small>' + tsub(t) + '</small></span>' + (t.achievedAt ? '' : '<span class="plab" style="color:' + PRI[p][0] + '">' + (p === 'm' ? 'MED' : PRI[p][1].toUpperCase()) + '</span>') + '</div>';
    });
    if (ts.length > 6) h += '<span class="small">+ ' + (ts.length - 6) + ' more</span>';
    return h + '</div><span class="go" style="color:' + T.coral + '">Update or add →</span></div>';
  }
  function priPicker(attr, cur) {
    return '<span class="pris">' + ['h', 'm', 'l'].map(function (k) { return '<button type="button" class="pri' + (cur === k ? ' on' : '') + '" ' + attr + k + '" style="--pc:' + PRI[k][0] + '" aria-label="' + PRI[k][1] + ' priority" aria-pressed="' + (cur === k) + '"></button>'; }).join('') + '</span>';
  }
  function bindTargets(root) {
    root.querySelectorAll('[data-tpri]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var p = b.dataset.tpri.split('|'), f = findTarget(p[0]); if (f) { f.t.pri = p[1]; save(); syncGoal(); render(); } }); });
    root.querySelectorAll('[data-npri]').forEach(function (b) { b.addEventListener('click', function () { ui.newPri = b.dataset.npri; var inp = root.querySelector('#tNew'), v = inp ? inp.value : ''; drawSheet(); var n = document.getElementById('tNew'); if (n) { n.value = v; try { n.focus(); } catch (e) {} } }); });
    root.querySelectorAll('[data-thit]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var f = findTarget(b.dataset.thit); if (!f) return;
        var was = !!f.t.achievedAt;
        mutate(function () { if (was) f.t.achievedAt = null; else targetUpdate(f.t, '', true); });
        if (!was) toast('Target hit · +20 XP');
      });
    });
    var add = root.querySelector('#tAdd'), inp = root.querySelector('#tNew');
    if (add) {
      var go = function () { var v = inp.value.trim(); if (!v) { inp.focus(); return; } var k = inp.dataset.key; mutate(function () { addTarget(k, v, ui.newPri || 'm'); }); var n = document.getElementById('tNew'); if (n) try { n.focus(); } catch (e) {} };
      add.onclick = go;
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
    root.querySelectorAll('[data-tdel]').forEach(function (b) {
      b.onclick = function () { var f = findTarget(b.dataset.tdel); if (!f || !confirm('Delete “' + f.t.text + '”?')) return; f.list.splice(f.list.indexOf(f.t), 1); if (!f.list.length) delete state.targets[f.key]; save(); syncGoal(); if (ui.sheet && ui.sheet.kind === 'target') closeSheet(); render(); };
    });
    var tu = root.querySelector('#tuText');
    if (tu) {
      var id = tu.dataset.tid;
      if (state.tuDraft && state.tuDraft.id === id && !tu.value) tu.value = state.tuDraft.text;
      tu.addEventListener('input', function () { state.tuDraft = { id: id, text: tu.value }; save(); });
      var sv = function (win) {
        var f = findTarget(id); if (!f) return; var tx = tu.value; if (!tx.trim() && !win) { tu.focus(); return; }
        var hitNow = win || isAchievedText(tx);
        delete state.tuDraft; mutate(function () { targetUpdate(f.t, tx, win); });
        toast(hitNow ? 'Target hit · +20 XP' : 'Update saved');
      };
      root.querySelector('#tuSave').onclick = function () { sv(false); };
      root.querySelector('#tuWin').onclick = function () { sv(true); };
    }
    var un = root.querySelector('#tuUndo'); if (un) un.onclick = function () { var f = findTarget(un.dataset.tid); if (f) mutate(function () { f.t.achievedAt = null; }); };
    var ed = root.querySelector('#tuEdit'); if (ed) ed.onclick = function () { var f = findTarget(ed.dataset.tid); if (!f) return; var v = prompt('Edit target', f.t.text); if (v && v.trim()) mutate(function () { f.t.text = v.trim(); }); };
  }
  function targetsSheet() {
    var tk = dkey(new Date()), ts = todayTargets(), hit = hitCount(tk), tom = targetsFor(tomorrowKey());
    var h = ts.length ? '<div class="list">' + sortTargets(ts).map(function (t) {
      var st = t.achievedAt ? ['hit', '#CDEFEA'] : t.updates.length ? ['going', '#FFE6B8'] : ['to do', '#F1E6D6'];
      return '<div class="r' + (t.achievedAt ? ' faded' : '') + '">' + tickBtn(t) + '<button type="button" class="rt" data-sheet="target:' + t.id + '"><span class="t">' + esc(t.text) + '<small>' + tsub(t) + '</small></span></button>' + (t.achievedAt ? '<span class="pill" style="background:' + st[1] + '">' + st[0] + '</span>' : priPicker('data-tpri="' + t.id + '|', priOf(t))) + '</div>';
    }).join('') + '</div>' : '<p class="muted" style="margin:0">No targets yet. What matters most today? Add one, two or three.</p>';
    h += '<div class="row addrow"><input id="tNew" data-key="' + tk + '" class="text" placeholder="Add a target for today" style="flex:1" enterkeyhint="done">' + priPicker('data-npri="', ui.newPri || 'm') + '<button type="button" class="btn coral" id="tAdd">Add</button></div>';
    h += '<div class="list">' + row({ t: 'Tomorrow’s targets', sub: 'they become tomorrow’s automatically', v: tom.length ? tom.length + ' planned' : 'plan', dot: T.mango, sheet: 'tomorrow' }) + '</div>';
    h += '<p class="muted small">Priority: <b style="color:#E5484D">red high</b> · <b style="color:#C98A12">yellow medium</b> · <b style="color:#2FA36B">green low</b>. Tap a dot to change it. Done targets drop to the bottom. Every ping asks about the targets that aren’t hit yet; +5 XP for each target set, +20 for each hit (up to 5 a day).</p>';
    return { title: 'Targets', cap: hit + ' of ' + ts.length + ' hit', html: h, bind: bindTargets };
  }
  function targetSheet(id) {
    var f = findTarget(id); if (!f) return targetsSheet();
    var t = f.t, other = f.key !== dkey(new Date());
    var h = '<div class="hero goalc" style="background:' + (t.achievedAt ? T.lagoon : T.coral) + ';color:#fff">' + sun('rgba(255,255,255,.18)', 90, -26, -30) +
      '<span class="cap">' + (other ? new Date(f.key + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' : '') + 'set ' + timeOf(t.setAt) + '</span><span class="display gt">' + esc(t.text) + '</span></div>';
    h += '<div class="row between"><span class="lab">Priority</span><div class="row" style="gap:6px">' + ['h', 'm', 'l'].map(function (k) { return '<button type="button" class="opt sm" data-tpri="' + t.id + '|' + k + '" aria-pressed="' + (priOf(t) === k) + '" style="' + (priOf(t) === k ? 'background:' + PRI[k][0] + ';color:#fff' : '') + '"><span class="dot" style="display:inline-block;background:' + PRI[k][0] + ';margin-right:6px"></span>' + PRI[k][1] + '</button>'; }).join('') + '</div></div>';
    if (t.updates.length) h += '<div class="list">' + t.updates.map(function (u) { return '<div class="r upd2"><span class="cap">' + timeOf(u.t) + '</span><span class="t">' + esc(u.text) + '</span></div>'; }).join('') + '</div>';
    if (!t.achievedAt) {
      h += '<textarea class="text" id="tuText" data-tid="' + t.id + '" placeholder="Where are you with it? (or type “done”)"></textarea>' +
        '<div class="row"><button type="button" class="btn line" id="tuSave" style="flex:1">Save update</button><button type="button" class="btn lagoon" id="tuWin" style="flex:1">Hit it · +20</button></div>';
    } else h += '<div class="notice ok">Hit at ' + timeOf(t.achievedAt) + '. Nice work.</div><button type="button" class="btn line small" id="tuUndo" data-tid="' + t.id + '" style="align-self:flex-start">Undo: not hit yet</button>';
    h += '<div class="row"><button type="button" class="link" id="tuEdit" data-tid="' + t.id + '">Edit text</button><button type="button" class="link" data-tdel="' + t.id + '" style="color:#D9463A">Delete target</button></div>';
    return { title: 'Update', cap: t.updates.length + ' update' + (t.updates.length === 1 ? '' : 's'), html: h, bind: bindTargets };
  }
  function planList(k) {
    var ts = targetsFor(k);
    return (ts.length ? '<div class="list">' + ts.map(function (t) { return '<div class="r"><span class="dot" style="background:' + PRI[priOf(t)][0] + '"></span><span class="t">' + esc(t.text) + '</span><button type="button" class="fx" data-tdel="' + t.id + '" aria-label="Delete ' + esc(t.text) + '">×</button></div>'; }).join('') + '</div>' : '') +
      '<div class="row addrow"><input id="tNew" data-key="' + k + '" class="text" placeholder="Add a target for tomorrow" style="flex:1" enterkeyhint="done">' + priPicker('data-npri="', ui.newPri || 'm') + '<button type="button" class="btn coral" id="tAdd">Add</button></div>';
  }
  function tomorrowSheet() {
    var k = tomorrowKey(), d = new Date(k + 'T00:00:00');
    var h = '<p class="muted" style="margin:0">Plan the day ahead. These show up as tomorrow’s targets automatically, and the morning ping will remind you of them.</p>' + planList(k);
    return { title: 'Tomorrow', cap: d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }), html: h, bind: bindTargets };
  }
  // night journal: mood, two short prompts, and tomorrow's targets
  var MOODS = ['😞', '😐', '🙂', '😄'];
  function hasJournal(k) { var j = (state.journal || {})[k]; return !!(j && (j.well || j.away || j.more || j.mood)); }
  function yesterdayKey() { var d = new Date(); d.setDate(d.getDate() - 1); return dkey(d); }
  function missedYesterday() { var yk = yesterdayKey(); return yk >= state.startDate && !hasJournal(yk); }
  function tonightSheet(key) {
    var tk = dkey(new Date()); key = key || tk;
    var yk = yesterdayKey(), both = missedYesterday() && (key === tk || key === yk);
    var j = state.journal[key] || {}, d = new Date(key + 'T00:00:00'), n = dayNumFor(d), note = n >= 1 && n <= 30 ? state.days[n].note : '';
    var h = '<div class="hero" style="background:#1B2F5A;color:#fff">' + sun('#FFE6B8', 70, 22, 18) + '<span class="cap">' + (key === tk ? 'Before bed' : d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' })) + '</span><span class="display h2" style="margin:0">How was<br><i>' + (key === tk ? 'your day?' : 'that day?') + '</i></span></div>';
    if (both) h = '<div class="jmiss">You didn’t write yesterday. <b>Fill both</b> while you remember, yesterday first.</div><div class="seg2 jtabs" role="tablist"><button type="button" role="tab" data-sheet="tonight:' + yk + '" aria-selected="' + (key === yk) + '">' + new Date(yk + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · missed</button><button type="button" role="tab" data-sheet="tonight" aria-selected="' + (key === tk) + '">Today</button></div>' + h;
    h += '<div class="optrow" role="group" aria-label="Mood">' + MOODS.map(function (m, i) { return '<button type="button" class="opt mood" data-mood="' + (i + 1) + '" aria-pressed="' + (j.mood === i + 1) + '">' + m + '</button>'; }).join('') + '</div>';
    h += '<label class="lab" for="jWell">What went well?</label><textarea class="text" id="jWell" data-jkey="' + key + '" placeholder="one or two things">' + esc(j.well || '') + '</textarea>';
    h += '<label class="lab" for="jAway">What pulled you away? <span class="muted">+5 XP</span></label><textarea class="text" id="jAway" placeholder="a thought, a ping, a craving…">' + esc(j.away || note || '') + '</textarea>';
    if (key === tk && (restNeeded() || (state.restLog || {})[tk])) {
      var rc0 = restCal();
      h += '<div class="restask"><label class="lab" for="jRest">Garmin resting calories today <span class="muted">' + (rc0 ? (rc0.stable ? '· calibrated' : '· day ' + Math.min(rc0.n + ((state.restLog || {})[tk] ? 0 : 1), 99) + (rc0.n < 5 ? ' of 5' : ', settling')) : '· day 1 of 5') + '</span></label>' +
        '<input class="text" id="jRest" type="number" inputmode="numeric" placeholder="Garmin Connect → Calories → Resting" value="' + ((state.restLog || {})[tk] || '') + '"><small class="muted">Helps the app learn your real calorie burn.</small></div>';
    }
    h += '<label class="lab" for="jMore">Anything else on your mind?</label><textarea class="text" id="jMore" placeholder="optional">' + esc(j.more || '') + '</textarea>';
    if (key === tk) h += '<div class="row between"><span class="lab">Tomorrow’s targets</span><span class="cap">become tomorrow’s</span></div>' + planList(tomorrowKey());
    h += '<button type="button" class="btn jungle" id="jDone">' + (key === tk ? 'Save · good night' : key === yk && !hasJournal(tk) ? 'Save ' + new Date(yk + 'T00:00:00').toLocaleDateString('en', { weekday: 'long' }) + ' → today' : 'Save') + '</button>';
    return { title: key === tk ? 'Tonight' : 'Journal', cap: key === tk ? new Date().toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '', html: h, bind: function (r) { bindTargets(r); bindJournal(r); } };
  }
  function bindJournal(r) {
    var w = r.querySelector('#jWell'); if (!w) return;
    var key = w.dataset.jkey, n = dayNumFor(new Date(key + 'T00:00:00'));
    var put = function () {
      var j = state.journal[key] = state.journal[key] || {};
      j.well = w.value; j.away = r.querySelector('#jAway').value; j.more = r.querySelector('#jMore').value; j.at = new Date().toISOString();
      if (n >= 1 && n <= 30) state.days[n].note = j.away;
      save();
    };
    ['#jWell', '#jAway', '#jMore'].forEach(function (id) { r.querySelector(id).addEventListener('input', put); });
    var jr = r.querySelector('#jRest');
    if (jr) jr.addEventListener('change', function () { var v = +jr.value; state.restLog = state.restLog || {}; if (v > 600 && v < 5000) { state.restLog[key] = Math.round(v); save(); var rc = restCal(); toast(rc.stable ? 'Calibrated! Resting burn ≈ ' + fmtN(rc.avg) + ' kcal' : 'Saved · ' + rc.n + ' day' + (rc.n === 1 ? '' : 's') + ' so far'); } else if (jr.value) toast('That looks off: resting calories are usually 1,200–2,500'); });
    r.querySelectorAll('[data-mood]').forEach(function (b) { b.onclick = function () { put(); state.journal[key].mood = +b.dataset.mood; save(); drawSheet(); }; });
    r.querySelector('#jDone').onclick = function () {
      put();
      if (key === yesterdayKey() && !hasJournal(dkey(new Date()))) { mutate(function () {}); openSheet('tonight'); toast('Saved. Now today.'); return; }
      closeSheet(); mutate(function () {}); toast(key === dkey(new Date()) ? 'Saved. Good night.' : 'Saved');
    };
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
    var best = bestStreak(), nC = state.checkins.length, nG = Object.keys(state.targets || {}).reduce(function (a, k) { return a + hitCount(k); }, 0);
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
    view.querySelectorAll('[data-qt]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); var f = b.dataset.qt; mutate(function () { state.days[sel][f] = true; }); }); });
    view.querySelectorAll('[data-begin]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); ui.tab = 'trail'; startTimer(sel, b.dataset.begin, +b.dataset.mins); window.scrollTo(0, 0); });
    });
    var stop = view.querySelector('#stopT');
    if (stop) stop.addEventListener('click', function () { clearInterval(ui.timer.iv); ui.timer = null; render(); });
    view.querySelectorAll('[data-goal]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.goal === 'win') hitSingle();
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
    resetOverlay();
    var dr = state.ciDraft;
    if (dr && Date.now() - dr.at < 10 * 60000) { ci = Object.assign({ stage: 'reflect', secs: 60, running: false, left: 60 }, dr.ci); drawCheckin(); document.getElementById('overlay').hidden = false; document.body.style.overflow = 'hidden'; return; }
    ci = { stage: openTargets().length ? 'goal' : 'setup', secs: 60, running: false, left: 60, picks: [], presence: 0, note: '', gNew: '', tu: {}, th: {} };
    drawCheckin();
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeCheckin() {
    resetOverlay(); closeOverlayEl();
    if (location.search) history.replaceState(history.state, '', location.pathname);
  }
  function drawCheckin() {
    var o = document.getElementById('overlay'), h = '<div class="inner">';
    o.classList.toggle('dark', ['breathe', 'setup', 'cairn', 'chessload', 'lesson', 'puzzle', 'pzdone'].indexOf(ci.stage) >= 0);
    h += '<div class="row between"><span class="eyebrow">Mindful check-in</span><div class="row" style="gap:8px">' + (ci.stage === 'reflect' ? '<button type="button" class="btn ghost small" id="ciDiscard">Discard</button>' : '') + '<button type="button" class="btn ghost small" id="ciClose">Close</button></div></div>';
    if (ci.stage === 'reflect') h += '<span class="muted" style="font-size:12px;margin-top:-10px">Saved as you type. Close any time and come back.</span>';
    if (ci.stage === 'goal') {
      var ots = openTargets();
      h += '<div><span class="eyebrow">Target check · 1 of 3</span><h1 style="font-size:26px;margin-top:6px">How are your targets going?</h1></div>';
      ots.forEach(function (t) {
        var lu = t.updates[t.updates.length - 1];
        h += '<section class="card goal" style="gap:8px"><p class="gtext" style="font-size:19px">' + esc(t.text) + '</p>' + (lu ? '<span style="font-size:13px;opacity:.9">Last: ' + esc(lu.text) + ' · ' + timeOf(lu.t) + '</span>' : '') +
          '<textarea class="text gcT" data-tid="' + t.id + '" style="min-height:60px" placeholder="update (optional)">' + esc(ci.tu[t.id] || '') + '</textarea>' +
          '<button type="button" class="dchip gcH" data-tid="' + t.id + '" aria-pressed="' + !!ci.th[t.id] + '" style="align-self:flex-start;--c:#0F4D40">' + (ci.th[t.id] ? '✓ Hit it' : 'Mark as hit') + '</button></section>';
      });
      h += '<button type="button" class="btn solid" id="gcSave">Save → breathe</button>';
      h += '<button type="button" class="btn ghost" id="gcSkip">Skip the targets this time</button>';
    } else if (ci.stage === 'setup') { h += setupHtml();
    } else if (ci.stage === 'cairn') { h += cairnHtml();
    } else if (ci.stage === 'chessload') { h += '<div class="gprobe"><span class="gglow"></span><span class="gnote">Setting up the board…</span></div>';
    } else if (ci.stage === 'lesson') { h += lessonHtml();
    } else if (ci.stage === 'puzzle') { h += puzzleHtml();
    } else if (ci.stage === 'pzdone') { h += pzDoneHtml();
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
      var all = todayTargets(), ot = openTargets();
      if (!all.length) {
        h += '<section class="card stack" style="gap:8px"><label for="ciGoalNew" style="font-size:14px;color:var(--bone2)">No targets for today yet. Add one? <span class="muted">(optional)</span></label><input class="text" id="ciGoalNew" type="text" value="' + esc(ci.gNew) + '" placeholder="the one thing you want to get done"></section>';
      } else {
        h += '<div class="notice">' + (ot.length ? ot.length + ' of ' + all.length + ' targets still open' + (ci.asked ? ' · updated' : '') : 'All ' + all.length + ' targets hit today. Just the check-in now.') + '</div>';
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
    o.querySelectorAll('.gcT').forEach(function (el) { el.addEventListener('input', function () { ci.tu[el.dataset.tid] = el.value; }); });
    o.querySelectorAll('.gcH').forEach(function (b) { b.onclick = function () { ci.th[b.dataset.tid] = !ci.th[b.dataset.tid]; drawCheckin(); }; });
    var gcs = o.querySelector('#gcSave'), gck = o.querySelector('#gcSkip');
    if (gcs) gcs.onclick = function () {
      var hits = 0, ups = 0;
      mutate(function () {
        openTargets().forEach(function (t) {
          var tx = ci.tu[t.id] || '', win = !!ci.th[t.id] || isAchievedText(tx);
          if (win) hits++; else if (tx.trim()) ups++;
          targetUpdate(t, tx, win);
        });
      });
      ci.asked = true; ci.stage = 'setup'; drawCheckin();
      if (hits) setTimeout(function () { toast(hits + ' target' + (hits > 1 ? 's' : '') + ' hit · +' + hits * 20 + ' XP'); }, 1800);
      else if (ups) toast('Update saved');
    };
    if (gck) gck.onclick = function () { ci.asked = true; ci.stage = 'setup'; drawCheckin(); };
    var ft = o.querySelector('.gcT'); if (ft) setTimeout(function () { try { ft.focus(); } catch (e) {} }, 50);
    var sk = o.querySelector('#ciSkip'); if (sk) sk.onclick = function () { if (ci.iv) clearInterval(ci.iv); clearTimeout(ci.bt); if (ci.stage === 'breathe' && ci.running) { ci.running = false; afterBreath(); return; } ci.stage = 'reflect'; drawCheckin(); };
    if (ci.stage === 'setup') bindSetup(o);
    if (ci.stage === 'cairn') bindCairn(o);
    if (ci.stage === 'puzzle') bindPuzzle(o);
    if (ci.stage === 'pzdone') bindPzDone(o);
    var gtry = o.querySelector('#gTry'); if (gtry) gtry.onclick = function () { ci.lessonSeen = true; ci.stage = 'puzzle'; drawCheckin(); };
    o.querySelectorAll('[data-pres]').forEach(function (b) { b.onclick = function () { ci.presence = +b.dataset.pres; saveNote(); drawCheckin(); }; });
    o.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.pick, at = ci.picks.indexOf(i); if (at >= 0) ci.picks.splice(at, 1); else ci.picks.push(i); saveNote(); drawCheckin(); };
    });
    ['#ciNote', '#ciGoalNew'].forEach(function (id) { var el = o.querySelector(id); if (el) el.addEventListener('input', saveNote); });
    if (ci.stage === 'reflect' && !state.ciDraft) saveNote();
    var sv = o.querySelector('#ciSave');
    if (sv) sv.onclick = function () {
      saveNote();
      var gN = (ci.gNew || '').trim();
      var entry = { t: new Date().toISOString(), secs: ci.done || 0, presence: ci.presence || null, distractions: ci.picks.map(function (i) { return DISTRACTIONS[i]; }), note: ci.note.trim() };
      if (ci.cairn) entry.cairn = { diff: ci.cairn.diff, stones: ci.cairn.n, drifts: ci.cairn.drifts, probeOk: ci.cairn.pOk, probeMiss: ci.cairn.pMiss };
      if (ci.chessRes) entry.chess = ci.chessRes;
      closeCheckin();
      mutate(function () {
        delete state.ciDraft;
        state.checkins.push(entry);
        if (gN && !todayTargets().length) addTarget(dkey(new Date()), gN);
      });
    };
  }
  function saveNote() {
    if (!ci) return;
    var n = document.getElementById('ciNote'); if (n) ci.note = n.value;
    var b = document.getElementById('ciGoalNew'); if (b) ci.gNew = b.value;
    if (ci.stage === 'reflect') { state.ciDraft = { at: Date.now(), ci: { picks: ci.picks.slice(), presence: ci.presence, note: ci.note, gNew: ci.gNew, done: ci.done || 0, asked: !!ci.asked, tu: {}, th: {}, cairn: ci.cairn ? { diff: ci.cairn.diff, n: ci.cairn.n, drifts: ci.cairn.drifts, pOk: ci.cairn.pOk, pMiss: ci.cairn.pMiss } : null, chessRes: ci.chessRes || null } }; save(); }
  }

  // ---------- targets screen (opened from pings and the Today card) ----------
  var gv = null;
  function openGoal() {
    resetOverlay(); closeOverlayEl();
    ui.tab = 'trail'; render();
    openSheet('targets');
    if (!todayTargets().length) setTimeout(function () { var n = document.getElementById('tNew'); if (n) try { n.focus(); } catch (e) {} }, 350);
  }
  // morning ping: a visualization first (if not done yet), then targets
  function openMorning() {
    if (!(state.vizDone || {})[dkey(new Date())] && new Date().getHours() < 12) openViz(true);
    else openGoal();
  }
  function hitSingle() { var o = openTargets(); if (o.length === 1) { mutate(function () { targetUpdate(o[0], '', true); }); toast('Target hit · +20 XP'); } }
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
        ci.running = false; afterBreath();
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
    resetOverlay(); closeSheet();
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
  // a birth year typed into "Age" (e.g. 1995) is turned into an age
  function fixAge(a) { a = +a || null; if (a && a >= 1900 && a <= new Date().getFullYear()) a = new Date().getFullYear() - a; return a && a > 5 && a < 110 ? a : null; }
  function prof() { var p = state.profile || {}; if (p.age && (p.age > 110 || p.age < 5)) { p.age = fixAge(p.age); state.profile = p; } return p; }
  function foodDay(key) { state.food = state.food || {}; return state.food[key] || []; }
  function sumItems(items) {
    return items.reduce(function (a, it) { a.kcal += it.kcal; a.p += it.p; a.c += it.c; a.f += it.f; return a; }, { kcal: 0, p: 0, c: 0, f: 0 });
  }
  function latestWeight() { var w = (state.weights || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; }); return w.length ? w[w.length - 1].kg : prof().weight; }
  // ---- resting calories calibrated from Garmin Connect (you type them in each night) ----
  function restEntries() { var r = state.restLog || {}; return Object.keys(r).sort().map(function (k) { return { d: k, v: r[k] }; }).filter(function (e) { return e.v > 600 && e.v < 5000; }); }
  function restCal() {
    var es = restEntries().slice(-14); if (!es.length) return null;
    var avg = es.reduce(function (a, e) { return a + e.v; }, 0) / es.length, last5 = es.slice(-5);
    var m5 = last5.reduce(function (a, e) { return a + e.v; }, 0) / last5.length;
    var sd = Math.sqrt(last5.reduce(function (a, e) { return a + (e.v - m5) * (e.v - m5); }, 0) / last5.length);
    var stable = es.length >= 5 && sd / m5 <= .04;
    return { avg: Math.round(avg), n: es.length, stable: stable, spread: Math.round(sd) };
  }
  function restNeeded() { var rc = restCal(); return !rc || !rc.stable; }
  function bodyCalc() {
    var p = prof(), w = latestWeight();
    if (!p.height || !w || !p.age || !p.sex || p.age > 110 || p.height < 100 || w < 25) return null;
    var hm = p.height / 100, bmi = w / (hm * hm);
    var bmrF = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161), rc = restCal();
    var bmr = rc ? rc.avg : bmrF;   // your own Garmin resting calories replace the formula once you've entered some
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
  var SPORT = { swim: ['Swim', '#12A39A'], bike: ['Bike', '#F28C28'], run: ['Run', '#FF6B57'], strength: ['Strength', '#0F4D40'], brick: ['Brick', '#E8457A'], rest: ['Rest', '#B9C4BD'], race: ['Race', '#FF6B57'], badminton: ['Badminton', '#E8457A'], walk: ['Walk', '#6F7D74'] };
  function planStart() { if (!state.planStart) { var t = new Date(); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); state.planStart = dkey(t); save(); } return state.planStart; }
  function planWeek(d) { var s = new Date(planStart() + 'T00:00:00'), t = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return Math.floor((t - s) / 86400000 / 7) + 1; }
  function trainDone(key, i) { return !!((state.train || {})[key] || {})[i]; }
  function trainingOn(key) { var t = (state.train || {})[key] || {}; return Object.keys(t).filter(function (k) { return t[k]; }).length; }
  function badmintonGames(key) { return activitiesDeduped().filter(function (a) { return a.sport === 'badminton' && (!key || a.d === key); }); }
  function badmintonOn(key) { return badmintonGames(key).length ? 1 : 0; }
  function exerciseKcal(key) { return activitiesDeduped().filter(function (a) { return a.d === key; }).reduce(function (s, a) { return s + (+a.kcal || 0); }, 0); }
  var BLVL = { easy: ['Easy rally', 5.5], match: ['Match play', 7], hard: ['Hard singles', 8.5] };

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
    var ex = Math.round(exerciseKcal(key)), tk = bc ? bc.kcal + ex : 0, left = tk - eaten.kcal, pct = tk ? Math.min(100, Math.round(eaten.kcal / tk * 100)) : 0;
    h += '<section class="hero w" style="background:' + T.mango + ';color:' + T.jungle + '">' + sun('rgba(255,255,255,.35)', 130, -30, -40) + wave('#FFFFFF', .25, 40, 20);
    if (tk) {
      h += '<span class="cap">' + (left >= 0 ? 'Kcal left' : 'Kcal over') + (isToday ? ' today' : '') + '</span><span class="display big">' + fmtN(Math.abs(left)) + '</span>' +
        '<div class="bar" style="background:rgba(15,77,64,.18)"><i style="width:' + pct + '%;background:' + (left < 0 ? T.coral : T.jungle) + '"></i></div>' +
        '<div class="row between small"><span>' + fmtN(eaten.kcal) + ' eaten</span><span>of ' + fmtN(tk) + (ex ? ' (incl. +' + fmtN(ex) + ' exercise)' : '') + '</span></div>';
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
    h += '<div class="list">' + row({ t: 'Daily targets', v: fmtN(bc.kcal) + ' kcal', sheet: 'kcal' }) + row({ t: 'Healthy range', v: Math.round(bc.lo) + '–' + Math.round(bc.hi) + ' kg', sheet: 'kcal' }) +
      row({ t: 'About you', v: (p.age || '–') + ' · ' + (p.height || '–') + ' cm', sheet: 'about' }) + row({ t: 'Weight log', v: ws.length + (ws.length === 1 ? ' entry' : ' entries'), sheet: 'weight' }) + '</div>';
    h += '<button type="button" class="btn coral" data-sheet="weighin">⚖ Weigh in</button>';
    h += '<h3 class="sh">From your Garmin <span class="cap">' + garminStatus() + '</span></h3>' + healthHtml().replace('<div class="card stack" style="gap:8px"><h2>From your Garmin</h2>', '<div class="card stack" style="gap:8px">');
    return h;
  }
  function aboutSheet() {
    var p = prof();
    var h = '<div class="formgrid">' +
      '<label>Sex<select id="bSex"><option value="">–</option><option value="m"' + (p.sex === 'm' ? ' selected' : '') + '>Male</option><option value="f"' + (p.sex === 'f' ? ' selected' : '') + '>Female</option></select></label>' +
      '<label>Age (or birth year)<input id="bAge" type="number" inputmode="numeric" value="' + (p.age || '') + '" placeholder="e.g. 31"></label>' +
      '<label>Height<input id="bHeight" type="number" inputmode="decimal" value="' + (p.height || '') + '" placeholder="cm"></label>' +
      '<label>Weight<input id="bWeight" type="number" inputmode="decimal" step="0.1" value="' + (latestWeight() || '') + '" placeholder="kg"></label>' +
      '<label class="wide">How active are you (before training)?<select id="bAct">' + [[1.2, 'Mostly sitting'], [1.375, 'Lightly active'], [1.55, 'Active most days'], [1.725, 'Very active']].map(function (a) {
        return '<option value="' + a[0] + '"' + ((p.activity || 1.375) == a[0] ? ' selected' : '') + '>' + a[1] + '</option>';
      }).join('') + '</select></label></div><button type="button" class="btn solid" id="bSave">Save</button>' +
      '<p class="muted small">These are general guidelines, not medical advice. If you have a health condition, check with a doctor before starting.</p>';
    return { title: 'About you', cap: 'Body', html: h, bind: bindFit };
  }
  function kcalSheet() {
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
    var h = '<button type="button" class="btn coral" data-sheet="weighin">⚖ Weigh in with your scale</button>';
    h += '<div class="row"><input id="wIn" class="text" type="number" inputmode="decimal" step="0.1" placeholder="or type today’s weight, kg" style="flex:1"><button type="button" class="btn solid" id="wAdd">Log</button></div>';
    if (bc && ws.length) h += '<div class="chartbox">' + weightChart(ws, bc, false) + '</div>';
    if (ws.length) h += '<div class="list">' + ws.slice().reverse().slice(0, 12).map(function (x) {
      return '<div class="r"><span class="t">' + new Date(x.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span>' + (x.src ? '<span class="wsrc">' + { scale: 'scale', shot: 'screenshot', sync: 'synced' }[x.src] + '</span>' : '') + '<span class="v strong">' + Number(x.kg).toFixed(1) + ' kg</span><button type="button" class="fx" data-wdel="' + x.d + '" aria-label="Delete this entry">×</button></div>';
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
      return h + badmintonCard() + '<div class="list">' + row({ t: '12-week road map', v: 'done', sheet: 'roadmap' }) + row({ t: 'Garmin', v: garminStatus(), sheet: 'garmin', dot: garminDot() }) + '</div>';
    }
    var ph = PHASES.filter(function (p) { return p.weeks.indexOf(wk) >= 0; })[0], days = weekDates(wk);
    var t = days.filter(function (x) { return x.key === tk; })[0];
    if (!t) return badmintonCard() + '<div class="list">' + row({ t: 'Your 12-week plan starts ' + new Date(planStart() + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' }), sheet: 'week' }) + '</div>';
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
    var bw = weekDates(wk).reduce(function (a, x) { return a + badmintonGames(x.key).length; }, 0);
    h += badmintonCard();
    h += '<div class="list">' + row({ t: 'This week', v: nDone + ' of ' + nAll + (bw ? ' · +' + bw + ' 🏸' : ''), sheet: 'week' }) + row({ t: '12-week road map', v: 'Week ' + wk, sheet: 'roadmap' }) + row({ t: 'Garmin', v: garminStatus(), sheet: 'garmin', dot: garminDot() }) + '</div>';
    return h;
  }
  function badmintonCard() {
    var tk = dkey(new Date()), g = badmintonGames(tk), wk = planWeek(new Date()), n = 0;
    if (wk >= 1 && wk <= 12) weekDates(wk).forEach(function (x) { n += badmintonGames(x.key).length; });
    else { var c = new Date(); c.setDate(c.getDate() - 6); n = badmintonGames().filter(function (a) { return a.d >= dkey(c); }).length; }
    var sub = g.length ? g.reduce(function (a, x) { return a + x.min; }, 0) + ' min today' + (g[0].kcal ? ' · ~' + fmtN(g.reduce(function (a, x) { return a + (+x.kcal || 0); }, 0)) + ' kcal' : '') : 'Counts as training';
    return '<button type="button" class="hero bcard" data-sheet="badminton" style="background:' + T.jungle + ';color:#fff">' + sun('rgba(255,178,63,.9)', 70, -14, -18) +
      '<span class="cap">Evening</span><span class="display gt">' + (g.length ? 'Badminton ✓' : 'Played badminton?') + '</span><span class="small" style="opacity:.85;font-weight:500">' + sub + ' · ' + n + (n === 1 ? ' game' : ' games') + ' this week</span>' +
      '<span class="bpill">🏸 ' + (g.length ? 'Log another game' : 'Log a game') + '</span></button>';
  }
  function badmintonSheet() {
    var b = ui.bm = ui.bm || { min: 60, lvl: 'match' }, kg = latestWeight() || 70, kcal = Math.round(BLVL[b.lvl][1] * kg * b.min / 60);
    var c = new Date(); c.setDate(c.getDate() - 6); var wkN = badmintonGames().filter(function (a) { return a.d >= dkey(c); }).length;
    var h = '<span class="lab">How long?</span><div class="optrow">' + [30, 45, 60, 90, 120].map(function (m) { return '<button type="button" class="opt" data-bmin="' + m + '" aria-pressed="' + (b.min === m) + '">' + m + ' min</button>'; }).join('') + '</div>';
    h += '<span class="lab">How hard?</span><div class="optrow">' + Object.keys(BLVL).map(function (k) { return '<button type="button" class="opt" data-blvl="' + k + '" aria-pressed="' + (b.lvl === k) + '">' + BLVL[k][0] + '</button>'; }).join('') + '</div>';
    h += '<div class="chips"><div class="chip" style="background:#FFE6B8"><b class="display">~' + fmtN(kcal) + '</b><small>kcal burned</small></div><div class="chip" style="background:#CDEFEA"><b class="display">+10</b><small>XP</small></div><div class="chip" style="background:#FFD9D3"><b class="display">' + wkN + '</b><small>games · 7 days</small></div></div>';
    h += '<input class="text" id="bNote" placeholder="Notes (optional): doubles with the office group">';
    h += '<p class="muted small">Burned calories are added to today’s food allowance. If your Forerunner records the game, the Garmin sync replaces this entry so it’s never counted twice.</p>';
    h += '<button type="button" class="btn jungle" id="bSave">Save game</button>';
    var rec = (state.activities || []).filter(function (a) { return a.sport === 'badminton'; }).sort(function (x, y) { return x.d < y.d ? 1 : -1; }).slice(0, 6);
    if (rec.length) h += '<h3 class="sh">Recent games</h3><div class="list">' + rec.map(function (a) {
      return '<div class="r"><span class="t">' + new Date(a.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '<small>' + a.min + ' min' + (a.lvl ? ' · ' + BLVL[a.lvl][0] : '') + (a.note ? ' · ' + esc(a.note) : '') + (isSynced(a) ? ' · from Garmin' : '') + '</small></span><span class="v">' + (a.kcal ? '~' + fmtN(a.kcal) : '') + '</span>' + (isSynced(a) ? '' : '<button type="button" class="fx" data-bdel="' + esc(a.id) + '" aria-label="Delete this game">×</button>') + '</div>';
    }).join('') + '</div>';
    return { title: 'Badminton', cap: new Date().toLocaleDateString('en', { weekday: 'short' }) + ' · evening', html: h, bind: bindBadminton };
  }
  function bindBadminton(r) {
    r.querySelectorAll('[data-bmin]').forEach(function (b) { b.onclick = function () { ui.bm.min = +b.dataset.bmin; drawSheet(); }; });
    r.querySelectorAll('[data-blvl]').forEach(function (b) { b.onclick = function () { ui.bm.lvl = b.dataset.blvl; drawSheet(); }; });
    r.querySelectorAll('[data-bdel]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this game?')) return; state.activities = state.activities.filter(function (a) { return a.id !== b.dataset.bdel; }); save(); render(); }; });
    var sv = r.querySelector('#bSave'); if (sv) sv.onclick = function () {
      var b = ui.bm, kg = latestWeight() || 70, kcal = Math.round(BLVL[b.lvl][1] * kg * b.min / 60), note = r.querySelector('#bNote').value.trim();
      closeSheet();
      mutate(function () { state.activities = state.activities || []; state.activities.push({ id: 'manual:' + Date.now(), d: dkey(new Date()), sport: 'badminton', type: 'Badminton', title: 'Badminton', min: b.min, kcal: kcal, lvl: b.lvl, note: note }); });
      toast('Game logged · ~' + fmtN(kcal) + ' kcal');
    };
  }
  // ---- daily health numbers from the watch (via intervals.icu) ----
  function wellnessRecent(field, back) {
    var ws = (state.wellness || []).slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; }), lim = new Date(); lim.setDate(lim.getDate() - (back || 0));
    for (var i = 0; i < ws.length; i++) { if (ws[i].d < dkey(lim)) break; if (ws[i][field] != null) return { v: ws[i][field], d: ws[i].d }; }
    return null;
  }
  function last7(field) {
    var out = [], d = new Date(); d.setDate(d.getDate() - 6);
    var byD = {}; (state.wellness || []).forEach(function (w) { byD[w.d] = w; });
    for (var i = 0; i < 7; i++) { var k = dkey(d), w = byD[k]; out.push({ d: k, v: w && w[field] != null ? w[field] : null }); d.setDate(d.getDate() + 1); }
    return out;
  }
  function spark(field, col) {
    var pts = last7(field), vals = pts.map(function (p) { return p.v; }).filter(function (v) { return v != null; });
    if (!vals.length) return '';
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals), bars = field === 'steps' || field === 'sleep';
    return '<svg class="spark" viewBox="0 0 70 24" aria-hidden="true">' + pts.map(function (p, i) {
      if (p.v == null) return '';
      if (bars) { var hh = Math.max(2, p.v / (mx || 1) * 22); return '<rect x="' + (i * 10 + 1) + '" y="' + (24 - hh) + '" width="7" height="' + hh + '" rx="2" fill="' + col + '" opacity="' + (i === 6 ? 1 : .45) + '"/>'; }
      var y = 20 - (mx === mn ? 8 : (p.v - mn) / (mx - mn) * 16); return '<circle cx="' + (i * 10 + 5) + '" cy="' + y + '" r="' + (i === 6 ? 3.2 : 2.2) + '" fill="' + col + '" opacity="' + (i === 6 ? 1 : .55) + '"/>';
    }).join('') + '</svg>';
  }
  function hm(secs) { var m = Math.round(secs / 60); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0'); }
  function healthHtml() {
    var tk = dkey(new Date()), st = wellnessRecent('steps', 3), rh = wellnessRecent('rhr', 5), sl = wellnessRecent('sleep', 3), hv = wellnessRecent('hrv', 5), ex = Math.round(exerciseKcal(tk));
    var when = function (x) { if (!x) return ''; var y = new Date(); y.setDate(y.getDate() - 1); return x.d === tk ? 'today' : x.d === dkey(y) ? 'yesterday' : niceDate(x.d + 'T12:00:00'); };
    if (!st && !rh && !sl && !hv) {
      var sv = state.strava || {};
      return '<div class="card stack" style="gap:8px"><h2>From your Garmin</h2>' + (sv.pass && sv.syncedAt ? '<div class="notice" style="background:#FFF1D6;color:#7A4B00">' + healthStatus(sv) + '</div>' : '') + burnHtml() + (sv.pass && sv.syncedAt ? '' : '<p class="muted small">' + (sv.pass ? 'Waiting for the first sync from GitHub.' : 'Connect Garmin sync first (Fit → Plan → Garmin) to see steps, resting heart rate, sleep and HRV here.') + '</p>') + '</div>';
    }
    var tileH = function (lab, v, sub, f, col) { return '<div class="gtile"><span class="cap">' + lab + '</span><b class="display">' + v + '</b><small>' + sub + '</small>' + spark(f, col) + '</div>'; };
    return '<div class="gtiles">' +
      tileH('Steps', st ? fmtN(st.v) : '–', when(st) || 'no data', 'steps', T.lagoon) +
      tileH('Resting HR', rh ? Math.round(rh.v) + '<span> bpm</span>' : '–', rh ? (rh.d === tk ? 'this morning' : niceDate(rh.d + 'T12:00:00')) : 'no data', 'rhr', T.coral) +
      tileH('Sleep', sl ? hm(sl.v) : '–', sl ? 'last night' : 'no data', 'sleep', '#6B5BD6') +
      tileH('HRV', hv ? Math.round(hv.v) + '<span> ms</span>' : '–', hv ? 'overnight' : 'no data', 'hrv', T.mango) + '</div>' +
      burnHtml() +
      '<p class="muted small">Steps, heart rate, sleep and HRV come from your watch via Garmin Connect and intervals.icu, a few hours behind. Garmin doesn’t share whole-day calories with intervals.icu, so the app estimates them: your resting burn (from age, height and weight) + walking (from steps) + workout calories (' + (ex ? '~' + fmtN(ex) + ' kcal today' : 'none today') + '). It’s an estimate: usually close to Garmin’s own number, but not identical.</p>';
  }
  // Total burn = resting (BMR, so far today) + walking from steps + workouts (minus the resting part already counted)
  function burnEstimate(key) {
    var bc = bodyCalc(); if (!bc || !(bc.bmr > 500)) return null;
    var p = prof(), kg = bc.w, now = new Date(), isToday = key === dkey(now);
    var frac = isToday ? (now.getHours() * 60 + now.getMinutes()) / 1440 : 1, resting = bc.bmr * frac;
    var w = (state.wellness || []).filter(function (x) { return x.d === key; })[0], steps = w && w.steps != null ? w.steps : null;
    var walk = steps ? .55 * kg * steps * (p.height * .415 / 100) / 1000 : 0;
    var work = activitiesDeduped().filter(function (a) { return a.d === key; }).reduce(function (sum, a) { return sum + Math.max(0, (+a.kcal || 0) - (a.min || 0) * bc.bmr / 1440); }, 0);
    return { total: Math.round(resting + walk + work), resting: Math.round(resting), walk: Math.round(walk), work: Math.round(work), steps: steps, partial: isToday };
  }
  function burnHtml() {
    var tk = dkey(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
    var a = burnEstimate(tk), b = burnEstimate(dkey(y));
    if (!a) return '<div class="list">' + row({ t: 'Calories burned', sub: 'add your height, weight and age in Body to see this', sheet: 'about' }) + '</div>';
    var rc = restCal();
    var line = function (e) { return 'resting ' + fmtN(e.resting) + ' + steps ' + (e.steps == null ? '(no data)' : fmtN(e.walk)) + ' + workouts ' + fmtN(e.work); };
    return '<div class="burn"><div class="row between"><span class="cap">Calories burned · estimate</span><span class="cap">so far today</span></div>' +
      '<b class="display">' + fmtN(a.total) + '<span> kcal</span></b><small>' + line(a) + '</small>' +
      '<div class="row between burny"><span>Yesterday, whole day</span><b>' + fmtN(b.total) + ' kcal</b></div><small>' + line(b) + '</small>' +
      '<button type="button" class="r calib" data-sheet="restcal"><span class="dot" style="background:' + (rc && rc.stable ? T.lagoon : T.mango) + '"></span><span class="t">Resting burn: ' + (rc ? fmtN(rc.avg) + ' kcal/day' : 'formula estimate') + '<small>' + (!rc ? 'calibrate it with Garmin’s numbers' : rc.stable ? '✓ calibrated from ' + rc.n + ' days of Garmin data' : 'calibrating · ' + rc.n + (rc.n < 5 ? ' of 5 days' : ' days, settling') ) + '</small></span>' + CHEV + '</button></div>';
  }
  function restcalSheet() {
    var rc = restCal(), es = restEntries(), tk = dkey(new Date()), y = new Date(); y.setDate(y.getDate() - 1); var yk = dkey(y), bf = null;
    var p = prof(), w = latestWeight(); if (p.height && w && p.age && p.sex) bf = Math.round(10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161));
    var h = '<div class="burn"><span class="cap">Your resting burn</span><b class="display">' + (rc ? fmtN(rc.avg) : bf ? fmtN(bf) : '–') + '<span> kcal/day</span></b><small>' +
      (!rc ? 'From the formula (age, height, weight). Enter Garmin’s numbers below to replace it.' : rc.stable ? '✓ Calibrated: average of ' + rc.n + ' days, the last 5 within ±' + fmtN(rc.spread) + ' kcal. The app has stopped asking.' : 'Average of ' + rc.n + ' day' + (rc.n === 1 ? '' : 's') + (rc.n < 5 ? '. ' + (5 - rc.n) + ' more to go' : '; still settling (last 5 vary by ±' + fmtN(rc.spread) + ' kcal)') + '. The Tonight screen will keep asking.') + '</small></div>';
    h += '<div class="card stack" style="gap:8px"><h2>Where to find it</h2><ol class="steps"><li>Open the <b>Garmin Connect</b> app.</li><li>On <b>My Day</b>, tap the <b>Calories</b> card (it may be called Calories Burned or Energy).</li><li>Copy the <b>Resting</b> number for the day. The whole-day total is best at night, just before bed.</li></ol></div>';
    var inp = function (k, lab) { var v = (state.restLog || {})[k]; return '<label class="row lab" style="gap:10px"><span style="flex:1">' + lab + '</span><input class="text rin" type="number" inputmode="numeric" data-rk="' + k + '" value="' + (v || '') + '" placeholder="e.g. 1780" style="max-width:130px"></label>'; };
    h += inp(tk, 'Today (' + new Date().toLocaleDateString('en', { weekday: 'short', day: 'numeric' }) + ')') + inp(yk, 'Yesterday (' + y.toLocaleDateString('en', { weekday: 'short', day: 'numeric' }) + ')');
    if (es.length) h += '<h3 class="sh">Entered <span class="cap">' + es.length + ' days</span></h3><div class="list">' + es.slice().reverse().map(function (e) { return '<div class="r"><span class="t">' + niceDate(e.d + 'T12:00:00') + '</span><span class="v strong">' + fmtN(e.v) + ' kcal</span><button type="button" class="fx" data-rdel="' + e.d + '" aria-label="Delete">×</button></div>'; }).join('') + '</div>';
    if (bf) h += '<p class="muted small">For comparison, the formula says ' + fmtN(bf) + ' kcal/day. Your calibrated number is also used for your daily food target.</p>';
    return { title: 'Resting calories', cap: rc && rc.stable ? 'calibrated' : 'calibrating', html: h, bind: function (r) {
      r.querySelectorAll('[data-rk]').forEach(function (el) { el.addEventListener('change', function () { var v = +el.value; state.restLog = state.restLog || {}; if (v > 600 && v < 5000) state.restLog[el.dataset.rk] = Math.round(v); else if (!el.value) delete state.restLog[el.dataset.rk]; else { toast('That looks off: resting calories are usually 1,200–2,500'); return; } save(); render(); toast('Saved'); }); });
      r.querySelectorAll('[data-rdel]').forEach(function (b) { b.onclick = function () { delete state.restLog[b.dataset.rdel]; save(); render(); }; });
    } };
  }
  function garminDaySheet() { return { title: 'Your Garmin', cap: garminStatus(), html: healthHtml(), bind: function () {} }; }
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
      state.profile = { sex: v('#bSex'), age: fixAge(v('#bAge')), height: +v('#bHeight') || null, weight: +v('#bWeight') || null, activity: +v('#bAct') };
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
    resetOverlay();
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
    if (!manual && sv.lastTry && Date.now() - sv.lastTry < 10 * 60000) return Promise.resolve();
    syncing = true; sv.lastTry = Date.now(); state.strava = sv; save();
    return fetch(repoRaw() + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) throw new Error('nothing synced yet: run “Garmin sync” on GitHub first');
      if (!r.ok) throw new Error('download failed (' + r.status + ')');
      return r.json();
    }).then(function (box) { return decryptBox(box, sv.pass).catch(function () { throw new Error('wrong passphrase: it must match SYNC_PASSPHRASE on GitHub'); }); })
      .then(function (data) {
        var mine = (state.activities || []).filter(function (a) { return !isSynced(a); });
        state.activities = mine.concat(data.activities);
        sv.syncedAt = data.at; sv.count = data.activities.length; sv.error = null; sv.hasWellness = !!data.wellness; sv.wdays = (data.wellness || []).length; if (data.wellness) { state.wellness = data.wellness; mergeSyncedWeights(); } save(); syncing = false;
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
      if (/^manual:/.test(String(a.id))) return !st.some(function (s) { return s.d === a.d && s.sport === a.sport; });
      return !st.some(function (s) { return s.d === a.d && s.sport === a.sport && Math.abs(s.min - a.min) <= 3; });
    });
  }
  function healthStatus(sv) {
    if (!sv.hasWellness) return 'Health data: <b>not in the GitHub file yet.</b> The sync on GitHub is still the old version: upload <b>sender/sync.mjs</b> from the latest zip, then Actions → Garmin sync → Run workflow, then Sync now here.';
    if (!sv.wdays) return 'Health data: <b>intervals.icu sent none.</b> In intervals.icu: Settings → Garmin → switch on wellness, wait until steps show on its calendar, then run Garmin sync on GitHub again.';
    var last = (state.wellness || []).map(function (w) { return w.d; }).sort().pop();
    return '✓ Health data: ' + sv.wdays + ' days (latest ' + niceDate(last + 'T12:00:00') + ')';
  }
  function stravaCard() {
    var sv = state.strava || {}, h = '<section class="card stack" style="gap:10px"><div class="row between"><h2>Garmin sync</h2><span class="eyebrow">Garmin → intervals.icu → here</span></div>';
    if (!sv.pass) {
      h += '<p class="muted" style="margin:0;font-size:13px">Pulls your Garmin workouts automatically: Garmin sends them to intervals.icu, GitHub collects them every 2 hours and locks them with your passphrase.</p>' +
        '<div class="formgrid"><label class="wide">Sync passphrase<input id="svPass" type="text" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="same as SYNC_PASSPHRASE on GitHub"></label></div>' +
        '<button type="button" class="btn solid" id="svSave">Save passphrase & sync</button>';
    } else {
      h += '<div class="notice" style="' + (sv.error ? 'background:#FFE1DB' : '') + '">' + (sv.error ? 'Last sync failed: ' + esc(sv.error) : sv.syncedAt ? '✓ ' + sv.count + ' activities · updated ' + new Date(sv.syncedAt).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Waiting for the first sync from GitHub.') + '</div>' +
        (sv.syncedAt && !sv.error ? '<div class="notice"' + (sv.hasWellness && sv.wdays ? ' style="background:rgba(18,163,154,.12);color:#0F4D40"' : ' style="background:#FFF1D6;color:#7A4B00"') + '>' + healthStatus(sv) + '</div>' : '') +
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
    var tks = Object.keys(state.targets || {}).filter(function (k) { return k <= dkey(new Date()); }), gk = { length: tks.reduce(function (a, k) { return a + targetsFor(k).length; }, 0) }, won = tks.reduce(function (a, k) { return a + hitCount(k); }, 0);
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
    var mm0 = dkey(new Date()).slice(0, 7), mt0 = money().items.filter(function (x) { return x.d.slice(0, 7) === mm0; }).reduce(function (a, x) { return a + x.v; }, 0);
    h += '<div class="list">' + row({ t: '₹ My money', sub: 'your own spending this month', v: inr(mt0), dot: '#7A5300', sheet: 'money' }) + '</div>';
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
    var tk = dkey(new Date()), ks = Object.keys(state.targets || {}).filter(function (k) { return k <= tk; }).sort().reverse();
    var tot = 0, won = 0; ks.forEach(function (k) { tot += targetsFor(k).length; won += hitCount(k); });
    var h = '';
    if (!ks.length) h += '<p class="muted">Set targets on the Today tab and they will show up here.</p>';
    ks.slice(0, 30).forEach(function (k) {
      var d = new Date(k + 'T00:00:00'), ts = targetsFor(k);
      h += '<h3 class="sh">' + d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + ' <span class="cap">' + hitCount(k) + ' of ' + ts.length + '</span></h3><div class="list">' + ts.map(function (t) {
        return '<div class="r entry"><span class="dot" style="background:' + (t.achievedAt ? T.lagoon : '#C8D3CC') + '"></span><button type="button" class="rt" data-sheet="target:' + t.id + '"><span class="t">' + esc(t.text) + '<small>' + (t.achievedAt ? 'hit at ' + timeOf(t.achievedAt) : 'not hit') + (t.updates.length ? ' · ' + t.updates.length + ' update' + (t.updates.length === 1 ? '' : 's') : '') + '</small></span></button>' +
          '<button type="button" class="fx" data-tdel="' + t.id + '" aria-label="Delete this target">×</button></div>';
      }).join('') + '</div>';
    });
    return { title: 'Targets', cap: won + ' of ' + tot + ' hit', html: h, bind: function (r) { bindLog(r); bindTargets(r); } };
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
      row({ t: '☁ Backup', v: state.lastShareBackup || (state.gdrive && state.gdrive.last) ? ago(state.lastShareBackup && (!state.gdrive || !state.gdrive.last || state.lastShareBackup > state.gdrive.last) ? state.lastShareBackup : state.gdrive.last) : 'not yet', dot: !backupDue() && (state.lastShareBackup || (state.gdrive && state.gdrive.last)) ? T.lagoon : T.mango, sheet: 'backup' }) +
      row({ t: 'Your data', v: last, sheet: 'data' }) +
      row({ t: 'Visualization', v: state.aiKey ? 'AI on' : 'scene library', dot: state.aiKey ? T.lagoon : '#C8D3CC', sheet: 'ai' }) +
      row({ t: 'Ping schedule', v: '9 am – 10 pm', sheet: 'schedule' }) + row({ t: 'App version', v: APP_VERSION }) + '</div>';
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
      row({ t: 'Movement snacks', sub: 'yoga, cardio, strength or stretching', v: 'every 30 min', dot: T.mango }) + row({ t: 'Before bed', sub: 'journal and plan tomorrow', v: '10 pm', dot: '#1B2F5A' }) + '</div>' +
      '<p class="muted small">' + esc(PING_INFO) + ' GitHub sends them, so a ping can arrive a few minutes late.</p>';
    return { title: 'Ping schedule', cap: '9 am – 10 pm', html: h, bind: bindSettings };
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
      state.lastBackup = new Date().toISOString(); save();
      var copy = JSON.parse(JSON.stringify(state));
      delete copy.keys; delete copy.code; delete copy.aiKey;
      // notes and their photos live in a separate store: put them in the backup file too
      loadNotes().then(function (ns) {
        copy.notes = ns; copy.noteImages = {};
        var ids = []; ns.forEach(function (n) { ids = ids.concat(noteImgs(n)); });
        return Promise.all(ids.map(function (id) { return idbGet('img-' + id).then(function (d) { if (d) copy.noteImages[id] = d; }); }));
      }).catch(function () {}).then(function () {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(copy)], { type: 'application/json' }));
        a.download = 'attention-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
        render();
      });
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
        var code = state.code, keys = state.keys, ak = state.aiKey, ns = d.notes, im = d.noteImages;
        delete d.notes; delete d.noteImages;
        state = d; state.code = state.code || code; state.keys = state.keys || keys; if (ak) state.aiKey = ak;
        migrate(state);
        if (ns) { NOTES = ns; saveNotes(true); Object.keys(im || {}).forEach(function (id) { idbPut('img-' + id, im[id]).catch(function () {}); }); }
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

  // ---------- overlay housekeeping ----------
  function resetOverlay() {
    if (ci && ci.iv) clearInterval(ci.iv);
    if (ci && ci.bt) clearTimeout(ci.bt);
    ci = null; gv = null;
    if (mv) stopMoveTimer(); mv = null;
    fp = null;
    if (vz) vizStop(); vz = null;
    if (nv) notesLeave(); nv = null;
    if (tk) { var tx = ideaById(tk.id); if (tx) tx.last = tk.page; save(); } tk = null;
    vb = null; sp = null; bp = null;
    if (br) brStop(); br = null;
    if (ms && ms.rec) try { ms.rec.abort(); } catch (e) {} ms = null;
    var o = document.getElementById('overlay'); o.classList.remove('dark', 'vzo', 'nto', 'tko', 'vbo', 'spo', 'bro', 'mso');
  }
  function closeOverlayEl() {
    var o = document.getElementById('overlay'); o.hidden = true; o.classList.remove('dark', 'vzo', 'nto', 'tko', 'vbo', 'spo', 'bro', 'mso');
    updateEye();
    document.body.style.overflow = ui.sheet ? 'hidden' : '';
  }
  function showOverlay(cls) {
    var o = document.getElementById('overlay'); o.hidden = false; if (cls) o.classList.add(cls); o.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  // ---------- notes: scribble pad (IndexedDB, so photos don't fill the phone's quick storage) ----------
  var NOTES = null, nsT = null, nv = null, imgCache = {};
  var NW = 1000, NH = 1300;
  var NCOL = ['#16302A', '#FFFFFF', '#12A39A', '#FF6B57', '#FFB23F', '#E8457A'];
  var NBG = ['#FFE6B8', '#FFFFFF', '#CDEFEA', '#FFD9D3'];
  function loadNotes() { return NOTES ? Promise.resolve(NOTES) : idbGet('notes').then(function (n) { NOTES = n || []; return NOTES; }).catch(function () { NOTES = []; return NOTES; }); }
  function saveNotes(now) { clearTimeout(nsT); var go = function () { idbPut('notes', NOTES).catch(function () { toast('Could not save the note'); }); }; if (now) go(); else nsT = setTimeout(go, 300); }
  function noteById(id) { return (NOTES || []).filter(function (n) { return n.id === id; })[0]; }
  function openNotes(tab, day) {
    resetOverlay(); closeSheet();
    loadNotes().then(function () { nv = { tab: tab || 'pad', calSel: day || null, calMonth: day ? day.slice(0, 7) : null, id: null, tool: 'pen', color: NCOL[0], thick: false, hist: [] }; drawNotes(); showOverlay('nto'); });
  }
  function closeNotes() { notesLeave(); nv = null; closeOverlayEl(); }
  // notes used to have one page; now each note has a list of pages
  function notePages(n) { if (!n.pages) { n.pages = [{ items: n.items || [] }]; delete n.items; } return n.pages; }
  function noteImgs(n) { var a = []; notePages(n).forEach(function (p) { p.items.forEach(function (it) { if (it.type === 'img') a.push(it.src); }); }); return a; }
  function notesLeave() {
    if (!nv || !nv.id) return;
    var n = noteById(nv.id); if (!n) return;
    var pages = notePages(n);
    pages.forEach(function (p) { p.items = p.items.filter(function (it) { return !(it.type === 'text' && !(it.text || '').trim()) && !(it.type === 'check' && !it.rows.some(function (r) { return r.t.trim(); })); }); });
    nv.edit = null;
    if (!n.title.trim() && !n.body.trim() && pages.every(function (p) { return !p.items.length; })) { NOTES.splice(NOTES.indexOf(n), 1); saveNotes(true); return; }
    n.thumb = pages.some(function (p) { return p.items.length; }) ? noteThumb(n) : null;
    saveNotes(true);
  }
  function noteThumb(n) {
    try {
      var c = document.createElement('canvas'); c.width = 300; c.height = 390;
      var x = c.getContext('2d'); x.fillStyle = n.kind === 'board' ? n.board : '#fff'; x.fillRect(0, 0, 300, 390); x.scale(300 / NW, 390 / NH);
      var pg = notePages(n).filter(function (p) { return p.items.length; })[0];
      pg.items.forEach(function (it) { drawItem(x, it, null); });
      return c.toDataURL('image/jpeg', .72);
    } catch (e) { return null; }
  }
  function niceDate(t) {
    var d = new Date(t), k = dkey(d), tk = dkey(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
    return k === tk ? 'today' : k === dkey(y) ? 'yesterday' : d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  var NICON = {
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',
    line: '<path d="M5 19L19 5"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    arrow: '<path d="M5 19L19 5M11 5h8v8"/>',
    text: '<path d="M5 6h14M12 6v13"/>',
    img: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-7 8"/>',
    erase: '<path d="M16 4l5 5-9 9H7l-3-3z"/><path d="M11 20h9"/>',
    check: '<rect x="3.5" y="4" width="6" height="6" rx="1.5"/><path d="M5 7l1 1 2-2M13 7h8M13 17h8"/><rect x="3.5" y="14" width="6" height="6" rx="1.5"/>'
  };
  var NNAME = { move: 'Move', pen: 'Pen', line: 'Line', rect: 'Box', circle: 'Circle', arrow: 'Arrow', text: 'Text', check: 'Checklist', img: 'Photo', erase: 'Eraser' };
  function drawNotes() {
    var o = document.getElementById('overlay');
    if (nv.crop) return drawCrop();
    if (nv.id) return drawNoteEditor();
    var keep = o.scrollTop;
    var h = '<div class="inner"><div class="row between"><h1 class="display" style="font-size:34px">Notes</h1><button type="button" class="btn ghost small" id="nClose">Close</button></div>';
    h += '<div class="seg2 seg4 seg6" role="tablist">' + [['pad', 'Scribble'], ['vision', 'Vision'], ['sticky', 'Stickies'], ['cal', 'Calendar'], ['ideas', 'Ideas'], ['journal', 'Journal']].map(function (t) {
      return '<button type="button" role="tab" data-ntab="' + t[0] + '" aria-selected="' + (nv.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
    if ((nv.tab === 'pad' || nv.tab === 'vision' || nv.tab === 'sticky') && nv.reorder) {
      h += reorderHtml();
    } else if (nv.tab === 'sticky') {
      h += stickiesHtml();
    } else if (nv.tab === 'pad' || nv.tab === 'vision') {
      var boards = nv.tab === 'vision';
      var list = orderedNotes(boards);
      if (list.length > 1) h += '<div class="row between"><span class="muted small">' + list.length + (boards ? ' boards' : ' notes') + '</span><button type="button" class="btn ghost small" id="nReorder">⇅ Reorder</button></div>';
      if (!list.length) h += '<p class="muted" style="margin:0">' + (boards ? 'Nothing yet. A vision board is a page of pictures and words for what you want. Tap <b>New vision board</b>, then find images on Google and paste them in.' : 'Nothing yet. Tap <b>New note</b> to sketch an idea, pin a photo or jot something down.') + '</p>';
      else h += '<div class="ngrid">' + list.map(function (n) {
        var prev = n.thumb ? '<img src="' + n.thumb + '" alt="">' : '<span class="nb">' + esc((n.body || '').slice(0, 140)) + '</span>';
        var dark = n.kind === 'board' && isDark(n.board);
        return '<button type="button" class="ncard' + (dark ? ' dark' : '') + '" data-nopen="' + n.id + '" style="background:' + (n.kind === 'board' ? n.board : n.bg) + '">' + (n.pinned ? '<span class="npin" aria-label="pinned">📌</span>' : '') +
          '<b>' + (esc(n.title) || 'Untitled') + '</b>' + prev + '<span class="cap">' + (n.pinned ? 'pinned · ' : '') + (notePages(n).length > 1 ? notePages(n).length + ' pages · ' : '') + niceDate(n.updated) + '</span></button>';
      }).join('') + '</div>';
      h += '<div class="nfoot"><button type="button" class="btn coral" id="nNew">' + (boards ? '+ New vision board' : '+ New note') + '</button></div>';
    } else if (nv.tab === 'cal') {
      h += calendarHtml();
    } else if (nv.tab === 'ideas') {
      h += ideasTabHtml();
    } else {
      var ks = Object.keys(state.journal || {}).filter(hasJournal);
      // every day from the start (at most 60 days back) up to yesterday that has no entry shows as a blank row
      var dd = new Date(), lim = new Date(); lim.setDate(lim.getDate() - 60); dd.setDate(dd.getDate() - 1);
      var startK = state.startDate > dkey(lim) ? state.startDate : dkey(lim);
      while (dkey(dd) >= startK) { var kk = dkey(dd); if (ks.indexOf(kk) < 0) ks.push(kk); dd.setDate(dd.getDate() - 1); }
      ks.sort().reverse();
      if (!ks.length) h += '<p class="muted" style="margin:0">Your nightly journal shows up here. The 10 pm ping opens it, or start one now.</p>';
      else h += '<div class="stack" style="gap:8px">' + ks.map(function (k) {
        var j = state.journal[k] || {}, d = new Date(k + 'T00:00:00'), lab = d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
        if (!hasJournal(k)) return '<button type="button" class="jblank" data-jopen="' + k + '"><span class="jm">·</span><span class="t">' + lab + '<small>Not written yet</small></span><span class="jfill">Fill in</span></button>';
        return '<button type="button" class="r jr jcard" data-jopen="' + k + '"><span class="jm">' + (j.mood && MOODS[j.mood - 1] ? MOODS[j.mood - 1] : '·') + '</span><span class="t">' + lab + '<small>' + esc([j.well, j.away, j.more].filter(Boolean).join(' · ')) + '</small></span>' + CHEV + '</button>';
      }).join('') + '</div>';
      h += '<div class="nfoot"><button type="button" class="btn" id="nTonight" style="background:#1B2F5A;color:#fff">Write tonight’s journal</button></div>';
    }
    o.innerHTML = h + '</div>';
    if (nv.keepScroll) { o.scrollTop = keep; nv.keepScroll = false; }
    o.querySelector('#nClose').onclick = closeNotes;
    if (nv.tab === 'ideas') bindIdeasTab(o);
    if (nv.reorder) bindReorder(o);
    else if (nv.tab === 'sticky') bindStickies(o);
    var ro = o.querySelector('#nReorder'); if (ro) ro.onclick = function () { nv.reorder = true; drawNotes(); };
    o.querySelectorAll('[data-ntab]').forEach(function (b) { b.onclick = function () { nv.tab = b.dataset.ntab; nv.reorder = false; nv.stEdit = null; drawNotes(); }; });
    o.querySelectorAll('[data-nopen]').forEach(function (b) { b.onclick = function () { nv.id = b.dataset.nopen; nv.hist = []; nv.sel = null; nv.page = 0; nv.zoom = 1; nv.edit = null; var n0 = noteById(nv.id); if (n0 && n0.kind === 'board') { nv.tool = 'move'; nv.color = '#FFFFFF'; } drawNotes(); }; });
    var nn = o.querySelector('#nNew'); if (nn) nn.onclick = function () {
      var board = nv.tab === 'vision';
      var n = { id: 'n' + Date.now().toString(36), title: '', body: '', pages: [{ items: [] }], pinned: false, bg: NBG[NOTES.length % NBG.length], created: new Date().toISOString(), updated: new Date().toISOString() };
      if (board) { n.kind = 'board'; n.board = BOARDBG[0][1]; }
      n.ord = topOrd(orderedNotes(board)); NOTES.push(n); nv.id = n.id; nv.hist = []; nv.tool = board ? 'move' : 'pen'; if (board) nv.color = '#FFFFFF'; nv.page = 0; nv.zoom = 1; nv.edit = null; drawNotes();
      setTimeout(function () { var t = document.getElementById('nTitle'); if (t) try { t.focus(); } catch (e) {} }, 60);
    };
    var jt = function (k) { closeNotes(); ui.tab = 'trail'; render(); openSheet('tonight' + (k && k !== dkey(new Date()) ? ':' + k : '')); };
    o.querySelectorAll('[data-jopen]').forEach(function (b) { b.onclick = function () { jt(b.dataset.jopen); }; });
    var tn = o.querySelector('#nTonight'); if (tn) tn.onclick = function () { jt(null); };
    if (nv.tab === 'cal') bindCalendar(o);
  }
  var BOARDBG = [['Dark', '#16302A'], ['Sand', '#FBF1E3'], ['White', '#FFFFFF'], ['Coral', '#FF6B57'], ['Lagoon', '#12A39A'], ['Mango', '#FFB23F']];
  function isDark(c) { return c === '#16302A' || c === '#12A39A' || c === '#FF6B57'; }

  // ---------- vision boards: find on Google, copy, paste, crop ----------
  function googleImages(q) { window.open('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q), '_blank', 'noopener'); }
  function blobToDataURL(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }
  // Paste: try the clipboard directly; if Chrome blocks it, show a box you can paste into by hand
  function pasteImage() {
    var fallback = function (why) { nv.pasteBox = why || 'blocked'; drawNoteEditor(); };
    if (!navigator.clipboard || !navigator.clipboard.read) return fallback('unsupported');
    var settled = false, timer = setTimeout(function () { if (!settled) { settled = true; fallback('blocked'); } }, 4000);
    navigator.clipboard.read().then(function (items) {
      if (settled) return; settled = true; clearTimeout(timer);
      for (var i = 0; i < items.length; i++) {
        var t = items[i].types.filter(function (x) { return /^image\//.test(x); })[0];
        if (t) { nv.pasteBox = null; return items[i].getType(t).then(blobToDataURL).then(startCrop); }
      }
      toast('No picture copied yet. In Google Images, long-press a picture → Copy image.');
    }).catch(function () { if (settled) return; settled = true; clearTimeout(timer); fallback('blocked'); });
  }
  function pasteBoxHtml() {
    var why = nv.pasteBox;
    return '<div class="pastewrap"><div class="row between"><span class="lab">Paste the picture here</span><button type="button" class="fx" id="pbClose" aria-label="Close">×</button></div>' +
      '<div class="pastebox" id="pasteBox" contenteditable="true" role="textbox" aria-label="Paste box: long-press here, then Paste" inputmode="none"></div>' +
      '<p class="muted small">' + (why === 'blocked' ? 'Chrome blocked the Paste button. Pasting by hand in this box always works.<br>To make the button work: Chrome → ⋮ → Settings → Site settings → <b>Clipboard</b> → allow <b>shravan-flow.github.io</b>. ' : '') +
      'Easiest of all: in Google Images, long-press a picture → <b>Share image</b> → <b>Attention</b>.</p></div>';
  }
  function bindPasteBox(o) {
    var pb = o.querySelector('#pasteBox'); if (!pb) return;
    var take = function (blob) { if (!blob) return false; nv.pasteBox = null; blobToDataURL(blob).then(startCrop); return true; };
    pb.addEventListener('focus', function () { if (/Long-press/.test(pb.textContent)) pb.innerHTML = ''; });
    pb.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); take(items[i].getAsFile()); return; }
    });
    // keyboards (like Gboard) insert the picture as an image: pick it up from there
    pb.addEventListener('input', function () {
      var im = pb.querySelector('img');
      if (im && /^(data:|blob:)/.test(im.src)) { fetch(im.src).then(function (r) { return r.blob(); }).then(take).catch(function () { toast('Couldn’t read that picture'); }); }
      else if (im) toast('That picture can’t be copied. Save it and use 🖼, or use Share image → Attention.');
      else if (pb.textContent.trim()) { toast('That pasted text, not a picture. Long-press the picture in Google → Copy image.'); pb.innerHTML = ''; }
    });
    o.querySelector('#pbClose').onclick = function () { nv.pasteBox = null; drawNoteEditor(); };
    setTimeout(function () { try { pb.focus(); } catch (e) {} }, 80);
  }
  // pictures shared to the app from other apps (Chrome → Share image → Attention)
  function receiveShared() {
    if (!('caches' in window)) return;
    caches.open('attention-data').then(function (c) {
      return c.match('shared-image').then(function (r) {
        if (!r) { toast('Nothing was shared. Try Share image again.'); return; }
        return r.blob().then(function (b) { c.delete('shared-image'); return blobToDataURL(b); }).then(function (d) { pendingShare = d; openSheet('sharedpick'); });
      });
    }).catch(function () {});
  }
  function sharedToVision(dataUrl) {
    loadNotes().then(function () {
      openNotes('vision');
      setTimeout(function () {
        if (!nv) return;
        var n = noteById(state.lastBoard);
        if (!n || n.kind !== 'board') {
          n = NOTES.filter(function (x) { return x.kind === 'board'; }).sort(function (a, b2) { return a.updated < b2.updated ? 1 : -1; })[0];
          if (!n) { n = { id: 'n' + Date.now().toString(36), kind: 'board', board: BOARDBG[0][1], title: 'Vision board', body: '', pages: [{ items: [] }], pinned: false, bg: NBG[0], created: new Date().toISOString(), updated: new Date().toISOString() }; NOTES.push(n); saveNotes(); }
        }
        nv.id = n.id; nv.page = 0; nv.zoom = 1; nv.hist = []; nv.tool = 'move'; nv.color = '#FFFFFF';
        startCrop(dataUrl);
        toast('Adding to “' + (n.title || 'Vision board') + '”');
      }, 250);
    });
  }

  function startCrop(url) {
    var im = new Image();
    im.onload = function () { nv.crop = { url: url, w: im.naturalWidth, h: im.naturalHeight, r: { x: .06, y: .06, w: .88, h: .88 }, cap: '' }; drawNotes(); };
    im.onerror = function () { toast('Could not open that image'); };
    im.src = url;
  }
  function drawCrop() {
    var o = document.getElementById('overlay'), c = nv.crop;
    var h = '<div class="inner"><div class="row between"><span class="eyebrow">Crop the image</span><button type="button" class="btn ghost small" id="crCancel">Cancel</button></div>';
    h += '<div class="crbox"><div class="crimg" id="crImg"><img src="' + c.url + '" alt="" draggable="false"><div class="crrect" id="crRect"><i data-h="tl"></i><i data-h="tr"></i><i data-h="bl"></i><i data-h="br"></i></div></div></div>';
    h += '<p class="muted small" style="text-align:center">Drag the corners to crop, or drag the middle to move the frame.</p>';
    h += '<input class="text" id="crCap" placeholder="Caption (optional): e.g. Nela in the field" value="' + esc(c.cap) + '">';
    h += '<div class="row"><button type="button" class="btn line" id="crAll">Use whole image</button><button type="button" class="btn jungle" id="crUse" style="flex:1">Place on board</button></div></div>';
    o.innerHTML = h;
    var wrap = o.querySelector('#crImg'), rect = o.querySelector('#crRect'), img = wrap.querySelector('img');
    var place = function () { rect.style.left = c.r.x * 100 + '%'; rect.style.top = c.r.y * 100 + '%'; rect.style.width = c.r.w * 100 + '%'; rect.style.height = c.r.h * 100 + '%'; };
    place();
    var drag = null;
    rect.addEventListener('pointerdown', function (e) {
      e.preventDefault(); try { rect.setPointerCapture(e.pointerId); } catch (x) {}
      drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, r: Object.assign({}, c.r) };
    });
    rect.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var b = img.getBoundingClientRect(), dx = (e.clientX - drag.x) / b.width, dy = (e.clientY - drag.y) / b.height, r = Object.assign({}, drag.r), m = .06;
      if (drag.h === 'move') { r.x = Math.max(0, Math.min(1 - r.w, r.x + dx)); r.y = Math.max(0, Math.min(1 - r.h, r.y + dy)); }
      else {
        if (/l/.test(drag.h)) { var nx = Math.max(0, Math.min(r.x + r.w - m, r.x + dx)); r.w += r.x - nx; r.x = nx; }
        if (/r/.test(drag.h)) r.w = Math.max(m, Math.min(1 - r.x, r.w + dx));
        if (/t/.test(drag.h)) { var ny = Math.max(0, Math.min(r.y + r.h - m, r.y + dy)); r.h += r.y - ny; r.y = ny; }
        if (/b/.test(drag.h)) r.h = Math.max(m, Math.min(1 - r.y, r.h + dy));
      }
      c.r = r; place();
    });
    var end = function () { drag = null; };
    rect.addEventListener('pointerup', end); rect.addEventListener('pointercancel', end);
    o.querySelector('#crCap').addEventListener('input', function (e) { c.cap = e.target.value; });
    o.querySelector('#crCancel').onclick = function () { nv.crop = null; drawNotes(); };
    o.querySelector('#crAll').onclick = function () { c.r = { x: 0, y: 0, w: 1, h: 1 }; place(); };
    o.querySelector('#crUse').onclick = function () {
      var sx = c.r.x * c.w, sy = c.r.y * c.h, sw = c.r.w * c.w, sh = c.r.h * c.h, sc = Math.min(1, 1100 / Math.max(sw, sh)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(sw * sc)); cv.height = Math.max(1, Math.round(sh * sc));
      var im = new Image();
      im.onload = function () {
        cv.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        var data = cv.toDataURL('image/jpeg', .85), id = 'i' + Date.now().toString(36), n = noteById(nv.id), pg = notePages(n)[nv.page || 0];
        idbPut('img-' + id, data).then(function () {
          var w = 430, hh = Math.round(w * cv.height / cv.width); if (hh > 560) { w = Math.round(w * 560 / hh); hh = 560; }
          var i2 = new Image(); i2.src = data; imgCache[id] = i2;
          var k = pg.items.filter(function (x) { return x.type === 'img'; }).length;
          nv.hist.push(JSON.stringify(pg.items));
          pg.items.push({ type: 'img', src: id, x: 60 + (k % 2) * 440 + (k % 3) * 10, y: 60 + Math.floor(k / 2) % 3 * 380, w: w, h: hh, rot: [-3, 2, -1.5, 3][k % 4], cap: (c.cap || '').trim(), polaroid: true });
          n.updated = new Date().toISOString(); saveNotes();
          nv.crop = null; nv.tool = 'move'; drawNotes(); toast('Placed. Drag it where you like.');
        }).catch(function () { toast('Could not save the image'); });
      };
      im.src = c.url;
    };
  }

  // ---------- calendar ----------
  var CALTYPE = { task: ['Task', T.coral], activity: ['Activity', T.lagoon], event: ['Event', T.mango], holiday: ['Holiday', T.hib] };
  var CALBG = { task: '#FFD9D3', activity: '#CDEFEA', event: '#FFE6B8', holiday: '#FFD9E5' };
  var CALPRESETS = [['🏸', 'Badminton', 'activity'], ['🏊', 'Swim', 'activity'], ['🏃', 'Run', 'activity'], ['🚴', 'Ride', 'activity'], ['🧘', 'Yoga', 'activity'], ['💪', 'Gym', 'activity'],
    ['☕', 'Estate round', 'task'], ['🌱', 'Fertiliser / spray', 'task'], ['💸', 'Pay bills', 'task'], ['📞', 'Call', 'task'], ['🛠', 'Bike service', 'task'], ['🛒', 'Groceries', 'task'],
    ['🎂', 'Birthday', 'event', 'yearly'], ['💍', 'Anniversary', 'event', 'yearly'], ['🤝', 'Meeting', 'event'], ['✈', 'Travel', 'event'], ['🎉', 'Festival', 'event'], ['🩺', 'Appointment', 'event'],
    ['🏖', 'Holiday / leave', 'holiday'], ['🛑', 'Shop closed', 'holiday'], ['🪔', 'Festival off', 'holiday']];
  function calEntries() { return state.cal = state.cal || []; }
  function occursOn(e, key) {
    if (e.date === key) return true;
    if (!e.repeat || e.repeat === 'none' || key < e.date) return false;
    var a = new Date(e.date + 'T00:00:00'), b = new Date(key + 'T00:00:00');
    if (e.repeat === 'daily') return true;
    if (e.repeat === 'weekly') return a.getDay() === b.getDay();
    if (e.repeat === 'monthly') return a.getDate() === b.getDate();
    if (e.repeat === 'yearly') return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    return false;
  }
  function entriesOn(key) { return calEntries().filter(function (e) { return occursOn(e, key) && !(e.skip || []).includes(key); }).sort(function (x, y) { return (x.time || '99') < (y.time || '99') ? -1 : 1; }); }
  function holidaysOn(key) { return ((state.holidays || {}).events || []).filter(function (h) { return h.d === key && h.t !== 'observance'; }); }
  function calLabel(e) { return (e.emoji ? e.emoji + ' ' : '') + e.title; }
  function time12(t) { if (!t) return ''; var p = t.split(':'), hh = +p[0]; return (hh % 12 || 12) + (p[1] !== '00' ? ':' + p[1] : '') + (hh < 12 ? ' am' : ' pm'); }
  // entries for today become today's targets (once each, so deleting the target sticks)
  function syncCalendarTargets() {
    var k = dkey(new Date()), es = entriesOn(k); if (!es.length) return false;
    state.calSynced = state.calSynced || {};
    var done = state.calSynced[k] = state.calSynced[k] || [], added = false;
    es.forEach(function (e) {
      if (e.type === 'holiday' || done.indexOf(e.id) >= 0) return;
      done.push(e.id); addTarget(k, calLabel(e) + (e.time ? ' · ' + time12(e.time) : ''));
      var ts = state.targets[k]; ts[ts.length - 1].calId = e.id; added = true;
    });
    Object.keys(state.calSynced).forEach(function (d) { if (d < k) delete state.calSynced[d]; });
    return added;
  }
  function holidayRaw() {
    var owner = location.hostname.split('.')[0], repo = location.pathname.split('/').filter(Boolean)[0];
    return location.hostname.indexOf('github.io') > 0 && repo ? 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/main/data/holidays.json' : 'data/holidays.json';
  }
  function loadHolidays(force) {
    var hs = state.holidays || {};
    if (!force && hs.tried && Date.now() - hs.tried < 12 * 3600000) return;
    hs.tried = Date.now(); state.holidays = hs;
    fetch(holidayRaw() + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { if (j && j.events) { state.holidays = { tried: Date.now(), at: j.at, events: j.events }; save(); render(); if (nv && nv.tab === 'cal' && !nv.id) { nv.keepScroll = true; drawNotes(); } } })
      .catch(function () { save(); });
  }
  function calendarHtml() {
    var tk = dkey(new Date()), sel = nv.calSel || tk, m = nv.calMonth || tk.slice(0, 7);
    var first = new Date(m + '-01T00:00:00'), lead = (first.getDay() + 6) % 7, days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var h = '<div class="row between"><span class="display" style="font-size:26px">' + first.toLocaleDateString('en', { month: 'long', year: 'numeric' }) + '</span><div class="row" style="gap:6px">' +
      (m !== tk.slice(0, 7) ? '<button type="button" class="nib sm" id="calToday">Today</button>' : '') + '<button type="button" class="nib" data-cm="-1" aria-label="Previous month">‹</button><button type="button" class="nib" data-cm="1" aria-label="Next month">›</button></div></div>';
    h += '<div class="calgrid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (d) { return '<span class="cap">' + d + '</span>'; }).join('');
    for (var i = 0; i < lead; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var k = m + '-' + String(d).padStart(2, '0'), es = entriesOn(k), hol = holidaysOn(k);
      var dots = es.slice(0, 3).map(function (e) { return '<i style="background:' + CALTYPE[e.type][1] + '"></i>'; }).join('') + (hol.length ? '<i style="background:' + T.hib + '"></i>' : '');
      h += '<button type="button" class="cd' + (k === sel ? ' sel' : '') + (k === tk ? ' today' : '') + (hol.some(function (x) { return x.t === 'public'; }) || es.some(function (e) { return e.type === 'holiday'; }) ? ' hol' : '') + '" data-cday="' + k + '" aria-label="' + k + (hol.length ? ', ' + esc(hol[0].n) : '') + (es.length ? ', ' + es.length + ' items' : '') + '">' + d + '<span>' + dots + '</span></button>';
    }
    h += '</div><div class="callegend">' + Object.keys(CALTYPE).map(function (t) { return '<span><i style="background:' + CALTYPE[t][1] + '"></i>' + CALTYPE[t][0].toLowerCase() + '</span>'; }).join('') + '<span><i style="background:' + T.hib + '"></i>public holiday</span></div>';
    // the selected day
    var sd = new Date(sel + 'T00:00:00'), es2 = entriesOn(sel), hol2 = holidaysOn(sel);
    h += '<div class="calday"><div class="row between"><span class="display" style="font-size:24px">' + sd.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span><span class="cap">' + es2.length + ' item' + (es2.length === 1 ? '' : 's') + '</span></div>';
    hol2.forEach(function (x) { h += '<div class="notice" style="background:#FFD9E5;color:#8A1F45">🎌 ' + esc(x.n) + ' · ' + (x.t === 'public' ? 'public holiday' : 'restricted holiday') + '</div>'; });
    if (es2.length) h += '<div class="list">' + es2.map(function (e) {
      var tl = e.time ? time12(e.time) + (e.end ? '–' + time12(e.end) : '') : e.allDay || e.type === 'holiday' ? 'all day' : '+ time';
      var row = '<div class="r"><span class="dot" style="background:' + CALTYPE[e.type][1] + '"></span><span class="t">' + esc(calLabel(e)) + '<small>' + CALTYPE[e.type][0].toLowerCase() + (e.repeat && e.repeat !== 'none' ? ' · every ' + { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[e.repeat] : '') + '</small></span>' +
        '<button type="button" class="ctime' + (e.time || e.allDay || e.type === 'holiday' ? ' on' : '') + '" data-ctime="' + e.id + '" aria-label="Set the time">' + tl + '</button><button type="button" class="fx" data-cdel="' + e.id + '" aria-label="Remove">×</button></div>';
      if (nv.calEdit === e.id) row += '<div class="ctedit"><div class="row" style="gap:8px;align-items:center"><input type="time" class="text" id="ceFrom" value="' + (e.time || '') + '"><span class="muted small">to</span><input type="time" class="text" id="ceTo" value="' + (e.end || '') + '"></div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="opt sm" id="ceAll" aria-pressed="' + !!e.allDay + '">All day</button><select id="ceType" class="text" style="flex:1;min-height:40px">' + Object.keys(CALTYPE).map(function (t) { return '<option value="' + t + '"' + (t === e.type ? ' selected' : '') + '>' + CALTYPE[t][0] + '</option>'; }).join('') + '</select></div>' +
        '<div class="row" style="gap:8px"><button type="button" class="btn ghost small" id="ceCancel">Cancel</button><button type="button" class="btn jungle small" id="ceSave" style="flex:1">Save</button></div></div>';
      return row;
    }).join('') + '</div>';
    else h += '<p class="muted small">Nothing planned. Add something below.' + (sel === tk ? '' : ' It will show up in that day’s targets.') + '</p>';
    h += '<div class="row" style="gap:8px"><label class="lab" for="calTime" style="white-space:nowrap">Time for the next item</label><input type="time" id="calTime" class="text" style="flex:1" value="' + (nv.calTime || '') + '"></div>';
    var mine = (state.calPresets || []).map(function (p) { return [p.emoji || '⭐', p.title, p.type, p.repeat || 'none', true]; });
    h += '<span class="lab">Quick add</span><div class="optrow calq">' + CALPRESETS.concat(mine).map(function (p, i) {
      return '<button type="button" class="opt sm" data-cq="' + i + '" style="background:' + (CALBG[p[2]] || '#fff') + '">' + p[0] + ' ' + esc(p[1]) + '</button>';
    }).join('') + '</div>';
    h += '<details class="calown"' + (nv.calOwn ? ' open' : '') + '><summary class="lab">+ Your own</summary><div class="stack" style="gap:8px;margin-top:8px">' +
      '<input class="text" id="calTitle" placeholder="What? e.g. Cariappa’s birthday, Fixture review">' +
      '<div class="row" style="gap:8px"><select id="calType" class="text">' + Object.keys(CALTYPE).map(function (t) { return '<option value="' + t + '">' + CALTYPE[t][0] + '</option>'; }).join('') + '</select>' +
      '<select id="calRep" class="text"><option value="none">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select></div>' +
      '<label class="row lab" style="gap:8px"><input type="checkbox" id="calSave"> Also save as a quick-add button</label>' +
      '<button type="button" class="btn jungle" id="calAdd">Add to ' + sd.toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '</button></div></details>';
    var hs = state.holidays || {};
    h += '<p class="muted small">' + (hs.events ? 'Public holidays for India load automatically (updated ' + niceDate(hs.at) + ').' : 'Public holidays aren’t loaded yet: they appear after the “Holidays” task has run once on GitHub.') + ' Tasks, activities and events for a date appear in that day’s targets on Today.</p>';
    return h + '</div>';
  }
  function bindCalendar(o) {
    var tk = dkey(new Date()), sel = nv.calSel || tk, redraw = function () { nv.keepScroll = true; drawNotes(); };
    o.querySelectorAll('[data-cday]').forEach(function (b) { b.onclick = function () { nv.calSel = b.dataset.cday; redraw(); }; });
    o.querySelectorAll('[data-cm]').forEach(function (b) { b.onclick = function () { var d = new Date((nv.calMonth || tk.slice(0, 7)) + '-01T00:00:00'); d.setMonth(d.getMonth() + +b.dataset.cm); nv.calMonth = dkey(d).slice(0, 7); redraw(); }; });
    var ct = o.querySelector('#calToday'); if (ct) ct.onclick = function () { nv.calMonth = tk.slice(0, 7); nv.calSel = tk; redraw(); };
    var tm = o.querySelector('#calTime'); tm.addEventListener('change', function () { nv.calTime = tm.value; });
    var add = function (emoji, title, type, repeat) {
      calEntries().push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: sel, title: title, emoji: emoji, type: type, time: tm.value || '', repeat: repeat || 'none' });
      if (sel === tk) syncCalendarTargets();
      save(); syncGoal(); render(); redraw();
      toast('Added to ' + new Date(sel + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + (sel === tk ? ' · also in today’s targets' : ''));
    };
    var mine = (state.calPresets || []).map(function (p) { return [p.emoji || '⭐', p.title, p.type, p.repeat || 'none']; }), all = CALPRESETS.concat(mine);
    o.querySelectorAll('[data-cq]').forEach(function (b) { b.onclick = function () { var p = all[+b.dataset.cq]; add(p[0], p[1], p[2], p[3]); }; });
    o.querySelectorAll('[data-cdel]').forEach(function (b) { b.onclick = function () {
      var e = calEntries().filter(function (x) { return x.id === b.dataset.cdel; })[0]; if (!e) return;
      if (e.repeat && e.repeat !== 'none' && e.date !== sel) {
        if (confirm('Remove only this day? (Cancel removes every repeat)')) { e.skip = (e.skip || []).concat([sel]); save(); redraw(); return; }
      } else if (!confirm('Remove “' + e.title + '”?')) return;
      state.cal = calEntries().filter(function (x) { return x !== e; }); save(); redraw();
    }; });
    var own = o.querySelector('.calown'); own.addEventListener('toggle', function () { nv.calOwn = own.open; });
    // set or change the time on any item
    o.querySelectorAll('[data-ctime]').forEach(function (b) { b.onclick = function () { nv.calEdit = nv.calEdit === b.dataset.ctime ? null : b.dataset.ctime; redraw(); }; });
    var ce = nv.calEdit && calEntries().filter(function (x) { return x.id === nv.calEdit; })[0];
    if (ce && o.querySelector('#ceSave')) {
      var allBtn = o.querySelector('#ceAll');
      allBtn.onclick = function () { var on = allBtn.getAttribute('aria-pressed') !== 'true'; allBtn.setAttribute('aria-pressed', on); if (on) { o.querySelector('#ceFrom').value = ''; o.querySelector('#ceTo').value = ''; } };
      o.querySelector('#ceCancel').onclick = function () { nv.calEdit = null; redraw(); };
      o.querySelector('#ceSave').onclick = function () {
        var f = o.querySelector('#ceFrom').value, t2 = o.querySelector('#ceTo').value, all = allBtn.getAttribute('aria-pressed') === 'true';
        ce.time = all ? '' : f; ce.end = all || !f ? '' : t2; ce.allDay = all && !f; ce.type = o.querySelector('#ceType').value;
        // keep today's target text in step with the new time
        var tk2 = dkey(new Date());
        (state.targets[tk2] || []).forEach(function (tg) { if (tg.calId === ce.id) tg.text = calLabel(ce) + (ce.time ? ' · ' + time12(ce.time) : ''); });
        nv.calEdit = null; save(); syncGoal(); render(); redraw(); toast(ce.time ? 'Time set · ' + time12(ce.time) : 'Saved');
      };
    }
    o.querySelector('#calAdd').onclick = function () {
      var t = o.querySelector('#calTitle').value.trim(); if (!t) { o.querySelector('#calTitle').focus(); return; }
      var ty = o.querySelector('#calType').value, rp = o.querySelector('#calRep').value;
      if (o.querySelector('#calSave').checked) { state.calPresets = (state.calPresets || []).concat([{ title: t, type: ty, repeat: rp }]); }
      nv.calOwn = false; add('', t, ty, rp);
    };
  }


  // ---------- your own order for notes, boards and stickies ----------
  function withOrd(list) {
    // older items have no position yet: give them one in their current order (newest first)
    var have = list.filter(function (x) { return x.ord != null; }), miss = list.filter(function (x) { return x.ord == null; });
    if (miss.length) {
      var lo = have.length ? Math.min.apply(null, have.map(function (x) { return x.ord; })) : 0;
      miss.sort(function (a, b) { return (a.updated || a.at || '') < (b.updated || b.at || '') ? 1 : -1; }).forEach(function (x, i) { x.ord = lo - miss.length + i; });
    }
    return list.sort(function (a, b) { return ((b.pinned || b.pin) ? 1 : 0) - ((a.pinned || a.pin) ? 1 : 0) || a.ord - b.ord; });
  }
  function orderedNotes(boards) { return withOrd((NOTES || []).filter(function (n) { return (n.kind === 'board') === !!boards; })); }
  function topOrd(list) { return list.length ? Math.min.apply(null, list.map(function (x) { return x.ord || 0; })) - 1 : 0; }
  function reorderList() { return nv.tab === 'sticky' ? withOrd(stickies()) : orderedNotes(nv.tab === 'vision'); }
  function reorderHtml() {
    var list = reorderList();
    var h = '<div class="row between"><span style="font-size:14px;font-weight:600">Hold ≡ and drag to reorder</span><button type="button" class="btn jungle small" id="roDone">Done</button></div><div class="rolist" id="roList">';
    h += list.map(function (x, i) {
      var sw = nv.tab === 'sticky' ? '<span class="rothumb" style="background:' + x.c + '"></span>' : x.thumb ? '<img class="rothumb" src="' + x.thumb + '" alt="">' : '<span class="rothumb" style="background:' + (x.kind === 'board' ? x.board : x.bg) + '"></span>';
      var t = nv.tab === 'sticky' ? (x.t || 'Empty sticky').split('\n')[0] : x.title || 'Untitled';
      return '<div class="rorow" data-ri="' + i + '">' + sw + '<span class="t">' + esc(t.slice(0, 60)) + '<small>' + ((x.pinned || x.pin) ? '📌 pinned · ' : '') + niceDate(x.updated || x.at) + '</small></span><span class="rohandle" aria-label="Drag to move">≡</span></div>';
    }).join('') + '</div><p class="muted small">Pinned ones stay on top. The order is also used in the full-screen vision viewer.</p>';
    return h;
  }
  function bindReorder(o) {
    o.querySelector('#roDone').onclick = function () { nv.reorder = false; drawNotes(); };
    var box = o.querySelector('#roList'), rows = [].slice.call(box.querySelectorAll('.rorow')), list = reorderList(), drag = null;
    rows.forEach(function (row) {
      var hd = row.querySelector('.rohandle');
      hd.addEventListener('pointerdown', function (e) {
        e.preventDefault(); try { hd.setPointerCapture(e.pointerId); } catch (x) {}
        var rh = row.getBoundingClientRect().height + 8;
        drag = { row: row, i: +row.dataset.ri, y0: e.clientY, rh: rh, to: +row.dataset.ri };
        row.classList.add('lift');
      });
      hd.addEventListener('pointermove', function (e) {
        if (!drag || drag.row !== row) return;
        var dy = e.clientY - drag.y0, to = Math.max(0, Math.min(rows.length - 1, drag.i + Math.round(dy / drag.rh)));
        row.style.transform = 'translateY(' + dy + 'px)';
        rows.forEach(function (r2, k) {
          if (r2 === row) return;
          var sh = 0; if (drag.i < to && k > drag.i && k <= to) sh = -drag.rh; else if (drag.i > to && k < drag.i && k >= to) sh = drag.rh;
          r2.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
        });
        drag.to = to;
      });
      var end = function () {
        if (!drag || drag.row !== row) return;
        var from = drag.i, to = drag.to; drag = null;
        rows.forEach(function (r2) { r2.style.transform = ''; r2.classList.remove('lift'); });
        if (from === to) return;
        var moved = list.splice(from, 1)[0]; list.splice(to, 0, moved);
        list.forEach(function (x, k) { x.ord = k; });
        if (nv.tab === 'sticky') save(); else saveNotes(true);
        nv.keepScroll = true; drawNotes();
      };
      hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
    });
  }

  // ---------- stickies: a wall of quick sticky notes, separate from scribble and vision ----------
  var STCOL = ['#FFE66D', '#FFB4A8', '#B8E6D9', '#C9D7FF', '#FFD6A5', '#FFFFFF'];
  function stickies() { return (state.stickies = state.stickies || []); }
  function stickiesHtml() {
    var list = withOrd(stickies()), h = '';
    if (nv.stEdit) {
      var st = list.filter(function (x) { return x.id === nv.stEdit; })[0];
      if (st) {
        h += '<div class="stedit" style="background:' + st.c + '"><textarea id="stText" placeholder="Write it down…">' + esc(st.t) + '</textarea></div>';
        h += '<div class="row between"><div class="row" style="gap:8px">' + STCOL.map(function (c) { return '<button type="button" class="nsw' + (st.c === c ? ' on' : '') + '" data-stc="' + c + '" style="background:' + c + ';border-radius:6px" aria-label="Sticky colour"></button>'; }).join('') + '</div>' +
          '<div class="row" style="gap:6px"><button type="button" class="nib' + (st.pin ? ' on' : '') + '" id="stPin" aria-label="Pin to the top">📌</button><button type="button" class="nib" id="stDel" aria-label="Delete sticky">🗑</button></div></div>';
        h += '<button type="button" class="btn jungle" id="stDone">Done</button>';
        return h;
      }
      nv.stEdit = null;
    }
    if (list.length > 1) h += '<div class="row between"><span class="muted small">' + list.length + ' stickies</span><button type="button" class="btn ghost small" id="nReorder">⇅ Reorder</button></div>';
    if (!list.length) h += '<p class="muted" style="margin:0">Quick sticky notes: a phone number, a reminder, an idea. Tap <b>New sticky</b>.</p>';
    else h += '<div class="stgrid">' + list.map(function (x, i) {
      return '<button type="button" class="sticky" data-stopen="' + x.id + '" style="background:' + x.c + ';--r:' + ([-2, 1.5, -1, 2.2, -1.6, 1][i % 6]) + 'deg">' + (x.pin ? '<span class="npin">📌</span>' : '') + '<span class="sttx">' + (esc(x.t) || '<i class="muted">empty</i>') + '</span><span class="cap">' + niceDate(x.at) + '</span></button>';
    }).join('') + '</div>';
    h += '<div class="nfoot"><button type="button" class="btn coral" id="stNew">+ New sticky</button></div>';
    return h;
  }
  function bindStickies(o) {
    var list = stickies(), st = nv.stEdit && list.filter(function (x) { return x.id === nv.stEdit; })[0];
    var nw = o.querySelector('#stNew');
    if (nw) nw.onclick = function () {
      var x = { id: 's' + Date.now().toString(36), t: '', c: STCOL[list.length % 4], pin: false, at: new Date().toISOString(), ord: topOrd(withOrd(list)) };
      list.push(x); save(); nv.stEdit = x.id; drawNotes();
    };
    o.querySelectorAll('[data-stopen]').forEach(function (b) { b.onclick = function () { nv.stEdit = b.dataset.stopen; drawNotes(); }; });
    if (st) {
      var ta = o.querySelector('#stText');
      ta.addEventListener('input', function () { st.t = ta.value; st.at = new Date().toISOString(); save(); });
      setTimeout(function () { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }, 60);
      o.querySelectorAll('[data-stc]').forEach(function (b) { b.onclick = function () { st.c = b.dataset.stc; save(); drawNotes(); }; });
      o.querySelector('#stPin').onclick = function () { st.pin = !st.pin; save(); drawNotes(); };
      o.querySelector('#stDel').onclick = function () { if (st.t && !confirm('Delete this sticky?')) return; state.stickies = list.filter(function (x) { return x !== st; }); nv.stEdit = null; save(); drawNotes(); };
      o.querySelector('#stDone').onclick = function () { if (!st.t.trim()) state.stickies = list.filter(function (x) { return x !== st; }); nv.stEdit = null; save(); drawNotes(); };
    }
  }

  function drawNoteEditor() {
    var o = document.getElementById('overlay'), n = noteById(nv.id);
    if (!n) { nv.id = null; return drawNotes(); }
    var pages = notePages(n);
    if (nv.page == null || nv.page >= pages.length) nv.page = 0;
    if (!nv.zoom) nv.zoom = 1;
    var pg = pages[nv.page], items = pg.items, editing = nv.edit != null && items[nv.edit];
    if (!editing) nv.edit = null;
    var keepScroll = o.scrollTop, wrapOld = o.querySelector('.nwrap'), wsl = wrapOld ? wrapOld.scrollLeft : 0, wst = wrapOld ? wrapOld.scrollTop : 0;
    var h = '<div class="inner ned"><div class="row between"><button type="button" class="btn ghost small" id="nBack">‹ Notes</button><div class="row" style="gap:6px">' +
      '<button type="button" class="nib' + (n.pinned ? ' on' : '') + '" id="nPin" aria-pressed="' + n.pinned + '" aria-label="Pin to the top">📌</button><button type="button" class="nib" id="nDel" aria-label="Delete note">🗑</button></div></div>';
    h += '<input id="nTitle" class="ntitle display" placeholder="Title" value="' + esc(n.title) + '">';
    h += '<textarea id="nBody" class="text nbody" placeholder="Type notes…">' + esc(n.body) + '</textarea>';
    h += '<div class="npager"><div class="row" style="gap:4px"><button type="button" class="nib" id="nPrev" aria-label="Previous page"' + (nv.page ? '' : ' disabled') + '>‹</button><span class="cap npno">Page ' + (nv.page + 1) + ' / ' + pages.length + '</span><button type="button" class="nib" id="nNext" aria-label="Next page"' + (nv.page < pages.length - 1 ? '' : ' disabled') + '>›</button>' +
      '<button type="button" class="nib sm" id="nAddPg">+ Page</button>' + (pages.length > 1 ? '<button type="button" class="nib sm" id="nDelPg" aria-label="Delete this page">🗑</button>' : '') + '</div>' +
      '<div class="row" style="gap:4px"><button type="button" class="nib" id="nZo" aria-label="Zoom out">−</button><button type="button" class="nib sm" id="nZr" aria-label="Reset zoom">' + Math.round(nv.zoom * 100) + '%</button><button type="button" class="nib" id="nZi" aria-label="Zoom in">+</button></div></div>';
    var board = n.kind === 'board';
    if (board && !editing) {
      h += '<div class="row vbtools"><input class="text" id="vbQ" placeholder="Search Google Images…" value="' + esc(nv.vbq || '') + '" enterkeyhint="search"><button type="button" class="nib" id="vbFind" aria-label="Find images on Google">🔍</button><button type="button" class="nib on" id="vbPaste">📋 Paste</button><button type="button" class="nib" id="vbGal" aria-label="Add from gallery">🖼</button></div>' +
        (nv.pasteBox ? pasteBoxHtml() : '') +
        '<div class="row" style="gap:6px;flex-wrap:wrap"><span class="cap">Background</span>' + BOARDBG.map(function (b) { return '<button type="button" class="nsw sm' + (n.board === b[1] ? ' on' : '') + '" data-bbg="' + b[1] + '" style="background:' + b[1] + '" aria-label="' + b[0] + ' background"></button>'; }).join('') + '</div>';
    }
    h += '<div class="nwrap' + (board ? ' board' : '') + '"' + (board ? ' style="background:' + n.board + '"' : '') + '><canvas id="nCv" aria-label="' + (board ? 'Vision board' : 'Sketch area') + ', page ' + (nv.page + 1) + '"></canvas></div>';
    if (!editing) h += '<div class="nlayer" id="nLayer" hidden>' + LAYERBTNS + '</div>';
    if (editing) h += '<div class="npanel" id="nPanel"></div>';
    else {
      h += '<div class="ntools" role="toolbar" aria-label="Drawing tools">' + ['move', 'pen', 'line', 'rect', 'circle', 'arrow', 'text', 'check', 'img', 'erase'].map(function (k) {
        return '<button type="button" class="ntool' + (nv.tool === k ? ' on' : '') + '" data-ntool="' + k + '" aria-label="' + NNAME[k] + '" aria-pressed="' + (nv.tool === k) + '"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' + NICON[k] + '</svg></button>';
      }).join('') + '</div>';
    }
    h += '<div class="row between"><div class="row" style="gap:9px">' + NCOL.map(function (c) { return '<button type="button" class="nsw' + (nv.color === c ? ' on' : '') + '" data-ncol="' + c + '" style="background:' + c + '" aria-label="Colour"></button>'; }).join('') + '</div>' +
      '<div class="row" style="gap:6px"><button type="button" class="nib sm' + (nv.thick ? ' on' : '') + '" id="nThick" aria-label="Line thickness">' + (nv.thick ? 'thick' : 'thin') + '</button><button type="button" class="nib" id="nUndo" aria-label="Undo"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>';
    if (!editing) h += '<p class="muted small" style="text-align:center">' + ({ move: 'Drag things to move them. Tap a picture, text or checklist, then drag its mango corner (or pinch it) to resize. Tap selected text or a checklist again to edit it.', text: 'Tap where the text should go, or tap existing text to edit it.', check: 'Tap where the checklist should go. Tap any box to tick it.', erase: 'Tap a line, shape, text, checklist or photo to remove it.', img: 'Choose a photo; then drag it into place.' }[nv.tool] || 'Draw with one finger. Pinch with two fingers to zoom.') + ' Saved as you go.</p>';
    h += '<input type="file" id="nImg" accept="image/*" hidden><input type="file" id="vbFile" accept="image/*" hidden></div>';
    o.innerHTML = h;
    var vf = o.querySelector('#vbFind');
    if (vf) {
      var vq = o.querySelector('#vbQ'), find = function () { var t = vq.value.trim() || n.title || 'vision board'; nv.vbq = vq.value; googleImages(t); setTimeout(function () { toast('Long-press an image → Copy image, then come back and tap Paste'); }, 400); };
      vf.onclick = find; vq.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); find(); } });
      vq.addEventListener('input', function () { nv.vbq = vq.value; });
      o.querySelector('#vbPaste').onclick = pasteImage;
      bindPasteBox(o);
      state.lastBoard = n.id;
      o.querySelector('#vbGal').onclick = function () { o.querySelector('#vbFile').click(); };
      o.querySelector('#vbFile').onchange = function (e) { var f = e.target.files[0]; if (f) blobToDataURL(f).then(startCrop); };
      o.querySelectorAll('[data-bbg]').forEach(function (b) { b.onclick = function () { n.board = b.dataset.bbg; n.updated = new Date().toISOString(); saveNotes(); if (isDark(n.board) && nv.color === '#16302A') nv.color = '#FFFFFF'; if (!isDark(n.board) && nv.color === '#FFFFFF') nv.color = '#16302A'; drawNoteEditor(); }; });
    }
    o.scrollTop = keepScroll;
    var touch = function () { n.updated = new Date().toISOString(); saveNotes(); };
    var snap = function () { nv.hist.push(JSON.stringify(pg.items)); if (nv.hist.length > 40) nv.hist.shift(); };
    var q = function (s) { return o.querySelector(s); };
    q('#nBack').onclick = function () { notesLeave(); nv.id = null; nv.edit = null; drawNotes(); };
    q('#nPin').onclick = function () { n.pinned = !n.pinned; touch(); drawNoteEditor(); };
    q('#nDel').onclick = function () {
      if (!confirm('Delete this whole note?')) return;
      noteImgs(n).forEach(function (id) { idbDel('img-' + id).catch(function () {}); });
      NOTES.splice(NOTES.indexOf(n), 1); saveNotes(true); nv.id = null; drawNotes(); toast('Note deleted');
    };
    q('#nTitle').addEventListener('input', function (e) { n.title = e.target.value; touch(); });
    var nb = q('#nBody'), fit = function () { nb.style.height = 'auto'; nb.style.height = Math.max(56, nb.scrollHeight) + 'px'; };
    nb.addEventListener('input', function () { n.body = nb.value; touch(); fit(); }); fit();
    var goPage = function (i) { nv.page = i; nv.hist = []; nv.sel = null; nv.edit = null; drawNoteEditor(); };
    q('#nPrev').onclick = function () { if (nv.page) goPage(nv.page - 1); };
    q('#nNext').onclick = function () { if (nv.page < pages.length - 1) goPage(nv.page + 1); };
    q('#nAddPg').onclick = function () { pages.splice(nv.page + 1, 0, { items: [] }); touch(); goPage(nv.page + 1); toast('Page ' + (nv.page + 1) + ' added'); };
    var dp = q('#nDelPg'); if (dp) dp.onclick = function () {
      if (!confirm('Delete page ' + (nv.page + 1) + '?')) return;
      var gone = pages.splice(nv.page, 1)[0]; touch();
      gone.items.forEach(function (it) { if (it.type === 'img' && noteImgs(n).indexOf(it.src) < 0) idbDel('img-' + it.src).catch(function () {}); });
      goPage(Math.max(0, nv.page - 1));
    };
    o.querySelectorAll('[data-ntool]').forEach(function (b) { b.onclick = function () { nv.tool = b.dataset.ntool; nv.sel = null; if (nv.tool === 'img') q('#nImg').click(); else drawNoteEditor(); }; });
    o.querySelectorAll('[data-ncol]').forEach(function (b) { b.onclick = function () {
      nv.color = b.dataset.ncol;
      if (editing) { editing.c = nv.color; touch(); } else if (nv.tool === 'move' || nv.tool === 'erase' || nv.tool === 'img') nv.tool = 'pen';
      drawNoteEditor();
    }; });
    q('#nThick').onclick = function () { nv.thick = !nv.thick; drawNoteEditor(); };
    q('#nUndo').onclick = function () { if (!nv.hist.length) { toast('Nothing to undo'); return; } pg.items = JSON.parse(nv.hist.pop()); nv.edit = null; nv.sel = null; touch(); drawNoteEditor(); };
    q('#nImg').onchange = function (e) {
      var f = e.target.files[0]; if (!f) { nv.tool = 'move'; drawNoteEditor(); return; }
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () {
        var sc = Math.min(1, 1100 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/jpeg', .82), id = 'i' + Date.now().toString(36);
        URL.revokeObjectURL(url);
        idbPut('img-' + id, data).then(function () {
          var w = 460, hh = Math.round(w * c.height / c.width), img2 = new Image(); img2.src = data; imgCache[id] = img2;
          snap(); pg.items.push({ type: 'img', src: id, x: 60, y: 60, w: w, h: hh, rot: -2 }); touch();
          nv.tool = 'move'; drawNoteEditor(); toast('Photo pinned. Drag it into place.');
        }).catch(function () { toast('Could not save the photo'); });
      };
      im.onerror = function () { toast('Could not open that photo'); };
      im.src = url;
    };
    // ----- canvas, zoom and gestures -----
    var wrap = q('.nwrap'), cv = q('#nCv'), ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), baseW = wrap.clientWidth || 340, scale = 1;
    wrap.style.height = Math.round(baseW * NH / NW) + 'px';
    function size(z, raster) {
      var cw = baseW * z; cv.style.width = cw + 'px'; cv.style.height = cw * NH / NW + 'px';
      if (raster) { var px = Math.min(Math.round(cw * dpr), 4096); cv.width = px; cv.height = Math.round(px * NH / NW); scale = cv.width / NW; paint(); }
    }
    function paint(extra) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(scale, 0, 0, scale, 0, 0);
      pg.items.forEach(function (it) { drawItem(ctx, it, paint); });
      if (extra) drawItem(ctx, extra, null);
      var si = nv.edit != null ? nv.edit : nv.sel;
      var lb = document.getElementById('nLayer'); if (lb) lb.hidden = !(nv.sel != null && pg.items[nv.sel] && nv.tool === 'move' && nv.edit == null);
      if (si != null && pg.items[si]) {
        var b = bbox(ctx, pg.items[si]); ctx.save(); ctx.setLineDash([12, 10]); ctx.strokeStyle = '#12A39A'; ctx.lineWidth = 3; ctx.strokeRect(b.x - 12, b.y - 12, Math.max(b.w, 60) + 24, b.h + 24); ctx.restore();
        if (/^(img|text|check)$/.test(pg.items[si].type) && nv.tool === 'move' && nv.edit == null) { var hp = handlePos(pg.items[si], ctx); ctx.save(); ctx.fillStyle = '#FFB23F'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(hp.x, hp.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#16302A'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hp.x - 9, hp.y - 9); ctx.lineTo(hp.x + 9, hp.y + 9); ctx.moveTo(hp.x + 9, hp.y - 1); ctx.lineTo(hp.x + 9, hp.y + 9); ctx.lineTo(hp.x - 1, hp.y + 9); ctx.moveTo(hp.x - 9, hp.y + 1); ctx.lineTo(hp.x - 9, hp.y - 9); ctx.lineTo(hp.x + 1, hp.y - 9); ctx.stroke(); ctx.restore(); }
      }
    }
    nv.paint = paint;
    size(nv.zoom, true);
    wrap.scrollLeft = wsl; wrap.scrollTop = wst;
    var setZoom = function (z, cx, cy) {
      z = Math.max(1, Math.min(4, z));
      var r = wrap.getBoundingClientRect(); cx = cx == null ? r.width / 2 : cx - r.left; cy = cy == null ? r.height / 2 : cy - r.top;
      var fx = (wrap.scrollLeft + cx) / (baseW * nv.zoom), fy = (wrap.scrollTop + cy) / (baseW * nv.zoom * NH / NW);
      nv.zoom = z; size(z, false);
      wrap.scrollLeft = fx * baseW * z - cx; wrap.scrollTop = fy * baseW * z * NH / NW - cy;
      q('#nZr').textContent = Math.round(z * 100) + '%';
    };
    q('#nZi').onclick = function () { setZoom(nv.zoom < 1.5 ? 1.5 : nv.zoom < 2 ? 2 : nv.zoom < 3 ? 3 : 4); size(nv.zoom, true); };
    q('#nZo').onclick = function () { setZoom(nv.zoom > 3 ? 3 : nv.zoom > 2 ? 2 : nv.zoom > 1.5 ? 1.5 : 1); size(nv.zoom, true); };
    q('#nZr').onclick = function () { setZoom(1); size(1, true); };
    var P = function (e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * NW, y: (e.clientY - r.top) / r.height * NH }; };
    var cur = null, drag = null, pan = null, pinch = null, rsz = null, ptrs = {}, blocked = false, W = function () { return nv.thick ? 12 : 5; };
    var hit = function (p) { for (var i = pg.items.length - 1; i >= 0; i--) { var b = bbox(ctx, pg.items[i]); if (p.x >= b.x - 18 && p.x <= b.x + Math.max(b.w, 40) + 18 && p.y >= b.y - 18 && p.y <= b.y + b.h + 18) return i; } return -1; };
    var boxHit = function (p) {
      for (var i = pg.items.length - 1; i >= 0; i--) { var it = pg.items[i]; if (it.type !== 'check') continue; var k = checkRowAt(it, p); if (k >= 0) return { i: i, k: k }; }
      return null;
    };
    var openEdit = function (i) { nv.edit = i; nv.sel = null; drawNoteEditor(); };
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {   // two fingers: pinch to zoom and pan, and cancel any stroke that just started
        cur = null; drag = null; pan = null; blocked = true; paint();
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: nv.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        rsz = null;
        var si2 = nv.sel;   // two fingers on a selected picture resize the picture instead of zooming
        if (nv.tool === 'move' && si2 != null && pg.items[si2] && pg.items[si2].type === 'img') { var im0 = pg.items[si2]; snap(); pinch.img = { it: im0, w0: im0.w, h0: im0.h, cx: im0.x + im0.w / 2, cy: im0.y + im0.h / 2 }; }
        else if (nv.tool === 'move' && si2 != null && pg.items[si2] && /^(text|check)$/.test(pg.items[si2].type)) { snap(); pinch.txt = { it: pg.items[si2], s0: pg.items[si2].s }; }
        return;
      }
      if (ids.length > 2 || blocked) return;
      if (nv.edit != null) return;
      var p = P(e), t = nv.tool;
      var bh = t !== 'erase' ? boxHit(p) : null;
      if (bh) { snap(); var row = pg.items[bh.i].rows[bh.k]; row.d = !row.d; touch(); paint(); cur = null; ptrs.tap = true; return; }
      if (t === 'pen') cur = { type: 'pen', c: nv.color, w: W(), pts: [[Math.round(p.x), Math.round(p.y)]] };
      else if (t === 'line' || t === 'rect' || t === 'circle' || t === 'arrow') cur = { type: t, c: nv.color, w: W(), x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      else if (t === 'text' || t === 'check') {
        var hi = hit(p);
        if (hi >= 0 && (pg.items[hi].type === 'text' || pg.items[hi].type === 'check')) { snap(); openEdit(hi); return; }
        snap();
        if (t === 'text') pg.items.push({ type: 'text', x: p.x, y: p.y + 20, text: '', c: nv.color, s: nv.thick ? 76 : 56 });
        else pg.items.push({ type: 'check', x: p.x, y: p.y - 10, c: nv.color, s: nv.thick ? 72 : 56, rows: [{ t: '', d: false }] });
        openEdit(pg.items.length - 1);
      } else if (t === 'erase') {
        var i = hit(p); if (i >= 0) { snap(); var gone = pg.items.splice(i, 1)[0]; touch(); paint(); if (gone.type === 'img' && noteImgs(n).indexOf(gone.src) < 0) idbDel('img-' + gone.src).catch(function () {}); }
      } else if (t === 'move') {
        var sItem = nv.sel != null ? pg.items[nv.sel] : null, hp0 = sItem && /^(img|text|check)$/.test(sItem.type) ? handlePos(sItem, ctx) : null;
        if (hp0 && Math.hypot(p.x - hp0.x, p.y - hp0.y) < 55) {
          snap();
          if (sItem.type === 'img') rsz = { it: sItem, x: p.x, y: p.y, w0: sItem.w, h0: sItem.h };
          else { var bb0 = bbox(ctx, sItem); rsz = { it: sItem, x: p.x, y: p.y, s0: sItem.s, span: Math.max(bb0.w, 60) + bb0.h }; }
          return;
        }
        var wasSel = nv.sel, j = hit(p); nv.sel = j >= 0 ? j : null;
        if (j >= 0) { snap(); drag = { i: j, x: p.x, y: p.y, moved: 0, wasSel: wasSel === j }; }
        else pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
        paint();
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(ptrs).filter(function (k) { return k !== 'tap'; }); if (ids.length < 2) return;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch.txt) { pinch.txt.it.s = Math.round(Math.max(18, Math.min(220, pinch.txt.s0 * d / pinch.d))); paint(); return; }
        if (pinch.img) { var pi = pinch.img, f = d / pinch.d, nw = Math.max(80, Math.min(1800, pi.w0 * f)); pi.it.w = Math.round(nw); pi.it.h = Math.round(nw * pi.h0 / pi.w0); pi.it.x = pi.cx - pi.it.w / 2; pi.it.y = pi.cy - pi.it.h / 2; paint(); return; }
        setZoom(pinch.z * d / pinch.d, mx, my);
        wrap.scrollLeft -= mx - pinch.mx; wrap.scrollTop -= my - pinch.my; pinch.mx = mx; pinch.my = my;
        return;
      }
      if (pan) { wrap.scrollLeft = pan.sl - (e.clientX - pan.x); wrap.scrollTop = pan.st - (e.clientY - pan.y); return; }
      if (rsz && rsz.s0) { var q3 = P(e), f3 = Math.max(.25, (rsz.span + (q3.x - rsz.x) + (q3.y - rsz.y)) / rsz.span); rsz.it.s = Math.round(Math.max(18, Math.min(220, rsz.s0 * f3))); paint(); return; }
      if (rsz) { var q2 = P(e), ar = rsz.w0 / rsz.h0, nw2 = Math.max(80, Math.min(1800, rsz.w0 + ((q2.x - rsz.x) + (q2.y - rsz.y) * ar) / 2)); rsz.it.w = Math.round(nw2); rsz.it.h = Math.round(nw2 / ar); paint(); return; }
      if (!cur && !drag) return;
      var p = P(e);
      if (cur && cur.type === 'pen') { var l = cur.pts[cur.pts.length - 1]; if (Math.abs(l[0] - p.x) + Math.abs(l[1] - p.y) > 3) cur.pts.push([Math.round(p.x), Math.round(p.y)]); paint(cur); }
      else if (cur) { cur.x2 = p.x; cur.y2 = p.y; paint(cur); }
      else if (drag) { drag.moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y); shift(pg.items[drag.i], p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y; paint(); }
    });
    var up = function (e) {
      delete ptrs[e.pointerId]; delete ptrs.tap;
      var left = Object.keys(ptrs).length;
      if (pinch && left < 2) { var wasImg = pinch.img || pinch.txt; pinch = null; if (wasImg) touch(); else size(nv.zoom, true); }
      if (rsz) { rsz = null; touch(); paint(); }
      if (blocked) { if (!left) blocked = false; return; }
      if (cur) {
        var ok = cur.type === 'pen' || Math.abs(cur.x2 - cur.x1) + Math.abs(cur.y2 - cur.y1) > 8;
        if (ok) { snap(); pg.items.push(cur); touch(); }
        cur = null; paint();
      }
      if (drag) {
        var it = pg.items[drag.i], was = drag.i, moved = drag.moved, again = drag.wasSel; drag = null;
        if (moved < 6) { nv.hist.pop(); if (again && it && (it.type === 'text' || it.type === 'check')) { snap(); openEdit(was); return; } paint(); return; }
        touch();
      }
      pan = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    bindLayer(o, pg, function () { return nv.sel; }, function (i) { nv.sel = i; }, snap, touch, paint);
    if (editing) drawPanel(n, pg, touch);
  }

  var LAYERBTNS = [['front', '⤒', 'To front'], ['fwd', '↑', 'Forward'], ['back', '↓', 'Backward'], ['bottom', '⤓', 'To back']].map(function (b) { return '<button type="button" data-layer="' + b[0] + '"><span>' + b[1] + '</span>' + b[2] + '</button>'; }).join('');
  // bring to front / send to back: the items later in the list are drawn on top
  function bindLayer(root, pg, getI, setI, snap, touch, paint) {
    root.querySelectorAll('[data-layer]').forEach(function (b) {
      b.onclick = function () {
        var i = getI(), a = pg.items; if (i == null || !a[i]) return;
        var to = { front: a.length - 1, fwd: Math.min(a.length - 1, i + 1), back: Math.max(0, i - 1), bottom: 0 }[b.dataset.layer];
        if (to === i) { toast(to ? 'Already on top' : 'Already at the back'); return; }
        snap(); var it = a.splice(i, 1)[0]; a.splice(to, 0, it); setI(to); touch(); paint();
      };
    });
  }
  // editing panel for text and checklists (typing here updates the page live)
  function drawPanel(n, pg, touch) {
    var box = document.getElementById('nPanel'), it = pg.items[nv.edit]; if (!box || !it) return;
    var sizes = it.type === 'text' ? [[40, 'S'], [56, 'M'], [76, 'L'], [104, 'XL']] : [[44, 'S'], [56, 'M'], [72, 'L']];
    var h = '<div class="row between"><span class="lab">' + (it.type === 'text' ? 'Text' : 'Checklist') + '</span><div class="row" style="gap:4px"><button type="button" class="nib" id="npSmaller" aria-label="Smaller">A−</button>' + sizes.map(function (s) { return '<button type="button" class="nib sm' + (it.s === s[0] ? ' on' : '') + '" data-tsz="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '<button type="button" class="nib" id="npBigger" aria-label="Bigger">A+</button></div></div>';
    if (it.type === 'text') h += '<textarea id="npText" class="text" rows="3" placeholder="Type here… (new line = Enter)">' + esc(it.text) + '</textarea>';
    else {
      h += '<div class="nprows">' + it.rows.map(function (r, k) {
        return '<div class="nprow"><button type="button" class="tck' + (r.d ? ' on' : '') + '" data-rtick="' + k + '" aria-label="Tick">' + (r.d ? TICK : '') + '</button><input class="text" data-row="' + k + '" value="' + esc(r.t) + '" placeholder="Item ' + (k + 1) + '" enterkeyhint="next"><button type="button" class="fx" data-rdel="' + k + '" aria-label="Remove item">×</button></div>';
      }).join('') + '</div><button type="button" class="link" id="npAdd" style="align-self:flex-start">+ Add item</button>';
    }
    h += '<div class="nlayer in">' + LAYERBTNS + '</div>';
    h += '<div class="row"><button type="button" class="btn line small" id="npDel">Delete</button><button type="button" class="btn jungle small" id="npDone" style="flex:1">Done</button></div>';
    box.innerHTML = h;
    bindLayer(box, pg, function () { return nv.edit; }, function (i) { nv.edit = i; }, function () { nv.hist.push(JSON.stringify(pg.items)); }, touch, function () { if (nv.paint) nv.paint(); });
    var paint = function () { if (nv.paint) nv.paint(); }, redrawPanel = function (focusRow) { drawPanel(n, pg, touch); if (focusRow != null) { var el = box.querySelector('[data-row="' + focusRow + '"]'); if (el) try { el.focus(); } catch (e) {} } };
    // act on the first touch and don't steal focus, so the keyboard stays open and the panel doesn't jump
    box.querySelectorAll('[data-tsz]').forEach(function (b) {
      var go = function (e) { e.preventDefault(); it.s = +b.dataset.tsz; touch(); paint(); box.querySelectorAll('[data-tsz]').forEach(function (x) { x.classList.toggle('on', x === b); }); };
      b.addEventListener('pointerdown', go); b.addEventListener('click', function (e) { e.preventDefault(); });
    });
    var szs = box.querySelector('#npSmaller'), szb = box.querySelector('#npBigger');
    [[szs, .85], [szb, 1.18]].forEach(function (x) { if (x[0]) x[0].addEventListener('pointerdown', function (e) { e.preventDefault(); it.s = Math.round(Math.max(18, Math.min(220, it.s * x[1]))); touch(); paint(); box.querySelectorAll('[data-tsz]').forEach(function (y) { y.classList.toggle('on', +y.dataset.tsz === it.s); }); }); });
    var ta = box.querySelector('#npText');
    if (ta) { ta.addEventListener('input', function () { it.text = ta.value; touch(); paint(); }); setTimeout(function () { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }, 60); }
    box.querySelectorAll('[data-row]').forEach(function (inp) {
      var k = +inp.dataset.row;
      inp.addEventListener('input', function () { it.rows[k].t = inp.value; touch(); paint(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); it.rows.splice(k + 1, 0, { t: '', d: false }); touch(); paint(); redrawPanel(k + 1); } });
    });
    box.querySelectorAll('[data-rtick]').forEach(function (b) { b.addEventListener('pointerdown', function (e) { e.preventDefault(); }); b.onclick = function () { var r = it.rows[+b.dataset.rtick]; r.d = !r.d; touch(); paint(); redrawPanel(); }; });
    box.querySelectorAll('[data-rdel]').forEach(function (b) { b.onclick = function () { it.rows.splice(+b.dataset.rdel, 1); if (!it.rows.length) it.rows.push({ t: '', d: false }); touch(); paint(); redrawPanel(); }; });
    var add = box.querySelector('#npAdd'); if (add) add.onclick = function () { it.rows.push({ t: '', d: false }); touch(); paint(); redrawPanel(it.rows.length - 1); };
    if (it.type === 'check') { var last = box.querySelector('[data-row="' + (it.rows.length - 1) + '"]'); if (last && !last.value) setTimeout(function () { try { last.focus(); } catch (e) {} }, 60); }
    box.querySelector('#npDel').onclick = function () { pg.items.splice(nv.edit, 1); nv.edit = null; touch(); drawNoteEditor(); };
    box.querySelector('#npDone').onclick = function () {
      if (it.type === 'text' && !it.text.trim()) pg.items.splice(nv.edit, 1);
      if (it.type === 'check') { it.rows = it.rows.filter(function (r) { return r.t.trim(); }); if (!it.rows.length) pg.items.splice(nv.edit, 1); }
      nv.edit = null; touch(); drawNoteEditor();
    };
  }
  function handlePos(it, ctx) {
    if (it.type === 'text' || it.type === 'check') { var b = bbox(ctx || document.createElement('canvas').getContext('2d'), it); return { x: b.x + Math.max(b.w, 60) + 12, y: b.y + b.h + 12 }; }
    var pad = it.polaroid ? 14 : 8, bot = it.polaroid ? (it.cap ? 64 : 22) : 8; return { x: it.x + it.w + pad, y: it.y + it.h + bot };
  }
  function checkGeo(it) { return { b: it.s * .82, rh: it.s * 1.6 }; }
  function checkRowAt(it, p) {
    var g = checkGeo(it);
    for (var k = 0; k < it.rows.length; k++) { var top = it.y + k * g.rh; if (p.x >= it.x - 16 && p.x <= it.x + g.b + 16 && p.y >= top - 12 && p.y <= top + g.b + 12) return k; }
    return -1;
  }
  function shift(it, dx, dy) {
    if (it.type === 'pen') it.pts.forEach(function (q) { q[0] += dx; q[1] += dy; });
    else if (it.x1 != null) { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
    else { it.x += dx; it.y += dy; }
  }
  function bbox(ctx, it) {
    if (it.type === 'pen') { var xs = it.pts.map(function (q) { return q[0]; }), ys = it.pts.map(function (q) { return q[1]; }); var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys); return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 }; }
    if (it.x1 != null) return { x: Math.min(it.x1, it.x2), y: Math.min(it.y1, it.y2), w: Math.abs(it.x2 - it.x1), h: Math.abs(it.y2 - it.y1) };
    if (it.type === 'text') { ctx.save(); ctx.font = '500 ' + it.s + 'px "Space Grotesk", sans-serif'; var lines = (it.text || '').split('\n'), w = Math.max(it.s * 2, Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }))); ctx.restore(); return { x: it.x, y: it.y - it.s, w: w, h: it.s * 1.25 * lines.length }; }
    if (it.type === 'check') {
      var g = checkGeo(it); ctx.save(); ctx.font = '500 ' + it.s + 'px "Space Grotesk", sans-serif';
      var tw = Math.max(it.s * 4, Math.max.apply(null, it.rows.map(function (r) { return ctx.measureText(r.t || '').width; }))); ctx.restore();
      return { x: it.x, y: it.y, w: g.b + it.s * .45 + tw, h: (it.rows.length - 1) * g.rh + g.b };
    }
    return { x: it.x, y: it.y, w: it.w, h: it.h + (it.polaroid && it.cap ? 60 : 0) };
  }
  function drawItem(x, it, redraw) {
    x.save(); x.strokeStyle = it.c; x.fillStyle = it.c; x.lineWidth = it.w; x.lineCap = 'round'; x.lineJoin = 'round';
    if (it.type === 'pen') {
      var p = it.pts; x.beginPath(); x.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) x.lineTo(p[0][0] + .1, p[0][1]);
      for (var i = 1; i < p.length - 1; i++) x.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      if (p.length > 1) x.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      x.stroke();
    } else if (it.type === 'line' || it.type === 'arrow') {
      x.beginPath(); x.moveTo(it.x1, it.y1); x.lineTo(it.x2, it.y2); x.stroke();
      if (it.type === 'arrow') { var a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), L = 22 + it.w * 2; x.beginPath(); x.moveTo(it.x2 - L * Math.cos(a - .45), it.y2 - L * Math.sin(a - .45)); x.lineTo(it.x2, it.y2); x.lineTo(it.x2 - L * Math.cos(a + .45), it.y2 - L * Math.sin(a + .45)); x.stroke(); }
    } else if (it.type === 'rect') {
      var rx = Math.min(it.x1, it.x2), ry = Math.min(it.y1, it.y2), rw = Math.abs(it.x2 - it.x1), rh = Math.abs(it.y2 - it.y1);
      x.beginPath(); if (x.roundRect) x.roundRect(rx, ry, rw, rh, 14); else x.rect(rx, ry, rw, rh); x.stroke();
    } else if (it.type === 'circle') {
      x.beginPath(); x.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2 || 1, Math.abs(it.y2 - it.y1) / 2 || 1, 0, 0, Math.PI * 2); x.stroke();
    } else if (it.type === 'text') {
      x.font = '500 ' + it.s + 'px "Space Grotesk", sans-serif'; x.textBaseline = 'alphabetic';
      (it.text || '').split('\n').forEach(function (l, k) { x.fillText(l, it.x, it.y + k * it.s * 1.25); });
    } else if (it.type === 'check') {
      var g = checkGeo(it), bx = g.b;
      x.font = '500 ' + it.s + 'px "Space Grotesk", sans-serif'; x.textBaseline = 'middle'; x.lineWidth = Math.max(3, it.s / 10);
      it.rows.forEach(function (r, k) {
        var top = it.y + k * g.rh, cy = top + bx / 2, tx = it.x + bx + it.s * .45;
        x.beginPath(); if (x.roundRect) x.roundRect(it.x, top, bx, bx, bx * .22); else x.rect(it.x, top, bx, bx);
        if (r.d) { x.fillStyle = it.c; x.fill(); x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(it.x + bx * .22, cy); x.lineTo(it.x + bx * .43, top + bx * .72); x.lineTo(it.x + bx * .8, top + bx * .28); x.stroke(); }
        else { x.strokeStyle = it.c; x.stroke(); }
        x.fillStyle = it.c; x.globalAlpha = r.d ? .45 : 1; x.fillText(r.t || '', tx, cy);
        if (r.d && r.t) { var w2 = x.measureText(r.t).width; x.strokeStyle = it.c; x.lineWidth = Math.max(2, it.s / 16); x.beginPath(); x.moveTo(tx, cy); x.lineTo(tx + w2, cy); x.stroke(); x.lineWidth = Math.max(3, it.s / 10); }
        x.globalAlpha = 1;
      });
    } else if (it.type === 'img') {
      var im = imgCache[it.src];
      if (!im) {
        imgCache[it.src] = im = new Image();
        idbGet('img-' + it.src).then(function (d) { if (d) { im.onload = function () { if (redraw) redraw(); }; im.src = d; } }).catch(function () {});
      }
      if (!(im.complete && im.naturalWidth) && redraw && !im._w) { im._w = 1; im.addEventListener('load', function () { redraw(); }); }
      if (im.complete && im.naturalWidth) {
        x.translate(it.x + it.w / 2, it.y + it.h / 2); x.rotate((it.rot || 0) * Math.PI / 180);
        x.shadowColor = 'rgba(0,0,0,.18)'; x.shadowBlur = 16; x.shadowOffsetY = 6;
        var pad = it.polaroid ? 14 : 8, bot = it.polaroid ? (it.cap ? 64 : 22) : 8;
        x.fillStyle = '#fff'; x.fillRect(-it.w / 2 - pad, -it.h / 2 - pad, it.w + pad * 2, it.h + pad + bot);
        x.shadowColor = 'transparent'; x.drawImage(im, -it.w / 2, -it.h / 2, it.w, it.h);
        if (it.cap) { x.fillStyle = '#16302A'; x.font = '500 30px "Space Grotesk", sans-serif'; x.textBaseline = 'middle'; x.fillText(it.cap.length > 28 ? it.cap.slice(0, 27) + '…' : it.cap, -it.w / 2, it.h / 2 + 34, it.w); }
      } else { x.fillStyle = '#EFE3D1'; x.fillRect(it.x, it.y, it.w, it.h); }
    }
    x.restore();
  }

  // ---------- morning visualization: AI writes the script, the phone's voice reads it, background sound is synthesised ----------
  var VZ_SCENES = [
    { id: 'ghats', e: '🏍', n: 'Ride through the Ghats', p: 'riding a motorcycle through the winding roads of the Western Ghats in Coorg on a clear, cool morning' },
    { id: 'tri', e: '🏁', n: 'Triathlon finish line', p: 'swimming, cycling and running your first sprint triathlon and crossing the finish line strong' },
    { id: 'match', e: '🏸', n: 'Winning a match', p: 'an evening game of badminton where you move lightly, read every shot and win the final rally' },
    { id: 'estate', e: '☕', n: 'Sunrise on the estate', p: 'walking through a coffee estate in Coorg at sunrise, mist lifting off the hills' },
    { id: 'pitch', e: '🤝', n: 'Nailing the pitch', p: 'giving a calm, confident pitch to investors and seeing it land' },
    { id: 'focus', e: '🎯', n: 'Deep focus at work', p: 'a morning of deep, calm focus on your most important work, finishing it well' }
  ];
  var VZ_LIB = {
    ghats: ['You are on your motorcycle at the start of the ghat road. The engine idles, steady and warm beneath you.', 'The air is cool and smells of wet earth and coffee blossom.', 'You roll forward. The first bend comes, and you lean into it smoothly, eyes looking through the curve.', 'Mist hangs between the trees. Sunlight breaks through in long gold stripes across the road.', 'Your hands are relaxed on the bars. Your breathing matches the rhythm of the road.', 'Bend after bend, you feel completely present: just the road, the machine and you.', 'You reach the top of the ghat and pull over. The valley opens below, green and endless.', 'You take off your helmet and breathe in. You feel clear, calm and alive.'],
    tri: ['You stand at the edge of the water with the other swimmers. Your heart is quick, but your breath is slow.', 'The start sounds. You walk in, dive, and find your stroke: long, easy, steady.', 'You climb out and run to your bike. Your hands know exactly what to do.', 'On the bike, the wind rushes past. Your legs turn smoothly; you pass one rider, then another.', 'Now the run. Your legs feel heavy for a moment, then they settle into rhythm.', 'You hear people cheering. Each step is light. You have trained for exactly this.', 'The finish line appears. You lift your pace and cross it, arms up.', 'You stop, breathing hard, and feel it: you did it. Twelve weeks of work, in one moment.'],
    match: ['It is evening. The court lights are on and the shuttle is bright white against the dark.', 'You bounce on your toes, loose and ready. Your grip is light on the racquet.', 'The rally begins. You read the shot early, split step, and move to it without rushing.', 'You hear the clean sound of the strings as you clear to the back of the court.', 'Your breathing is steady. Your mind is only on the next shot.', 'Match point. You wait, calm. The shuttle floats up short.', 'You step in and play the smash, sharp and clean. It lands.', 'Your partner laughs and high-fives you. You feel quick, strong and completely present.'],
    estate: ['You step out into the estate just before sunrise. The ground is soft and damp under your feet.', 'Mist sits in the valleys. Birds are starting to call across the hills.', 'You walk between the coffee rows. The leaves are glossy and heavy with dew.', 'You notice the healthy plants, the clean rows, the work that has gone into every block.', 'The sun rises over the ridge and the mist turns gold.', 'You breathe in the smell of earth and leaves. You feel proud of this place, and calm.', 'You picture the estate a year from now: thriving, well run, exactly as you want it.', 'You stand still for a moment and let that picture settle in your chest.'],
    pitch: ['You walk into the room. You feel prepared, grounded and calm.', 'You look at the people across the table and smile. Your voice comes out steady and clear.', 'You explain the problem simply. You can see them nodding.', 'You show what you have built. Your hands are relaxed; you know every detail.', 'A hard question comes. You pause, breathe, and answer it well.', 'The energy in the room shifts. They lean forward. They are interested.', 'At the end, someone says: let’s talk about next steps.', 'You walk out into the daylight feeling light, clear and proud of how you showed up.'],
    focus: ['You sit down at your desk. Your phone is in another room. The space is quiet.', 'You open the one piece of work that matters most today.', 'The first few minutes feel slow. Then you find the thread, and time begins to move differently.', 'Your attention is steady, like a lamp held still. Distractions come, and you let them pass.', 'You make a clear decision, then another. The work takes shape in front of you.', 'You notice how good it feels to give one thing all of your attention.', 'The hour ends and you look at what you have made. It is solid, and it is finished.', 'You stretch, stand up, and feel calm, capable and ahead of your day.']
  };
  function vizSettings() {
    state.viz = state.viz || {};
    var v = state.viz;
    if (!v.scene && !v.custom) v.scene = 'ghats';
    if (!v.mins) v.mins = 5; if (!v.rate) v.rate = .9; if (!v.bg) v.bg = 'ocean';
    if (v.bgVol == null) v.bgVol = .5; if (v.vVol == null) v.vVol = 1;
    return v;
  }
  function vizTopic(v) { if (v.custom) return v.custom; var s = VZ_SCENES.filter(function (x) { return x.id === v.scene; })[0] || VZ_SCENES[0]; return s.p; }
  function vizTopicName(v) { if (v.custom) return v.custom; var s = VZ_SCENES.filter(function (x) { return x.id === v.scene; })[0] || VZ_SCENES[0]; return s.n; }
  var BGS = [['ocean', '🌊 Ocean'], ['rain', '🌧 Rain'], ['forest', '🌿 Forest birds'], ['tanpura', '🪕 Tanpura drone'], ['bells', '🔔 Soft bells'], ['silence', 'Silence']];
  function bgName(k) { return (BGS.filter(function (b) { return b[0] === k; })[0] || BGS[0])[1]; }
  // a short topic with no verb ("elephant", "an eagle", "the ocean") means: become it
  function isBeing(t) { return t.split(/\s+/).length <= 3 && !/\b(my|me|i|win|winning|finish|finishing|give|giving|demo|pitch|launch|run|ride|riding|play|playing|get|getting|build|building|walk|walking|first)\b/i.test(t); }
  function localScript(v) {
    var c = (v.custom || '').replace(/[.!]+$/, ''), body;
    if (c && isBeing(c)) {
      var noun = c.replace(/^(a|an|the)\s+/i, ''), an = /^[aeiou]/i.test(noun) ? 'an ' : 'a ';
      body = ['Imagine that you slowly become ' + an + noun + '.', 'Feel your body change shape. Notice its size, its weight, how it holds itself.', 'Feel how you stand, how you move, how you breathe as ' + an + noun + '.', 'Look out through these new eyes. Where are you? What is the ground, the air, the light like here?', 'Listen the way ' + an + noun + ' listens. What sounds matter to you now?', 'Notice what you can smell and feel on your skin.', 'Move through your world for a while, completely at ease in this body.', 'Notice the quality this creature has that you most admire. Feel it filling you.'];
    } else if (c) {
      body = ['Picture this clearly: ' + c + '.', 'Notice where you are. What can you see around you? Let the details come into focus.', 'Notice the light, the colours, the small things you would only see if you were really there.', 'What can you hear? Let the sounds come closer.', 'Feel your body: steady, capable and calm.', 'Now see the moment it goes well, exactly as you hoped.', 'Notice how that feels in your chest, in your hands, on your face.', 'Stay here for a few breaths. You have done the work to get here.'];
    } else body = VZ_LIB[v.scene] || VZ_LIB.ghats;
    var L = [{ text: 'Sit comfortably and let your eyes close.', pause: 4 }, { text: 'Breathe in slowly through your nose… and let it go.', pause: 7 }, { text: 'Once more. In… and out. Let your shoulders drop.', pause: 7 }];
    body.forEach(function (t, i) { L.push({ text: t, pause: i === body.length - 1 ? 12 : 7 }); });
    L.push({ text: c && isBeing(c) ? 'Now slowly become yourself again, and bring that quality with you into today.' : 'Now choose one small thing you will do today to move towards this.', pause: 10 }, { text: 'Hold the picture and the feeling.', pause: 6 }, { text: 'Take a deep breath in… and out.', pause: 6 }, { text: 'When you are ready, open your eyes and begin your day.', pause: 1 });
    return { title: vizTopicName(v), lines: L, ai: false };
  }
  function vizPrompt(v) {
    var custom = !!v.custom, words = Math.round(v.mins * 75);
    return 'You are an expert guided-imagery writer. Write a spoken morning visualization for one listener named Shravan (an engineer in Coorg, India) lasting about ' + v.mins + ' minutes when read slowly with pauses.\n\n' +
      'TOPIC: "' + vizTopic(v) + '"\n\n' +
      (custom ?
        'First decide what the listener most likely wants from this topic and commit to it fully:\n' +
        '- If the topic names an animal, creature, plant, object, element or place (for example "elephant", "eagle", "banyan tree", "river", "ocean"), the listener BECOMES it. Put him inside its body in the second person ("you are an elephant"). Describe the world as that being actually perceives it, using accurate, specific real details: its size and weight, how its body moves, its senses (for an elephant: the trunk that smells water from far away, feeling rumbles through the feet, the slow sway, the herd led by the matriarch, dust baths, mud on the skin, the forests of Nagarhole or Kabini). Stay in that perspective for most of the script. Do NOT turn it into a success or goal story.\n' +
        '- If the topic is an activity, goal or event, the listener lives it vividly as himself, up to the moment it goes really well.\n\n' :
        'The listener lives this scene vividly as himself, up to the moment it goes really well.\n\n') +
      'Style: second person, present tense, slow and calm. Concrete, specific, surprising sensory details (sight, sound, smell, touch, temperature, weight, movement) instead of generic phrases. Short sentences. No clichés ("journey", "unlock", "embrace"), no religious content, no health claims.\n' +
      'Shape: 2–3 lines to settle and breathe; then the heart of the experience (at least 70% of the script); then one or two lines bringing one quality from it into today; then a gentle return.\n' +
      'Length: about ' + words + ' words in total.\n\n' +
      'Reply only with JSON: {"title": "short evocative title", "lines": [{"text": "one or two sentences", "pause": seconds}]}. Pauses 2–15 seconds, longer after breathing cues and after vivid moments.';
  }
  function geminiCall(body) {
    // if one model is busy ("high demand") or missing, quietly try the next one; after a full round, wait and try once more
    var models = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
    var busyStatus = function (st) { return st === 404 || st === 429 || st === 500 || st === 502 || st === 503 || st === 504; };
    var lastErr = null;
    var go = function (i, round) {
      if (i >= models.length) {
        if (round < 1 && lastErr && lastErr.busy) return new Promise(function (res) { setTimeout(res, 2500); }).then(function () { return go(0, round + 1); });
        throw lastErr || new Error('AI is not available right now');
      }
      // newer keys (starting "AQ.") only work when sent in this header, not in the web address
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.aiKey }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.ok) return r.json().then(function (j) {
            var c = (j.candidates || [])[0];
            if (!c || !c.content || !c.content.parts) { lastErr = new Error('the AI gave an empty reply, try again'); lastErr.busy = true; return go(i + 1, round); }
            return j;
          });
          return r.text().then(function (t) {
            var m = ''; try { m = JSON.parse(t).error.message; } catch (e) {}
            if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('the AI key was not accepted' + (m ? ' (' + m.slice(0, 90) + ')' : ''));
            lastErr = new Error(r.status === 429 ? 'the free limit is used up for now, try again in a minute' : r.status === 404 ? 'no AI model available for this key' : 'Google’s AI is very busy right now, try again in a minute');
            lastErr.busy = r.status !== 404;
            if (busyStatus(r.status)) return go(i + 1, round);
            throw new Error('AI error ' + r.status + (m ? ': ' + m.slice(0, 90) : ''));
          });
        }, function () { lastErr = new Error('no internet connection'); throw lastErr; });
    };
    return go(0, 0).then(function (j) { return j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); });
  }
  function aiScript(v) {
    return geminiCall({ contents: [{ parts: [{ text: vizPrompt(v) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 1 } }).then(function (txt) {
      var s = JSON.parse(txt.replace(/^\s*```(json)?/, '').replace(/```\s*$/, ''));
      var lines = (s.lines || []).filter(function (l) { return l && l.text; }).map(function (l) { return { text: String(l.text), pause: Math.max(1, Math.min(20, +l.pause || 5)) }; });
      if (lines.length < 4) throw new Error('the AI reply was too short');
      return { title: s.title || vizTopicName(v), lines: lines, ai: true };
    });
  }
  // --- voice ---
  function vizVoices() {
    var all = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
    return all.filter(function (x) { return /^en/i.test(x.lang); }).sort(function (a, b) { return (/IN/.test(b.lang) - /IN/.test(a.lang)) || (a.name < b.name ? -1 : 1); });
  }
  function pickVoice() { var v = vizSettings(), vs = vizVoices(); return vs.filter(function (x) { return x.voiceURI === v.voice; })[0] || vs.filter(function (x) { return /en[-_]IN/i.test(x.lang); })[0] || vs[0] || null; }
  function speak(text, onend) {
    if (!('speechSynthesis' in window)) { setTimeout(onend, estSec(text) * 1000); return; }
    var v = vizSettings(), u = new SpeechSynthesisUtterance(text), vo = pickVoice();
    if (vo) { u.voice = vo; u.lang = vo.lang; } else u.lang = 'en-IN';
    u.rate = v.rate; u.volume = v.vVol; u.pitch = 1;
    u.onend = onend; u.onerror = onend;
    speechSynthesis.speak(u);
  }
  function estSec(t) { return t.split(/\s+/).length / (2.4 * vizSettings().rate) + .6; }
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = function () { if (vz && vz.stage === 'audio') drawViz(); };
  // --- natural AI voices (Gemini text-to-speech, same free key) ---
  var AIVOICES = [['Sulafat', 'Warm'], ['Achernar', 'Soft'], ['Vindemiatrix', 'Gentle'], ['Enceladus', 'Breathy'], ['Aoede', 'Breezy'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Gacrux', 'Mature'], ['Umbriel', 'Easy-going'], ['Iapetus', 'Clear'], ['Charon', 'Deep, informative'], ['Achird', 'Friendly']];
  function useAIVoice() { var v = vizSettings(); return !!state.aiKey && v.voiceMode !== 'phone'; }
  function aiVoiceName() { return vizSettings().aiVoice || 'Sulafat'; }
  function ttsStyle() { var r = vizSettings().rate; return 'Read this as a warm, calm meditation guide, speaking ' + (r <= .8 ? 'very slowly' : r < 1 ? 'slowly' : 'at a relaxed pace') + ', softly and close to the microphone, with gentle natural pauses between sentences.'; }
  function apiErr(r) {
    return r.text().then(function (t) {
      var m = ''; try { m = JSON.parse(t).error.message; } catch (e) {}
      var e = new Error(r.status === 401 || r.status === 403 ? 'the AI key was not accepted' : r.status === 429 ? 'the free voice limit is used up for now' : 'voice error ' + r.status + (m ? ': ' + m.slice(0, 80) : ''));
      e.status = r.status; throw e;
    });
  }
  function b64bytes2(b) { var s = atob(b), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  // one request for the whole script; tries the newest voice models first, then older ones
  function ttsRequest(lines, voice) {
    var tagged = lines.map(function (l) { return l.text + (l.pause >= 6 ? ' <long pause>' : ' <short pause>'); }).join('\n');
    var plain = lines.map(function (l) { return l.text; }).join('\n\n');
    var H = { 'Content-Type': 'application/json', 'x-goog-api-key': state.aiKey };
    var tries = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts'].map(function (m) {
      return function () {
        return fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: H, body: JSON.stringify({
          model: m, input: [{ type: 'user_input', content: [{ type: 'text', text: tagged, annotations: [{ type: 'speech_metadata', style: ttsStyle() }] }] }],
          response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: voice }] }
        }) }).then(function (r) {
          if (!r.ok) return apiErr(r);
          return r.json().then(function (j) {
            var au = null;
            (j.steps || []).forEach(function (st) { (st.content || []).forEach(function (c) { if (c.type === 'audio' && c.data) au = c; }); });
            if (!au) (j.outputs || j.output || []).forEach(function (c) { if (c && c.type === 'audio' && c.data) au = c; });
            if (!au) throw new Error('no audio in the reply');
            return { bytes: b64bytes2(au.data), mime: au.mime_type || au.mimeType || '' };
          });
        });
      };
    }).concat([function () {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', { method: 'POST', headers: H, body: JSON.stringify({
        contents: [{ parts: [{ text: ttsStyle() + '\n\n' + plain }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      }) }).then(function (r) {
        if (!r.ok) return apiErr(r);
        return r.json().then(function (j) {
          var p = (((j.candidates || [])[0] || {}).content || {}).parts || [], d = p.filter(function (x) { return x.inlineData; })[0];
          if (!d) throw new Error('no audio in the reply');
          return { bytes: b64bytes2(d.inlineData.data), mime: d.inlineData.mimeType || '' };
        });
      });
    }]);
    var last = null;
    var go = function (i) {
      if (i >= tries.length) return Promise.reject(last || new Error('no voice model available'));
      return tries[i]().catch(function (e) { last = e; if (e.status === 401 || e.status === 403) throw e; return go(i + 1); });
    };
    return go(0);
  }
  function decodeTTS(a) {
    var b = a.bytes, c = actx();
    if ((b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70) || /wav/i.test(a.mime) || /mpeg|mp3|ogg|opus/i.test(a.mime)) return c.decodeAudioData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    var rate = +((/rate=(\d+)/.exec(a.mime) || [])[1]) || 24000, n = Math.floor(b.length / 2), buf = c.createBuffer(1, n, rate), d = buf.getChannelData(0), dv = new DataView(b.buffer, b.byteOffset, n * 2);
    for (var i = 0; i < n; i++) d[i] = dv.getInt16(i * 2, true) / 32768;
    return Promise.resolve(buf);
  }
  // add silence at the natural pauses so it lasts about the length you chose, and time the captions
  function stretchVoice(buf, targetSec, lines) {
    var sr = buf.sampleRate, d = buf.getChannelData(0), win = Math.round(sr * .02), n = Math.floor(d.length / win), rms = new Float32Array(n), mx = 0, i, k;
    for (i = 0; i < n; i++) { var s2 = 0; for (k = i * win; k < (i + 1) * win; k++) s2 += d[k] * d[k]; rms[i] = Math.sqrt(s2 / win); if (rms[i] > mx) mx = rms[i]; }
    var th = Math.max(.003, mx * .06), gaps = [], st = -1;
    for (i = 0; i < n; i++) {
      if (rms[i] < th) { if (st < 0) st = i; }
      else { if (st > 0 && (i - st) * .02 >= .28) gaps.push({ a: st * win, b: i * win }); st = -1; }
    }
    var extra = Math.max(0, targetSec - buf.duration - 3) * sr, W = gaps.reduce(function (s, g) { return s + Math.min(g.b - g.a, sr * 2); }, 0) || 1;
    gaps.forEach(function (g) { g.add = Math.min(sr * 25, Math.round(extra * Math.min(g.b - g.a, sr * 2) / W)); g.at = Math.round((g.a + g.b) / 2); });
    var addAll = gaps.reduce(function (s, g) { return s + g.add; }, 0), lead = Math.round(sr * .5), tail = Math.round(sr * Math.min(12, Math.max(2, (extra - addAll) / sr)));
    var out = actx().createBuffer(1, lead + d.length + addAll + tail, sr), o = out.getChannelData(0), pos = lead, from = 0;
    gaps.forEach(function (g) { o.set(d.subarray(from, g.at), pos); pos += g.at - from; pos += g.add; from = g.at; });
    o.set(d.subarray(from), pos);
    var toOut = function (smp) { var t = lead + smp; gaps.forEach(function (g) { if (g.at < smp) t += g.add; }); return t / sr; };
    // captions: place each line by its share of the text, then snap to the nearest pause
    var total = lines.reduce(function (s, l) { return s + l.text.length; }, 0) || 1, voicedEnd = d.length, acc = 0, caps = [];
    lines.forEach(function (l, li) {
      var est = acc / total * voicedEnd;
      if (li > 0) { var best = null; gaps.forEach(function (g) { if (!best || Math.abs(g.b - est) < Math.abs(best.b - est)) best = g; }); if (best && Math.abs(best.b - est) < sr * 4) est = best.b; }
      caps.push({ t: li ? toOut(est) : 0, text: l.text }); acc += l.text.length;
    });
    return { buf: out, caps: caps };
  }
  var prevCache = {};
  function previewAIVoice(name, btn) {
    var c = actx();
    var play = function (buf) { if (vz && vz.prevSrc) try { vz.prevSrc.stop(); } catch (e) {} var s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination); s.start(); if (vz) vz.prevSrc = s; if (btn) btn.textContent = '▶ Preview'; };
    if (prevCache[name]) return play(prevCache[name]);
    if (btn) btn.textContent = 'Loading…';
    idbGet('ttsprev-' + name).then(function (saved) {
      return saved ? saved : ttsRequest([{ text: 'Good morning, ' + myName() + '. Let your shoulders drop, and take one slow breath in… and out.', pause: 2 }], name).then(function (a) { idbPut('ttsprev-' + name, a).catch(function () {}); return a; });
    }).then(decodeTTS).then(function (buf) { prevCache[name] = buf; play(buf); })
      .catch(function (e) { if (btn) btn.textContent = '▶ Preview'; toast('Couldn’t load the voice: ' + e.message); });
  }

  // --- background sound (made live with Web Audio, so there are no sound files to download) ---
  var AC = null, bg = null;
  function actx() { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
  function bgStart(kind, vol) {
    bgStop();
    if (!kind || kind === 'silence' || !(window.AudioContext || window.webkitAudioContext)) return;
    var c = actx(), out = c.createGain(), nodes = [], timers = [], t0 = c.currentTime;
    var me = { out: out, nodes: nodes, timers: timers, kind: kind }; bg = me;
    out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(vol, t0 + 2.5); out.connect(c.destination);
    var noise = function (brown) {
      var len = c.sampleRate * 4, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; if (brown) { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      var s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); nodes.push(s); return s;
    };
    var filt = function (type, f, q) { var x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; nodes.push(x); return x; };
    var gain = function (v) { var g = c.createGain(); g.gain.value = v; nodes.push(g); return g; };
    var lfo = function (target, f, depth) { var o = c.createOscillator(), g = gain(depth); o.frequency.value = f; o.connect(g); g.connect(target); o.start(); nodes.push(o); };
    if (kind === 'ocean') {
      var g1 = gain(.55); noise(true).connect(filt('lowpass', 700)).connect(g1); g1.connect(out); lfo(g1.gain, .085, .4);
      var g2 = gain(.12); noise(false).connect(filt('bandpass', 1800, .6)).connect(g2); g2.connect(out); lfo(g2.gain, .085, .1);
    } else if (kind === 'rain') {
      noise(false).connect(filt('highpass', 900)).connect(filt('lowpass', 6500)).connect(gain(.22)).connect(out);
      noise(true).connect(filt('lowpass', 400)).connect(gain(.35)).connect(out);
      timers.push(setInterval(function () { if (Math.random() < .5) return; var o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.frequency.setValueAtTime(2200 + Math.random() * 1800, t); o.frequency.exponentialRampToValueAtTime(700, t + .05); g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.0001, t + .06); o.connect(g); g.connect(out); o.start(t); o.stop(t + .08); }, 120));
    } else if (kind === 'forest') {
      var gw = gain(.25); noise(true).connect(filt('bandpass', 420, .7)).connect(gw); gw.connect(out); lfo(gw.gain, .05, .15);
      var chirp = function () {
        var t = c.currentTime, base = 2600 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4);
        for (var k = 0; k < n; k++) { var o = c.createOscillator(), g = c.createGain(), s = t + k * .16; o.type = 'sine'; o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * .3), s + .09); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.06, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + .13); o.connect(g); g.connect(out); o.start(s); o.stop(s + .15); }
        if (bg === me) timers.push(setTimeout(chirp, 1200 + Math.random() * 4200));
      };
      timers.push(setTimeout(chirp, 900));
    } else if (kind === 'tanpura') {
      var strings = [98, 130.81, 130.81, 65.41], k2 = 0;
      var pluck = function () {
        var f = strings[k2++ % 4], t = c.currentTime, lp = c.createBiquadFilter(), g = c.createGain();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 2.5);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .03); g.gain.exponentialRampToValueAtTime(.0008, t + 4.2);
        [0, .35, -.3].forEach(function (dt) { var o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f + dt; o.connect(lp); o.start(t); o.stop(t + 4.4); });
        lp.connect(g); g.connect(out);
      };
      pluck(); timers.push(setInterval(pluck, 1150));
    } else if (kind === 'bells') {
      var notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      var bell = function () {
        var f = notes[Math.floor(Math.random() * notes.length)], t = c.currentTime;
        [[1, .16], [2.76, .06], [5.4, .025]].forEach(function (p) { var o = c.createOscillator(), g = c.createGain(); o.frequency.value = f * p[0]; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + 5); o.connect(g); g.connect(out); o.start(t); o.stop(t + 5.2); });
        if (bg === me) timers.push(setTimeout(bell, 4000 + Math.random() * 5000));
      };
      noise(true).connect(filt('lowpass', 300)).connect(gain(.12)).connect(out);
      timers.push(setTimeout(bell, 600));
    }
  }
  function bgStop() {
    if (!bg) return;
    var b = bg, c = AC; bg = null;
    b.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    try { b.out.gain.cancelScheduledValues(c.currentTime); b.out.gain.setValueAtTime(b.out.gain.value, c.currentTime); b.out.gain.linearRampToValueAtTime(0, c.currentTime + .8); } catch (e) {}
    setTimeout(function () { b.nodes.forEach(function (n) { try { if (n.stop) n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }); try { b.out.disconnect(); } catch (e) {} }, 900);
  }
  function bgVol(v) { if (bg && AC) bg.out.gain.setTargetAtTime(v, AC.currentTime, .15); }
  // --- screens ---
  var vz = null, wakeLock = null;
  function openViz(morning) {
    resetOverlay(); closeSheet();
    vz = { stage: 'choose', morning: !!morning };
    drawViz(); showOverlay('vzo');
  }
  function closeViz() { vizStop(); vz = null; closeOverlayEl(); if (location.search) history.replaceState(history.state, '', location.pathname); }
  function vizStop() {
    if (!vz) return;
    clearTimeout(vz.to); clearTimeout(vz.fb); clearInterval(vz.tick);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (AC && AC.state === 'suspended') AC.resume();
    if (vz.src) { try { vz.src.onended = null; vz.src.stop(); } catch (e) {} vz.src = null; }
    if (vz.prevSrc) { try { vz.prevSrc.stop(); } catch (e) {} vz.prevSrc = null; }
    bgStop();
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  function drawViz() {
    var o = document.getElementById('overlay'), v = vizSettings(), h = '<div class="inner">';
    o.classList.toggle('vzplay', vz.stage === 'play' || vz.stage === 'making');
    if (vz.stage === 'choose') {
      h += '<div class="row between"><span class="eyebrow">' + (vz.morning ? 'Good morning · ' : '') + new Date().toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) + '</span><button type="button" class="btn ghost small" id="vzClose">Close</button></div>';
      h += '<section class="hero w" style="background:linear-gradient(160deg,#FFB23F 0%,#FF6B57 70%);color:#fff">' + sun('#FFE6B8', 90, -10, 40) + wave('#FFFFFF', .2, 40, 20) + '<span class="cap">Visualization</span><span class="display h2" style="margin:0">Picture your<br><i>day going well</i></span></section>';
      h += '<span class="lab">What do you want to picture?</span><div class="optrow">' + VZ_SCENES.map(function (s) { return '<button type="button" class="opt sm" data-vscene="' + s.id + '" aria-pressed="' + (!v.custom && v.scene === s.id) + '">' + s.e + ' ' + s.n + '</button>'; }).join('') + '</div>';
      h += '<input class="text" id="vzCustom" value="' + esc(v.custom || '') + '" placeholder="…or type your own: “first demo of the weeder robot”">';
      h += '<span class="lab">Length</span><div class="optrow">' + [3, 5, 10].map(function (m) { return '<button type="button" class="opt" data-vmins="' + m + '" aria-pressed="' + (v.mins === m) + '">' + m + ' min</button>'; }).join('') + '</div>';
      var vo = pickVoice();
      h += '<div class="list"><button type="button" class="r" id="vzAudio"><span class="dot" style="background:' + T.lagoon + '"></span><span class="t">Voice</span><span class="v">' + (useAIVoice() ? esc(aiVoiceName()) + ' · AI' : esc(vo ? vo.name.replace(/Google |Microsoft /, '').slice(0, 20) : 'phone default')) + '</span>' + CHEV + '</button>' +
        '<button type="button" class="r" id="vzAudio2"><span class="dot" style="background:' + T.mango + '"></span><span class="t">Background</span><span class="v">' + bgName(v.bg) + '</span>' + CHEV + '</button></div>';
      h += '<button type="button" class="btn jungle" id="vzGo">' + (state.aiKey ? '✦ Create & play' : 'Play') + '</button>';
      if (!state.aiKey) h += '<p class="muted small" style="text-align:center">Using the app’s own scenes and phone voice. Add a free AI key (Settings → Visualization) for fresh scripts and natural voices.</p>';
      else if (useAIVoice()) h += '<p class="muted small" style="text-align:center">Writing and recording takes about 20–60 seconds.</p>';
      var saved = state.vizSaved || [];
      if (saved.length) h += '<h3 class="sh">Saved <span class="cap">replay</span></h3><div class="list">' + saved.slice().reverse().map(function (s) { return '<div class="r"><button type="button" class="rt" data-vsaved="' + s.id + '"><span class="t">' + esc(s.title) + '<small>' + s.lines.length + ' lines · saved ' + niceDate(s.at) + '</small></span><span class="v">▶</span></button><button type="button" class="fx" data-vsdel="' + s.id + '" aria-label="Delete">×</button></div>'; }).join('') + '</div>';
      if (vz.morning) h += '<button type="button" class="link" id="vzSkip" style="align-self:center">Skip to today’s targets</button>';
    } else if (vz.stage === 'audio') {
      h += '<div class="row between"><button type="button" class="btn ghost small" id="vzBack">‹ Back</button><span class="eyebrow">Voice + sound</span></div><h1 class="display" style="font-size:32px">Audio</h1>';
      var vs = vizVoices(), cur = pickVoice(), ai = useAIVoice();
      if (state.aiKey) {
        h += '<span class="lab">Natural AI voices <span class="muted">(recorded fresh each time)</span></span><div class="list">' + AIVOICES.map(function (x) {
          var on = ai && aiVoiceName() === x[0];
          return '<div class="r"><button type="button" class="tck' + (on ? ' on' : '') + '" data-avoice="' + x[0] + '" aria-pressed="' + on + '" aria-label="Use ' + x[0] + '">' + (on ? TICK : '') + '</button><span class="t">' + x[0] + '<small>' + x[1] + '</small></span><button type="button" class="pill pv" data-aprev="' + x[0] + '">▶ Preview</button></div>';
        }).join('') + '</div>';
      } else h += '<div class="notice">Want natural, human-sounding voices? Add your free AI key in Settings → Visualization.</div>';
      h += '<span class="lab">Phone voices <span class="muted">(robotic, but work offline)</span></span>';
      if (!vs.length) h += '<div class="notice">No English voices found. On Android: Settings → Accessibility → Text-to-speech → install Speech Services by Google.</div>';
      else h += '<div class="list">' + vs.slice(0, 12).map(function (x) {
        var on = !ai && cur && cur.voiceURI === x.voiceURI;
        return '<div class="r"><button type="button" class="tck' + (on ? ' on' : '') + '" data-vvoice="' + esc(x.voiceURI) + '" aria-pressed="' + on + '" aria-label="Use ' + esc(x.name) + '">' + (on ? TICK : '') + '</button><span class="t">' + esc(x.name.replace(/Google |Microsoft /, '')) + '<small>' + esc(x.lang) + (x.localService ? ' · works offline' : ' · needs internet') + '</small></span><button type="button" class="pill pv" data-vprev="' + esc(x.voiceURI) + '">▶ Preview</button></div>';
      }).join('') + '</div>';
      h += '<span class="lab">Speed</span><div class="optrow">' + [[.8, 'Slow'], [.9, 'Gentle'], [1, 'Normal']].map(function (r) { return '<button type="button" class="opt" data-vrate="' + r[0] + '" aria-pressed="' + (v.rate === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>';
      h += '<span class="lab">Background <span class="muted">(tap to hear it)</span></span><div class="optrow">' + BGS.map(function (b) { return '<button type="button" class="opt" data-vbg="' + b[0] + '" aria-pressed="' + (v.bg === b[0]) + '">' + b[1] + '</button>'; }).join('') + '</div>';
      h += '<label class="lab rng">Background volume<input type="range" id="vzBgV" min="0" max="1" step="0.05" value="' + v.bgVol + '"></label>';
      h += '<label class="lab rng">Voice volume<input type="range" id="vzVV" min="0.2" max="1" step="0.05" value="' + v.vVol + '"></label>';
      h += '<button type="button" class="btn jungle" id="vzBack2">Done</button>';
    } else if (vz.stage === 'making') {
      h += '<div class="vzmid"><div class="vzorb"></div><span class="cap" style="color:#FFE6B8">' + esc(vz.msg || 'writing your visualization') + '</span><span class="display" style="font-size:24px;color:#fff;text-align:center">' + esc(vizTopicName(v)) + '</span></div>';
    } else if (vz.stage === 'play') {
      var tot = vz.total || 1;
      h += '<div class="row between" style="color:#CDEFEA"><span class="eyebrow" style="color:#CDEFEA">' + esc(vz.script.title) + ' · ' + v.mins + ' min</span><button type="button" class="vzx" id="vzStop" aria-label="Stop">✕</button></div>';
      h += '<div class="vzmid"><div class="vzorb' + (vz.paused ? ' paused' : '') + '"></div><span class="cap" id="vzCue" style="color:#FFE6B8">' + (vz.paused ? 'paused' : 'listen') + '</span><p class="display vzline" id="vzLine" aria-live="polite">' + esc(vz.line || '') + '</p></div>';
      h += '<div class="vzbar"><div class="bar" style="background:rgba(255,255,255,.2)"><i id="vzProg" style="width:' + Math.min(100, (Date.now() - vz.t0) / tot * 100) + '%"></i></div><div class="row between"><span class="cap" id="vzEl" style="color:#CDEFEA">0:00</span><span class="small" style="color:#CDEFEA;opacity:.8">' + (vz.script.ai ? 'AI script' : 'app scene') + ' · ' + (vz.mode === 'ai' ? esc(aiVoiceName()) + ' voice' : 'phone voice') + '</span><span class="cap" style="color:#CDEFEA">' + fmt(Math.round(tot / 1000)) + '</span></div>' +
        '<div class="row" style="justify-content:center;gap:26px"><span class="small" style="color:#fff;opacity:.85">' + bgName(v.bg) + '</span><button type="button" class="vzpp" id="vzPP" aria-label="' + (vz.paused ? 'Play' : 'Pause') + '">' + (vz.paused ? '▶' : '❚❚') + '</button><button type="button" class="link" id="vzSave" style="color:#fff">' + (vz.saved ? 'Saved ★' : 'Save ☆') + '</button></div></div>';
    } else if (vz.stage === 'done') {
      h += '<div class="vzmid"><div class="vzorb done"></div><span class="display" style="font-size:34px;color:#fff;text-align:center;line-height:1.1">Carry it<br>into today</span><span style="color:#CDEFEA;text-align:center">+5 XP</span></div>';
      h += '<button type="button" class="btn" id="vzTargets" style="background:#FFB23F;color:#0F4D40">Set today’s targets</button>';
      if (!vz.saved) h += '<button type="button" class="btn ghost" id="vzSave2" style="border-color:rgba(255,255,255,.4);color:#fff">Save this script ☆</button>';
      h += '<button type="button" class="btn ghost" id="vzDone" style="border-color:rgba(255,255,255,.4);color:#fff">Close</button>';
    }
    o.innerHTML = h + '</div>';
    bindViz(o);
  }
  function bindViz(o) {
    var v = vizSettings(), q = function (s) { return o.querySelector(s); }, on = function (s, f) { var e = q(s); if (e) e.onclick = f; };
    on('#vzClose', closeViz); on('#vzDone', closeViz); on('#vzStop', closeViz);
    on('#vzSkip', function () { closeViz(); openGoal(); });
    on('#vzTargets', function () { closeViz(); openGoal(); });
    o.querySelectorAll('[data-vscene]').forEach(function (b) { b.onclick = function () { v.scene = b.dataset.vscene; v.custom = ''; save(); drawViz(); }; });
    o.querySelectorAll('[data-vmins]').forEach(function (b) { b.onclick = function () { v.mins = +b.dataset.vmins; save(); drawViz(); }; });
    var cu = q('#vzCustom'); if (cu) cu.addEventListener('input', function () { v.custom = cu.value.trim(); save(); o.querySelectorAll('[data-vscene]').forEach(function (b) { b.setAttribute('aria-pressed', String(!v.custom && v.scene === b.dataset.vscene)); }); });
    var toAudio = function () { vz.stage = 'audio'; drawViz(); };
    on('#vzAudio', toAudio); on('#vzAudio2', toAudio);
    var back = function () { bgStop(); if ('speechSynthesis' in window) speechSynthesis.cancel(); if (vz.prevSrc) { try { vz.prevSrc.stop(); } catch (e) {} vz.prevSrc = null; } vz.stage = 'choose'; drawViz(); };
    on('#vzBack', back); on('#vzBack2', back);
    o.querySelectorAll('[data-vvoice]').forEach(function (b) { b.onclick = function () { v.voice = b.dataset.vvoice; v.voiceMode = 'phone'; save(); drawViz(); }; });
    o.querySelectorAll('[data-avoice]').forEach(function (b) { b.onclick = function () { v.aiVoice = b.dataset.avoice; v.voiceMode = 'ai'; save(); drawViz(); }; });
    o.querySelectorAll('[data-aprev]').forEach(function (b) { b.onclick = function () { if ('speechSynthesis' in window) speechSynthesis.cancel(); previewAIVoice(b.dataset.aprev, b); }; });
    o.querySelectorAll('[data-vprev]').forEach(function (b) { b.onclick = function () { speechSynthesis.cancel(); var keep = v.voice; v.voice = b.dataset.vprev; speak('Good morning, ' + myName() + '. Let’s begin.', function () {}); v.voice = keep; }; });
    o.querySelectorAll('[data-vrate]').forEach(function (b) { b.onclick = function () { v.rate = +b.dataset.vrate; save(); drawViz(); if (!useAIVoice()) { speechSynthesis.cancel(); speak('This is how fast I will speak.', function () {}); } }; });
    o.querySelectorAll('[data-vbg]').forEach(function (b) { b.onclick = function () { v.bg = b.dataset.vbg; save(); var k = v.bg; drawViz(); bgStart(k, v.bgVol); }; });
    var bv = q('#vzBgV'); if (bv) bv.oninput = function () { v.bgVol = +bv.value; save(); bgVol(v.bgVol); };
    var vv = q('#vzVV'); if (vv) vv.onchange = function () { v.vVol = +vv.value; save(); if (vz.vg) vz.vg.gain.value = v.vVol * 1.15; if (!useAIVoice()) { speechSynthesis.cancel(); speak('This is the voice volume.', function () {}); } };
    on('#vzGo', function () { vizUnlock(); vizMake(); });
    o.querySelectorAll('[data-vsaved]').forEach(function (b) { b.onclick = function () { var s = (state.vizSaved || []).filter(function (x) { return x.id === b.dataset.vsaved; })[0]; if (s) { vizUnlock(); vz.saved = true; vizVoice({ title: s.title, lines: s.lines, ai: s.ai }, s.audio ? s.id : null); } }; });
    o.querySelectorAll('[data-vsdel]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this saved visualization?')) return; idbDel('vzaudio-' + b.dataset.vsdel).catch(function () {}); state.vizSaved = state.vizSaved.filter(function (x) { return x.id !== b.dataset.vsdel; }); save(); drawViz(); }; });
    on('#vzPP', function () { if (vz.paused) vizResume(); else vizPause(); });
    var sv = function () {
      if (vz.saved || !vz.script) return;
      var id = 's' + Date.now().toString(36), withAudio = !!vz.raw;
      if (withAudio) idbPut('vzaudio-' + id, vz.raw).catch(function () {});
      var all = (state.vizSaved || []).concat([{ id: id, title: vz.script.title, lines: vz.script.lines, ai: vz.script.ai, audio: withAudio, at: new Date().toISOString() }]);
      while (all.length > 20) { var old = all.shift(); if (old.audio) idbDel('vzaudio-' + old.id).catch(function () {}); }
      state.vizSaved = all; save(); vz.saved = true; toast('Saved' + (withAudio ? ' with the voice' : '') + '. Replay it any morning.'); drawViz();
    };
    on('#vzSave', sv); on('#vzSave2', sv);
  }
  // speech and audio must start from a tap on Android: warm them up right away
  function vizUnlock() {
    try { actx(); } catch (e) {}
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  }
  function vizMake() {
    var v = vizSettings();
    if (!state.aiKey) return vizVoice(localScript(v));
    vz.stage = 'making'; vz.msg = 'writing your visualization'; drawViz();
    var done = false, timer = setTimeout(function () { if (done) return; done = true; toast('The AI is slow today: using the app’s scenes'); vizVoice(localScript(v)); }, 25000);
    aiScript(v).then(function (s) { if (done || !vz) return; done = true; clearTimeout(timer); vizVoice(s); })
      .catch(function (e) { if (done || !vz) return; done = true; clearTimeout(timer); toast('AI unavailable (' + e.message + '): using the app’s scenes'); vizVoice(localScript(v)); });
  }
  // AI voice if possible (or a saved recording), otherwise the phone's own voice
  function vizVoice(script, savedId) {
    if (!savedId && !useAIVoice()) return vizPlay(script);
    vz.stage = 'making'; vz.msg = savedId ? 'loading your saved voice' : 'recording the voice · ' + aiVoiceName(); drawViz();
    var done = false, timer = null;
    var fail = function (e) { if (done || !vz) return; done = true; clearTimeout(timer); toast('Natural voice unavailable (' + e.message + '): using the phone voice'); vizPlay(script); };
    timer = setTimeout(function () { fail(new Error('it took too long')); }, 150000);
    var get = savedId ? idbGet('vzaudio-' + savedId).then(function (a) { if (!a) throw new Error('recording not found'); return a; }) : ttsRequest(script.lines, aiVoiceName());
    get.then(function (raw) { return decodeTTS(raw).then(function (buf) { return { raw: raw, buf: buf }; }); })
      .then(function (r) { if (done || !vz) return; done = true; clearTimeout(timer); vz.raw = r.raw; vizPlayAI(script, stretchVoice(r.buf, vizSettings().mins * 60, script.lines)); })
      .catch(fail);
  }
  function vizPlayAI(script, prep) {
    var v = vizSettings(), c = actx();
    vz.script = script; vz.stage = 'play'; vz.mode = 'ai'; vz.paused = false; vz.line = script.lines[0].text; vz.ci = 0;
    vz.total = prep.buf.duration * 1000; vz.t0 = Date.now();
    bgStart(v.bg, v.bgVol);
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
    var g = c.createGain(); g.gain.value = v.vVol * 1.15; g.connect(c.destination);
    var src = c.createBufferSource(); src.buffer = prep.buf; src.connect(g);
    vz.src = src; vz.vg = g; vz.caps = prep.caps; vz.cStart = c.currentTime + 1;
    src.onended = function () { if (vz && vz.src === src && vz.stage === 'play') vizFinish(); };
    src.start(vz.cStart);
    drawViz();
    vz.tick = setInterval(function () {
      if (!vz || vz.stage !== 'play') return;
      var el = Math.max(0, c.currentTime - vz.cStart), p = document.getElementById('vzProg'), t = document.getElementById('vzEl');
      if (p) p.style.width = Math.min(100, el * 1000 / vz.total * 100) + '%';
      if (t) t.textContent = fmt(Math.min(Math.round(el), Math.round(vz.total / 1000)));
      var k = 0; for (var i = 0; i < vz.caps.length; i++) if (vz.caps[i].t <= el) k = i;
      if (k !== vz.ci) {
        vz.ci = k; vz.line = vz.caps[k].text;
        var ln = document.getElementById('vzLine'); if (ln) { ln.classList.remove('in'); void ln.offsetWidth; ln.textContent = vz.line; ln.classList.add('in'); }
        var cue = document.getElementById('vzCue'); if (cue) cue.textContent = /breath|inhale|exhale/i.test(vz.line) ? 'breathe' : 'listen';
      }
    }, 250);
  }
  function vizPlay(script) {
    var v = vizSettings();
    vz.mode = 'phone'; vz.raw = null;
    vz.script = script; vz.stage = 'play'; vz.i = 0; vz.line = ''; vz.paused = false;
    vz.t0 = Date.now(); vz.total = v.mins * 60000; vz.end = vz.t0 + vz.total;
    bgStart(v.bg, v.bgVol);
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
    drawViz();
    vz.tick = setInterval(function () {
      if (!vz || vz.stage !== 'play' || vz.paused) return;
      var el = Date.now() - vz.t0, p = document.getElementById('vzProg'), t = document.getElementById('vzEl');
      if (p) p.style.width = Math.min(100, el / vz.total * 100) + '%';
      if (t) t.textContent = fmt(Math.min(Math.round(el / 1000), Math.round(vz.total / 1000)));
    }, 500);
    setTimeout(vizNext, 1500);
  }
  function vizNext() {
    if (!vz || vz.stage !== 'play' || vz.paused) return;
    var L = vz.script.lines;
    if (vz.i >= L.length) return vizFinish();
    var line = L[vz.i], fired = false;
    vz.line = line.text;
    var el = document.getElementById('vzLine'); if (el) { el.classList.remove('in'); void el.offsetWidth; el.textContent = line.text; el.classList.add('in'); }
    var cue = document.getElementById('vzCue'); if (cue) cue.textContent = /breath|inhale|exhale/i.test(line.text) ? 'breathe' : 'listen';
    var fin = function () {
      if (fired) return; fired = true; clearTimeout(vz.fb);
      if (!vz || vz.paused || vz.stage !== 'play') return;
      var wait = pauseFor(vz.i); vz.i++;
      vz.to = setTimeout(vizNext, wait * 1000);
    };
    vz.fb = setTimeout(fin, estSec(line.text) * 1000 + 5000);
    speak(line.text, fin);
  }
  // stretch or shrink the pauses so the whole thing lasts about the length you chose
  function pauseFor(i) {
    var L = vz.script.lines, rest = L.slice(i + 1), speech = rest.reduce(function (a, l) { return a + estSec(l.text); }, 0);
    var left = (vz.end - Date.now()) / 1000 - speech, w = L.slice(i).reduce(function (a, l) { return a + l.pause; }, 0) || 1;
    return Math.max(1.5, Math.min(30, left * L[i].pause / w));
  }
  function vizPause() {
    if (vz.mode === 'ai') { vz.paused = true; if (AC) AC.suspend(); drawViz(); return; }
    vz.paused = true; vz.pausedAt = Date.now(); clearTimeout(vz.to); clearTimeout(vz.fb); if ('speechSynthesis' in window) speechSynthesis.cancel(); bgVol(vizSettings().bgVol * .4); drawViz(); }
  function vizResume() {
    if (vz.mode === 'ai') { vz.paused = false; if (AC) AC.resume(); drawViz(); return; }
    var d = Date.now() - vz.pausedAt; vz.t0 += d; vz.end += d; vz.paused = false; bgVol(vizSettings().bgVol); drawViz(); setTimeout(vizNext, 600); }
  function vizFinish() {
    clearInterval(vz.tick); vz.src = null;
    bgStop(); if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    vz.stage = 'done'; drawViz();
    var k = dkey(new Date());
    if (!(state.vizDone || {})[k]) mutate(function () { state.vizDone = state.vizDone || {}; state.vizDone[k] = true; });
  }
  function aiSheet() {
    var has = !!state.aiKey;
    var h = '<p style="margin:0;font-size:14px;line-height:1.5">Each morning Google’s Gemini AI can write a fresh visualization for you. It uses a <b>free</b> key that stays on this phone (it isn’t included in backups). One visualization a day is far inside the free limit.</p>';
    h += '<div class="card stack" style="gap:8px"><h2>Get your free key (once)</h2><ol class="steps"><li>Open <a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with your Google account.</li><li>Tap <b>Create API key</b> and accept the terms.</li><li>Tap the copy icon next to the key (it starts with <b>AQ.</b> or <b>AIza</b>).</li><li>Come back here, paste it below and tap <b>Save & test</b>.</li></ol></div>';
    h += '<input class="text" id="aiKey" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + (has ? 'Key saved · paste a new one to replace it' : 'AQ.… or AIza… (paste your key)') + '">';
    h += '<div class="row"><button type="button" class="btn jungle" id="aiSave" style="flex:1">Save & test</button>' + (has ? '<button type="button" class="btn line" id="aiDel">Remove</button>' : '') + '</div>';
    h += '<div class="notice ok">No key or no internet? It still works: the app builds the visualization from its own scenes.</div>';
    h += '<button type="button" class="btn coral" data-viz="1">Open the visualization</button>';
    return { title: 'Visualization', cap: has ? 'AI on' : 'scene library', html: h, bind: function (r) {
      var s = r.querySelector('#aiSave'), d = r.querySelector('#aiDel');
      s.onclick = function () {
        var k = r.querySelector('#aiKey').value.replace(/\s+/g, ''); if (!k && !state.aiKey) { toast('Paste your key first'); return; }
        var old = state.aiKey; if (k) state.aiKey = k;
        s.disabled = true; s.textContent = 'Testing…';
        geminiCall({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }).then(function () { save(); toast('AI key works'); drawSheet(); render(); })
          .catch(function (e) { state.aiKey = old; save(); toast('Didn’t work: ' + e.message); s.disabled = false; s.textContent = 'Save & test'; });
      };
      if (d) d.onclick = function () { if (!confirm('Remove the AI key from this phone?')) return; delete state.aiKey; save(); drawSheet(); render(); };
    } };
  }

  // ---------- detail sheets (slide up from the bottom) ----------
  function sheetFor(kind, arg) {
    switch (kind) {
      case 'progress': return progressSheet();
      case 'targets': return targetsSheet();
      case 'target': return targetSheet(arg);
      case 'tomorrow': return tomorrowSheet();
      case 'tonight': return tonightSheet(arg);
      case 'badminton': return badmintonSheet();
      case 'ai': return aiSheet();
      case 'day': return daySheet(ui.sel || todayNum());
      case 'move': return { title: 'Movement', cap: 'every 30 min', html: bodyCard(), bind: function (r) { bindTrail(r, todayNum()); } };
      case 'meal': return mealSheet(arg || 'breakfast');
      case 'about': return aboutSheet();
      case 'kcal': return kcalSheet();
      case 'weight': return weightSheet();
      case 'weighin': return weighinSheet();
      case 'sharedpick': return sharedPickSheet();
      case 'shopmonth': return shopMonthSheet(arg || dkey(new Date()).slice(0, 7));
      case 'shoplearn': return shopLearnSheet();
      case 'money': return moneySheet(arg);
      case 'shopshare': return shopShareSheet(arg);
      case 'shoppick': return shopPickSheet();
      case 'shopcard': return shopCardSheet(arg);
      case 'shoporder': return shopOrderSheet();
      case 'shopdash': return shopDashSheet(arg);
      case 'shopchecks': return shopChecksSheet();
      case 'backup': return backupSheet();
      case 'quickcam': return quickCamSheet(arg);
      case 'shopteach': return shopTeachSheet();
      case 'shopitems': return shopItemsSheet();
      case 'shopitem': return shopItemSheet(arg);
      case 'shopsame': return shopSameSheet();
      case 'shopindent': return shopIndentSheet();
      case 'shopreset': return shopResetSheet();
      case 'breath': return breathSheet();
      case 'shopset': return shopSetSheet();
      case 'shopstock': return shopStockSheet();
      case 'shopprices': return shopPricesSheet();
      case 'week': return weekSheet();
      case 'roadmap': return roadmapSheet();
      case 'garmin': return garminSheet();
      case 'garminday': return garminDaySheet();
      case 'restcal': return restcalSheet();
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
    if (ui.sheet.kind === 'weighin' && typeof wbClose === 'function') { wbClose(); wb.status = 'idle'; wb.reading = null; wb.msg = null; }
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
    var t = e.target.closest && e.target.closest('[data-sheet],[data-tab-go],[data-viz],[data-ocal],[data-drill],[data-breath],[data-spend],[data-bkup]');
    if (!t) return;
    if (t.dataset.spend) { e.stopPropagation(); openSpend(); return; }
    if (t.dataset.bkup) { e.stopPropagation(); openSheet('backup'); if (state.gdrive && state.gdrive.cid && state.gdrive.ok) gdBackup(); else shareBackup(); return; }
    if (t.dataset.breath) { e.stopPropagation(); openBreath(); return; }
    if (t.dataset.viz) { openViz(false); return; }
    if (t.dataset.drill) { e.stopPropagation(); openDrill(); return; }
    if (t.dataset.ocal) { openNotes('cal', t.dataset.ocal); return; }
    if (t.dataset.sheet) { openSheet(t.dataset.sheet); return; }
    var g = t.dataset.tabGo.split(':');
    closeSheet(); ui.tab = g[0]; if (g[1]) fitUi.view = g[1];
    render(); window.scrollTo(0, 0);
  });

  // ---------- mindful games in the check-in: Stone Cairn, then a chess lesson + puzzle ----------
  function gameCfg() {
    var g = state.games = state.games || {};
    if (!g.breath) g.breath = 'cairn';
    if (!g.cairn) g.cairn = 'm';
    if (!g.chess) g.chess = 'b';
    if (!g.kind) g.kind = 'course';
    g.best = g.best || {};
    return g;
  }
  var CAIRN = { e: { n: 5, name: 'Easy', sub: '5 breaths' }, m: { n: 10, name: 'Medium', sub: '10 breaths' }, h: { n: 10, name: 'Hard', sub: 'dark + probes' } };
  var CLEVEL = { b: 'Beginner', c: 'Club', s: 'Strong', x: 'Skip' };
  var CKIND = { course: 'Course', mix: 'Mix', material: 'Win material', mate: 'Checkmates', endgame: 'Endgames', opening: 'Openings' };
  var CKIND_TAGS = {
    material: ['fork', 'pin', 'skewer', 'hanging', 'discovered', 'trapped', 'removedef', 'doublecheck', 'sacrifice', 'material'],
    mate: ['mate1', 'mate2', 'mate3'],
    endgame: ['eg-pawn', 'eg-rook', 'eg-minor', 'eg-queen', 'endgame'],
    opening: ['opening']
  };
  function gOpt(attr, val, cur, label) { return '<button type="button" class="gopt" ' + attr + '="' + val + '" aria-pressed="' + (val === cur) + '">' + label + '</button>'; }

  // --- setup screen (the first thing after the target check) ---
  function setupHtml() {
    var g = gameCfg(), h = '';
    h += '<div><h1 style="font-size:30px;line-height:1.05">' + (g.chess === 'x' ? 'Breathe,<br><i class="lite">one stone at a time</i>' : 'Breathe, then<br><i class="lite">one chess lesson</i>') + '</h1></div>';
    h += '<div class="gsec"><span class="eyebrow">Breathing</span><div class="optrow">' + gOpt('data-gbr', 'cairn', g.breath, 'Stone Cairn') + gOpt('data-gbr', 'circle', g.breath, 'Plain circle') + '</div></div>';
    if (g.breath === 'cairn') {
      h += '<div class="gsec"><span class="eyebrow">Difficulty</span><div class="optrow">' + Object.keys(CAIRN).map(function (k) { return gOpt('data-gcd', k, g.cairn, CAIRN[k].name + ' · ' + CAIRN[k].sub); }).join('') + '</div>' +
        '<span class="gnote">' + (g.cairn === 'h' ? 'The screen stays dark and your count is hidden. A soft chime now and then asks which number you are on.' : 'Tap anywhere on each out-breath and a stone is set. Mind wandered? Tap “I drifted”. Noticing is the practice.') + '</span></div>';
    } else {
      h += '<div class="gsec"><span class="eyebrow">Length</span><div class="optrow">' + gOpt('data-gsecs', '60', String(ci.secs), '1 minute') + gOpt('data-gsecs', '120', String(ci.secs), '2 minutes') + '</div></div>';
    }
    h += '<div class="gsec"><span class="eyebrow">Chess level</span><div class="optrow">' + Object.keys(CLEVEL).map(function (k) { return gOpt('data-gcl', k, g.chess, CLEVEL[k]); }).join('') + '</div></div>';
    if (g.chess !== 'x') {
      h += '<div class="gsec"><span class="eyebrow">Puzzle kind</span><div class="optrow">' + Object.keys(CKIND).map(function (k) { return gOpt('data-gck', k, g.kind, CKIND[k]); }).join('') + '</div></div>';
      if (g.kind === 'course') {
        var li = (state.chess && state.chess.lesson) || 0, L = CH && CH.lessons[li % CH.lessons.length];
        h += '<div class="gcourse"><span class="gk">♞</span><span><b>Course: lesson ' + (li % 40 + 1) + ' of ' + (CH ? CH.lessons.length : 40) + (L ? ' · ' + esc(L.title) : '') + '</b><small>Each check-in teaches one idea, then a puzzle uses it</small></span></div>';
      }
    }
    h += '<div style="flex:1"></div><button type="button" class="btn solid" id="gBegin">Begin</button><button type="button" class="btn ghost" id="ciSkip">Skip to reflection</button>';
    return h;
  }
  function bindSetup(o) {
    var g = gameCfg();
    var set = function (k, v) { g[k] = v; save(); drawCheckin(); };
    o.querySelectorAll('[data-gbr]').forEach(function (b) { b.onclick = function () { set('breath', b.dataset.gbr); }; });
    o.querySelectorAll('[data-gcd]').forEach(function (b) { b.onclick = function () { set('cairn', b.dataset.gcd); }; });
    o.querySelectorAll('[data-gcl]').forEach(function (b) { b.onclick = function () { set('chess', b.dataset.gcl); }; });
    o.querySelectorAll('[data-gck]').forEach(function (b) { b.onclick = function () { set('kind', b.dataset.gck); }; });
    o.querySelectorAll('[data-gsecs]').forEach(function (b) { b.onclick = function () { ci.secs = +b.dataset.gsecs; ci.left = ci.secs; drawCheckin(); }; });
    var bg = o.querySelector('#gBegin');
    if (bg) bg.onclick = function () {
      if (g.chess !== 'x') loadChess();
      if (g.breath === 'cairn') { ci.cairn = { diff: g.cairn, n: 0, drifts: 0, pOk: 0, pMiss: 0, last: 0, probeAt: probePlan(g.cairn), t0: Date.now() }; ci.stage = 'cairn'; drawCheckin(); }
      else { ci.stage = 'breathe'; drawCheckin(); startBreath(); }
    };
  }
  // after the breathing part: chess (if on), else straight to the reflection
  function afterBreath() {
    var g = gameCfg();
    if (g.chess === 'x') { ci.stage = 'reflect'; drawCheckin(); return; }
    ci.stage = 'chessload'; drawCheckin();
    loadChess().then(function () {
      if (!ci || ci.stage !== 'chessload') return;
      startChess(); drawCheckin();
    }).catch(function () {
      if (!ci) return;
      toast('Chess needs the internet the first time'); ci.stage = 'reflect'; drawCheckin();
    });
  }

  // --- Stone Cairn ---
  function probePlan(d) {
    if (d !== 'h') return [];
    var a = 2 + Math.floor(Math.random() * 3), b = a + 3 + Math.floor(Math.random() * 3);
    return [a, Math.min(b, 9)];
  }
  var STONES = ['#8FA89D', '#B7C7BF', '#6F8F83', '#C9D6CF', '#9BB3A8', '#DCE6E1', '#A7BDB2', '#7E9C90', '#C2D1C9', '#E4ECE8'];
  function cairnSvg(n, total) {
    var s = '', y = 330, w0 = 190;
    for (var i = 0; i < n; i++) {
      var w = Math.max(56, w0 - i * (w0 - 56) / Math.max(total - 1, 1)), hgt = Math.max(26, 58 - i * 3), jit = ((i * 37) % 11) - 5;
      y -= hgt - 8;
      s += '<g class="stone' + (i === n - 1 ? ' new' : '') + '"><ellipse cx="' + (150 + jit) + '" cy="' + (y + hgt / 2) + '" rx="' + (w / 2) + '" ry="' + (hgt / 2) + '" fill="' + STONES[i % STONES.length] + '"/><ellipse cx="' + (150 + jit) + '" cy="' + (y + hgt / 2 + 4) + '" rx="' + (w / 2 - 4) + '" ry="' + (hgt / 2 - 6) + '" fill="rgba(0,0,0,.12)"/></g>';
    }
    return '<svg class="cairn" viewBox="0 0 300 350" aria-hidden="true"><ellipse cx="150" cy="338" rx="120" ry="9" fill="rgba(0,0,0,.35)"/>' + s + '</svg>';
  }
  function cairnHtml() {
    var c = ci.cairn, D = CAIRN[c.diff], g = gameCfg(), best = g.best[c.diff] || 0, hard = c.diff === 'h';
    var h = '<div><span class="eyebrow">Stone Cairn · ' + D.name + '</span></div>';
    if (c.probe) {
      h += '<div class="gprobe"><span class="gglow"></span><h1 style="font-size:30px;text-align:center">Which number<br><i class="lite">are you on?</i></h1><div class="gnums">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<button type="button" data-gnum="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
        '<span class="gnote" style="text-align:center">Right answer keeps your stones.</span></div>';
      return h;
    }
    if (c.msg) h += '<div class="gmsg">' + c.msg + '</div>';
    if (!hard) h += '<div class="row between" style="align-items:flex-end"><span class="display gcount">' + c.n + '<small> / ' + D.n + '</small></span><span class="gnote" style="text-align:right">' + (c.drifts ? 'drifted ' + (c.drifts === 1 ? 'once' : c.drifts + ' times') : 'no drift yet') + '<br>best cairn ' + best + '</span></div>';
    h += '<button type="button" class="gtap' + (hard ? ' hard' : '') + (c.fall ? ' fall' : '') + '" id="gTap" aria-label="Tap on each out-breath">' + (hard ? '<span class="gglow"></span>' : cairnSvg(c.n, D.n)) + '<span class="gtip">' + (c.n ? 'tap on the next out-breath' : 'breathe in… and tap as you breathe out') + '</span></button>';
    h += '<button type="button" class="btn ghost" id="gDrift">I drifted</button>';
    return h;
  }
  function chime() {
    try {
      var ac = window.__ac || (window.__ac = new (window.AudioContext || window.webkitAudioContext)()), t = ac.currentTime;
      [528, 792].forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0, t + i * .12); g.gain.linearRampToValueAtTime(.12, t + i * .12 + .03); g.gain.exponentialRampToValueAtTime(.001, t + i * .12 + 1.6);
        o.connect(g); g.connect(ac.destination); o.start(t + i * .12); o.stop(t + i * .12 + 1.7);
      });
    } catch (e) {}
  }
  function bindCairn(o) {
    var c = ci.cairn, D = CAIRN[c.diff];
    o.querySelectorAll('[data-gnum]').forEach(function (b) {
      b.onclick = function () {
        var n = +b.dataset.gnum; c.probe = false;
        if (n === c.n) { c.pOk++; c.msg = '✓ Yes, ' + n + '. Keep going.'; }
        else { c.pMiss++; c.drifts++; c.msg = 'You were on ' + c.n + '. The cairn starts again.'; c.n = 0; c.probeAt = probePlan('h'); }
        drawCheckin();
      };
    });
    var tap = o.querySelector('#gTap');
    if (tap) tap.onclick = function () {
      var now = Date.now();
      if (now - c.last < 1500) { c.msg = 'Slower: one tap for each out-breath.'; c.last = now; drawCheckin(); return; }
      c.last = now; c.msg = ''; c.n++; c.fall = false;
      if (navigator.vibrate) navigator.vibrate(18);
      if (c.n >= D.n) {
        var g = gameCfg(); g.best[c.diff] = Math.max(g.best[c.diff] || 0, c.n); save();
        c.done = true; ci.done = Math.round((now - c.t0) / 1000);
        if (navigator.vibrate) navigator.vibrate([60, 60, 120]);
        c.msg = '✓ Cairn of ' + c.n + (c.drifts ? '' : ', no drift') + '.';
        drawCheckin(); setTimeout(function () { if (ci && ci.stage === 'cairn') afterBreath(); }, 1300);
        return;
      }
      if (c.probeAt.indexOf(c.n) >= 0) {
        c.probeAt = c.probeAt.filter(function (x) { return x !== c.n; });
        drawCheckin();
        setTimeout(function () { if (ci && ci.stage === 'cairn') { chime(); c.probe = true; drawCheckin(); } }, 1600 + Math.random() * 1500);
        return;
      }
      drawCheckin();
    };
    var dr = o.querySelector('#gDrift');
    if (dr) dr.onclick = function () {
      c.drifts++; c.fall = c.n > 0; c.msg = 'Noticed. That is the practice. Start a new cairn.';
      drawCheckin();
      setTimeout(function () { if (ci && ci.stage === 'cairn') { c.n = 0; c.fall = false; drawCheckin(); } }, c.fall ? 700 : 0);
    };
  }

  // --- chess data + rules (loaded the first time chess is used) ---
  var CH = null, chLoading = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function loadChess() {
    if (CH && window.Chess) return Promise.resolve(CH);
    if (chLoading) return chLoading;
    chLoading = Promise.all([window.Chess ? 1 : loadScript('chesslib.js'), fetch('chess.json').then(function (r) { if (!r.ok) throw new Error('no chess'); return r.json(); })])
      .then(function (a) { CH = a[1]; return CH; }).catch(function (e) { chLoading = null; throw e; });
    return chLoading;
  }
  function chessState() { var c = state.chess = state.chess || {}; c.lesson = c.lesson || 0; c.log = c.log || []; c.seen = c.seen || []; return c; }
  function pickPuzzle(tags, lvl, avoid) {
    var cs = chessState(), seen = {}; cs.seen.forEach(function (i) { seen[i] = 1; }); if (avoid != null) seen[avoid] = 1;
    var L = { b: 0, c: 1, s: 2 }[lvl]; if (L == null) L = 0;
    var match = function (p) { return !tags || tags.some(function (t) { return p.t.indexOf(t) >= 0; }); };
    var prim = function (p) { return !tags || p.t.indexOf(tags[0]) >= 0; };
    var tries = [
      function (p, i) { return !seen[i] && p.d === L && prim(p); },
      function (p, i) { return !seen[i] && Math.abs(p.d - L) <= 1 && prim(p); },
      function (p, i) { return !seen[i] && p.d === L && match(p); },
      function (p, i) { return !seen[i] && Math.abs(p.d - L) <= 1 && match(p); },
      function (p, i) { return !seen[i] && match(p); },
      function (p, i) { return p.d === L && match(p); },
      function (p, i) { return !seen[i] && p.d === L; },
      function () { return true; }
    ];
    for (var k = 0; k < tries.length; k++) {
      var pool = []; CH.puzzles.forEach(function (p, i) { if (tries[k](p, i)) pool.push(i); });
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return 0;
  }
  function lessonFor(p) {
    if (p.pt) for (var j = 0; j < CH.lessons.length; j++) if (CH.lessons[j].tags[0] === p.pt) return CH.lessons[j];
    for (var i = 0; i < CH.lessons.length; i++) if (CH.lessons[i].tags && p.t.indexOf(CH.lessons[i].tags[0]) >= 0 && CH.lessons[i].tags[0] !== 'any') return CH.lessons[i];
    return null;
  }
  function startChess(again) {
    var g = gameCfg(), cs = chessState(), L = null, tags = null;
    if (g.kind === 'course') { L = CH.lessons[cs.lesson % CH.lessons.length]; tags = L.tags[0] === 'any' ? null : L.tags; }
    else if (CKIND_TAGS[g.kind]) tags = CKIND_TAGS[g.kind];
    var id = pickPuzzle(tags, g.chess, again ? ci.pz && ci.pz.id : null);
    ci.pz = { id: id, lesson: L, step: 0, tries: 0, hint: 0, t0: Date.now() };
    pzReset();
    ci.stage = L && !again && !ci.lessonSeen ? 'lesson' : 'puzzle';
  }
  function pzReset() {
    var P = CH.puzzles[ci.pz.id];
    ci.pz.game = new window.Chess(P.f);
    ci.pz.me = ci.pz.game.turn();
    ci.pz.sel = null; ci.pz.step = 0; ci.pz.res = null; ci.pz.lastMv = P.lm ? [P.lm.slice(0, 2), P.lm.slice(2, 4)] : null;
  }

  // --- board drawing (pieces: cburnett set, see style.css) ---
  var FILES = 'abcdefgh';
  function fenBoard(fen) {
    var rows = fen.split(' ')[0].split('/'), b = {};
    rows.forEach(function (r, ri) { var f = 0; for (var i = 0; i < r.length; i++) { var ch = r[i]; if (/\d/.test(ch)) f += +ch; else { b[FILES[f] + (8 - ri)] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase(); f++; } } });
    return b;
  }
  function boardHtml(o) {
    var B = fenBoard(o.fen), flip = !!o.flip, h = '<div class="cboard' + (o.small ? ' small' : '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '><div class="cgrid">';
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var rank = flip ? r + 1 : 8 - r, file = flip ? 7 - f : f, sq = FILES[file] + rank, light = (file + rank) % 2 === 1;
      var cls = 'sq ' + (light ? 'l' : 'd');
      if (o.last && o.last.indexOf(sq) >= 0) cls += ' lm';
      if (o.hi && o.hi.indexOf(sq) >= 0) cls += ' hi';
      if (o.bad && o.bad.indexOf(sq) >= 0) cls += ' bad';
      if (o.sel === sq) cls += ' sel';
      var pc = B[sq], dot = o.dots && o.dots.indexOf(sq) >= 0;
      var coord = (f === 0 ? '<i class="rk">' + rank + '</i>' : '') + (r === 7 ? '<i class="fl">' + FILES[file] + '</i>' : '');
      h += (o.static ? '<span' : '<button type="button"') + ' class="' + cls + '" data-sq="' + sq + '" aria-label="' + sq + (pc ? ' ' + PNAME[pc[1]] : '') + '">' + coord + (pc ? '<span class="cp ' + pc + '"></span>' : '') + (dot ? '<b class="' + (pc ? 'cap' : 'dot') + '"></b>' : '') + (o.static ? '</span>' : '</button>');
    }
    h += '</div>';
    if (o.arrows && o.arrows.length) {
      var xy = function (sq) { var fi = FILES.indexOf(sq[0]), ra = +sq[1]; return flip ? [7 - fi + .5, ra - .5] : [fi + .5, 8 - ra + .5]; };
      h += '<svg class="carrows" viewBox="0 0 8 8" aria-hidden="true"><defs><marker id="amk" markerWidth="3" markerHeight="3" refX="1.4" refY="1.5" orient="auto"><path d="M0 0L3 1.5L0 3z" fill="#FFB23F"/></marker><marker id="amc" markerWidth="3" markerHeight="3" refX="1.4" refY="1.5" orient="auto"><path d="M0 0L3 1.5L0 3z" fill="#FF6B57"/></marker></defs>' +
        o.arrows.map(function (a) { var p = xy(a[0]), q = xy(a[1]), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.sqrt(dx * dx + dy * dy) || 1, k = (L - .42) / L; return '<line x1="' + p[0] + '" y1="' + p[1] + '" x2="' + (p[0] + dx * k).toFixed(2) + '" y2="' + (p[1] + dy * k).toFixed(2) + '" stroke="' + (a[2] === 't' ? '#FF6B57' : '#FFB23F') + '" stroke-width=".2" stroke-linecap="round" opacity=".92" marker-end="url(#' + (a[2] === 't' ? 'amc' : 'amk') + ')"/>'; }).join('') + '</svg>';
    }
    return h + '</div>';
  }
  var PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

  // --- lesson card ---
  function lessonHtml() {
    var L = ci.pz.lesson, cs = chessState(), ex = L.ex != null ? CH.puzzles[L.ex] : null;
    var h = '<div class="row between"><span class="eyebrow">Lesson ' + (cs.lesson % CH.lessons.length + 1) + ' of ' + CH.lessons.length + ' · ' + esc(L.group) + '</span></div>';
    h += '<h1 style="font-size:34px;line-height:1">' + esc(L.title) + '</h1>';
    h += '<p class="gbody">' + L.body + '</p>';
    if (ex) {
      var fl = ex.f.split(' ')[1] === 'b';
      h += boardHtml({ fen: ex.f, flip: fl, static: true, small: true, hi: [ex.l[0].slice(0, 2)], arrows: ex.a || [[ex.l[0].slice(0, 2), ex.l[0].slice(2, 4), 'k']] });
      h += '<span class="gnote">Example: ' + (fl ? 'Black' : 'White') + ' plays <b>' + esc(ex.s[0]) + '</b>. ' + esc(ex.e || '') + '</span>';
    }
    h += '<div class="gtipbox"><b>Remember</b> · ' + L.tip + '</div>';
    h += '<div style="flex:1"></div><button type="button" class="btn solid" id="gTry">Got it · try a puzzle</button><button type="button" class="btn ghost" id="ciSkip">Skip to reflection</button>';
    return h;
  }

  // --- puzzle ---
  function puzzleTitle(P) {
    var side = ci.pz.me === 'w' ? 'White' : 'Black';
    if (P.t.indexOf('mate1') >= 0) return side + ' to move.<br><i class="lite">Checkmate in one</i>';
    if (P.t.indexOf('mate2') >= 0) return side + ' to move.<br><i class="lite">Mate in two</i>';
    if (P.t.indexOf('mate3') >= 0) return side + ' to move.<br><i class="lite">Mate in three</i>';
    return side + ' to move.<br><i class="lite">Find a good move</i>';
  }
  function puzzleHtml() {
    var pz = ci.pz, P = CH.puzzles[pz.id], g = gameCfg(), G = pz.game;
    var dots = [], hi = [];
    if (pz.sel) G.moves({ square: pz.sel, verbose: true }).forEach(function (m) { if (dots.indexOf(m.to) < 0) dots.push(m.to); });
    var key = P.l[pz.step * 2];
    if (pz.hint >= 1 && key) hi.push(key.slice(0, 2));
    var arrows = pz.hint >= 2 && key ? [[key.slice(0, 2), key.slice(2, 4), 'k']] : null;
    var h = '<div class="row between"><span class="eyebrow">' + (pz.lesson ? 'Puzzle · uses lesson ' + (chessState().lesson % CH.lessons.length + 1) : 'Puzzle · ' + CKIND[g.kind]) + '</span><button type="button" class="btn ghost small" id="gSkipP">Skip</button></div>';
    h += '<div class="row between" style="align-items:flex-start"><h1 style="font-size:28px;line-height:1.05">' + puzzleTitle(P) + '</h1><span class="gpill">' + ['Beginner', 'Club', 'Strong'][P.d] + '</span></div>';
    h += boardHtml({ fen: G.fen(), flip: pz.me === 'b', sel: pz.sel, dots: dots, hi: hi, last: pz.lastMv, bad: pz.bad, arrows: arrows, id: 'cb' });
    h += '<div class="gmsg' + (pz.msgBad ? ' bad' : '') + '" id="gPzMsg">' + (pz.msg || (pz.step ? '✓ Correct. Keep going.' : 'Any good move counts. The best move earns a ★.')) + '</div>';
    h += '<div style="flex:1"></div><div class="row" style="gap:10px"><button type="button" class="btn ghost" style="flex:1" id="gHint">' + (pz.hint >= 2 ? 'Show answer' : '💡 Hint') + '</button><button type="button" class="btn ghost" style="flex:1" id="gAnother">Another</button></div>';
    return h;
  }
  function uciOf(m) { return m.from + m.to + (m.promotion || ''); }
  function sanList(fen, ucis) {
    try { var G = new window.Chess(fen), out = []; ucis.forEach(function (u) { var m = G.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); if (m) out.push(m.san); }); return out; } catch (e) { return []; }
  }
  function evText(v) { if (v >= 90000) return 'forced mate'; if (v <= -90000) return 'you get mated'; var p = v / 100; return (p > 0 ? '+' : '') + p.toFixed(1); }
  function bindPuzzle(o) {
    var pz = ci.pz, P = CH.puzzles[pz.id];
    o.querySelectorAll('.cboard .sq').forEach(function (b) {
      b.onclick = function () {
        if (pz.busy) return;
        var sq = b.dataset.sq, G = pz.game, pc = G.get(sq);
        if (pz.sel) {
          var mv = G.moves({ square: pz.sel, verbose: true }).filter(function (m) { return m.to === sq; });
          if (mv.length) { playerMove(mv.filter(function (m) { return !m.promotion || m.promotion === 'q'; })[0] || mv[0]); return; }
        }
        pz.sel = pc && pc.color === pz.me && pz.sel !== sq ? sq : null; pz.msg = pz.msg && pz.msgBad ? pz.msg : pz.msg; drawCheckin();
      };
    });
    o.querySelector('#gHint').onclick = function () {
      if (pz.hint >= 2) { pz.res = { grade: 'shown' }; ci.stage = 'pzdone'; drawCheckin(); return; }
      pz.hint++; pz.msg = pz.hint === 1 ? 'Look at the highlighted piece.' : 'Here is the move. Play it on the board.'; pz.msgBad = false; drawCheckin();
    };
    o.querySelector('#gAnother').onclick = function () { logPuzzle(pz, 'skip'); startChess(true); drawCheckin(); };
    o.querySelector('#gSkipP').onclick = function () { logPuzzle(pz, 'skip'); ci.stage = 'reflect'; drawCheckin(); };
  }
  function playerMove(m) {
    var pz = ci.pz, P = CH.puzzles[pz.id], G = pz.game, u = uciOf(m), grades = (P.g || [])[pz.step] || {}, main = P.l[pz.step * 2];
    var gr = grades[u] || grades[u.slice(0, 4)] || null, fenBefore = G.fen();
    G.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    pz.sel = null; pz.lastMv = [m.from, m.to]; pz.bad = null;
    var isMain = u === main || u.slice(0, 4) === main.slice(0, 4);
    if (!isMain && G.in_checkmate()) gr = ['b', 99999];
    if (isMain) {
      if (pz.step * 2 + 1 < P.l.length) {
        pz.busy = true; pz.msg = '✓ Correct. Keep going.'; pz.msgBad = false; drawCheckin();
        setTimeout(function () {
          if (!ci || ci.stage !== 'puzzle') return;
          var r = P.l[pz.step * 2 + 1]; G.move({ from: r.slice(0, 2), to: r.slice(2, 4), promotion: r[4] || 'q' });
          pz.lastMv = [r.slice(0, 2), r.slice(2, 4)]; pz.step++; pz.hint = 0; pz.busy = false; pz.msg = '✓ Correct. Keep going.'; drawCheckin();
        }, 650);
        return;
      }
      pz.res = { grade: pz.hint ? 'hint' : 'best', san: m.san };
    } else if (gr && gr[0] === 'b') {
      pz.res = { grade: pz.hint ? 'hint' : 'best', san: m.san, alt: true, ev: gr[1] };
    } else if (gr && gr[0] === 'g') {
      pz.res = { grade: 'good', san: m.san, ev: gr[1], check: G.in_check(), cap: m.captured, fenBefore: fenBefore };
    } else if (gr && gr[0] === 'o') {
      pz.res = { grade: 'ok', san: m.san, ev: gr[1], fenBefore: fenBefore };
    } else {
      pz.tries++; pz.busy = true; pz.bad = [m.from, m.to];
      pz.msg = '✕ ' + m.san + ' lets the advantage slip.' + (pz.tries >= 2 ? ' Try the hint.' : ' Look again.'); pz.msgBad = true; drawCheckin();
      if (navigator.vibrate) navigator.vibrate(40);
      setTimeout(function () { if (!ci || ci.stage !== 'puzzle') return; G.undo(); pz.busy = false; pz.bad = null; pz.lastMv = null; drawCheckin(); }, 900);
      return;
    }
    ci.stage = 'pzdone'; drawCheckin();
  }
  function logPuzzle(pz, grade) {
    if (!pz || pz.logged) return; pz.logged = true;
    var cs = chessState();
    cs.log.push({ id: pz.id, g: grade, d: dkey(new Date()), t: new Date().toISOString(), s: Math.round((Date.now() - pz.t0) / 1000) });
    if (cs.log.length > 600) cs.log = cs.log.slice(-600);
    cs.seen.push(pz.id); if (cs.seen.length > 400) cs.seen = cs.seen.slice(-400);
    ci.chessRes = { id: pz.id, g: grade };
  }
  function pzDoneHtml() {
    var pz = ci.pz, P = CH.puzzles[pz.id], r = pz.res, best = sanList(P.f, P.l), h = '';
    var bestLine = best.map(function (s, i) { return (i % 2 ? '<span class="opp">' + s + '</span>' : '<b>' + s + '</b>'); }).join(' ');
    var after = P.n ? ' Then: ' + esc(P.n) + '.' : '';
    h += '<div class="row between"><span class="eyebrow">' + (pz.lesson ? 'Puzzle · uses lesson ' + (chessState().lesson % CH.lessons.length + 1) : 'Puzzle · ' + CKIND[gameCfg().kind]) + '</span></div>';
    var big = function (ic, cls, t, sub) { return '<div class="gres"><span class="gic ' + cls + '">' + ic + '</span><div><h1 style="font-size:26px;line-height:1.1">' + t + '</h1><span class="gnote">' + sub + '</span></div></div>'; };
    if (r.grade === 'best' || r.grade === 'hint') {
      h += big(r.grade === 'best' ? '★' : '✓', 'ok', (r.alt ? 'That works too · ' : P.t.indexOf('mate1') >= 0 || /#/.test(r.san) ? 'Checkmate · ' : 'Best move · ') + esc(r.san), r.grade === 'best' ? 'Solved' + (pz.tries ? ' after ' + pz.tries + ' tr' + (pz.tries > 1 ? 'ies' : 'y') : ' first go') + ' · +5 XP' : 'Solved with a hint · +3 XP');
      h += boardHtml({ fen: pz.game.fen(), flip: pz.me === 'b', static: true, last: pz.lastMv });
      h += '<div class="gtipbox"><b>Why it works</b> · ' + esc(P.e || '') + (r.alt ? ' The line we had in mind: ' + bestLine + '.' : best.length > 1 ? ' The whole line: ' + bestLine + '.' : '') + after + '</div>';
    } else if (r.grade === 'good') {
      h += big('✓', 'ok', 'Good move · ' + esc(r.san), (r.check ? 'Check, and ' : '') + (r.cap ? 'it wins the ' + PNAME[r.cap] + '. ' : 'you stay ahead. ') + 'Engine: ' + evText(r.ev) + ' · +3 XP');
      h += boardHtml({ fen: r.fenBefore, flip: pz.me === 'b', static: true, hi: [P.l[pz.step * 2].slice(0, 2)], arrows: pz.step === 0 && P.a ? P.a : [[P.l[pz.step * 2].slice(0, 2), P.l[pz.step * 2].slice(2, 4), 'k']] });
      h += '<div class="gtipbox"><b>★ Even stronger: ' + esc(best[pz.step * 2] || '') + '</b><br>' + esc(P.e || '') + after + '</div>';
    } else if (r.grade === 'ok') {
      h += big('~', 'mid', 'Playable · ' + esc(r.san), 'Nothing lost, but there was more here. Engine: ' + evText(r.ev));
      h += boardHtml({ fen: r.fenBefore, flip: pz.me === 'b', static: true, arrows: pz.step === 0 && P.a ? P.a : [[P.l[pz.step * 2].slice(0, 2), P.l[pz.step * 2].slice(2, 4), 'k']] });
      h += '<div class="gtipbox"><b>The strong move: ' + esc(best[pz.step * 2] || '') + '</b><br>' + esc(P.e || '') + after + '</div>';
    } else {
      h += big('→', 'mid', 'The answer: ' + esc(best[0] || ''), 'No XP this time. See it once and it sticks.');
      h += boardHtml({ fen: P.f, flip: pz.me === 'b', static: true, arrows: P.a || [[P.l[0].slice(0, 2), P.l[0].slice(2, 4), 'k']] });
      h += '<div class="gtipbox">' + esc(P.e || '') + (best.length > 1 ? ' The whole line: ' + bestLine + '.' : '') + after + '</div>';
    }
    var L = pz.lesson || lessonFor(P);
    if (L && !pz.lesson) h += '<div class="gtipbox lite"><b>Lesson · ' + esc(L.title) + '</b><br>' + L.tip + '</div>';
    h += '<div style="flex:1"></div><div class="row" style="gap:10px">' + (r.grade === 'good' || r.grade === 'ok' ? '<button type="button" class="btn ghost" style="flex:1" id="gRetry">Try the best</button>' : '<button type="button" class="btn ghost" style="flex:1" id="gAnother2">Another puzzle</button>') + '<button type="button" class="btn solid" style="flex:1" id="gCont">Continue</button></div>';
    return h;
  }
  function bindPzDone(o) {
    var pz = ci.pz, r = pz.res;
    if (!pz.logged) mutate(function () {
      logPuzzle(pz, r.grade);
      if (pz.lesson && (r.grade === 'best' || r.grade === 'good' || r.grade === 'hint')) { chessState().lesson++; ci.lessonSeen = true; }
    });
    var rt = o.querySelector('#gRetry'); if (rt) rt.onclick = function () {
      var P = CH.puzzles[pz.id], G = pz.game; G.load(r.fenBefore); pz.lastMv = null; pz.res = null; pz.hint = 1; pz.msg = 'Find the stronger move. The piece is highlighted.'; pz.msgBad = false;
      pz.logged = true; ci.stage = 'puzzle'; drawCheckin();
    };
    var an = o.querySelector('#gAnother2'); if (an) an.onclick = function () { ci.lessonSeen = true; startChess(true); drawCheckin(); };
    o.querySelector('#gCont').onclick = function () { ci.stage = 'reflect'; drawCheckin(); };
  }
  // XP for the chess puzzles (added to the day's XP)
  function chessXp(dk) {
    var x = 0; ((state.chess || {}).log || []).forEach(function (e) { if (e.d !== dk) return; x += e.g === 'best' ? 5 : e.g === 'good' || e.g === 'hint' ? 3 : 0; });
    return Math.min(x, 40);
  }

  // ---------- Think: first-principles tool (question → delete → physics floor → simplify → speed → automate → test) ----------
  var tk = null, tkSaveT = null;
  var TK_RAIL = ['Question', 'Delete', 'Physics', 'Simplify', 'Speed', 'Automate', 'Test'];
  var TK_FULL = ['q', 'del', 'phys', 'ssa', 'red', 'test'];
  var TK_MODES = {
    full: { ic: '⚙️', t: 'The full algorithm · 25 min', s: 'Question → Delete → Physics floor → Simplify → Speed → Automate → Test', pages: TK_FULL },
    idiot: { ic: '🧮', t: 'Idiot index · 5 min', s: 'What it costs vs. what its raw materials cost', pages: ['phys'] },
    red: { ic: '🔥', t: 'Red team · 5 min', s: 'AI attacks your idea as hard as it can', pages: ['red'] },
    fermi: { ic: '📏', t: 'Fermi estimate · 3 min', s: 'Get the order of magnitude in your head', pages: ['fermi'] }
  };
  var VAGUE = /^\s*$|standard|everyone|every one|always|industry|customers? expect|market|nobody|no one|don.?t know|not sure|usual|convention|norm|spec sheet says|they say|tradition/i;
  function ideas() { return (state.ideas = state.ideas || []); }
  function ideaById(id) { return ideas().filter(function (x) { return x.id === id; })[0]; }
  function newIdea(title, mode) {
    var x = { id: 'i' + Date.now().toString(36), title: title, mode: mode || 'full', created: new Date().toISOString(), updated: new Date().toISOString(), reqs: [], parts: [], mats: [], price: '', target: '', truths: [], limit: '', simplify: [], speed: [], automate: [], attacks: [], conf: 50, rebuilt: '', test: { what: '', cost: '', time: '', pass: '' }, chat: [], fermi: null };
    ideas().unshift(x); save(); return x;
  }
  function tkSave() { var x = tk && ideaById(tk.id); if (x) x.updated = new Date().toISOString(); clearTimeout(tkSaveT); tkSaveT = setTimeout(save, 250); }
  function setPath(o, path, v) { var p = path.split('.'); for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; }
  function hasAI() { return !!state.aiKey; }
  function noAI() { return '<span class="tknote">AI suggestions need your Gemini key (Settings → Visualization). You can fill everything in by hand.</span>'; }
  function aiBtn(kind, label) { return hasAI() ? '<button type="button" class="tkai" data-tkai="' + kind + '"' + (tk.busy ? ' disabled' : '') + '>' + (tk.busy === kind ? 'Thinking…' : '✨ ' + label) + '</button>' : ''; }
  function coachBox(t, lab) { return '<div class="tkcoach"><b>' + (lab || 'Coach') + '</b> · ' + t + '</div>'; }
  function floorOf(x) { return x.mats.reduce(function (a, m) { return a + (+m.cost || 0); }, 0); }
  function idx(price, floor) { price = +price || 0; if (!price || !floor) return null; var v = price / floor; return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10; }
  function rupee(n) { return '₹' + Math.round(+n || 0).toLocaleString('en-IN'); }
  function reqFlag(r) { return VAGUE.test(r.owner || ''); }
  function tkRailIdx(x, page) {
    if (page === 'q') return 0; if (page === 'del') return 1; if (page === 'phys') return 2;
    if (page === 'ssa') return x.simplify.filter(Boolean).length < 3 ? 3 : x.speed.filter(Boolean).length < 1 ? 4 : 5;
    return 6;
  }
  function tkRail(x, page) {
    var cur = tkRailIdx(x, page);
    return '<div class="tkrail">' + TK_RAIL.map(function (s, k) { return '<button type="button" data-tkrail="' + k + '" class="' + (k <= cur ? 'on' : '') + (k === cur ? ' cur' : '') + '"><i></i><span>' + s + '</span></button>'; }).join('') + '</div>';
  }

  function openThink(id, page) {
    resetOverlay(); closeSheet();
    tk = { id: id || null, page: page || (id ? null : 'start'), mode: 'full', title: '', busy: null };
    if (id) { var x = ideaById(id); if (!x) { tk = null; return; } tk.page = page || x.last || TK_MODES[x.mode].pages[0]; }
    drawThink(); showOverlay('tko');
  }
  function closeThink() { var x = tk && ideaById(tk.id); if (x) { x.last = tk.page; save(); } tk = null; closeOverlayEl(); render(); }
  function drawThink() {
    var o = document.getElementById('overlay'), x = tk.id ? ideaById(tk.id) : null, pg = tk.page, keep = tk.keepScroll ? o.scrollTop : 0;
    var h = '<div class="inner tk">';
    if (pg === 'start') h += tkStart();
    else if (pg === 'drill') h += drillHtml();
    else if (!x) h += '<p>Not found.</p>';
    else if (pg === 'q') h += tkQuestion(x);
    else if (pg === 'del') h += tkDelete(x);
    else if (pg === 'phys') h += tkPhys(x);
    else if (pg === 'ssa') h += tkSSA(x);
    else if (pg === 'red') h += tkRed(x);
    else if (pg === 'test') h += tkTest(x);
    else if (pg === 'tree') h += tkTree(x);
    else if (pg === 'chat') h += tkChat(x);
    else if (pg === 'fermi') h += tkFermi(x);
    o.innerHTML = h + '</div>';
    o.scrollTop = keep; tk.keepScroll = false;
    bindThink(o, x);
  }
  function tkHead(x, cap, right) {
    return '<div class="row between"><span class="eyebrow">' + cap + '</span><div class="row" style="gap:8px">' + (right || '') + '<button type="button" class="btn ghost small" id="tkClose">Close</button></div></div>' +
      (x ? '<button type="button" class="tkidea" data-tkgo="tree">' + esc(x.title) + '</button>' : '');
  }
  function tkFoot(x, pg) {
    var pages = TK_MODES[x.mode].pages, i = pages.indexOf(pg), prev = i > 0 ? pages[i - 1] : null, next = i >= 0 && i < pages.length - 1 ? pages[i + 1] : null;
    return '<div class="tkfoot"><button type="button" class="btn ghost small" data-tkgo="chat">💬 Talk it through</button><div class="row" style="gap:8px">' +
      (prev ? '<button type="button" class="btn ghost" data-tkgo="' + prev + '">Back</button>' : '') +
      (next ? '<button type="button" class="btn solid" data-tkgo="' + next + '">Next</button>' : '<button type="button" class="btn solid" data-tkgo="tree">Done · see tree</button>') + '</div></div>';
  }

  // --- start ---
  function tkStart() {
    var h = '<div class="row between"><span class="eyebrow">Think · first principles</span><button type="button" class="btn ghost small" id="tkClose">Close</button></div>';
    h += '<div class="hero tkhero" style="background:' + T.jungle + ';color:#fff">' + sun('rgba(255,178,63,.28)', 130, -34, -44) + '<span class="cap">Reason from physics, not analogy</span><span class="display" style="font-size:30px;line-height:1.05">What are you trying<br><i class="lite">to make true?</i></span>' +
      '<textarea class="text" id="tkTitle" rows="2" placeholder="e.g. an e-bike torque sensor at a third of today’s price">' + esc(tk.title) + '</textarea></div>';
    h += '<span class="eyebrow">How deep?</span><div class="stack" style="gap:10px">' + Object.keys(TK_MODES).map(function (k) {
      var m = TK_MODES[k]; return '<button type="button" class="tkmode' + (tk.mode === k ? ' on' : '') + '" data-tkmode="' + k + '"><span class="ic">' + m.ic + '</span><span><b>' + m.t + '</b><small>' + m.s + '</small></span></button>';
    }).join('') + '</div>';
    h += '<div style="flex:1"></div><button type="button" class="btn coral" id="tkStart">Start</button>';
    return h;
  }

  // --- 1 question every requirement ---
  function tkQuestion(x) {
    var n = x.reqs.length, fl = x.reqs.filter(reqFlag).length, cut = x.reqs.filter(function (r) { return r.tag === 'del' || r.tag === 'less'; }).length;
    var h = tkHead(x, 'Step 1 of 7 · Question') + '<h1 class="tkh">Every requirement<br><i class="lite">needs a name on it</i></h1>' + tkRail(x, 'q');
    h += '<p class="tksub">List everything this “must” be or do: specs, sizes, prices, standards. Then write the <b>person</b> who asked for each one, not a department or “the industry”.</p>';
    h += '<div class="tklist">' + x.reqs.map(function (r, i) {
      var bad = reqFlag(r);
      return '<div class="tkitem"><div class="row" style="gap:8px"><input class="tkin b" data-f="reqs.' + i + '.t" value="' + esc(r.t) + '" placeholder="Requirement"><button type="button" class="tkx" data-tkdel="reqs.' + i + '" aria-label="Remove">✕</button></div>' +
        '<label class="tkowner' + (bad ? ' bad' : '') + '">👤 <input data-f="reqs.' + i + '.owner" value="' + esc(r.owner || '') + '" placeholder="Who asked for this? A person’s name"></label>' +
        '<span class="tkflag"' + (bad ? '' : ' hidden') + '>' + (r.owner ? 'That’s analogy, not a person. Who exactly?' : 'No person owns this yet.') + '</span>' +
        '<input class="tkin s" data-f="reqs.' + i + '.note" value="' + esc(r.note || '') + '" placeholder="Why? Physics, or just habit?">' +
        '<div class="tkchips">' + [['keep', 'Keep'], ['less', 'Less dumb'], ['del', 'Delete']].map(function (c) { return '<button type="button" data-tktag="reqs.' + i + '" data-v="' + c[0] + '" aria-pressed="' + (r.tag === c[0]) + '" class="c-' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
    h += '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost small" data-tkadd="reqs">+ Add requirement</button>' + aiBtn('reqs', 'Suggest requirements') + '</div>' + (hasAI() ? '' : noAI());
    h += coachBox(!n ? 'Start with what everyone “knows” this must be. The most dangerous requirements come from smart people, because nobody questions them.' :
      fl ? fl + ' of ' + n + ' have no real person behind them. “Industry standard” or “customers expect it” is <b>analogy</b>, not physics. Challenge those first.' :
      cut ? 'Good: ' + cut + ' requirement' + (cut > 1 ? 's' : '') + ' made less dumb or deleted. Every one left should survive the question “what law of physics needs this?”' :
      'Each one has an owner. Now ask them: what happens if we drop it or loosen it by half?');
    return h + tkFoot(x, 'q');
  }

  // --- 2 delete ---
  function tkDelete(x) {
    var del = x.parts.filter(function (p) { return p.st === 'del'; }).length, back = x.parts.filter(function (p) { return p.st === 'back'; }).length, tot = del + back, pct = tot ? Math.round(back / tot * 100) : 0;
    var h = tkHead(x, 'Step 2 of 7 · Delete') + '<h1 class="tkh">The best part<br><i class="lite">is no part</i></h1>' + tkRail(x, 'del');
    h += '<p class="tksub">List the parts and process steps. Try to delete each one. If it turns out you really need it, mark it <b>added back</b>.</p>';
    h += '<div class="tklist">' + x.parts.map(function (p, i) {
      return '<div class="tkitem' + (p.st === 'del' ? ' gone' : '') + '"><div class="row" style="gap:8px"><input class="tkin b" data-f="parts.' + i + '.t" value="' + esc(p.t) + '" placeholder="Part or step"><button type="button" class="tkx" data-tkdel="parts.' + i + '" aria-label="Remove">✕</button></div>' +
        '<input class="tkin s" data-f="parts.' + i + '.note" value="' + esc(p.note || '') + '" placeholder="What does it do? What takes over if it goes?">' +
        '<div class="tkchips">' + [['keep', 'Keep'], ['del', 'Deleted'], ['back', 'Added back']].map(function (c) { return '<button type="button" data-tkst="parts.' + i + '" data-v="' + c[0] + '" aria-pressed="' + ((p.st || 'keep') === c[0]) + '" class="c-' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
    }).join('') + '</div>';
    h += '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost small" data-tkadd="parts">+ Add part or step</button>' + aiBtn('parts', 'List likely parts') + '</div>' + (hasAI() ? '' : noAI());
    h += '<div class="tkstats"><div><b>' + del + '</b><small>deleted</small></div><div><b>' + back + '</b><small>added back</small></div><div><b>' + pct + '%</b><small>added back</small></div></div>';
    h += coachBox(!x.parts.length ? 'Write down every part and every step, even the obvious ones.' :
      !del ? 'Nothing deleted yet. Try deleting every part, then add back only what you truly need.' :
      !back ? 'You haven’t added anything back. If you never add back, you probably didn’t delete enough. Aim to overshoot, so about 10% comes back.' :
      'You added back ' + back + ' of ' + tot + '. That means you pushed hard enough. Now improve only what survived.');
    return h + tkFoot(x, 'del');
  }

  // --- 3 physics floor ---
  function tkPhys(x) {
    var fl = floorOf(x), ix = idx(x.price, fl);
    var h = tkHead(x, x.mode === 'idiot' ? 'Idiot index' : 'Step 3 of 7 · Physics floor') + '<h1 class="tkh">Idiot index</h1>' + (x.mode === 'full' ? tkRail(x, 'phys') : '');
    h += '<p class="tksub">What do the <b>raw materials</b> cost at commodity prices? That is the floor. Everything above it is design, process and volume.</p>';
    h += '<div class="card tkmat"><span class="eyebrow">Raw materials' + (x.matsAI ? ' · AI estimates, edit any number' : '') + '</span>' + x.mats.map(function (m, i) {
      return '<div class="tkmrow"><input class="tkin b" data-f="mats.' + i + '.t" value="' + esc(m.t) + '" placeholder="Material"><input class="tkin s" data-f="mats.' + i + '.q" value="' + esc(m.q || '') + '" placeholder="qty × ₹/kg"><label class="tkcost">₹<input inputmode="decimal" data-f="mats.' + i + '.cost" data-num="1" value="' + esc(m.cost) + '"></label><button type="button" class="tkx" data-tkdel="mats.' + i + '" aria-label="Remove">✕</button></div>';
    }).join('') + '<div class="tkmrow tot"><b>Physics floor</b><b id="tkFloor">' + rupee(fl) + '</b></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost small" data-tkadd="mats">+ Add material</button>' + aiBtn('mats', 'Estimate materials') + '</div></div>';
    h += '<label class="tkprice">Market price today <span>₹<input inputmode="decimal" data-f="price" data-num="1" value="' + esc(x.price) + '" placeholder="12000"></span></label>';
    h += '<div class="tkidx" id="tkIdx"' + (ix ? '' : ' hidden') + '><div><span class="cap">Market ÷ floor</span><span class="t">' + (ix >= 5 ? 'Everything above the floor is design, process and volume. That’s your room.' : ix >= 2 ? 'Some room. Look at process steps and part count.' : 'Close to the floor: gains must come from using less material.') + '</span></div><b class="display">' + (ix || '') + '×</b></div>';
    h += '<span class="eyebrow">Bedrock truths · physics you can’t argue with</span><div class="tklist">' + x.truths.map(function (t, i) { return '<div class="row tktruth" style="gap:8px"><span>◆</span><input class="tkin" data-f="truths.' + i + '" value="' + esc(t) + '" placeholder="e.g. steel deforms under load (Hooke’s law)"><button type="button" class="tkx" data-tkdel="truths.' + i + '" aria-label="Remove">✕</button></div>'; }).join('') + '</div>' +
      '<button type="button" class="btn ghost small" data-tkadd="truths" style="align-self:flex-start">+ Add a truth</button>';
    h += '<span class="eyebrow">The performance limit</span><textarea class="text" data-f="limit" rows="3" placeholder="What is the best physics allows? e.g. the most signal, the least weight, the highest efficiency">' + esc(x.limit) + '</textarea>' + aiBtn('limit', 'Work out the physics limit') + (hasAI() ? '' : noAI());
    return h + (x.mode === 'full' ? tkFoot(x, 'phys') : '<div class="tkfoot"><button type="button" class="btn ghost small" data-tkgo="chat">💬 Talk it through</button><button type="button" class="btn solid" data-tkgo="full">Run the full algorithm</button></div>');
  }

  // --- 4-6 simplify, speed up, automate (in that order) ---
  function tkSSA(x) {
    var s1 = x.simplify.filter(Boolean).length, s2 = x.speed.filter(Boolean).length, lock2 = s1 < 3, lock3 = lock2 || s2 < 1;
    tk.lockSig = lock2 + ',' + (s2 < 1);
    var h = tkHead(x, 'Steps 4–6 · in this order') + '<h1 class="tkh">Simplify, speed up,<br><i class="lite">then automate</i></h1>' + tkRail(x, 'ssa');
    var sec = function (n, key, title, lock, why) {
      var s = '<div class="tkstep' + (lock ? ' lock' : '') + '"><span class="n">' + (lock ? '🔒' : n) + '</span><div class="b"><b>' + title + '</b>';
      if (lock) return s + '<span class="tknote">' + why + '</span></div></div>';
      s += x[key].map(function (t, i) { return '<div class="row" style="gap:8px"><input class="tkin" data-f="' + key + '.' + i + '" value="' + esc(t) + '" placeholder="…"><button type="button" class="tkx" data-tkdel="' + key + '.' + i + '" aria-label="Remove">✕</button></div>'; }).join('');
      return s + '<button type="button" class="btn ghost small" data-tkadd="' + key + '" style="align-self:flex-start">+ Add</button></div></div>';
    };
    h += sec(4, 'simplify', 'Simplify what survived', false);
    h += sec(5, 'speed', 'Speed up the cycle', lock2, 'Unlocks after Simplify has 3 entries (' + s1 + ' so far).');
    h += sec(6, 'automate', 'Automate', lock3, 'Last. Never automate a step you should have deleted.');
    h += aiBtn('ssa', 'Suggest for each step') + (hasAI() ? '' : noAI());
    h += coachBox('The common mistake is doing these backwards: automating, then speeding up, then simplifying something that shouldn’t exist at all.', 'Why locked');
    return h + tkFoot(x, 'ssa');
  }

  // --- red team ---
  function tkRed(x) {
    var h = tkHead(x, 'Red team · argue against yourself') + '<h1 class="tkh">Try to kill<br><i class="lite">your own idea</i></h1>' + (x.mode === 'full' ? tkRail(x, 'red') : '');
    h += x.attacks.map(function (a, i) {
      var done = (a.reply || '').trim();
      return '<div class="card tkatk"><div class="row between"><span class="cap" style="color:' + T.coral + '">Attack ' + (i + 1) + '</span><span class="row" style="gap:6px"><span class="tkpill ' + (done ? 'ok' : 'open') + '">' + (done ? 'Answered' : 'Open') + '</span><button type="button" class="tkx" data-tkdel="attacks.' + i + '" aria-label="Remove">✕</button></span></div>' +
        '<textarea class="tkin b" rows="2" data-f="attacks.' + i + '.t" placeholder="The strongest reason this fails">' + esc(a.t) + '</textarea><textarea class="tkreply" rows="2" data-f="attacks.' + i + '.reply" placeholder="Your reply…">' + esc(a.reply || '') + '</textarea></div>';
    }).join('');
    h += '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost small" data-tkadd="attacks">+ Add an attack</button>' + aiBtn('red', 'Attack my idea') + '</div>' + (hasAI() ? '' : noAI());
    h += '<div class="tkconf"><div class="row between"><span class="eyebrow">How sure are you it works?</span><b id="tkConfV">' + x.conf + '%</b></div><input type="range" min="0" max="100" step="5" data-f="conf" data-num="1" value="' + x.conf + '" aria-label="Confidence"><span class="tknote">Write a number, not a feeling. You’ll re-rate it after the test.</span></div>';
    return h + (x.mode === 'full' ? tkFoot(x, 'red') : '<div class="tkfoot"><button type="button" class="btn ghost small" data-tkgo="chat">💬 Talk it through</button><button type="button" class="btn solid" data-tkgo="full">Run the full algorithm</button></div>');
  }

  // --- test ---
  function tkTest(x) {
    var del = x.parts.filter(function (p) { return p.st === 'del'; }).length, fl = floorOf(x), i1 = idx(x.price, fl), i2 = idx(x.target, fl), open = x.attacks.filter(function (a) { return !(a.reply || '').trim(); }).length;
    var tt = x.test.tid ? findTarget(x.test.tid) : null;
    var h = tkHead(x, 'Step 7 of 7 · Test', '<button type="button" class="btn ghost small" data-tkgo="tree">Tree</button>') + tkRail(x, 'test');
    h += '<div class="hero tkhero" style="background:' + T.jungle + ';color:#fff">' + sun('rgba(255,178,63,.28)', 120, -30, -40) + '<span class="cap">Rebuilt from physics</span><textarea class="text" rows="3" data-f="rebuilt" placeholder="Your rebuilt idea in one sentence">' + esc(x.rebuilt) + '</textarea>' +
      '<div class="optrow">' + (del ? '<span class="tkpill w">' + del + ' part' + (del > 1 ? 's' : '') + ' deleted</span>' : '') + (i1 ? '<span class="tkpill w">Idiot index ' + i1 + '×' + (i2 ? ' → ' + i2 + '×' : '') + '</span>' : '') + (open ? '<span class="tkpill red">' + open + ' attack' + (open > 1 ? 's' : '') + ' open</span>' : '') + '</div></div>';
    if (fl) h += '<label class="tkprice">Target price after the rebuild <span>₹<input inputmode="decimal" data-f="target" data-num="1" value="' + esc(x.target) + '"></span></label>';
    h += '<div class="card stack" style="gap:10px"><span class="eyebrow">Cheapest test that could prove you wrong</span><textarea class="tkin b" rows="2" data-f="test.what" placeholder="e.g. press a ring onto a stock axle, load 0–100 Nm on the bench, log the signal">' + esc(x.test.what) + '</textarea>' +
      '<div class="tk3">' + [['cost', 'Cost', '₹2,500'], ['time', 'Time', '3 days'], ['pass', 'Pass if', '±3% linear']].map(function (f) { return '<label><span class="cap">' + f[1] + '</span><input data-f="test.' + f[0] + '" value="' + esc(x.test[f[0]]) + '" placeholder="' + f[2] + '"></label>'; }).join('') + '</div></div>';
    h += aiBtn('rebuilt', 'Write the rebuilt idea + a test') + (hasAI() ? '' : noAI());
    if (tt) h += '<div class="notice ok">✓ On your targets for ' + new Date(tt.key + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short' }) + (tt.t.achievedAt ? ' · done' : '') + '.</div>' +
      (tt.t.achievedAt ? '<div class="tkconf"><div class="row between"><span class="eyebrow">After the test: how sure now?</span><b id="tkConf2V">' + (x.conf2 == null ? x.conf : x.conf2) + '%</b></div><input type="range" min="0" max="100" step="5" data-f="conf2" data-num="1" value="' + (x.conf2 == null ? x.conf : x.conf2) + '"><span class="tknote">Before: ' + x.conf + '%</span></div>' : '');
    else {
      var d = new Date(); d.setDate(d.getDate() + 2);
      h += '<div class="card row" style="gap:10px;align-items:center"><div style="flex:1"><b style="font-size:14px">Add as a target</b><br><span class="tknote">Shows on Today, high priority</span></div><input type="date" id="tkDate" value="' + dkey(d) + '" class="tkdate"><button type="button" class="btn solid small" id="tkTarget">Add</button></div>';
    }
    return h + tkFoot(x, 'test');
  }

  // --- idea tree ---
  function tkTree(x) {
    var habits = x.reqs.filter(function (r) { return r.t && (r.tag === 'del' || r.tag === 'less' || reqFlag(r)); }).map(function (r) { return { t: r.t, k: r.tag === 'del' ? 'deleted' : 'habit' }; })
      .concat(x.parts.filter(function (p) { return p.st === 'del' && p.t; }).map(function (p) { return { t: p.t, k: 'deleted' }; }));
    var truths = x.truths.filter(Boolean), fl = floorOf(x), ix = idx(x.price, fl);
    var node = function (t, cls) { return '<span class="tknode ' + cls + '">' + t + '</span>'; };
    var h = tkHead(x, 'Idea tree', '<button type="button" class="btn ghost small" id="tkShare">Share</button>');
    h += '<div class="tktree">' + node('💡 ' + esc(x.title), 'root');
    if (habits.length) h += '<i class="tkline"></i><span class="cap">Habits and analogies</span><div class="tkrowN">' + habits.slice(0, 9).map(function (a) { return node(esc(a.t) + (a.k === 'deleted' ? ' <s>deleted</s>' : ''), 'habit'); }).join('') + '</div>';
    if (truths.length || ix) h += '<i class="tkline"></i><span class="cap">Bedrock truths</span><div class="tkrowN">' + truths.map(function (t) { return node('◆ ' + esc(t), 'truth'); }).join('') + (ix ? node('Floor ' + rupee(fl) + ' · idiot index ' + ix + '×', 'truth') : '') + '</div>';
    h += '<i class="tkline"></i>' + node('🔁 ' + (esc(x.rebuilt) || '<span class="tknote">Rebuilt idea: not written yet</span>'), 'rebuilt');
    if ((x.test.what || '').trim()) h += '<i class="tkline"></i>' + node('<span class="cap">Next test</span><br>' + esc(x.test.what), 'test');
    h += '</div><div class="tklegend"><span class="habit">■ habit</span><span class="truth">■ bedrock truth</span><span class="rebuilt">■ rebuilt idea</span></div>';
    var pages = TK_MODES[x.mode].pages;
    h += '<div style="flex:1"></div><div class="row" style="gap:10px"><button type="button" class="btn ghost" style="flex:1" data-tkgo="' + pages[0] + '">Edit steps</button><button type="button" class="btn solid" style="flex:1" id="tkDone">Done</button></div>';
    return h;
  }
  function treeText(x) {
    var fl = floorOf(x), ix = idx(x.price, fl), L = ['First principles: ' + x.title, ''];
    var r = x.reqs.filter(function (q) { return q.t; }); if (r.length) { L.push('Requirements:'); r.forEach(function (q) { L.push('- ' + q.t + ' (' + (q.owner || 'no owner') + ')' + (q.tag ? ' → ' + { keep: 'keep', less: 'less dumb', del: 'delete' }[q.tag] : '')); }); L.push(''); }
    var d = x.parts.filter(function (p) { return p.st === 'del'; }); if (d.length) { L.push('Deleted: ' + d.map(function (p) { return p.t; }).join(', ')); L.push(''); }
    if (ix) L.push('Physics floor ' + rupee(fl) + ', market ' + rupee(x.price) + ', idiot index ' + ix + '×');
    if (x.truths.length) L.push('Truths: ' + x.truths.filter(Boolean).join('; '));
    if (x.rebuilt) L.push('', 'Rebuilt: ' + x.rebuilt);
    if (x.test.what) L.push('Test: ' + x.test.what + [x.test.cost, x.test.time, x.test.pass ? 'pass if ' + x.test.pass : ''].filter(Boolean).map(function (s) { return ' · ' + s; }).join(''));
    return L.join('\n');
  }

  // --- coach chat with analogy detector ---
  function hlText(t, hl) {
    var s = esc(t);
    (hl || []).forEach(function (p) { if (!p) return; var e = esc(p); var i = s.toLowerCase().indexOf(e.toLowerCase()); if (i >= 0) s = s.slice(0, i) + '<mark>' + s.slice(i, i + e.length) + '</mark>' + s.slice(i + e.length); });
    return s;
  }
  function tkChat(x) {
    if (!x.chat.length) x.chat.push({ r: 'ai', t: 'Start with how things are today. Why is it done the way it is now? List every reason you can think of: cost, size, how it’s made, who asked for it.', tag: 'Question' });
    var h = tkHead(x, 'Coach · analogy detector', '<button type="button" class="btn ghost small" data-tkgo="' + (tk.from || TK_MODES[x.mode].pages[0]) + '">Back</button>');
    h += '<div class="tkchat" id="tkChat">' + x.chat.map(function (m) {
      if (m.r === 'me') return '<div class="bub me">' + hlText(m.t, m.hl) + '</div>';
      var tg = m.tag || '', cls = /analogy/i.test(tg) ? 'bad' : /physics/i.test(tg) ? 'good' : '';
      return '<div class="bub ai">' + (tg ? '<span class="cap ' + cls + '">' + esc(tg) + '</span>' : '') + esc(m.t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</div>';
    }).join('') + (tk.busy === 'chat' ? '<div class="bub ai"><span class="tknote">Thinking…</span></div>' : '') + '</div>';
    h += hasAI() ? '<div class="tkcompose"><textarea class="text" id="tkMsg" rows="2" placeholder="Type or speak…">' + esc(tk.draft || '') + '</textarea>' +
      (('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? '<button type="button" class="tkmic" id="tkMic" aria-label="Speak">🎤</button>' : '') + '<button type="button" class="btn solid small" id="tkSend">Send</button></div>' : noAI();
    return h;
  }

  // --- Fermi estimate ---
  function tkFermi(x) {
    var f = x.fermi = x.fermi || { q: x.title, guess: '', res: null };
    var h = tkHead(x, 'Fermi estimate') + '<h1 class="tkh">Get the order<br><i class="lite">of magnitude</i></h1>';
    h += '<label class="lab rng">Question<textarea class="text" rows="2" data-f="fermi.q" placeholder="e.g. how many e-bikes are sold in India each year?">' + esc(f.q) + '</textarea></label>';
    h += '<label class="lab rng">Your guess, before any maths<input class="text" data-f="fermi.guess" value="' + esc(f.guess) + '" placeholder="e.g. 1 lakh"></label>';
    h += aiBtn('fermi', 'Work it out') + (hasAI() ? '' : noAI());
    if (f.res) {
      h += '<div class="card stack" style="gap:8px"><span class="eyebrow">Worked out</span>' + (f.res.steps || []).map(function (s) { return '<div class="tkmrow"><span>' + esc(s.f) + '</span><b>' + esc(s.v) + '</b></div>'; }).join('') +
        '<div class="tkmrow tot"><b>Answer</b><b>' + esc(f.res.answer) + '</b></div>' + (f.res.verdict ? '<span class="tknote"><b>Your guess:</b> ' + esc(f.res.verdict) + '</span>' : '') + (f.res.note ? '<span class="tknote">' + esc(f.res.note) + '</span>' : '') + '</div>';
    }
    return h + '<div class="tkfoot"><button type="button" class="btn ghost small" data-tkgo="chat">💬 Talk it through</button><button type="button" class="btn solid" data-tkgo="tree">Done</button></div>';
  }

  // --- AI ---
  function ideaCtx(x) {
    var L = ['Idea: ' + x.title];
    if (x.reqs.length) L.push('Requirements: ' + x.reqs.map(function (r) { return r.t + ' (owner: ' + (r.owner || 'none') + (r.tag ? ', ' + r.tag : '') + ')'; }).join('; '));
    if (x.parts.length) L.push('Parts/steps: ' + x.parts.map(function (p) { return p.t + (p.st === 'del' ? ' [deleted]' : p.st === 'back' ? ' [added back]' : ''); }).join('; '));
    if (x.mats.length) L.push('Raw materials: ' + x.mats.map(function (m) { return m.t + ' ' + (m.q || '') + ' ₹' + m.cost; }).join('; ') + '; market price ₹' + (x.price || '?'));
    if (x.truths.length) L.push('Bedrock truths: ' + x.truths.join('; '));
    if (x.simplify.length) L.push('Simplify: ' + x.simplify.join('; '));
    if (x.speed.length) L.push('Speed up: ' + x.speed.join('; '));
    if (x.automate.length) L.push('Automate: ' + x.automate.join('; '));
    if (x.attacks.length) L.push('Attacks: ' + x.attacks.map(function (a) { return a.t + (a.reply ? ' → reply: ' + a.reply : ''); }).join(' | '));
    if (x.rebuilt) L.push('Rebuilt idea: ' + x.rebuilt);
    return L.join('\n');
  }
  var TK_SYS = 'You coach first-principles thinking the way Elon Musk has described it: make every requirement less dumb (each must have a named person as owner), delete parts and process steps (if you are not adding back about 10%, you did not delete enough), reason from physics and raw-material cost (the "idiot index": finished cost divided by raw-material cost) rather than by analogy to what others do, then simplify, then speed up, and only then automate. The user is an Indian mechanical design engineer: use ₹ and metric units, current Indian commodity prices, and be concrete, short and technically correct. Never invent quotes.';
  function tkAsk(prompt, temp) {
    return geminiCall({ contents: [{ parts: [{ text: TK_SYS + '\n\n' + prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: temp == null ? .6 : temp } })
      .then(function (t) { return JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '')); });
  }
  function runAI(kind, x) {
    var c = ideaCtx(x), P;
    if (kind === 'reqs') P = c + '\n\nList 5 to 7 requirements people usually assume this must meet (specs, standards, features, price points). For each, say briefly why it might be real physics or just habit. Reply JSON: {"items":[{"t":"requirement","note":"why it may or may not be real"}]}';
    else if (kind === 'parts') P = c + '\n\nList 6 to 10 parts and process steps a typical version of this has today (what exists now, before any deletion). Reply JSON: {"items":[{"t":"part or step","note":"what it does"}]}';
    else if (kind === 'mats') P = c + '\n\nEstimate the raw materials in one unit at commodity prices in India (kg × ₹/kg, or per component for electronics). Also the typical market price today in ₹ if you know it, 2 to 4 bedrock physical truths that constrain it, and the physical performance limit. Reply JSON: {"items":[{"t":"material","q":"0.12 kg × ₹90/kg","cost":11}],"price":12000,"truths":["..."],"limit":"2-4 sentences"}';
    else if (kind === 'limit') P = c + '\n\nWork out the physical performance limit for this idea from first principles, with the key numbers, in 3 to 5 short sentences, and how far typical products today are from it. Reply JSON: {"limit":"...","truths":["bedrock truth", "..."]}';
    else if (kind === 'ssa') P = c + '\n\nFor what survived deletion, suggest 3 ways to simplify, 2 ways to speed up the cycle (design, test or production), and 1 to 2 things to automate last. Reply JSON: {"simplify":["..."],"speed":["..."],"automate":["..."]}';
    else if (kind === 'red') P = c + '\n\nAct as a harsh but fair red team. Give the 3 strongest, most specific reasons this fails (technical, market or execution). Do not repeat attacks already listed. Reply JSON: {"attacks":["...","...","..."]}';
    else if (kind === 'rebuilt') P = c + '\n\nWrite the rebuilt idea in one sentence built only on the bedrock truths, and the cheapest, fastest experiment that could prove it wrong within a week or two. Reply JSON: {"rebuilt":"...","test":{"what":"...","cost":"₹…","time":"… days","pass":"measurable pass condition"}}';
    else if (kind === 'fermi') P = 'Fermi-estimate: ' + x.fermi.q + '\nThe user guessed: ' + (x.fermi.guess || 'no guess') + '\nBreak it into 3 to 6 factors with rough values (India context when relevant), give the answer as an order of magnitude, and compare the user’s guess. Reply JSON: {"steps":[{"f":"factor","v":"value"}],"answer":"≈ …","verdict":"right order of magnitude / about 10× too high / …","note":"one line on the biggest uncertainty"}';
    tk.busy = kind; tk.keepScroll = true; drawThink();
    tkAsk(P).then(function (r) {
      if (!tk) return;
      var add = function (key, arr, map) { (arr || []).forEach(function (a) { x[key].push(map ? map(a) : a); }); };
      if (kind === 'reqs') add('reqs', r.items, function (a) { return { t: a.t, owner: '', note: a.note || '', tag: '' }; });
      if (kind === 'parts') add('parts', r.items, function (a) { return { t: a.t, note: a.note || '', st: 'keep' }; });
      if (kind === 'mats') { x.mats = (r.items || []).map(function (a) { return { t: a.t, q: a.q || '', cost: Math.round(+a.cost || 0) }; }); x.matsAI = true; if (!x.price && r.price) x.price = String(Math.round(+r.price)); if (!x.truths.length) add('truths', r.truths); if (!x.limit && r.limit) x.limit = r.limit; }
      if (kind === 'limit') { x.limit = r.limit || x.limit; if (!x.truths.length) add('truths', r.truths); }
      if (kind === 'ssa') { add('simplify', r.simplify); add('speed', r.speed); add('automate', r.automate); }
      if (kind === 'red') add('attacks', r.attacks, function (a) { return { t: a, reply: '' }; });
      if (kind === 'rebuilt') { if (r.rebuilt) x.rebuilt = r.rebuilt; if (r.test) ['what', 'cost', 'time', 'pass'].forEach(function (k) { if (r.test[k] && !(x.test[k] || '').trim()) x.test[k] = r.test[k]; }); }
      if (kind === 'fermi') x.fermi.res = r;
      tk.busy = null; tkSave(); tk.keepScroll = true; drawThink();
    }).catch(function (e) { if (!tk) return; tk.busy = null; tk.keepScroll = true; drawThink(); toast('AI: ' + (e.message || 'failed')); });
  }
  function sendChat(x, text) {
    x.chat.push({ r: 'me', t: text }); tk.draft = ''; tk.busy = 'chat'; tkSave(); drawThink(); scrollChat();
    var hist = x.chat.slice(-12).map(function (m) { return (m.r === 'me' ? 'USER: ' : 'COACH: ') + m.t; }).join('\n');
    var P = ideaCtx(x) + '\nThe user is on the step: ' + (TK_RAIL[tkRailIdx(x, tk.from || 'q')] || 'Question') + '.\n\nConversation so far:\n' + hist +
      '\n\nAs the coach, reply to the USER’s last message. First find any phrases in it that reason by analogy (what others do, what has always been done, what customers expect, "industry standard") rather than from physics, cost of materials, energy, forces or time. Quote those phrases exactly. Then reply in 1 to 3 short sentences: if there was analogy, point it out and ask them to redo it from physics; if it was all physics, confirm it and ask the next sharpest question that moves the idea forward. Reply JSON: {"analogy":["exact phrase"],"tag":"Analogy spotted ×N" or "Physics ✓" or "Question" or "Challenge","reply":"..."}';
    tkAsk(P, .5).then(function (r) {
      if (!tk) return;
      var me = x.chat[x.chat.length - 1]; me.hl = (r.analogy || []).filter(function (p) { return p && me.t.toLowerCase().indexOf(String(p).toLowerCase()) >= 0; });
      var tag = r.tag || ''; if (me.hl.length && !/analogy/i.test(tag)) tag = 'Analogy spotted ×' + me.hl.length;
      x.chat.push({ r: 'ai', t: r.reply || '…', tag: tag });
      tk.busy = null; tkSave(); drawThink(); scrollChat();
    }).catch(function (e) { if (!tk) return; tk.busy = null; drawThink(); toast('AI: ' + (e.message || 'failed')); });
  }
  function scrollChat() { var o = document.getElementById('overlay'); o.scrollTop = o.scrollHeight; }

  function bindThink(o, x) {
    var cl = o.querySelector('#tkClose'); if (cl) cl.onclick = closeThink;
    o.querySelectorAll('[data-tkgo]').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.tkgo;
        if (g === 'full') { x.mode = 'full'; save(); g = 'q'; }
        if (g === 'chat') tk.from = tk.page;
        tk.page = g; if (x) x.last = g; save(); drawThink(); o.scrollTop = 0; if (g === 'chat') scrollChat();
      };
    });
    o.querySelectorAll('[data-tkrail]').forEach(function (b) { b.onclick = function () { var k = +b.dataset.tkrail; tk.page = k === 0 ? 'q' : k === 1 ? 'del' : k === 2 ? 'phys' : k <= 5 ? 'ssa' : 'red'; x.last = tk.page; save(); drawThink(); o.scrollTop = 0; }; });
    // start page
    o.querySelectorAll('[data-tkmode]').forEach(function (b) { b.onclick = function () { var t = o.querySelector('#tkTitle'); tk.title = t ? t.value : tk.title; tk.mode = b.dataset.tkmode; drawThink(); }; });
    var st = o.querySelector('#tkStart');
    if (st) st.onclick = function () {
      var t = o.querySelector('#tkTitle').value.trim();
      if (!t) { toast('Write the idea first'); o.querySelector('#tkTitle').focus(); return; }
      var nx = newIdea(t, tk.mode); tk.id = nx.id; tk.page = TK_MODES[tk.mode].pages[0];
      if (tk.mode === 'fermi') nx.fermi = { q: t, guess: '', res: null };
      save(); drawThink();
    };
    // text fields
    o.querySelectorAll('[data-f]').forEach(function (el) {
      el.addEventListener('input', function () {
        var v = el.value; if (el.dataset.num) v = el.type === 'range' ? +v : v.replace(/[^\d.]/g, '');
        setPath(x, el.dataset.f, v); tkSave();
        if (el.dataset.f === 'conf') { var cv = o.querySelector('#tkConfV'); if (cv) cv.textContent = v + '%'; }
        if (el.dataset.f === 'conf2') { var c2 = o.querySelector('#tkConf2V'); if (c2) c2.textContent = v + '%'; }
        if (tk.page === 'phys' && /^mats\.\d+\.cost$|^price$/.test(el.dataset.f)) {
          var fl = floorOf(x), ix = idx(x.price, fl), fe = o.querySelector('#tkFloor'), ie = o.querySelector('#tkIdx');
          if (fe) fe.textContent = rupee(fl);
          if (ie) { ie.hidden = !ix; ie.querySelector('b').textContent = (ix || '') + '×'; }
        }
      });
      // update in place (a full redraw here would swallow the tap on the next button)
      el.addEventListener('change', function () {
        var f = el.dataset.f, m;
        if ((m = /^reqs\.(\d+)\.owner$/.exec(f))) {
          var r = x.reqs[+m[1]], bad = reqFlag(r), lab = el.closest('.tkowner'), fl = lab && lab.parentNode.querySelector('.tkflag');
          if (lab) lab.classList.toggle('bad', bad);
          if (fl) { fl.hidden = !bad; fl.textContent = r.owner ? 'That’s analogy, not a person. Who exactly?' : 'No person owns this yet.'; }
        } else if ((m = /^attacks\.(\d+)\.reply$/.exec(f))) {
          var pl = el.closest('.tkatk').querySelector('.tkpill'), done = !!el.value.trim();
          pl.className = 'tkpill ' + (done ? 'ok' : 'open'); pl.textContent = done ? 'Answered' : 'Open';
        } else if (/^(simplify|speed)\./.test(f) && tk.page === 'ssa') {
          var lk = (x.simplify.filter(Boolean).length < 3) + ',' + (x.speed.filter(Boolean).length < 1);
          if (lk !== tk.lockSig) { var pg = tk.page; setTimeout(function () { if (tk && tk.page === pg) { tk.keepScroll = true; drawThink(); } }, 350); }
        }
      });
    });
    o.querySelectorAll('[data-tkadd]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.tkadd, blank = { reqs: { t: '', owner: '', note: '', tag: '' }, parts: { t: '', note: '', st: 'keep' }, mats: { t: '', q: '', cost: '' }, attacks: { t: '', reply: '' } }[k];
        x[k].push(blank ? JSON.parse(JSON.stringify(blank)) : ''); tkSave(); tk.keepScroll = true; drawThink();
        var ins = o.querySelectorAll('[data-f^="' + k + '.' + (x[k].length - 1) + '"]'); if (ins[0]) try { ins[0].focus(); } catch (e) {}
      };
    });
    o.querySelectorAll('[data-tkdel]').forEach(function (b) { b.onclick = function () { var p = b.dataset.tkdel.split('.'); x[p[0]].splice(+p[1], 1); tkSave(); tk.keepScroll = true; drawThink(); }; });
    o.querySelectorAll('[data-tktag]').forEach(function (b) { b.onclick = function () { var p = b.dataset.tktag.split('.'), r = x[p[0]][+p[1]]; r.tag = r.tag === b.dataset.v ? '' : b.dataset.v; tkSave(); tk.keepScroll = true; drawThink(); }; });
    o.querySelectorAll('[data-tkst]').forEach(function (b) { b.onclick = function () { var p = b.dataset.tkst.split('.'); x[p[0]][+p[1]].st = b.dataset.v; tkSave(); tk.keepScroll = true; drawThink(); }; });
    o.querySelectorAll('[data-tkai]').forEach(function (b) { b.onclick = function () { runAI(b.dataset.tkai, x); }; });
    var ta = o.querySelector('#tkTarget');
    if (ta) ta.onclick = function () {
      var what = (x.test.what || '').trim(); if (!what) { toast('Write the test first'); return; }
      var dv = o.querySelector('#tkDate').value || tomorrowKey();
      mutate(function () {
        addTarget(dv, 'Test: ' + what.slice(0, 90), 'h');
        var arr = state.targets[dv]; x.test.tid = arr[arr.length - 1].id; x.testAt = dkey(new Date());
      });
      toast('Added to your targets'); tk.keepScroll = true; drawThink();
    };
    var sh = o.querySelector('#tkShare');
    if (sh) sh.onclick = function () {
      var txt = treeText(x);
      if (navigator.share) navigator.share({ title: x.title, text: txt }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Copied'); });
    };
    var dn = o.querySelector('#tkDone'); if (dn) dn.onclick = function () { closeThink(); openNotes('ideas'); };
    // chat
    var msg = o.querySelector('#tkMsg');
    if (msg) {
      msg.addEventListener('input', function () { tk.draft = msg.value; });
      o.querySelector('#tkSend').onclick = function () { var t = msg.value.trim(); if (t && !tk.busy) sendChat(x, t); };
      var mic = o.querySelector('#tkMic');
      if (mic) mic.onclick = function () {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition, r = new SR(); r.lang = 'en-IN'; r.interimResults = false;
        mic.classList.add('on');
        r.onresult = function (e) { var t = e.results[0][0].transcript; msg.value = (msg.value ? msg.value + ' ' : '') + t; tk.draft = msg.value; };
        r.onend = function () { mic.classList.remove('on'); };
        r.onerror = function () { mic.classList.remove('on'); };
        try { r.start(); } catch (e) { mic.classList.remove('on'); }
      };
    }
    if (tk.page === 'drill') bindDrill(o);
  }

  // ---------- daily drill: Fermi estimates, idiot index, "why is it this shape?" ----------
  var DRILLS = [
    { k: 'mc', lab: 'Fermi + idiot index', q: 'A ₹1,200 bicycle chain.<br><i class="lite">What’s the steel worth?</i>', o: ['₹3', '₹30', '₹300', '₹3k'], a: 1, x: 'About 0.3 kg of steel × roughly ₹80/kg ≈ <b>₹25</b>. Idiot index ≈ <b>50×</b>. The rest is heat treatment, precision and very fast machines.' },
    { k: 'steps', lab: 'Why is it this shape?', q: 'Why does a bicycle chain<br><i class="lite">have rollers?</i>', x: 'A roller <b>rolls</b> against the sprocket tooth instead of sliding. Rolling friction is far lower than sliding friction, so less energy turns into heat and the teeth wear much slower. Bedrock truth: sliding contact wastes energy and wears; rolling contact doesn’t (nearly as much).' },
    { k: 'mc', lab: 'Fermi estimate', q: 'A 500 Wh e-bike battery.<br><i class="lite">How high could its energy lift you (75 kg)?</i>', o: ['25 m', '250 m', '2.5 km', '25 km'], a: 2, x: '500 Wh = 1.8 MJ. Height = E ÷ (m × g) = 1,800,000 ÷ (75 × 9.8) ≈ <b>2,450 m</b>. A small battery holds a mountain’s worth of lifting.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'Your bedroom is 3 × 4 × 3 m.<br><i class="lite">How much does the air in it weigh?</i>', o: ['0.4 kg', '4 kg', '40 kg', '400 kg'], a: 2, x: '36 m³ × about 1.2 kg/m³ ≈ <b>43 kg</b>. Roughly the weight of a child. Air is light, not weightless.' },
    { k: 'steps', lab: 'Why is it this shape?', q: 'Why are drink cans round,<br><i class="lite">with a domed bottom?</i>', x: 'A can is a small <b>pressure vessel</b>. A cylinder spreads the internal pressure evenly as hoop stress, so there are no weak corners. The dome curves outward like an arch against the pressure, letting the base be much thinner. Bedrock truth: curved shells carry pressure in tension with the least material.' },
    { k: 'mc', lab: 'Idiot index', q: 'A ₹800 steel water bottle.<br><i class="lite">What’s the stainless steel worth?</i>', o: ['₹8', '₹80', '₹800', '₹8k'], a: 1, x: 'About 0.3 kg of stainless steel × roughly ₹250/kg ≈ <b>₹75</b>. Idiot index ≈ <b>10×</b>. Deep drawing, welding the double wall and the vacuum take the rest.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'A 75 W ceiling fan runs 10 hours a day.<br><i class="lite">What does it cost per month at ₹8/kWh?</i>', o: ['₹18', '₹180', '₹1,800', '₹18,000'], a: 1, x: '75 W × 10 h × 30 days = 22.5 kWh × ₹8 ≈ <b>₹180</b>. A BLDC fan at about 30 W would cut that to about ₹70.' },
    { k: 'steps', lab: 'The physics limit', q: 'What is the least energy<br><i class="lite">to boil 1 litre of water from 25 °C?</i>', x: 'Q = m × c × ΔT = 1 kg × 4,186 J/kg·K × 75 K ≈ <b>314 kJ ≈ 0.087 kWh</b>. A good electric kettle gets 80–90% of its energy into the water, so it is already close to the limit. A gas stove is much further away (often under 50%).' },
    { k: 'mc', lab: 'Fermi estimate', q: 'How many times does your heart<br><i class="lite">beat in one year?</i>', o: ['370 thousand', '3.7 million', '37 million', '370 million'], a: 2, x: '70 beats/min × 60 × 24 × 365 ≈ <b>37 million</b>.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'A 1,000 kg car at 60 km/h.<br><i class="lite">Dropped from what height would it hit as hard?</i>', o: ['1.4 m', '14 m', '140 m', '1.4 km'], a: 1, x: '60 km/h ≈ 16.7 m/s. h = v² ÷ 2g = 278 ÷ 19.6 ≈ <b>14 m</b>, about a four-storey fall. Energy grows with the square of speed.' },
    { k: 'steps', lab: 'Why is it this shape?', q: 'Why are steel beams<br><i class="lite">shaped like an I?</i>', x: 'In bending, the material far from the centre line does most of the work (stiffness grows with the <b>square of the distance</b> from the neutral axis). The flanges put metal where it counts; the thin web just holds them apart. Same stiffness, far less steel.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'A Coorg monsoon drops ~2,500 mm of rain.<br><i class="lite">How much water lands on one acre?</i>', o: ['1 lakh litres', '10 lakh litres', '1 crore litres', '10 crore litres'], a: 2, x: '1 acre ≈ 4,047 m² × 2.5 m ≈ 10,000 m³ = <b>1 crore litres</b>.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'Noon sun on a 1 m² solar panel.<br><i class="lite">How much electric power comes out?</i>', o: ['2 W', '20 W', '200 W', '2,000 W'], a: 2, x: 'Sunlight at noon is about 1,000 W/m². A good panel converts about 20% ≈ <b>200 W</b>. The physics limit for a single-junction silicon cell is about 30%.' },
    { k: 'steps', lab: 'Why is it this shape?', q: 'Why do coffee beans<br><i class="lite">have to be dried before storage?</i>', x: 'Moulds, yeasts and bacteria need <b>free water</b> to grow. Drying beans to about 11–12% moisture lowers the water activity below what most of them need, so the beans stop fermenting and rotting. Bedrock truth: life needs available water.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'How many AA batteries hold the energy<br><i class="lite">of 1 litre of petrol?</i>', o: ['35', '350', '3,500', '35,000'], a: 2, x: 'Petrol ≈ 34 MJ per litre ≈ 9.4 kWh. An alkaline AA holds about 3 Wh. 9,400 ÷ 3 ≈ <b>3,000–3,500</b>. That gap is why fuel still wins on energy density.' },
    { k: 'steps', lab: 'The physics limit', q: 'A 250 W motor lifts you + bike (100 kg)<br><i class="lite">up a 10% slope. What’s the top speed?</i>', x: 'Power = m × g × v × sin θ. sin θ ≈ 0.1, so v = 250 ÷ (100 × 9.8 × 0.1) ≈ <b>2.5 m/s ≈ 9 km/h</b> from the motor alone, with no losses. Your legs and less weight are the only ways to go faster.' },
    { k: 'mc', lab: 'Fermi estimate', q: 'How many litres of air<br><i class="lite">do you breathe in a day?</i>', o: ['100', '1,000', '10,000', '1,00,000'], a: 2, x: 'About 0.5 L per breath × 15 breaths/min × 1,440 min ≈ <b>10,800 L</b>.' },
    { k: 'steps', lab: 'Delete a part', q: 'Why are manhole covers round,<br><i class="lite">and what would you delete from one?</i>', x: 'A circle has the same width in every direction, so the cover <b>can’t fall through</b> its own hole; it needs no orientation and can be rolled. Many requirements (hinges, locks, lettering) are habits; the shape itself is physics.' },
    { k: 'mc', lab: 'Idiot index', q: 'A ₹2,000 aluminium pressure cooker.<br><i class="lite">What’s the aluminium worth?</i>', o: ['₹4', '₹40', '₹400', '₹4k'], a: 2, x: 'About 1.5 kg of aluminium × roughly ₹250/kg ≈ <b>₹375</b>. Idiot index ≈ <b>5×</b>. A simple, high-volume product sits close to its floor.' },
    { k: 'steps', lab: 'Why is it this shape?', q: 'Why do road tyres have tread,<br><i class="lite">but racing slicks don’t?</i>', x: 'On a dry road, grip comes from <b>rubber touching the road</b>: more contact area, more grip, so slicks have no grooves. On a wet road, water must escape or the tyre floats (aquaplaning). Tread is a drainage system, needed only because of water.' }
  ];
  function drillIdx() { var n = 0; Object.keys(state.drills || {}).forEach(function (k) { if (state.drills[k].done) n++; }); return n; }
  function todayDrill() {
    state.drills = state.drills || {};
    var k = dkey(new Date()), d = state.drills[k];
    if (!d) { var i = drillIdx() % DRILLS.length; d = state.drills[k] = { i: i, pick: null, ans: [], done: false }; }
    return d;
  }
  function drillStreak() {
    var s = 0, d = new Date(); if (!((state.drills || {})[dkey(d)] || {}).done) d.setDate(d.getDate() - 1);
    while (((state.drills || {})[dkey(d)] || {}).done) { s++; d.setDate(d.getDate() - 1); }
    return s;
  }
  function openDrill() { resetOverlay(); closeSheet(); tk = { id: null, page: 'drill', busy: null }; drawThink(); showOverlay('tko'); }
  function drillHtml() {
    var d = todayDrill(), D = DRILLS[d.i], mon = dkey(new Date()).slice(0, 7), ms = Object.keys(state.drills).filter(function (k) { return k.slice(0, 7) === mon; }), right = ms.filter(function (k) { var x = state.drills[k]; return x.done && DRILLS[x.i].k === 'mc' && x.pick === DRILLS[x.i].a; }).length, mcs = ms.filter(function (k) { var x = state.drills[k]; return x.done && DRILLS[x.i].k === 'mc'; }).length;
    var h = '<div class="row between"><span class="eyebrow">Daily drill · 3 min</span><button type="button" class="btn ghost small" id="tkClose">' + (d.done ? 'Close' : 'Skip') + '</button></div>';
    h += '<div class="hero tkhero" style="background:' + T.coral + ';color:#fff">' + sun('rgba(255,255,255,.18)', 110, -30, -40) + '<span class="cap">Day ' + (drillIdx() + (d.done ? 0 : 1)) + ' · ' + D.lab + '</span><span class="display" style="font-size:26px;line-height:1.08">' + D.q + '</span></div>';
    if (D.k === 'mc') {
      h += '<div class="card stack" style="gap:12px"><span class="eyebrow">Your guess · order of magnitude</span><div class="tkopts">' + D.o.map(function (t, i) {
        var cls = d.pick == null ? '' : i === D.a ? ' right' : i === d.pick ? ' wrong' : '';
        return '<button type="button" data-dpick="' + i + '" class="' + (d.pick === i ? 'on' : '') + cls + '"' + (d.pick != null ? ' disabled' : '') + '>' + t + '</button>';
      }).join('') + '</div>';
      if (d.pick != null) h += '<div class="tkworked"><span class="cap" style="color:' + (d.pick === D.a ? T.lagoon : T.coral) + '">' + (d.pick === D.a ? '✓ Right order of magnitude' : 'Worked out') + '</span><span>' + D.x + '</span></div>';
      h += '</div>';
    } else {
      var steps = ['What job must it do?', 'What would happen without it, or with a different shape?', 'What basic truth makes it work?', 'Where else could that truth help you?'];
      h += '<div class="card stack" style="gap:14px">' + steps.map(function (s, i) {
        var ans = d.ans[i], on = i === d.ans.length && !d.done;
        return '<div class="tkds' + (ans != null ? ' done' : on ? ' on' : '') + '"><span class="n">' + (ans != null ? '✓' : i + 1) + '</span><div><b>' + s + '</b>' + (ans != null ? '<span class="tknote">' + esc(ans || '—') + '</span>' : on ? '<textarea class="text" id="dAns" rows="2" placeholder="Your answer…"></textarea>' : '') + '</div></div>';
      }).join('') + '</div>';
      if (d.ans.length >= 4) h += '<div class="card tkworked"><span class="cap" style="color:' + T.lagoon + '">Here’s the physics</span><span>' + D.x + '</span></div>';
    }
    h += '<div class="tkstats"><div><b>' + (D.k === 'mc' && d.pick != null ? (d.pick === D.a ? '✓' : '✗') : '·') + '</b><small>' + (D.k === 'mc' ? 'right order' : 'today') + '</small></div><div><b>' + right + '/' + mcs + '</b><small>this month</small></div><div><b>🔥' + drillStreak() + '</b><small>day streak</small></div></div>';
    h += '<span class="tknote">Rotates each day: Fermi estimate · idiot index · physics limit · “why is it this shape?”</span><div style="flex:1"></div>';
    if (!d.done && D.k === 'steps' && d.ans.length < 4) h += '<button type="button" class="btn solid" id="dNext">Next step</button>';
    else if (!d.done && (D.k === 'steps' || d.pick != null)) h += '<button type="button" class="btn solid" id="dDone">Done · +5 XP</button>';
    else if (d.done) h += '<button type="button" class="btn solid" id="tkClose2">Next drill tomorrow</button>';
    return h;
  }
  function bindDrill(o) {
    var d = todayDrill();
    o.querySelectorAll('[data-dpick]').forEach(function (b) { b.onclick = function () { d.pick = +b.dataset.dpick; save(); drawThink(); }; });
    var nx = o.querySelector('#dNext'); if (nx) nx.onclick = function () { var a = o.querySelector('#dAns'); d.ans.push(a ? a.value.trim() : ''); save(); drawThink(); };
    var dn = o.querySelector('#dDone'); if (dn) dn.onclick = function () { mutate(function () { d.done = true; d.at = new Date().toISOString(); }); drawThink(); };
    var c2 = o.querySelector('#tkClose2'); if (c2) c2.onclick = closeThink;
    var da = o.querySelector('#dAns'); if (da) setTimeout(function () { try { da.focus(); } catch (e) {} }, 60);
  }
  function drillDoneToday() { return !!((state.drills || {})[dkey(new Date())] || {}).done; }
  function thinkXp(dk) {
    var x = ((state.drills || {})[dk] || {}).done ? 5 : 0;
    x += Math.min(ideas().filter(function (i) { return i.testAt === dk; }).length, 2) * 10;
    return x;
  }
  // Notes → Ideas tab
  function ideasTabHtml() {
    var d = (state.drills || {})[dkey(new Date())] || {}, list = ideas();
    var h = '<button type="button" class="tkdrillrow" id="nDrill"><span class="ic">🧠</span><span><b>' + (d.done ? 'Today’s drill done' : 'Daily drill · 3 min') + '</b><small>' + (d.done ? '🔥 ' + drillStreak() + '-day streak · next one tomorrow' : 'Fermi estimate, idiot index or “why is it this shape?”') + '</small></span>' + CHEV + '</button>';
    if (!list.length) h += '<p class="muted" style="margin:0">Break an idea down to physics: question the requirements, delete parts, find the raw-material floor, then test it. Start with anything you’re working on.</p>';
    else h += '<div class="list">' + list.map(function (x) {
      var fl = floorOf(x), ix = idx(x.price, fl), st = x.test && x.test.tid ? ['Testing', '#CDEFEA'] : x.rebuilt ? ['Rebuilt', '#FFE6B8'] : ['Step: ' + (x.mode === 'full' ? TK_RAIL[tkRailIdx(x, x.last || 'q')] : TK_MODES[x.mode].t.split(' ·')[0]), '#FFE0D9'];
      var sub = [x.truths.filter(Boolean).length ? x.truths.filter(Boolean).length + ' truths' : '', ix ? 'idiot index ' + ix + '×' : '', x.parts.filter(function (p) { return p.st === 'del'; }).length ? x.parts.filter(function (p) { return p.st === 'del'; }).length + ' deleted' : '', niceDate(x.updated)].filter(Boolean).join(' · ');
      return '<button type="button" class="r" data-iopen="' + x.id + '"><span class="t">' + esc(x.title) + '<small>' + sub + '</small></span><span class="tkpill" style="background:' + st[1] + '">' + st[0] + '</span>' + CHEV + '</button>';
    }).join('') + '</div>';
    h += '<div class="optrow">' + ['idiot', 'red', 'fermi'].map(function (k) { return '<button type="button" class="opt sm" data-inew="' + k + '">' + TK_MODES[k].ic + ' ' + TK_MODES[k].t.split(' ·')[0] + '</button>'; }).join('') + '</div>';
    h += '<div class="nfoot"><button type="button" class="btn coral" data-inew="full">+ Break down a new idea</button></div>';
    return h;
  }
  function bindIdeasTab(o) {
    var dr = o.querySelector('#nDrill'); if (dr) dr.onclick = function () { openDrill(); };
    o.querySelectorAll('[data-iopen]').forEach(function (b) { b.onclick = function () { openThink(b.dataset.iopen); }; });
    o.querySelectorAll('[data-inew]').forEach(function (b) { b.onclick = function () { openThink(null); tk.mode = b.dataset.inew; drawThink(); }; });
  }


  // ---------- vision boards, full screen and view only (the eye tab on Today) ----------
  var vb = null;
  function visionBoards() { return orderedNotes(true).filter(function (n) { return notePages(n).some(function (p) { return p.items.length; }); }); }
  function updateEye() {
    var e = document.getElementById('visionEye'); if (!e) return;
    e.hidden = !(ui.tab === 'trail' && NOTES && visionBoards().length);
  }
  function openVision(startId) {
    loadNotes().then(function () {
      var list = visionBoards(); if (!list.length) { toast('No vision boards yet'); return; }
      resetOverlay(); closeSheet();
      var i0 = Math.max(0, list.map(function (n) { return n.id; }).indexOf(startId));
      vb = { list: list, i: i0 };
      try { history.pushState({ vision: 1 }, ''); } catch (e) {}
      drawVision(); showOverlay('vbo');
      var tr = document.getElementById('vbTrack'); tr.scrollLeft = i0 * tr.clientWidth;
    });
  }
  function closeVision(fromPop) {
    if (!vb) return; vb = null; closeOverlayEl();
    if (!fromPop && history.state && history.state.vision) { try { history.back(); } catch (e) {} }
  }
  function drawVision() {
    var o = document.getElementById('overlay'), n = vb.list.length;
    var W = Math.min(window.innerWidth, 560), availH = window.innerHeight - 170;
    var cw = W, ch = Math.round(W * NH / NW); if (ch > availH) { ch = availH; cw = Math.round(ch * NW / NH); }
    var h = '<div class="vbhead"><div><span class="cap">Vision · <b id="vbIdx">' + (vb.i + 1) + '</b> of ' + n + '</span><span class="vbt" id="vbTitle">' + (esc(vb.list[vb.i].title) || 'Untitled') + '</span></div><button type="button" class="vbx" id="vbClose" aria-label="Close">✕</button></div>';
    h += '<div class="vbtrack" id="vbTrack">' + vb.list.map(function (b, bi) {
      var pages = notePages(b).filter(function (p) { return p.items.length; });
      return '<div class="vbslide"><div class="vbpages">' + pages.map(function (p, pi) {
        return '<div class="vbpage"><canvas data-vb="' + bi + '" data-pg="' + notePages(b).indexOf(p) + '" style="width:' + cw + 'px;height:' + ch + 'px;background:' + b.board + '"></canvas></div>';
      }).join('') + '</div>' + (pages.length > 1 ? '<span class="vbmore">' + pages.length + ' pages · swipe up</span>' : '') + '</div>';
    }).join('') + '</div>';
    h += '<div class="vbfoot"><div class="vbdots">' + vb.list.map(function (b, i) { return '<i' + (i === vb.i ? ' class="on"' : '') + '></i>'; }).join('') + '</div><span>' + (n > 1 ? 'Swipe for the next board · view only' : 'View only') + '</span></div>';
    o.innerHTML = h;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    o.querySelectorAll('canvas[data-vb]').forEach(function (c) {
      var b = vb.list[+c.dataset.vb], pg = notePages(b)[+c.dataset.pg];
      c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
      var paint = function () {
        if (!vb) return;
        var x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = b.board; x.fillRect(0, 0, c.width, c.height);
        x.scale(c.width / NW, c.height / NH);
        pg.items.forEach(function (it) { drawItem(x, it, paint); });
        // pictures still loading: repaint this page when each one arrives
        pg.items.forEach(function (it) { var im = it.type === 'img' && imgCache[it.src]; if (im && !(im.complete && im.naturalWidth) && !im['_vb' + c.dataset.vb + c.dataset.pg]) { im['_vb' + c.dataset.vb + c.dataset.pg] = 1; im.addEventListener('load', paint); } });
      };
      paint();
    });
    o.querySelector('#vbClose').onclick = function () { closeVision(); };
    var tr = o.querySelector('#vbTrack'), t = null;
    tr.addEventListener('scroll', function () {
      clearTimeout(t); t = setTimeout(function () {
        if (!vb) return;
        var i = Math.round(tr.scrollLeft / tr.clientWidth); if (i === vb.i || i < 0 || i >= vb.list.length) return;
        vb.i = i; o.querySelector('#vbIdx').textContent = i + 1; o.querySelector('#vbTitle').textContent = vb.list[i].title || 'Untitled';
        o.querySelectorAll('.vbdots i').forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
      }, 60);
    }, { passive: true });
  }
  window.addEventListener('popstate', function () { if (vb) closeVision(true); });
  document.getElementById('visionEye').addEventListener('click', function () { openVision(); });
  window.addEventListener('resize', function () { if (vb) { var tr = document.getElementById('vbTrack'); drawVision(); var t2 = document.getElementById('vbTrack'); if (t2) t2.scrollLeft = vb.i * t2.clientWidth; } });


  // ---------- weigh-in: read the FitDays scale over Bluetooth (learns its signal once), or read a screenshot ----------
  function logWeight(kg, src, key) {
    key = key || dkey(new Date()); kg = Math.round(kg * 10) / 10;
    state.weights = (state.weights || []).filter(function (x) { return x.d !== key; });
    state.weights.push({ d: key, kg: kg, src: src }); save(); render();
  }
  function mergeSyncedWeights() {
    (state.wellness || []).forEach(function (w) {
      if (!w.weight || w.weight < 30 || w.weight > 250) return;
      var ex = (state.weights || []).filter(function (x) { return x.d === w.d; })[0];
      if (!ex) { state.weights = (state.weights || []).concat([{ d: w.d, kg: Math.round(w.weight * 10) / 10, src: 'sync' }]); }
      else if (ex.src === 'sync') ex.kg = Math.round(w.weight * 10) / 10;
    });
  }
  var wb = { status: 'idle', seen: {}, reading: null, scan: null };
  function weighinSheet() {
    var sc = state.scale, h = '';
    var bt = !!navigator.bluetooth, scanOk = bt && !!navigator.bluetooth.requestLEScan;
    if (wb.reading) {
      h += '<div class="wbig"><span class="cap">Your scale says</span><span class="display">' + wb.reading.toFixed(1) + '<small> kg</small></span><span class="muted small">' + (wb.stable ? 'steady reading' : 'settling…') + '</span></div>';
      h += '<button type="button" class="btn coral" id="wbSave"' + (wb.stable ? '' : ' disabled') + '>Save ' + wb.reading.toFixed(1) + ' kg</button>';
    } else if (wb.status === 'scan') {
      h += '<div class="wbig"><span class="wpulse"></span><span style="font-size:17px;font-weight:600">' + (sc ? 'Step on the scale now' : 'Step on the scale') + '</span><span class="muted small">' + (sc ? 'Listening for your scale…' : 'First time: when the number on the scale stops changing, type it below so the app can learn your scale’s signal.') + '</span></div>';
      if (!sc) h += '<div class="row"><input id="wbLearn" class="text" type="number" inputmode="decimal" step="0.05" placeholder="number shown on the scale" style="flex:1"><button type="button" class="btn solid" id="wbLearnGo">Learn</button></div>';
      h += '<button type="button" class="btn ghost" id="wbStop">Stop</button>';
    } else if (scanOk) {
      h += '<div class="wbig"><span style="font-size:40px">⚖</span><span style="font-size:17px;font-weight:600">' + (sc ? 'Ready: ' + esc(sc.name || 'your scale') : 'Connect your scale once') + '</span><span class="muted small">' + (sc ? 'Tap start, then step on the scale. No other app needed.' : 'Your FitDays scale sends its reading over Bluetooth. The app listens for it directly.') + '</span></div>';
      h += '<button type="button" class="btn coral" id="wbStart">Start · then step on</button>';
      if (sc) h += '<button type="button" class="link small" id="wbForget" style="align-self:center">Forget this scale and learn again</button>';
    } else {
      h += '<div class="notice"><b>One-time Chrome setting</b> lets the app hear your scale over Bluetooth:<ol class="steps" style="margin-top:8px"><li>Open a new Chrome tab and type <code>chrome://flags</code></li><li>Search <b>Experimental Web Platform features</b></li><li>Set it to <b>Enabled</b> and tap <b>Relaunch</b></li><li>Come back here and tap Weigh in again</li></ol></div>' +
        '<button type="button" class="btn ghost small" id="wbCopy">Copy chrome://flags</button>';
    }
    if (wb.msg) h += '<div class="notice' + (wb.ok ? ' ok' : '') + '">' + wb.msg + '</div>';
    h += '<h3 class="sh">Or</h3><div class="list">' + row({ t: '📷 Read a FitDays screenshot', sub: hasAI() ? 'take a screenshot in FitDays, pick it here' : 'needs your Gemini key (Settings → Visualization)', id: 'wbShot' }) + '</div>';
    h += '<input type="file" id="wbFile" accept="image/*" hidden>';
    h += '<p class="muted small">Tip: in FitDays you can also tap Share on the result and choose this app.</p>';
    return { title: 'Weigh in', cap: sc ? 'scale learnt' : '', html: h, bind: bindWeighin };
  }
  function wbClose() { try { if (wb.scan && wb.scan.active) wb.scan.stop(); } catch (e) {} wb.scan = null; navigator.bluetooth && navigator.bluetooth.removeEventListener && navigator.bluetooth.removeEventListener('advertisementreceived', wbAdv); }
  function advFields(ev) {
    var out = [];
    if (ev.manufacturerData) ev.manufacturerData.forEach(function (dv, id) { out.push({ k: 'm:' + id, dv: dv }); });
    if (ev.serviceData) ev.serviceData.forEach(function (dv, id) { out.push({ k: 's:' + id, dv: dv }); });
    return out;
  }
  function wbAdv(ev) {
    var sc = state.scale, now = Date.now(), id = ev.device && ev.device.id;
    advFields(ev).forEach(function (f) {
      var bytes = []; for (var i = 0; i < f.dv.byteLength; i++) bytes.push(f.dv.getUint8(i));
      var key = id + '|' + f.k; wb.seen[key] = { t: now, b: bytes, name: (ev.device && ev.device.name) || ev.name || '', id: id, k: f.k };
      if (sc && (sc.id === id || (sc.name && sc.name === ((ev.device && ev.device.name) || ev.name))) && sc.k === f.k && bytes.length > sc.off + 1) {
        var raw = sc.le ? bytes[sc.off] | (bytes[sc.off + 1] << 8) : (bytes[sc.off] << 8) | bytes[sc.off + 1], kg = raw / sc.div;
        if (kg < 20 || kg > 250) return;
        var last = wb.hist || []; last.push(Math.round(kg * 10) / 10); wb.hist = last.slice(-4);
        wb.reading = kg; wb.stable = wb.hist.length >= 3 && wb.hist.slice(-3).every(function (v) { return v === wb.hist[wb.hist.length - 1]; });
        if (ui.sheet && ui.sheet.kind === 'weighin') drawSheet();
      }
    });
  }
  function wbLearn(shown) {
    // find the device and the two bytes that carry the weight the user typed
    var best = null, now = Date.now();
    Object.keys(wb.seen).forEach(function (key) {
      var s2 = wb.seen[key]; if (now - s2.t > 60000) return;
      var b = s2.b;
      for (var o = 0; o + 1 < b.length; o++) [true, false].forEach(function (le) {
        var raw = le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
        [10, 100, 20, 200, 22.0462, 220.462].forEach(function (div) {
          var kg = raw / div; if (Math.abs(kg - shown) <= 0.06 && (!best || s2.t > best.t)) best = { id: s2.id, name: s2.name, k: s2.k, off: o, le: le, div: div, t: s2.t };
        });
      });
    });
    return best;
  }
  function bindWeighin(r) {
    var st = r.querySelector('#wbStart');
    if (st) st.onclick = function () {
      wb.msg = null; wb.reading = null; wb.hist = []; wb.seen = {};
      navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true }).then(function (scan) {
        wb.scan = scan; wb.status = 'scan';
        navigator.bluetooth.addEventListener('advertisementreceived', wbAdv);
        drawSheet();
        setTimeout(function () { if (wb.status === 'scan' && !wb.reading) { wb.msg = state.scale ? 'Nothing heard yet. Step on the scale again, or check Bluetooth is on.' : null; if (ui.sheet && ui.sheet.kind === 'weighin') drawSheet(); } }, 25000);
      }).catch(function (e) { wb.msg = 'Bluetooth didn’t start: ' + esc(e.message || e) + '. Turn on Bluetooth and Location, then try again.'; drawSheet(); });
    };
    var sp = r.querySelector('#wbStop'); if (sp) sp.onclick = function () { wbClose(); wb.status = 'idle'; drawSheet(); };
    var lg = r.querySelector('#wbLearnGo');
    if (lg) lg.onclick = function () {
      var v = +r.querySelector('#wbLearn').value; if (!v || v < 20 || v > 250) { toast('Type the number on the scale'); return; }
      var f = wbLearn(v);
      if (!f) { wb.msg = 'Couldn’t find that number in any Bluetooth signal yet. Stay on the scale for a few seconds and tap Learn again. If it never works, use a screenshot below.'; wb.ok = false; drawSheet(); return; }
      state.scale = { id: f.id, name: f.name, k: f.k, off: f.off, le: f.le, div: f.div, at: new Date().toISOString() }; save();
      wbClose(); wb.status = 'idle'; wb.reading = null; wb.ok = true; wb.msg = 'Learnt your scale' + (f.name ? ' (' + esc(f.name) + ')' : '') + '. Saved ' + v + ' kg for today. Next time just tap Start and step on.';
      logWeight(v, 'scale'); drawSheet();
    };
    var sv = r.querySelector('#wbSave'); if (sv) sv.onclick = function () { var kg = wb.reading; wbClose(); wb.status = 'idle'; wb.reading = null; logWeight(kg, 'scale'); closeSheet(); toast('Saved ' + kg.toFixed(1) + ' kg'); };
    var fg = r.querySelector('#wbForget'); if (fg) fg.onclick = function () { delete state.scale; save(); wb.msg = null; drawSheet(); };
    var cp = r.querySelector('#wbCopy'); if (cp) cp.onclick = function () { try { navigator.clipboard.writeText('chrome://flags'); toast('Copied. Paste it in a new Chrome tab'); } catch (e) {} };
    var sh = r.querySelector('#wbShot'), fi = r.querySelector('#wbFile');
    if (sh) sh.onclick = function () { if (!hasAI()) { toast('Add your Gemini key in Settings → Visualization first'); return; } fi.click(); };
    if (fi) fi.onchange = function () { var f = fi.files[0]; if (f) blobToDataURL(f).then(readWeightShot); };
  }
  function shrinkImage(dataUrl, max) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () {
        var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .85));
      }; im.onerror = function () { res(dataUrl); }; im.src = dataUrl;
    });
  }
  function geminiImages(prompt, dataUrls, temp) {
    return Promise.all(dataUrls.map(function (u) { return shrinkImage(u, 1800); })).then(function (us) {
      var parts = us.map(function (u) { return { inline_data: { mime_type: 'image/jpeg', data: u.split(',')[1] } }; });
      parts.push({ text: prompt });
      return geminiCall({ contents: [{ parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: temp == null ? .1 : temp } });
    }).then(function (t) { return JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '')); });
  }
  function readWeightShot(dataUrl) {
    toast('Reading the screenshot…');
    geminiImages('This is a screenshot from a smart-scale app (like FitDays). Find the body weight reading and its date if shown. Reply JSON: {"weight": number in kg (convert from lb or jin if needed), "date": "YYYY-MM-DD" or null, "fat": body fat % or null}', [dataUrl]).then(function (r) {
      var kg = +r.weight; if (!kg || kg < 20 || kg > 250) { toast('Couldn’t find a weight in that picture'); return; }
      var key = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= dkey(new Date()) ? r.date : dkey(new Date());
      if (!confirm('Save ' + kg.toFixed(1) + ' kg for ' + new Date(key + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '?')) return;
      logWeight(kg, 'shot', key); if (ui.sheet) openSheet('weight'); toast('Saved ' + kg.toFixed(1) + ' kg');
    }).catch(function (e) { toast('AI: ' + (e.message || 'failed')); });
  }
  // a picture shared into the app: ask where it should go
  var pendingShare = null;
  function sharedPickSheet() {
    var h = '<p class="muted" style="margin:0">Where should this picture go?</p><div class="list">' +
      row({ t: '🌄 Vision board', sub: 'place it on a board', id: 'spVision' }) +
      row({ t: '🧾 Shop sales sheet', sub: 'add it to today’s sales statement', id: 'spShop' }) +
      row({ t: '📦 KSBCL bill', sub: 'stock in: add the bottles to your stock', id: 'spBill' }) +
      row({ t: '⚖ My weight', sub: 'read the weight from a FitDays screenshot', id: 'spWeight' }) + row({ t: '💸 My expense', sub: 'read a GPay / PhonePe payment', id: 'spMoney' }) + '</div>';
    if (pendingShare) h = '<img src="' + pendingShare + '" alt="" style="max-height:220px;object-fit:contain;border-radius:14px;align-self:center">' + h;
    return { title: 'Shared picture', cap: '', html: h, bind: function (r) {
      var go = function (fn) { var d = pendingShare; pendingShare = null; closeSheet(); fn(d); };
      r.querySelector('#spVision').onclick = function () { go(sharedToVision); };
      r.querySelector('#spShop').onclick = function () { go(function (d) { shopAddPhotos([d]); }); };
      r.querySelector('#spWeight').onclick = function () { go(readWeightShot); };
      r.querySelector('#spMoney').onclick = function () { go(readPayShot); };
      r.querySelector('#spBill').onclick = function () { go(function (d) { stockAddPhotos([d]); }); };
    } };
  }

  // ---------- Shop accounts: photo of the daily sales statement → editable sheet → close the day → monthly Excel ----------
  var SHCOLS = ['Item', 'Size', 'Opening', 'Received', 'Total', 'Sales', 'Rate', 'Amount', 'Closing', 'Remarks'];
  var SC = { item: 0, size: 1, open: 2, recv: 3, total: 4, sales: 5, rate: 6, amt: 7, close: 8, rem: 9 };
  var shopUi = { month: null }, sp = null;
  function shop() {
    var s2 = state.shop = state.shop || {};
    s2.name = s2.name || 'Laxmi Wines'; s2.days = s2.days || {}; s2.gloss = s2.gloss || {}; s2.fixes = s2.fixes || 0;
    return s2;
  }
  function shopDay(k, make) { var s2 = shop(); if (!s2.days[k] && make) s2.days[k] = { photos: [], grid: null, exp: [], status: 'new', at: new Date().toISOString() }; return s2.days[k]; }
  function inr(n, dec) { if (n == null || n === '' || isNaN(n)) return '—'; return (n < 0 ? '−' : '') + '₹' + Math.abs(Number(n)).toLocaleString('en-IN', { maximumFractionDigits: dec == null ? 0 : dec }); }
  function inrK(n) { if (!n) return '₹0'; var a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 100000 ? '₹' + (a / 100000).toFixed(2).replace(/\.?0+$/, '') + 'L' : a >= 1000 ? '₹' + (a / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '₹' + Math.round(a)); }

  // --- a small spreadsheet engine: A1 refs, ranges, + − × ÷ ^ %, comparisons and the usual functions ---
  function colName(c) { var s2 = ''; c++; while (c) { var m = (c - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; c = Math.floor((c - 1) / 26); } return s2; }
  function colNum(L) { var n = 0; for (var i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64); return n - 1; }
  function num(v) { if (typeof v === 'number') return v; if (v == null || v === '') return 0; var t = String(v).replace(/[,₹\s]/g, ''); if (t === '-' || t === '—') return 0; var n = parseFloat(t); return isNaN(n) ? 0 : n; }
  function isNum(v) { if (typeof v === 'number') return isFinite(v); var t = String(v == null ? '' : v).replace(/[,₹\s]/g, ''); return t !== '' && !isNaN(+t); }
  function cellVal(g, r, c, seen) {
    if (!g[r] || g[r][c] == null) return '';
    var raw = g[r][c];
    if (typeof raw === 'string' && raw.charAt(0) === '=') {
      var key = r + ',' + c; seen = seen || {}; if (seen[key]) return '#CYCLE';
      seen[key] = 1; try { var v = evalFormula(g, raw.slice(1), seen); delete seen[key]; return v; } catch (e) { delete seen[key]; return '#ERR'; }
    }
    if (isNum(raw)) return num(raw);
    return raw;
  }
  function evalFormula(g, src, seen) {
    var i = 0, s2 = src;
    var ws = function () { while (s2[i] === ' ') i++; };
    var peek = function (t) { ws(); return s2.substr(i, t.length).toUpperCase() === t; };
    var flat = function (a) { return [].concat.apply([], a.map(function (x) { return Array.isArray(x) ? flat(x) : [x]; })); };
    function primary() {
      ws(); var ch = s2[i];
      if (ch === '(') { i++; var v = cmp(); ws(); if (s2[i] === ')') i++; return v; }
      if (ch === '"') { var j = s2.indexOf('"', i + 1); var str = s2.slice(i + 1, j < 0 ? s2.length : j); i = j < 0 ? s2.length : j + 1; return str; }
      var m = /^[0-9]*\.?[0-9]+(e[+-]?\d+)?/i.exec(s2.slice(i)); if (m) { i += m[0].length; return parseFloat(m[0]); }
      m = /^\$?([A-Z]{1,2})\$?(\d+)(?::\$?([A-Z]{1,2})\$?(\d+))?/i.exec(s2.slice(i));
      var fm = /^([A-Z][A-Z0-9.]*)\s*\(/i.exec(s2.slice(i));
      if (fm) {
        i += fm[0].length; var args = []; ws();
        if (s2[i] !== ')') { do { args.push(cmp()); ws(); } while (s2[i] === ',' && ++i); }
        ws(); if (s2[i] === ')') i++;
        return fn(fm[1].toUpperCase(), args);
      }
      if (m) {
        i += m[0].length;
        var c1 = colNum(m[1].toUpperCase()), r1 = +m[2] - 1;
        if (!m[3]) return cellVal(g, r1, c1, seen);
        var c2 = colNum(m[3].toUpperCase()), r2 = +m[4] - 1, out = [];
        for (var r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (var c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(cellVal(g, r, c, seen));
        return out;
      }
      if (peek('TRUE')) { i += 4; return 1; } if (peek('FALSE')) { i += 5; return 0; }
      throw new Error('bad formula');
    }
    function postfix() { var v = primary(); ws(); while (s2[i] === '%') { i++; v = num(v) / 100; ws(); } return v; }
    function unary() { ws(); if (s2[i] === '-') { i++; return -num(unary()); } if (s2[i] === '+') { i++; return num(unary()); } return postfix(); }
    function pow() { var v = unary(); ws(); while (s2[i] === '^') { i++; v = Math.pow(num(v), num(unary())); ws(); } return v; }
    function mul() { var v = pow(); ws(); while (s2[i] === '*' || s2[i] === '/') { var op = s2[i++]; var b = pow(); v = op === '*' ? num(v) * num(b) : num(b) === 0 ? '#DIV/0' : num(v) / num(b); ws(); } return v; }
    function add() { var v = mul(); ws(); while (s2[i] === '+' || s2[i] === '-' || s2[i] === '&') { var op = s2[i++]; var b = mul(); v = op === '&' ? String(v) + String(b) : op === '+' ? num(v) + num(b) : num(v) - num(b); ws(); } return v; }
    function cmp() {
      var v = add(); ws(); var m = /^(<=|>=|<>|=|<|>)/.exec(s2.slice(i));
      if (!m) return v; i += m[0].length; var b = add(), x = isNum(v) && isNum(b) ? num(v) : String(v).toLowerCase(), y = isNum(v) && isNum(b) ? num(b) : String(b).toLowerCase();
      return { '=': x == y, '<>': x != y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[m[0]] ? 1 : 0;
    }
    function crit(c) {
      var m = /^(<=|>=|<>|=|<|>)?(.*)$/.exec(String(c)), op = m[1] || '=', val = m[2];
      return function (x) { var a = isNum(x) && isNum(val) ? num(x) : String(x).toLowerCase(), b = isNum(x) && isNum(val) ? num(val) : String(val).toLowerCase(); return { '=': a == b, '<>': a != b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op]; };
    }
    function fn(name, a) {
      var nums = function () { return flat(a).filter(isNum).map(num); };
      switch (name) {
        case 'SUM': return nums().reduce(function (x, y) { return x + y; }, 0);
        case 'AVERAGE': case 'AVG': var n1 = nums(); return n1.length ? n1.reduce(function (x, y) { return x + y; }, 0) / n1.length : '#DIV/0';
        case 'MIN': var n2 = nums(); return n2.length ? Math.min.apply(null, n2) : 0;
        case 'MAX': var n3 = nums(); return n3.length ? Math.max.apply(null, n3) : 0;
        case 'COUNT': return nums().length;
        case 'COUNTA': return flat(a).filter(function (x) { return x !== '' && x != null; }).length;
        case 'PRODUCT': return nums().reduce(function (x, y) { return x * y; }, 1);
        case 'ROUND': var p = Math.pow(10, num(a[1] || 0)); return Math.round(num(a[0]) * p) / p;
        case 'ROUNDUP': var p2 = Math.pow(10, num(a[1] || 0)); return Math.ceil(num(a[0]) * p2) / p2;
        case 'ROUNDDOWN': var p3 = Math.pow(10, num(a[1] || 0)); return Math.floor(num(a[0]) * p3) / p3;
        case 'INT': return Math.floor(num(a[0]));
        case 'ABS': return Math.abs(num(a[0]));
        case 'MOD': return num(a[0]) % num(a[1]);
        case 'SQRT': return Math.sqrt(num(a[0]));
        case 'POWER': return Math.pow(num(a[0]), num(a[1]));
        case 'IF': return num(a[0]) ? (a.length > 1 ? a[1] : 1) : (a.length > 2 ? a[2] : 0);
        case 'AND': return flat(a).every(function (x) { return num(x); }) ? 1 : 0;
        case 'OR': return flat(a).some(function (x) { return num(x); }) ? 1 : 0;
        case 'NOT': return num(a[0]) ? 0 : 1;
        case 'SUMIF': case 'COUNTIF':
          var rg = flat([a[0]]), test = crit(a[1]), sr = a[2] != null ? flat([a[2]]) : rg, tot = 0, cnt = 0;
          rg.forEach(function (x, k) { if (test(x)) { cnt++; tot += num(sr[k]); } });
          return name === 'SUMIF' ? tot : cnt;
        default: throw new Error('unknown function');
      }
    }
    var out = cmp(); return Array.isArray(out) ? out[0] : out;
  }
  function fmtCell(v) { if (typeof v === 'number') return Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v).toLocaleString('en-IN') : Number(v.toFixed(2)).toLocaleString('en-IN'); return v == null ? '' : String(v); }

  // --- the grid of a day ---
  function blankGrid() { var g = [SHCOLS.slice()]; for (var i = 0; i < 12; i++) g.push(SHCOLS.map(function () { return ''; })); return withTotalRow(g); }
  function withTotalRow(g) {
    g = g.filter(function (r) { return r[0] !== 'TOTAL'; });
    var n = g.length; var t = SHCOLS.map(function () { return ''; }); t[0] = 'TOTAL'; t[SC.sales] = '=SUM(F2:F' + n + ')'; t[SC.amt] = '=SUM(H2:H' + n + ')';
    g.push(t); return g;
  }
  function dataRows(g) { var out = []; for (var r = 1; r < g.length; r++) if (g[r][0] !== 'TOTAL') out.push(r); return out; }
  function rowKey(g, r) { return regKey(g[r][SC.item], g[r][SC.size]); }
  function daySales(d) { if (!d || !d.grid) return 0; var g = d.grid, t = 0; dataRows(g).forEach(function (r) { t += num(cellVal(g, r, SC.amt)); }); return t; }
  function prevDayKey(k) { var ks = Object.keys(shop().days).filter(function (x) { return x < k && shop().days[x].grid; }).sort(); return ks.pop(); }
  // checks: anything that doesn't add up turns red
  function shopChecks(k) {
    var d = shopDay(k), g = d && d.grid, bad = {}, msgs = [];
    if (!g) return { bad: bad, msgs: msgs };
    var pk = prevDayKey(k), prevClose = {};
    if (pk) { var pg = shop().days[pk].grid; dataRows(pg).forEach(function (r) { if (isNum(cellVal(pg, r, SC.close))) prevClose[rowKey(pg, r)] = num(cellVal(pg, r, SC.close)); }); }
    dataRows(g).forEach(function (r) {
      var v = function (c) { return cellVal(g, r, c); }, has = function (c) { var x = g[r][c]; return x !== '' && x != null; };
      var nm = (g[r][SC.item] || 'Row ' + (r + 1)) + (g[r][SC.size] ? ' ' + g[r][SC.size] : '');
      if (!has(SC.item) && !has(SC.open) && !has(SC.sales)) return;
      var o = num(v(SC.open)), rc = num(v(SC.recv)), sl = num(v(SC.sales)), rt = num(v(SC.rate)), am = num(v(SC.amt)), cl = num(v(SC.close));
      if (has(SC.total) && Math.abs(num(v(SC.total)) - (o + rc)) > .01) { bad[r + ',' + SC.total] = 1; msgs.push({ r: r, c: SC.total, t: '<b>' + esc(nm) + '</b>: total ' + fmtCell(num(v(SC.total))) + ' ≠ opening ' + o + ' + received ' + rc }); }
      if (has(SC.sales) && has(SC.rate) && has(SC.amt) && Math.abs(sl * rt - am) > .5) { bad[r + ',' + SC.amt] = 1; msgs.push({ r: r, c: SC.amt, t: '<b>' + esc(nm) + '</b>: ' + sl + ' × ' + rt + ' = ' + fmtCell(sl * rt) + ', but amount says ' + fmtCell(am) }); }
      if (has(SC.close) && has(SC.open) && Math.abs(o + rc - sl - cl) > .01) { bad[r + ',' + SC.close] = 1; msgs.push({ r: r, c: SC.close, t: '<b>' + esc(nm) + '</b>: ' + o + (rc ? ' + ' + rc : '') + ' − ' + sl + ' = ' + (o + rc - sl) + ', but closing says ' + cl }); }
      var pc = prevClose[rowKey(g, r)];
      if (pc != null && has(SC.open) && Math.abs(pc - o) > .01) { bad[r + ',' + SC.open] = 1; msgs.push({ r: r, c: SC.open, t: '<b>' + esc(nm) + '</b>: opening ' + o + ', but yesterday closed at ' + pc }); }
    });
    if (d.written && d.written.sales && Math.abs(daySales(d) - d.written.sales) > .5) msgs.push({ r: null, t: 'Amounts add up to <b>' + inr(daySales(d)) + '</b>, but the sheet’s written total is <b>' + inr(d.written.sales) + '</b>' });
    return { bad: bad, msgs: msgs };
  }

  // --- Shop tab ---
  function shopMonthDays(m) { var ds = shop().days; return Object.keys(ds).filter(function (k) { return k.slice(0, 7) === m; }).sort().reverse(); }
  function monthTotals(m) {
    var t = { sales: 0, profit: 0, exp: 0, net: 0, cash: 0, n: 0 };
    shopMonthDays(m).forEach(function (k) { var d = shop().days[k]; if (d.status !== 'closed') return; t.n++; t.sales += d.sales || 0; t.profit += d.profit || 0; t.exp += d.expTotal || 0; t.net += d.net || 0; t.cash += d.cash || 0; });
    return t;
  }
  function renderShop() {
    var s2 = shop(), tk = dkey(new Date()), m = shopUi.month || tk.slice(0, 7), mt = monthTotals(m), md = new Date(m + '-01T00:00:00');
    var h = '<div class="stack">' + topbar(esc(s2.name));
    h += '<div class="hero" style="background:' + T.jungle + ';color:#fff;gap:10px">' + sun(T.mango, 120, -34, -44) +
      '<div class="row between"><span class="cap">' + md.toLocaleDateString('en', { month: 'long', year: 'numeric' }) + ' · ' + mt.n + ' day' + (mt.n === 1 ? '' : 's') + ' closed</span><span class="row" style="gap:4px"><button type="button" class="nib sm shm" data-shm="-1" aria-label="Previous month">‹</button><button type="button" class="nib sm shm" data-shm="1" aria-label="Next month">›</button></span></div>' +
      '<div class="shtiles">' + [[inrK(mt.sales), 'sales'], [inrK(mt.profit), 'profit'], [inrK(mt.exp), 'expenses'], [inrK(mt.net), 'net']].map(function (x) { return '<div><b class="display">' + x[0] + '</b><small>' + x[1] + '</small></div>'; }).join('') + '</div></div>';
    if (queuedCount()) h += '<div class="notice">📶 ' + queuedCount() + ' photo set' + (queuedCount() > 1 ? 's' : '') + ' waiting for internet. They’re read automatically when you’re back online.</div>';
    h += '<div class="shbtns"><button type="button" class="btn coral" id="shAdd">📷 Sales sheet</button><button type="button" class="btn jungle" id="shBill">📦 Stock in (bill)</button></div>';
    h += '<input type="file" id="shFile" accept="image/*" multiple hidden><input type="file" id="shBillFile" accept="image/*" multiple hidden>';
    h += stockCardHtml();
    var na = newAlerts();
    var lastK = Object.keys(s2.days).filter(function (k) { return s2.days[k].grid; }).sort().pop();
    h += '<div class="shq">' + (lastK ? '<button type="button" data-sheet="shopcard:' + lastK + '"><span>🖼</span>Daily card</button>' : '') + '<button type="button" data-sheet="shopdash"><span>📊</span>Dashboard</button><button type="button" data-sheet="shoporder"><span>🛒</span>Order next</button><button type="button" data-sheet="shopchecks"' + (na ? ' class="hot"' : '') + '><span>' + (na ? na : '✓') + '</span>Checks</button></div>';
    var ks = shopMonthDays(m), bl = Object.keys(bills()).map(function (id) { return bills()[id]; }).filter(function (b) { return (b.date || '').slice(0, 7) === m; });
    if (bl.length) h += '<div class="list">' + bl.sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (b) {
      var st = { added: ['in stock', '#E3F0FF'], queued: ['no internet', '#F1E6D6'], pending: ['waiting', '#FFE6B8'], reading: ['reading…', '#FFE6B8'], dup: ['duplicate', '#FFD9D3'], draft: ['to check', '#FFE0D9'] }[b.status] || ['', '#fff'];
      return '<button type="button" class="r" data-bill="' + b.id + '"><span class="t">' + new Date(b.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · KSBCL bill<small>' + (b.items.length ? b.items.reduce(function (a, it) { return a + it.cases; }, 0) + ' cases · ' + billBottles(b) + ' bottles' + (b.invoiceValue ? ' · ' + inr(b.invoiceValue) : '') : b.photos.length + ' photos') + '</small></span><span class="tkpill" style="background:' + st[1] + '">' + st[0] + '</span>' + CHEV + '</button>';
    }).join('') + '</div>';
    if (!ks.length) h += '<p class="muted" style="margin:0">No days yet. Take photos of today’s Statement of Sales (all pages) and tap <b>Today’s sheet</b>. The app reads the handwriting into a sheet you can check and fix.</p>';
    else h += '<div class="list">' + ks.map(function (k) {
      var d = s2.days[k], st = d.status === 'closed' ? ['closed', '#CDEFEA'] : d.status === 'reading' ? ['reading…', '#FFE6B8'] : d.status === 'queued' ? ['waiting', '#F1E6D6'] : d.grid ? ['to check', '#FFE0D9'] : ['photos only', '#F1E6D6'];
      return '<button type="button" class="r" data-shday="' + k + '"><span class="t">' + new Date(k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '<small>' + (d.status === 'closed' ? 'sales ' + inr(d.sales) + ' · net ' + inr(d.net) : d.grid ? 'sales ' + inr(daySales(d)) + ' so far' : d.photos.length + ' photo' + (d.photos.length === 1 ? '' : 's')) + '</small></span><span class="tkpill" style="background:' + st[1] + '">' + st[0] + '</span>' + CHEV + '</button>';
    }).join('') + '</div>';
    h += '<div class="list">' + row({ t: '🏷 Your items', sub: regAll().length + ' items' + ((s2.askq || []).length ? ' · <b>' + s2.askq.length + ' to confirm</b>' : ' · his short names, stock, margins'), sheet: 'shopitems' }) + row({ t: '📦 Past KSBCL indents', sub: Object.keys(s2.indents || {}).length ? Object.keys(s2.indents).length + ' indents · used for costs' : 'upload them: your real stock and latest costs', sheet: 'shopindent' }) + row({ t: '📋 KSBCL name list', sub: PL && PL.asOf ? fmtN(PL.items.length) + ' names · as on ' + new Date(PL.asOf + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'the supplier-wise list: used only for exact names', sheet: 'shopprices' }) + row({ t: '📊 Month file', sub: 'share ' + md.toLocaleDateString('en', { month: 'long' }) + ' as Excel or PDF', sheet: 'shopmonth:' + m }) + row({ t: '📚 Teach from old sheets', sub: teachSub(), sheet: 'shopteach' }) + row({ t: '🧠 Learning your handwriting', sub: Object.keys(s2.gloss).length + ' words learnt · ' + s2.fixes + ' corrections', sheet: 'shoplearn' }) + row({ t: 'Shop settings', sub: 'name, usual profit %', sheet: 'shopset' }) + '</div>';
    if (!hasAI()) h += '<div class="notice">Reading photos needs your free Gemini key (Settings → Visualization). Without it you can still type the sheet in.</div>';
    return h + '</div>';
  }
  function bindShop(view) {
    if (!PL) loadPL().then(function () { if (ui.tab === 'shop' && !ui.sheet) render(); });
    view.querySelectorAll('[data-shm]').forEach(function (b) { b.onclick = function () { var d = new Date((shopUi.month || dkey(new Date()).slice(0, 7)) + '-01T00:00:00'); d.setMonth(d.getMonth() + +b.dataset.shm); shopUi.month = dkey(d).slice(0, 7); render(); }; });
    var fi = view.querySelector('#shFile');
    view.querySelector('#shAdd').onclick = function () { openSheet('shoppick'); };
    var bf = view.querySelector('#shBillFile');
    view.querySelector('#shBill').onclick = function () { bf.click(); };
    bf.onchange = function () { var fs = [].slice.call(bf.files); if (!fs.length) return; Promise.all(fs.map(blobToDataURL)).then(stockAddPhotos); bf.value = ''; };
    view.querySelectorAll('[data-bill]').forEach(function (b) { b.onclick = function () { openBill(b.dataset.bill); }; });
    fi.onchange = function () { var fs = [].slice.call(fi.files); if (!fs.length) return; var pk = shopUi.pickKey || dkey(new Date()); shopUi.pickKey = null; Promise.all(fs.map(blobToDataURL)).then(function (us) { shopAddPhotos(us, pk); }); fi.value = ''; };
    view.querySelectorAll('[data-shday]').forEach(function (b) { b.onclick = function () { openShopDay(b.dataset.shday); }; });
  }
  function shopAddPhotos(urls, key) {
    key = key || (sp && sp.k) || dkey(new Date());
    var d = shopDay(key, true);
    Promise.all(urls.map(function (u) { return shrinkImage(u, 2000); })).then(function (us) {
      return Promise.all(us.map(function (u, i) { var id = 'sp' + Date.now().toString(36) + i; d.photos.push(id); return idbPut('shopimg-' + id, u); }));
    }).then(function () {
      save(); if (!sp || sp.k !== key) openShopDay(key); else drawShopDay();
      if (hasAI() && !navigator.onLine) { d.status = 'queued'; save(); drawShopDay(); toast('Saved. It’s read as soon as you’re back online'); }
      else if (hasAI()) shopRead(key); else { if (!d.grid) { d.grid = blankGrid(); save(); } drawShopDay(); }
    }).catch(function (e) { toast('Couldn’t save the photos: ' + (e.message || e)); });
  }
  function shopPhotos(d) { return Promise.all(d.photos.map(function (id) { return idbGet('shopimg-' + id).catch(function () { return null; }); })).then(function (a) { return a.filter(Boolean); }); }
  // read the handwriting with Gemini, using what it has learnt
  function shopRead(key) {
    var d = shopDay(key, true), s2 = shop();
    d.status = 'reading'; save(); if (sp && sp.k === key) drawShopDay();
    var prompt = 'These photos are the pages of one day’s handwritten "Statement of Sales" from a liquor shop in Karnataka, India (Laxmi Wines). Read every filled row carefully.\n' +
      'Columns on the form: Type of Liquors (brand + size), Opening Balance, Stock Received, Total, Sales, Rate, Amount (Rs.), Closing Balance, Remarks.\n' +
      'Each numbered row (Sl. No.) on the form is ONE row in your answer: same order, never merge, split, skip or invent rows. The "Type of Liquor" column has a handwritten brand name and, at its right end, the bottle size in ml (60, 90, 180, 275, 330, 375, 500, 650, 750, 1000, 2000). Copy the size exactly as written: 60 is common, never change it to 90. Put the size in "size", never inside "item".\n' +
      'A row with ONLY a size (no name) is the same brand as the nearest row above it that has a name: repeat that brand. A row with its OWN handwritten name is a NEW brand, however short or abbreviated (like "RC W", "R Stg", "BCD", "N.P."): write that name, never the brand from above. Names can also be in Kannada. A price like 650 or 330 written next to a beer can be its size; anything else goes in "remarks".\n' +
      'A dash "-" or "—" in a number column means 0. Skip rows with no numbers at all. Keep numbers exactly as written; do not correct the maths.\n' +
      'Some pages also have a list of expenses (names with amounts, usually with a total) and written day totals like "Sale 74085", "Exp 9850" and a balance. Return those too.\n' +
      shopHints() +
      'Also read the date written on the sheet (Indian day/month/year order) as "date": "YYYY-MM-DD", or null if none.\n' +
      'For every row that has its OWN handwritten brand name, also give "box": where that handwritten NAME is on its photo, as [ymin, xmin, ymax, xmax] scaled 0–1000, and "page": which of the new photos it is on (0 = the first new photo). Rows without their own name: "box": null.\n' +
      'Reply JSON: {"date":"YYYY-MM-DD"|null,"rows":[{"sl":1,"item":"brand","box":[120,40,160,300],"page":0,"size":"750","open":number|null,"recv":number|null,"total":number|null,"sales":number|null,"rate":number|null,"amount":number|null,"close":number|null,"remarks":"text"}],"expenses":[{"name":"text","amount":number}],"written":{"sales":number|null,"expenses":number|null,"balance":number|null}}';
    shopPhotos(d).then(function (imgs) {
      if (!imgs.length) throw new Error('no photos');
      return geminiImagesEx(prompt, imgs, .1);
    }).then(function (r) {
      var g = [SHCOLS.slice()], fixed = 0, boxes = {};
      (r.rows || []).forEach(function (x, xi) {
        if (x && Array.isArray(x.box) && x.box.length === 4 && String(x.item || '').trim() && x.box[2] > x.box[0] && x.box[3] > x.box[1]) boxes[xi + 1] = { p: +x.page || 0, b: x.box.map(Number) };
        var ss = splitSize(x.item, x.size), item = ss[0]; x.size = ss[1];
        var nv2 = function (v) { return v == null || v === '' ? '' : String(v); };
        var row2 = [item, nv2(x.size), nv2(x.open), nv2(x.recv), nv2(x.total), nv2(x.sales), nv2(x.rate), nv2(x.amount), nv2(x.close), nv2(x.remarks)];
        g.push(row2);
      });
      if (g.length < 2) g.push(SHCOLS.map(function () { return ''; }));
      var aiRows = g.map(function (rw) { return rw.slice(); });
      fillDownNames(g);
      d.grid = withTotalRow(g); d.ai = withTotalRow(aiRows);
      dataRows(d.grid).forEach(function (rr) { var gk = String(d.grid[rr][SC.item] || '').trim().toLowerCase(); if (gk && s2.gloss[gk]) { d.grid[rr][SC.item] = s2.gloss[gk].to; fixed++; } });
      var cy = regAssign(key);
      d.exp = (r.expenses || []).filter(function (e) { return e && (e.name || e.amount); }).map(function (e) { return { t: String(e.name || ''), v: num(e.amount) }; });
      d.written = r.written || {}; d.status = 'draft';
      d.sheetDate = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date !== key && r.date <= dkey(new Date()) ? r.date : null;
      d.boxes = boxes; d.ink = {}; d.inkm = null; save();
      inkProcess(key).catch(function () {});
      applyPendingBills(key);
      if (sp && sp.k === key) { sp.view = 'list'; sp.step = 'sheet'; drawShopDay(); }
      var ck = shopChecks(key);
      toast('Read ' + (d.grid.length - 2) + ' rows' + (ck.msgs.length ? ' · ' + ck.msgs.length + ' to check' : '') + (cy && cy.n ? ' · ' + cy.n + ' matched to your items' : fixed ? ' · ' + fixed + ' names auto-fixed' : ''));
      if (ui.tab === 'shop') render();
    }).catch(function (e) {
      if (isNetErr(e) && !d.grid) { d.status = 'queued'; save(); if (sp && sp.k === key) drawShopDay(); if (ui.tab === 'shop') render(); toast('No internet: the photos wait and are read when you’re back online'); return; }
      d.status = d.grid ? 'draft' : 'new'; if (!d.grid) d.grid = blankGrid(); save();
      if (sp && sp.k === key) drawShopDay();
      toast('Reading failed: ' + (e.message || 'AI error') + '. You can type it in or tap Read again.');
    });
  }

  // ---------- Stock in: read a KSBCL bill, turn cases into bottles, add them to the day's Received column ----------
  var bp = null;
  function bills() { var s2 = shop(); s2.bills = s2.bills || {}; s2.map = s2.map || {}; s2.items = s2.items || {}; s2.alias = s2.alias || {}; return s2.bills; }
  function normName(t) { return String(t || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9ಀ-೿]+/g, ' ').trim(); }
  function itemKey(item, size) { return normName(item).replace(/ /g, '') + '|' + String(size || '').replace(/[^0-9]/g, ''); }
  // every item the shop sells: names from the sales sheets plus anything that arrived on a bill
  function shopItems() {
    var s2 = shop(), out = {}; bills();
    Object.keys(s2.items).forEach(function (k) { out[k] = s2.items[k]; });
    Object.keys(s2.days).sort().forEach(function (k) { var g = s2.days[k].grid; if (g) dataRows(g).forEach(function (r) { var it = String(g[r][SC.item] || '').trim(); if (!it) return; var key = regKey(it, g[r][SC.size]); if (!out[key]) out[key] = { item: it, size: String(g[r][SC.size] || '').replace(/[^0-9]/g, '') }; }); });
    return out;
  }
  // stock now = closing on the latest sheet + bills that haven't reached a sheet yet
  function stockNow() {
    regSync(); var s2 = shop(), st = {}, items = shopItems(), last = null;
    Object.keys(s2.days).sort().forEach(function (k) { if (s2.days[k].grid) last = k; });
    Object.keys(items).forEach(function (key) { st[key] = { item: items[key].item, size: items[key].size, qty: 0, inToday: 0, known: false }; });
    Object.keys(s2.days).sort().forEach(function (dk) { if (dk === last) return; var g0 = s2.days[dk].grid; if (!g0) return; dataRows(g0).forEach(function (r) { var n = String(g0[r][SC.item] || '').trim(); if (!n) return; var key = regKey(n, g0[r][SC.size]); if (!st[key]) return; var cv = cellVal(g0, r, SC.close); if (isNum(cv) && String(g0[r][SC.close]).trim() !== '') { st[key].qty = num(cv); st[key].known = true; } }); });
    if (last) { var g = s2.days[last].grid; dataRows(g).forEach(function (r) { var key = regKey(g[r][SC.item], g[r][SC.size]); if (!st[key]) return; var cv = cellVal(g, r, SC.close), o2 = cellVal(g, r, SC.open);
        if (isNum(cv) && String(g[r][SC.close]).trim() !== '') { st[key].qty = num(cv); st[key].known = true; }
        else if (isNum(o2)) { st[key].qty = num(o2) + num(cellVal(g, r, SC.recv)) - num(cellVal(g, r, SC.sales)); st[key].known = true; } }); }
    var tk = dkey(new Date());
    Object.keys(bills()).forEach(function (no) {
      var b = s2.bills[no]; if (b.status !== 'pending' && b.status !== 'added') return;
      (b.items || []).forEach(function (it) {
        var key = resolveKey(it.key); if (!key || !st[key]) return;
        if (b.status === 'pending' || (b.applied && b.applied > (last || ''))) st[key].qty += it.bottles;
        if (b.date === tk) st[key].inToday += it.bottles;
      });
    });
    return { list: Object.keys(st).map(function (k) { st[k].key = k; return st[k]; }), asOf: last };
  }
  function stockCardHtml() {
    var sn = stockNow(), list = sn.list.filter(function (x) { return x.qty || x.inToday; });
    if (!list.length) return '';
    var tot = list.reduce(function (a, x) { return a + x.qty; }, 0);
    list.sort(function (a, b) { return (b.inToday - a.inToday) || (a.qty - b.qty); });
    return '<div class="card stack shstock" style="gap:6px"><div class="row between"><b style="font-size:15px">Stock now</b><span class="cap">' + fmtN(tot) + ' bottles · ' + list.length + ' items</span></div>' +
      list.slice(0, 4).map(function (x) { return '<div class="shsrow"><span class="t"><b>' + esc(x.item) + '</b> ' + (x.size ? x.size + ' ml' : '') + '</span>' + (x.inToday ? '<span class="tkpill ok">+' + x.inToday + ' today</span>' : x.qty <= 6 ? '<span class="tkpill open">low</span>' : '') + '<b class="q">' + fmtN(x.qty) + '</b></div>'; }).join('') +
      '<button type="button" class="link" data-sheet="shopstock" style="align-self:flex-start">See all stock →</button></div>';
  }
  function shopStockSheet() {
    var sn = stockNow(), list = sn.list.slice().sort(function (a, b) { return a.item.localeCompare(b.item) || (+b.size - +a.size); }), q = (shopUi.sq || '').toLowerCase();
    var h = '<input class="text" id="ssq" placeholder="Search a brand…" value="' + esc(shopUi.sq || '') + '">';
    h += '<div class="list">' + list.filter(function (x) { return !q || x.item.toLowerCase().indexOf(q) >= 0; }).map(function (x) {
      return '<div class="r"><span class="t">' + esc(x.item) + '<small>' + (x.size ? x.size + ' ml' : '') + (x.known ? '' : ' · from bills only') + (x.inToday ? ' · +' + x.inToday + ' today' : '') + '</small></span><span class="v strong">' + fmtN(x.qty) + '</span></div>';
    }).join('') + '</div>';
    h += '<p class="muted small">Closing balance on your latest sheet' + (sn.asOf ? ' (' + new Date(sn.asOf + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ')' : '') + ', plus bills not yet on a sheet.</p>';
    return { title: 'Stock now', cap: list.length + ' items', html: h, bind: function (r) { var i = r.querySelector('#ssq'); i.addEventListener('input', function () { shopUi.sq = i.value; var pos = i.selectionStart; drawSheet(); var j = document.getElementById('ssq'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } }); } };
  }

  // --- read a bill ---
  function stockAddPhotos(urls) {
    var id = 'b' + Date.now().toString(36);
    var b = { id: id, no: '', date: dkey(new Date()), photos: [], items: [], status: 'reading', at: new Date().toISOString() };
    bills()[id] = b;
    Promise.all(urls.map(function (u) { return shrinkImage(u, 2000); })).then(function (us) {
      return Promise.all(us.map(function (u, i) { var pid = 'bp' + Date.now().toString(36) + i; b.photos.push(pid); return idbPut('shopimg-' + pid, u); }));
    }).then(function () { save(); openBill(id); if (hasAI() && !navigator.onLine) { b.status = 'queued'; save(); drawBill(); toast('Saved. It’s read when you’re back online'); } else if (hasAI()) billRead(id); else { b.status = 'draft'; save(); drawBill(); toast('Add your Gemini key to read bills'); } })
      .catch(function (e) { toast('Couldn’t save the photos: ' + (e.message || e)); });
  }
  function billRead(id) {
    var b = bills()[id], s2 = shop(); regSync(); var items = shopItems();
    b.status = 'reading'; save(); if (bp && bp.id === id) drawBill();
    var names = regAll().map(function (x) { return x.item + (x.size ? ' ' + x.size : ''); });
    var prompt = 'These photos are the pages of one computer-printed KSBCL (Karnataka State Beverages Corporation) "Bill Of Invoice" for a liquor shop. Read it exactly.\n' +
      'For each line item return: the full item name as printed (without the pack code in brackets), size in ml, the pack text (like "180MLx48Btls"), bottles per case (the number before "Btls" in the pack text, e.g. 48), CBs (cases), Btls (loose bottles), rate per case, amount.\n' +
      'Also return the invoice number, the invoice date (YYYY-MM-DD), the item total (the "Total" amount), the invoice value, and the total number of cases.\n' +
      (names.length ? 'The shop writes these item names on its own daily sales sheet (often abbreviated): ' + names.slice(0, 200).join('; ') + '.\nFor each bill item, give "match": the exact sheet name from that list that is the same brand and size, or null if none is clearly the same product.\n' : 'Set "match" to null for every item.\n') +
      'Reply JSON: {"invoice":"SVPT…","date":"YYYY-MM-DD","items":[{"name":"text","ml":180,"pack":"180MLx48Btls","perCase":48,"cases":1,"loose":0,"rate":5869.6,"amount":5869.6,"match":"sheet name or null"}],"itemTotal":number,"invoiceValue":number,"totalCases":number}';
    Promise.all(b.photos.map(function (p) { return idbGet('shopimg-' + p); })).then(function (imgs) { return geminiImages(prompt, imgs.filter(Boolean), .1); }).then(function (r) {
      var no = String(r.invoice || '').trim();
      // the same bill can't be added twice
      var dup = no && Object.keys(bills()).filter(function (k) { return k !== id && bills()[k].no === no && bills()[k].status !== 'draft' && bills()[k].status !== 'reading'; })[0];
      b.no = no; b.date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : b.date;
      b.itemTotal = num(r.itemTotal); b.invoiceValue = num(r.invoiceValue); b.totalCases = num(r.totalCases);
      var byName = {}; Object.keys(items).forEach(function (k) { byName[(items[k].item + (items[k].size ? ' ' + items[k].size : '')).toLowerCase()] = k; });
      b.items = (r.items || []).map(function (x) {
        var ml = String(x.ml || '').replace(/[^0-9]/g, ''), per = num(x.perCase) || num((/x\s*(\d+)\s*b/i.exec(x.pack || '') || [])[1]) || 0;
        var it = { name: String(x.name || '').trim(), ml: ml, per: per, cases: num(x.cases), loose: num(x.loose), rate: num(x.rate), amount: num(x.amount) };
        it.bottles = it.cases * it.per + it.loose;
        var mapped = resolveKey(s2.map[normName(it.name) + '|' + ml]), short = shortBillName(it.name);
        var exact = regAll().filter(function (y) { return y.size === ml && (normName(y.item) === normName(short) || (y.full && normName(y.full) === normName(it.name))); })[0];
        if (mapped && regItem(mapped)) it.key = mapped;
        else if (exact) it.key = exact.key;
        else {
          // not sure: ask before making a new item
          var c = regCands(short, ml, 3).map(function (y) { return y.key; }), ai = x.match ? regAll().filter(function (y) { return normName(y.item + ' ' + y.size) === normName(x.match) || (normName(y.item) === normName(String(x.match).replace(/\s*\d+\s*(ml)?$/i, '')) && y.size === ml); })[0] : null;
          if (ai && c.indexOf(ai.key) < 0) c.unshift(ai.key); else if (ai) { c.splice(c.indexOf(ai.key), 1); c.unshift(ai.key); }
          it.key = null; it.ask = c.length ? c.slice(0, 3) : null; it.ans = null;
        }
        return it;
      });
      b.status = dup ? 'dup' : 'draft'; b.dupOf = dup || null; save();
      if (bp && bp.id === id) drawBill();
      if (dup) toast('This bill (' + no + ') was already added'); else toast('Read ' + b.items.length + ' items · ' + billBottles(b) + ' bottles');
    }).catch(function (e) { if (isNetErr(e) && !b.items.length) { b.status = 'queued'; save(); if (bp && bp.id === id) drawBill(); toast('No internet: the bill waits'); return; } b.status = 'draft'; save(); if (bp && bp.id === id) drawBill(); toast('Reading failed: ' + (e.message || 'AI error')); });
  }
  // "Original Choice Deluxe Whisky-Aseptic Brick Pack (40%)" → "Original Choice Deluxe Whisky"
  function shortBillName(t) { return String(t || '').replace(/\(.*?\)/g, ' ').replace(/\s*[-–]\s*(aseptic|tetra|brick|pet|can|glass|pack)\b.*$/i, '').replace(/\s+(aseptic|tetra)\s.*$/i, '').replace(/\s+/g, ' ').trim() || t; }
  function billAsks(b) { return (b.items || []).filter(function (it) { return it.ask && it.ans == null; }).length; }
  function billBottles(b) { return (b.items || []).reduce(function (a, it) { return a + (it.bottles || 0); }, 0); }
  function openBill(id) { resetOverlay(); closeSheet(); bp = { id: id, view: 'items', step: 1, ph: 0, zoom: 1 }; drawBill(); showOverlay('spo'); }
  function closeBill() { bp = null; closeOverlayEl(); if (ui.tab === 'shop') render(); }
  function drawBill() {
    var o = document.getElementById('overlay'), b = bills()[bp.id], items = shopItems(), keep = o.scrollTop;
    if (!b) { closeBill(); return; }
    var h = '<div class="inner shd"><div class="row between"><button type="button" class="btn ghost small" id="bpBack">‹ Shop</button><span class="cap">KSBCL bill · ' + b.photos.length + ' photo' + (b.photos.length === 1 ? '' : 's') + '</span><button type="button" class="btn ghost small" id="bpDel">Delete</button></div>';
    h += '<h1 class="display" style="font-size:30px;margin:0;line-height:1.05">' + (bp.step === 2 ? 'Add to stock' : 'Stock in') + '<br><span class="lite" style="font-size:20px">' + esc(b.no || 'bill') + ' · ' + new Date(b.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '</span></h1>';
    if (b.status === 'queued') h += '<div class="notice">📶 <b>Waiting for internet.</b> The bill is read automatically when you’re back online.</div>';
    if (b.status === 'reading') h += '<div class="shreading"><span class="wpulse"></span><b>Reading the bill…</b><span class="muted small">usually 15–40 seconds</span></div>';
    if (b.status === 'dup') h += '<div class="notice">This bill was already added to stock on ' + new Date(bills()[b.dupOf].applied ? bills()[b.dupOf].applied + 'T00:00:00' : bills()[b.dupOf].at).toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '. Delete this copy, or open the first one.</div>';
    if (b.status === 'added') h += '<div class="notice ok">✓ Added to stock on the ' + new Date(b.applied + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' sheet.</div>';
    if (b.status === 'pending') h += '<div class="notice">Waiting for the ' + new Date(b.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' sales sheet. The bottles are added as soon as that sheet is read.</div>';
    if (bp.step === 1) {
      h += '<div class="seg2 shseg" role="tablist">' + [['photo', 'Photo'], ['both', 'Both'], ['items', 'Items']].map(function (v) { return '<button type="button" role="tab" data-bpv="' + v[0] + '" aria-selected="' + (bp.view === v[0]) + '">' + v[1] + '</button>'; }).join('') + '</div>';
      if (bp.view !== 'items') h += '<div class="shphoto' + (bp.view === 'photo' ? ' big' : '') + '"><img id="bpImg" alt="Bill photo" style="width:' + bp.zoom * 100 + '%"></div><div class="row between shphbar"><span class="row" style="gap:4px">' + (b.photos.length > 1 ? '<button type="button" class="nib" data-bph="-1">‹</button><span class="cap">' + (bp.ph + 1) + ' / ' + b.photos.length + '</span><button type="button" class="nib" data-bph="1">›</button>' : '') + '</span><span class="row" style="gap:4px"><button type="button" class="nib" id="bpZo">−</button><button type="button" class="nib" id="bpZi">+</button></span></div>';
      if (bp.view !== 'photo') {
        var regs = regAll(), opts = regs.map(function (x) { return x.key; }).sort(function (a, c) { return regItem(a).item.localeCompare(regItem(c).item); });
        h += '<div class="stack" style="gap:8px">' + b.items.map(function (it, i) {
          var nw = !it.key, q2 = it.ask && it.ans == null;
          if (q2) {
            var st0 = regStock();
            return '<div class="bitem ask"><span class="cap">On the KSBCL bill</span><b>' + esc(it.name) + ' <span class="muted">' + it.ml + ' ml</span></b><span class="muted small">' + it.cases + ' case' + (it.cases === 1 ? '' : 's') + ' · ' + it.bottles + ' bottles</span><span class="cap" style="margin-top:6px">Is it this item from your sheet?</span><div class="askb">' + it.ask.map(function (k) { var x = regItem(k); if (!x) return ''; var al = Object.keys(x.alias || {}).slice(0, 2), sk = st0[resolveKey(k)]; return '<button type="button" data-bq="' + i + '" data-bk2="' + esc(k) + '"><b>' + esc(x.item) + ' ' + esc(x.size) + '</b><small>' + (al.length ? 'he writes ' + al.map(esc).join(', ') + ' · ' : '') + (sk ? sk.qty + ' in stock' : 'on your sheets') + '</small></button>'; }).join('') + '<button type="button" data-bq="' + i + '" data-bk2="__new"><b>No, it’s new</b><small>add it to your items under the bill name</small></button></div></div>';
          }
          return '<div class="bitem' + (nw ? ' new' : '') + '"><div class="row between" style="align-items:flex-start;gap:8px"><b>' + esc(it.name) + ' <span class="muted">' + it.ml + ' ml</span></b><span class="muted small" style="white-space:nowrap">' + inr(it.amount, 2) + '</span></div>' +
            '<div class="row bmath"><input data-bi="' + i + '" data-bk="cases" inputmode="numeric" value="' + it.cases + '"><span>case' + (it.cases === 1 ? '' : 's') + ' ×</span><input data-bi="' + i + '" data-bk="per" inputmode="numeric" value="' + it.per + '"><span>+</span><input data-bi="' + i + '" data-bk="loose" inputmode="numeric" value="' + it.loose + '"><span>=</span><b class="bbt" id="bbt' + i + '">' + it.bottles + ' bottles</b></div>' +
            '<label class="bmatch">→ <select data-bm="' + i + '"><option value="">➕ New item: ' + esc(shortBillName(it.name)) + ' ' + it.ml + '</option>' + opts.map(function (k) { var x = regItem(k); return '<option value="' + esc(k) + '"' + (k === resolveKey(it.key) ? ' selected' : '') + '>' + esc(x.item) + (x.size ? ' ' + x.size : '') + '</option>'; }).join('') + '</select></label>' +
            (nw ? '<span class="small" style="color:#B3372B">New item: it will be added to your items under this name</span>' : it.ans === 'y' && regItem(it.key) && normName(regItem(it.key).item) !== normName(shortBillName(it.name)) ? '<span class="small" style="color:#0F7A6E">From tomorrow “' + esc(regItem(it.key).item) + '” shows as “' + esc(shortBillName(it.name)) + '”; his short name stays linked</span>' : '') + '</div>';
        }).join('') + '</div>';
        var cases = b.items.reduce(function (a, it) { return a + it.cases; }, 0), amt = b.items.reduce(function (a, it) { return a + it.amount; }, 0);
        if (b.items.length) h += '<div class="notice' + (b.itemTotal && Math.abs(amt - b.itemTotal) < 1 ? ' ok' : '') + '">' + b.items.length + ' items · <b>' + cases + ' cases · ' + billBottles(b) + ' bottles</b> · items add up to ' + inr(amt, 2) + (b.itemTotal ? (Math.abs(amt - b.itemTotal) < 1 ? ' ✓ same as the bill' : ' ⚠ the bill says ' + inr(b.itemTotal, 2)) : '') + (b.invoiceValue ? ' (' + inr(b.invoiceValue, 2) + ' with TCS)' : '') + (b.totalCases && b.totalCases !== cases ? ' · ⚠ bill says ' + b.totalCases + ' cases' : '') + '</div>';
      }
      h += '<div class="row" style="gap:10px">' + (hasAI() ? '<button type="button" class="btn line small" id="bpRead">↻ Read again</button>' : '') + '<button type="button" class="btn coral" style="flex:1" id="bpNext"' + (b.items.length && b.status !== 'dup' && b.status !== 'reading' && !billAsks(b) ? '' : ' disabled') + '>' + (b.status === 'added' ? 'See where it went →' : billAsks(b) ? 'Answer ' + billAsks(b) + ' question' + (billAsks(b) > 1 ? 's' : '') + ' first' : 'Next →') + '</button></div>';
    } else h += billStep2Html(b, items);
    o.innerHTML = h + '</div>'; o.scrollTop = keep;
    bindBill(o, b);
  }
  function billStep2Html(b, items) {
    var tgt = bp.target || b.date, d = shopDay(tgt), g = d && d.grid, rowsByKey = {};
    if (g) dataRows(g).forEach(function (r) { rowsByKey[regKey(g[r][SC.item], g[r][SC.size])] = r; });
    var h = '<div class="shf"><div><span class="lab">Goes into the <b>Received</b> column of</span><small>' + (g ? 'that day’s sales sheet' : 'no sheet for that day yet: it waits for it') + '</small></div><input type="date" class="tkdate" id="bpDate" value="' + tgt + '"' + (b.status === 'added' ? ' disabled' : '') + '></div>';
    h += '<div class="shmtab"><table><thead><tr><th>Item</th><th>Size</th><th>Open</th><th>Recv</th><th>Total</th></tr></thead><tbody>' + b.items.map(function (it) {
      var key = it.key ? resolveKey(it.key) : regKey(shortBillName(it.name), it.ml), nm = it.key && regItem(it.key) ? regItem(it.key).item : shortBillName(it.name), r = g ? rowsByKey[key] : null;
      var op = r != null ? num(cellVal(g, r, SC.open)) : 0, rc = r != null ? num(cellVal(g, r, SC.recv)) : 0;
      if (b.status === 'added') rc -= it.bottles;
      return '<tr><td style="text-align:left">' + esc(nm) + (it.key ? '' : ' <span class="tkpill open">new</span>') + '</td><td>' + it.ml + '</td><td>' + op + '</td><td class="plus">+' + it.bottles + '</td><td class="plus">' + (op + rc + it.bottles) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    var learnt = b.items.filter(function (it) { return it.key && regItem(it.key) && normName(regItem(it.key).item) !== normName(shortBillName(it.name)); }).map(function (it) { return '“' + esc(regItem(it.key).item) + '” = ' + esc(shortBillName(it.name)); });
    var nw = b.items.filter(function (it) { return !it.key; });
    if (learnt.length || nw.length) h += '<div class="card stack" style="gap:6px"><span class="cap">Learnt from this bill</span><span style="font-size:13px;line-height:1.5">' + learnt.slice(0, 8).join(' · ') + (nw.length ? (learnt.length ? '<br>' : '') + 'New on your list: ' + nw.map(function (it) { return esc(it.name) + ' ' + it.ml; }).join(', ') : '') + '. The handwriting reader now knows these names.</span></div>';
    h += '<p class="muted small">Each bill number is saved once, so the same bill can’t be added twice.</p>';
    h += '<div class="row" style="gap:10px"><button type="button" class="btn line" id="bpBack2">‹ Items</button>' + (b.status === 'added' ? '<button type="button" class="btn jungle" style="flex:1" id="bpOpenDay">Open that sheet</button>' : '<button type="button" class="btn coral" style="flex:1" id="bpAdd">Add ' + billBottles(b) + ' bottles to stock</button>') + '</div>';
    return h;
  }
  function bindBill(o, b) {
    var q = function (x) { return o.querySelector(x); };
    q('#bpBack').onclick = closeBill;
    q('#bpDel').onclick = function () {
      if (b.status === 'added' && !confirm('This bill is already in stock. Delete it and take its bottles back out of the sheet?')) return;
      if (b.status !== 'added' && !confirm('Delete this bill?')) return;
      if (b.status === 'added') billUnapply(b);
      b.photos.forEach(function (p) { idbDel('shopimg-' + p).catch(function () {}); }); delete bills()[b.id]; save(); closeBill();
    };
    o.querySelectorAll('[data-bpv]').forEach(function (x) { x.onclick = function () { bp.view = x.dataset.bpv; drawBill(); }; });
    var img = q('#bpImg'); if (img && b.photos.length) idbGet('shopimg-' + b.photos[bp.ph]).then(function (u) { if (u) img.src = u; });
    o.querySelectorAll('[data-bph]').forEach(function (x) { x.onclick = function () { bp.ph = (bp.ph + +x.dataset.bph + b.photos.length) % b.photos.length; drawBill(); }; });
    var zi = q('#bpZi'), zo = q('#bpZo'); if (zi) zi.onclick = function () { bp.zoom = Math.min(4, bp.zoom + .5); drawBill(); }; if (zo) zo.onclick = function () { bp.zoom = Math.max(1, bp.zoom - .5); drawBill(); };
    o.querySelectorAll('[data-bi]').forEach(function (el) {
      el.addEventListener('input', function () {
        var it = b.items[+el.dataset.bi]; it[el.dataset.bk] = num(el.value); it.bottles = it.cases * it.per + it.loose; save();
        var t = document.getElementById('bbt' + el.dataset.bi); if (t) t.textContent = it.bottles + ' bottles';
      });
      el.addEventListener('change', function () { if (b.status === 'added') toast('Already in stock: delete and add again to change it'); setTimeout(function () { if (bp) drawBill(); }, 0); });
    });
    o.querySelectorAll('[data-bm]').forEach(function (sel) { sel.onchange = function () { var it = b.items[+sel.dataset.bm]; it.key = sel.value || null; it.ans = sel.value ? 'y' : 'n'; save(); drawBill(); }; });
    o.querySelectorAll('[data-bq]').forEach(function (bt) { bt.onclick = function () { var it = b.items[+bt.dataset.bq], v = bt.dataset.bk2; if (v === '__new') { it.key = null; it.ans = 'n'; } else { it.key = v; it.ans = 'y'; } save(); drawBill(); }; });
    var rd = q('#bpRead'); if (rd) rd.onclick = function () { billRead(b.id); };
    var nx = q('#bpNext'); if (nx) nx.onclick = function () { bp.step = 2; bp.target = b.status === 'added' ? b.applied : b.date; drawBill(); o.scrollTop = 0; };
    var bk = q('#bpBack2'); if (bk) bk.onclick = function () { bp.step = 1; drawBill(); };
    var dt = q('#bpDate'); if (dt) dt.onchange = function () { bp.target = dt.value || b.date; drawBill(); };
    var od = q('#bpOpenDay'); if (od) od.onclick = function () { var k = b.applied; closeBill(); openShopDay(k); };
    var ad = q('#bpAdd'); if (ad) ad.onclick = function () {
      var s2 = shop(), tgt = bp.target || b.date;
      // learn: bill name → sheet name, and add brand-new items to the list
      if (billAsks(b)) { toast('Answer the questions first'); return; }
      b.items.forEach(function (it) {
        var short = shortBillName(it.name);
        if (!it.key) it.key = regAdd(short, it.ml, 'bill', { full: it.name });
        else {
          it.key = resolveKey(it.key); if (!regItem(it.key)) it.key = regAdd(short, it.ml, 'bill', { full: it.name });
          // confirmed the same: the KSBCL name is used from the next sheet, his short name stays linked
          var x = regItem(it.key); if (normName(x.item) !== normName(short)) it.key = regRename(it.key, short);
          regItem(it.key).full = it.name;
        }
        s2.map[normName(it.name) + '|' + it.ml] = it.key;
      });
      b.target = tgt;
      var d = shopDay(tgt);
      if (d && d.grid && d.status !== 'reading') { billApply(b, tgt); toast('Added ' + billBottles(b) + ' bottles to the ' + new Date(tgt + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' sheet'); }
      else { b.status = 'pending'; toast('Saved. The bottles go in when the ' + new Date(tgt + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' sheet is read'); }
      save(); drawBill();
    };
  }
  // put the bottles into the Received column (adding rows for items not on the sheet)
  function billApply(b, k) {
    var d = shopDay(k, true), s2 = shop();
    if (!d.grid) d.grid = blankGrid();
    var g = d.grid.filter(function (r) { return r[0] !== 'TOTAL'; }), byKey = {};
    for (var r = 1; r < g.length; r++) if (String(g[r][SC.item] || '').trim()) byKey[regKey(g[r][SC.item], g[r][SC.size])] = r;
    b.items.forEach(function (it) {
      var r2 = byKey[resolveKey(it.key)];
      if (r2 == null) {
        // reuse an empty row if there is one, else add a row
        for (var e = 1; e < g.length; e++) if (g[e].every(function (v) { return v === '' || v == null; })) { r2 = e; break; }
        if (r2 == null) { g.push(SHCOLS.map(function () { return ''; })); r2 = g.length - 1; if (d.ai) d.ai.push(SHCOLS.map(function () { return ''; })); }
        g[r2][SC.item] = regItem(it.key) ? regItem(it.key).item : shortBillName(it.name); g[r2][SC.size] = String(it.ml); g[r2][SC.open] = g[r2][SC.open] || '0';
        byKey[resolveKey(it.key)] = r2;
      }
      var cur = g[r2][SC.recv], cl = g[r2][SC.close];
      // a written closing that matched before the delivery gets the bottles too, so the row still adds up
      if (isNum(cl) && String(cl).trim() !== '' && Math.abs(num(g[r2][SC.open]) + num(cur) - num(g[r2][SC.sales]) - num(cl)) < .01) g[r2][SC.close] = String(num(cl) + it.bottles);
      if (isNum(g[r2][SC.total]) && String(g[r2][SC.total]).trim() !== '') g[r2][SC.total] = String(num(g[r2][SC.total]) + it.bottles);
      g[r2][SC.recv] = String((isNum(cur) ? num(cur) : 0) + it.bottles);
    });
    d.grid = withTotalRow(g); b.status = 'added'; b.applied = k; d.bills = (d.bills || []).concat([b.id]); save();
  }
  function billUnapply(b) {
    var d = shopDay(b.applied); if (!d || !d.grid) return; var g = d.grid;
    b.items.forEach(function (it) { dataRows(g).forEach(function (r) { if (regKey(g[r][SC.item], g[r][SC.size]) === resolveKey(it.key) && isNum(g[r][SC.recv])) { var v = num(g[r][SC.recv]) - it.bottles; g[r][SC.recv] = v ? String(v) : ''; ['close', 'total'].forEach(function (c) { var x = g[r][SC[c]]; if (isNum(x) && String(x).trim() !== '') g[r][SC[c]] = String(num(x) - it.bottles); }); } }); });
    d.bills = (d.bills || []).filter(function (x) { return x !== b.id; }); save();
  }
  // when a day's sheet is read, bills waiting for it are added
  function applyPendingBills(k) {
    var n = 0; Object.keys(bills()).forEach(function (id) { var b = bills()[id]; if (b.status === 'pending' && (b.target || b.date) === k) { billApply(b, k); n += billBottles(b); } });
    if (n) toast(n + ' bottles from the KSBCL bill added to Received');
  }

  // ---------- KSBCL price list (PDF or Excel): exact names, MRP and cost, quick typing, profit per item ----------
  var PL = null, plLoading = null, plJob = null;
  function loadPL() { if (PL) return Promise.resolve(PL); if (plLoading) return plLoading; plLoading = idbGet('pricelist').then(function (x) { PL = x || { items: [], asOf: null }; return PL; }).catch(function () { PL = { items: [], asOf: null }; return PL; }); return plLoading; }
  function savePL() { return idbPut('pricelist', PL); }
  function plKey(name, ml) { return itemKey(shortBillName(name), ml); }
  // text lines from a PDF (rows rebuilt from the text positions)
  function pdfLines(buf, onPage) {
    return (window.pdfjsLib ? Promise.resolve() : loadScript('pdf.min.js')).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (doc) {
      var lines = [], p = 1;
      var next = function () {
        if (p > doc.numPages) return Promise.resolve(lines);
        return doc.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var rows = {};
          tc.items.forEach(function (it) { if (!it.str.trim()) return; var y = Math.round(it.transform[5] / 3) * 3; (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str.trim() }); });
          Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) { lines.push(rows[y].sort(function (a, b) { return a.x - b.x; }).map(function (c) { return c.s; }).join(' | ')); });
          if (onPage) onPage(p, doc.numPages); p++; return next();
        });
      };
      return next();
    });
  }
  function xlsxLines(buf) {
    return loadXlsx().then(function (X) {
      var wb2 = X.read(buf, { type: 'array' }), out = [];
      wb2.SheetNames.forEach(function (n) { X.utils.sheet_to_json(wb2.Sheets[n], { header: 1, raw: false, defval: '' }).forEach(function (r) { var t = r.map(function (c) { return String(c).trim(); }).filter(Boolean); if (t.length) out.push(t.join(' | ')); }); });
      return out;
    });
  }
  // the AI turns batches of lines into items (works the same for any column layout)
  // Big lists (thousands of rows) are parsed on the phone. The AI only looks at ~40 sample rows once,
  // to learn which column is the name, the MRP and the cost; then every row is read with that layout.
  var ML_RE = /(\d{2,4})\s*ML(?![a-wyz])/i;
  function cellNum(c) { var t = String(c == null ? '' : c).replace(/[,₹\s]/g, ''); return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; }
  function modeOf(a) { var m = {}, best = null, bc = 0; a.forEach(function (v) { if (v == null) return; m[v] = (m[v] || 0) + 1; if (m[v] > bc) { bc = m[v]; best = v; } }); return { v: best == null ? null : +best, n: bc }; }
  function importPriceList(file) {
    var isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    plJob = { stage: 'Opening the file…' }; drawSheet();
    var asOf = (/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/.exec(file.name) || null);
    var rows = [];
    file.arrayBuffer().then(function (buf) { return isPdf ? pdfLines(buf, function (p, n) { if (p % 5 === 0 || p === n) { plJob.stage = 'Reading page ' + p + ' of ' + n; drawSheet(); } }) : xlsxLines(buf); }).then(function (lines) {
      // rows that hold a product: one cell with a size like "750ML" and at least one price after it
      rows = lines.map(function (l) { return l.split(' | ').map(function (c) { return c.trim(); }).filter(function (c) { return c !== ''; }); })
        .filter(function (cs) { var a = -1; for (var i = 0; i < cs.length; i++) if (ML_RE.test(cs[i])) { a = i; break; } if (a < 0) return false; cs.anchor = a; return cs.slice(a + 1).some(function (c) { return cellNum(c) != null; }); });
      if (!rows.length) throw new Error('no product rows found (is it a scanned picture?)');
      plJob.stage = 'Learning the layout from ' + Math.min(40, rows.length) + ' sample rows'; drawSheet();
      var step = Math.max(1, Math.floor(rows.length / 40)), sample = []; for (var i = 0; i < rows.length && sample.length < 40; i += step) sample.push(rows[i]);
      if (!hasAI()) return null;
      var P = 'These are sample rows from the Karnataka State Beverages Corporation (KSBCL) "supplier wise item wise price list". Each row is split into numbered cells.\n' +
        'For EVERY row, give the cell number of: "name" (the product/brand name), "mrp" (the maximum retail price for ONE bottle), "cost" (the price the retailer pays per CASE: issue price / landing cost / KSBCL price; null if there is none), "per" (bottles per case, only if it is a separate cell, else null), "supplier" (null if not in the row).\n\n' +
        sample.map(function (cs, k) { return 'Row ' + k + ': ' + cs.map(function (c, j) { return '[' + j + '] ' + c; }).join('  '); }).join('\n') +
        '\n\nReply JSON: {"rows":[{"row":0,"name":2,"mrp":7,"cost":5,"per":null,"supplier":1}],"costIsPer":"case" or "bottle"}';
      return geminiCall({ contents: [{ parts: [{ text: P }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
        .then(function (t) { return JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '')); })
        .then(function (r) {
          var rel = function (f) { return (r.rows || []).map(function (x) { var cs = sample[x.row]; return cs && x[f] != null ? x[f] - cs.anchor : null; }); };
          var end = function (f) { return (r.rows || []).map(function (x) { var cs = sample[x.row]; return cs && x[f] != null ? x[f] - cs.length : null; }); };
          var lay = { costIsPer: r.costIsPer === 'bottle' ? 'bottle' : 'case' };
          ['name', 'mrp', 'cost', 'per', 'supplier'].forEach(function (f) { var a = modeOf(rel(f)), b2 = modeOf(end(f)); lay[f] = a.n >= b2.n ? { from: 'anchor', off: a.v } : { from: 'end', off: b2.v }; if ((a.n || 0) + (b2.n || 0) === 0) lay[f] = null; });
          return lay;
        }).catch(function () { return null; });
    }).then(function (lay) {
      // no AI (or it failed): the last number in the row is taken as the MRP, the one before it as the cost
      if (!lay || !lay.mrp) lay = { name: { from: 'anchor', off: 0 }, mrp: { from: 'end', off: -1 }, cost: { from: 'end', off: -2 }, per: null, supplier: null, costIsPer: 'case', guess: true };
      plJob.stage = 'Reading ' + fmtN(rows.length) + ' rows'; drawSheet();
      var at = function (cs, spec) { if (!spec || spec.off == null) return null; var i = spec.from === 'anchor' ? cs.anchor + spec.off : cs.length + spec.off; return i >= 0 && i < cs.length ? cs[i] : null; };
      var items = [], sup = '';
      rows.forEach(function (cs) {
        var nameCell = at(cs, lay.name) || cs[cs.anchor], sizeCell = ML_RE.test(nameCell) ? nameCell : cs[cs.anchor];
        var ml = (ML_RE.exec(sizeCell) || [])[1], per = cellNum(at(cs, lay.per)) || +((/x\s*(\d{1,3})/i.exec(sizeCell) || [])[1] || 0) || null;
        var mrp = cellNum(at(cs, lay.mrp)), cost = cellNum(at(cs, lay.cost)), s3 = String(at(cs, lay.supplier) || '').replace(/^\d+\s+/, ''); if (s3 && !cellNum(s3)) sup = s3;
        var name = String(nameCell).replace(/\s*\d{2,4}\s*ML.*$/i, '').replace(/\(\d+\)/g, '').trim();
        if (!name || !ml) return;
        items.push({ name: name, ml: ml, per: per, mrp: mrp, cost: lay.costIsPer === 'bottle' ? (cost && per ? cost * per : cost) : cost, supplier: sup });
      });
      return items;
    }).then(function (items) {
      return loadPL().then(function () {
        var old = {}; (PL.items || []).forEach(function (x) { old[x.key] = x; });
        var seen = {}, out = [], changed = 0;
        items.forEach(function (x) {
          var ml = String(x.ml || '').replace(/[^0-9]/g, ''), name = shortBillName(String(x.name).replace(/\s+/g, ' ').trim()), key = itemKey(name, ml);
          if (!name || seen[key]) return; seen[key] = 1;
          var per = num(x.per) || ({ 2000: 6, 1750: 6, 1500: 6, 1000: 9, 750: 12, 700: 12, 650: 12, 500: 24, 375: 24, 330: 24, 275: 24, 200: 48, 180: 48, 90: 96, 60: 150 })[+ml] || null, mrp = num(x.mrp) || null, costCase = num(x.cost) || null;
          var it = { key: key, name: name, ml: ml, per: per, mrp: mrp, costCase: costCase, cost: costCase && per ? Math.round(costCase / per * 100) / 100 : null, sup: x.supplier || '' };
          var o = old[key]; if (o && o.mrp && mrp && o.mrp !== mrp) { it.was = o.mrp; changed++; }
          out.push(it);
        });
        if (!out.length) throw new Error('no items found');
        PL = { items: out, asOf: asOf ? asOf[3] + '-' + String(asOf[2]).padStart(2, '0') + '-' + String(asOf[1]).padStart(2, '0') : dkey(new Date()), file: file.name, at: new Date().toISOString(), changed: changed, sups: Object.keys(out.reduce(function (a, x) { if (x.sup) a[x.sup] = 1; return a; }, {})).length };
        return savePL().then(function () { plJob = null; drawSheet(); toast(fmtN(out.length) + ' items in the price list' + (changed ? ' · ' + changed + ' MRPs changed' : '')); });
      });
    }).catch(function (e) { plJob = { stage: 'Couldn’t read it: ' + (e.message || e), err: true }; drawSheet(); });
  }
  function shopPricesSheet() {
    var h = '';
    if (!PL) { loadPL().then(function () { if (ui.sheet && ui.sheet.kind === 'shopprices') drawSheet(); }); return { title: 'Price list', cap: '', html: '<p class="muted">Loading…</p>', bind: function () {} }; }
    if (PL.asOf) h += '<div class="shtiles plt">' + [[fmtN(PL.items.length), 'items'], [PL.sups || '—', 'suppliers'], [PL.changed || 0, 'MRPs changed']].map(function (x) { return '<div><b class="display">' + x[0] + '</b><small>' + x[1] + '</small></div>'; }).join('') + '</div>';
    if (plJob) h += '<div class="' + (plJob.err ? 'notice' : 'shreading') + '">' + (plJob.err ? '' : '<span class="wpulse"></span>') + '<b>' + esc(plJob.stage) + '</b>' + (plJob.total ? '<span class="muted small">' + plJob.done + ' of ' + plJob.total + ' parts</span>' : '') + '</div>';
    h += '<button type="button" class="btn jungle" id="plUp"' + (plJob && !plJob.err ? ' disabled' : '') + '>⤒ ' + (PL.asOf ? 'Update with the new list (PDF or Excel)' : 'Add the KSBCL price list (PDF or Excel)') + '</button><input type="file" id="plFile" accept=".pdf,.xlsx,.xls,.csv,application/pdf" hidden>';
    if (PL.items.length) {
      h += '<input class="text" id="plQ" placeholder="Search: “orig” or “OC”" value="' + esc(shopUi.pq || '') + '">';
      var res = shopUi.pq ? plSearch(shopUi.pq, 40) : PL.items.slice(0, 30).map(function (x) { return { it: x }; });
      h += '<div class="list">' + res.map(function (r) { var x = r.it; return '<div class="r"><span class="t">' + esc(x.name) + '<small>' + (x.ml ? x.ml + ' ml' : '') + (x.sup ? ' · ' + esc(x.sup) : '') + (x.cost ? ' · cost ₹' + x.cost : '') + '</small></span>' + (x.was ? '<span class="tkpill" style="background:#FFE6B8">was ' + x.was + '</span>' : '') + '<span class="v strong">' + (x.mrp ? '₹' + fmtCell(x.mrp) : '—') + '</span></div>'; }).join('') + '</div>';
      h += '<p class="muted small">List as on ' + new Date(PL.asOf + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) + (PL.file ? ' · ' + esc(PL.file) : '') + '.</p>';
    } else if (!plJob) h += '<p class="muted small">Download the latest “supplier wise item wise price list” from KSBCL (PDF or Excel) and pick it here. The app reads every item’s name, size, MRP and cost. Do it again whenever a new list comes out.</p>';
    return { title: 'Price list', cap: PL.asOf ? 'as on ' + new Date(PL.asOf + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '', html: h, bind: function (r) {
      var f = r.querySelector('#plFile'); r.querySelector('#plUp').onclick = function () { f.click(); };
      f.onchange = function () { if (f.files[0]) importPriceList(f.files[0]); };
      var q = r.querySelector('#plQ'); if (q) q.addEventListener('input', function () { shopUi.pq = q.value; var pos = q.selectionStart; drawSheet(); var j = document.getElementById('plQ'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } });
    } };
  }
  // --- fuzzy matching: "orig ch", "OC", "oc 180", "Mcd 90" ---
  function words(t) { return normName(t).split(' ').filter(Boolean); }
  function nameScore(q, name) {
    var qw = words(q).filter(function (w) { return !/^\d+$/.test(w); }), nw = words(name); if (!qw.length || !nw.length) return 0;
    var initials = nw.map(function (w) { return w[0]; }).join(''), sc = 0;
    qw.forEach(function (w) {
      var best = 0;
      nw.forEach(function (n) { if (n === w) best = Math.max(best, 1); else if (n.indexOf(w) === 0) best = Math.max(best, .85 + Math.min(.1, w.length / 50)); else if (w.length >= 3 && n.indexOf(w) > 0) best = Math.max(best, .5); });
      if (w.length >= 2 && initials.indexOf(w) === 0) best = Math.max(best, .9);
      else if (w.length >= 2 && initials.indexOf(w) > 0) best = Math.max(best, .6);
      sc += best;
    });
    return sc / qw.length - Math.max(0, nw.length - qw.length) * .01;
  }
  function plSearch(q, max, size, listOnly) {
    var sz = size || (/(\d{2,4})/.exec(q) || [])[1], out = [];
    var mine = listOnly ? {} : shopItems(); bills();
    Object.keys(mine).forEach(function (k) { var x = mine[k], s = nameScore(q, x.item); if (s > .45) out.push({ it: { key: k, name: x.item, ml: x.size, mrp: (plFind(x.item, x.size) || {}).mrp }, s: s + .15 + (sz && x.size === sz ? .3 : sz ? -.2 : 0), mine: true }); });
    ((PL && PL.items) || []).forEach(function (x) { var s = nameScore(q, x.name); if (s > .45) out.push({ it: x, s: s + (sz && x.ml === sz ? .3 : sz ? -.2 : 0) }); });
    out.sort(function (a, b) { return b.s - a.s; });
    var seen = {}; return out.filter(function (r) { var k = normName(r.it.name) + '|' + r.it.ml; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, max || 8);
  }
  function plFind(name, size) {
    if (!PL || !PL.items.length) return null; var key = itemKey(shortBillName(name), size);
    var ex = PL.items.filter(function (x) { return x.key === key; })[0]; if (ex) return ex;
    var s2 = shop(), full = (s2.alias || {})[name]; if (full) { ex = PL.items.filter(function (x) { return x.key === itemKey(shortBillName(full), size); })[0]; if (ex) return ex; }
    var best = null, bs = 0; PL.items.forEach(function (x) { if (size && x.ml !== String(size).replace(/[^0-9]/g, '')) return; var s3 = nameScore(name, x.name); if (s3 > bs) { bs = s3; best = x; } });
    return bs >= .85 ? best : null;
  }
  function profitRows(d, k) {
    var g = d.grid, rows = []; k = k || (sp && sp.k) || null;
    dataRows(g).forEach(function (r) {
      var nm = String(g[r][SC.item] || '').trim(); if (!nm) return;
      var sold = num(cellVal(g, r, SC.sales)), rate = num(cellVal(g, r, SC.rate)), c = costFor(nm, g[r][SC.size], k);
      rows.push({ r: r, name: nm, size: g[r][SC.size], sold: sold, rate: rate, cost: c ? c.c : null, src: c ? c.src : '', pct: c && rate ? (rate - c.c) / rate * 100 : null });
    });
    var sales = 0, prof = 0; rows.forEach(function (x) { if (x.pct != null && x.sold) { sales += x.sold * x.rate; prof += x.sold * (x.rate - x.cost); } });
    return { rows: rows, avg: sales ? prof / sales * 100 : null, covered: sales };
  }
  function profitHtml(d) {
    var pr = profitRows(d), h = '<h1 class="display" style="font-size:30px;margin:0">Profit per item</h1>';
    h += '<div class="shmtab"><table><thead><tr><th>Item</th><th>Sold</th><th>Rate</th><th>Cost</th><th>Profit</th></tr></thead><tbody>' + pr.rows.map(function (x) {
      return '<tr><td style="text-align:left">' + esc(x.name) + (x.size ? ' ' + esc(x.size) : '') + '</td><td>' + (x.sold || '') + '</td><td>' + (x.rate || '') + '</td><td>' + (x.cost != null ? fmtCell(Math.round(x.cost * 100) / 100) : '<span class="muted">—</span>') + '</td><td class="' + (x.pct == null ? '' : x.pct < 0 ? 'neg' : 'plus') + '">' + (x.pct == null ? '' : (x.pct < 0 ? '−' : '') + Math.abs(x.pct).toFixed(1) + '%') + '</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td>Average (by sales)</td><td></td><td></td><td></td><td>' + (pr.avg == null ? '—' : pr.avg.toFixed(1) + '%') + '</td></tr></tfoot></table></div>';
    var miss = pr.rows.filter(function (x) { return x.cost == null && x.sold; }).length;
    h += '<p class="muted small">Profit % = (your rate − cost) ÷ your rate. Cost per bottle = rate per case ÷ bottles per case, plus its share of the TCS, from the KSBCL bill or indent that applied on this day. The old price list isn’t used for prices. Red = selling below cost.' + (miss ? ' ' + miss + ' item' + (miss > 1 ? 's have' : ' has') + ' no cost yet: add a bill or the price list.' : '') + '</p>';
    h += '<div class="row" style="gap:10px"><button type="button" class="btn line" id="pfBack">‹ Sheet</button><button type="button" class="btn coral" style="flex:1" id="pfNext">Close the day →</button></div>';
    return h;
  }
  // --- exact names for the handwritten ones ---
  function nameChecks(d) {
    var g = d.grid, out = [], s2 = shop();
    dataRows(g).forEach(function (r) {
      var hw = String(g[r][SC.item] || '').trim(); if (!hw) return;
      var size = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''), full = (s2.alias || {})[hw];
      var c = plSearch((full || hw) + (size ? ' ' + size : ''), 5, size, true), ai = sp && sp.aiMatch && sp.aiMatch[hw + '|' + size];
      if (ai) { c = c.filter(function (x) { return normName(x.it.name) !== normName(ai.name) || x.it.ml !== ai.ml; }); c.unshift({ it: ai, s: 1.2, ai: true }); }
      if (!c.length) { out.push({ r: r, hw: hw, size: size, cands: [], conf: 'none' }); return; }
      var top = c[0], gap = c[1] ? top.s - c[1].s : 1, exact = normName(top.it.name) === normName(hw);
      out.push({ r: r, hw: hw, size: size, cands: c, conf: exact ? 'same' : c[0].ai ? 'likely' : top.s >= 1.15 && gap >= .12 ? 'sure' : top.s >= .9 ? 'likely' : 'pick' });
    });
    return out;
  }
  function namesHtml(d) {
    var nc = nameChecks(d), h = '<h1 class="display" style="font-size:30px;margin:0;line-height:1.05">Check the names<br><span class="lite" style="font-size:20px">handwriting → exact names</span></h1>';
    if (!PL || !PL.items.length) h += '<div class="notice">Add the KSBCL price list (Shop → Price list) so names can be matched to the exact ones.</div>';
    var show = nc.filter(function (x) { return x.conf !== 'same'; });
    if (!show.length) h += '<div class="notice ok">✓ Every name already matches.</div>';
    h += '<div class="stack" style="gap:8px">' + show.map(function (x, i) {
      var col = { sure: '#CDEFEA', likely: '#FFE6B8', pick: '#FFD9D3', none: '#F1E6D6' }[x.conf], lab = { sure: 'sure', likely: 'likely', pick: 'pick one', none: 'no match' }[x.conf];
      return '<div class="ncrow"><span class="hw">' + esc(x.hw) + (x.size ? ' ' + x.size : '') + '</span><select data-nc="' + x.r + '"><option value="">keep “' + esc(x.hw) + '”</option>' + x.cands.map(function (c, k) { return '<option value="' + k + '"' + (k === 0 && x.conf !== 'pick' && x.conf !== 'none' ? ' selected' : '') + '>' + esc(c.it.name) + (c.it.ml ? ' ' + c.it.ml : '') + (c.it.mrp ? ' · ₹' + c.it.mrp : '') + '</option>'; }).join('') + '</select><span class="tkpill" style="background:' + col + '">' + lab + '</span></div>';
    }).join('') + '</div>';
    var hard = show.filter(function (x) { return x.conf === 'pick' || x.conf === 'none'; }).length;
    if (hard && hasAI() && PL && PL.items.length) h += '<button type="button" class="btn line small" id="ncAI"' + (sp.aiBusy ? ' disabled' : '') + '>' + (sp.aiBusy ? 'Matching…' : '✨ Ask AI to match the ' + hard + ' unclear name' + (hard > 1 ? 's' : '')) + '</button>';
    if (show.length) h += '<div class="row" style="gap:10px"><button type="button" class="btn line" style="flex:1" id="ncKeep">Keep short names</button><button type="button" class="btn jungle" style="flex:1" id="ncUse">Use exact names</button></div>';
    h += '<p class="muted small">Matched against your price list and the names you’ve used before. Your choice is remembered for next time.</p><button type="button" class="btn ghost" id="ncBack">‹ Sheet</button>';
    sp.nc = nc;
    return h;
  }
  function bindNames(o, d) {
    var s2 = shop(), q = function (x) { return o.querySelector(x); };
    q('#ncBack').onclick = function () { sp.step = 'sheet'; drawShopDay(); };
    var ai = q('#ncAI'); if (ai) ai.onclick = function () {
      var hard = sp.nc.filter(function (x) { return x.conf === 'pick' || x.conf === 'none'; });
      var sizes = {}; hard.forEach(function (x) { sizes[x.size] = 1; });
      var cands = PL.items.filter(function (x) { return !Object.keys(sizes).some(function (z) { return z; }) || sizes[x.ml]; }).slice(0, 900).map(function (x) { return x.name + ' | ' + x.ml; });
      var P = 'A liquor shop in Karnataka writes short or misspelt brand names on its daily sales sheet. Match each handwritten name (with its bottle size in ml) to the one product in the official KSBCL price list below that it most likely means. Use common Indian shop abbreviations (OC = Original Choice, OT = Old Tavern, MC/Mcd = McDowell’s, KF = Kingfisher, IB/Imp = Imperial Blue, RS = Royal Stag, BP = Bagpiper, OM = Old Monk). If nothing fits, use null.\n\nHandwritten: ' + hard.map(function (x) { return '"' + x.hw + '" ' + x.size; }).join('; ') + '\n\nPrice list (name | ml):\n' + cands.join('\n') + '\n\nReply JSON: {"matches":[{"hw":"handwritten text","size":"180","name":"exact price-list name or null","ml":"180"}]}';
      sp.aiBusy = true; drawShopDay();
      geminiCall({ contents: [{ parts: [{ text: P }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }).then(function (t) { return JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '')); }).then(function (r) {
        sp.aiMatch = sp.aiMatch || {}; var n = 0;
        (r.matches || []).forEach(function (m) { if (!m || !m.name) return; var it = PL.items.filter(function (x) { return normName(x.name) === normName(m.name) && (!m.ml || x.ml === String(m.ml)); })[0]; if (it) { sp.aiMatch[m.hw + '|' + String(m.size || '').replace(/[^0-9]/g, '')] = it; n++; } });
        sp.aiBusy = false; if (sp.step === 'names') drawShopDay(); toast(n ? n + ' matched by AI · check them' : 'AI couldn’t match them');
      }).catch(function (e) { sp.aiBusy = false; if (sp && sp.step === 'names') drawShopDay(); toast('AI: ' + (e.message || 'failed')); });
    };
    var keep = q('#ncKeep'); if (keep) keep.onclick = function () {
      // remember the full name behind each short name, but leave the sheet as written
      o.querySelectorAll('[data-nc]').forEach(function (sel) { var x = sp.nc.filter(function (y) { return y.r === +sel.dataset.nc; })[0]; if (!x || sel.value === '') return; var c = x.cands[+sel.value]; s2.alias[x.hw] = c.it.name; });
      save(); toast('Remembered'); sp.step = 'sheet'; drawShopDay();
    };
    var use = q('#ncUse'); if (use) use.onclick = function () {
      spSnap(d); var n = 0;
      o.querySelectorAll('[data-nc]').forEach(function (sel) {
        var x = sp.nc.filter(function (y) { return y.r === +sel.dataset.nc; })[0]; if (!x || sel.value === '') return;
        var c = x.cands[+sel.value], g = d.grid;
        s2.gloss[x.hw.toLowerCase()] = { to: c.it.name, n: ((s2.gloss[x.hw.toLowerCase()] || {}).n || 0) + 1 };
        var nk2 = regAdd(c.it.name, c.it.ml || x.size, 'sheet'); if (nk2) regAlias(nk2, x.hw, 2);
        g[x.r][SC.item] = c.it.name; if (c.it.ml && !g[x.r][SC.size]) g[x.r][SC.size] = c.it.ml; n++;
      });
      save(); toast(n + ' names updated'); sp.step = 'sheet'; drawShopDay();
    };
  }
  // --- dropdown while typing in the Item column ---
  function itemSuggest(o, d) {
    var fx = o.querySelector('#spFx'), box = o.querySelector('#spSug'); if (!fx || !box) return;
    var render2 = function () {
      var v = fx.value.trim(); if (!sp.sel || sp.sel[1] !== SC.item || sp.sel[0] === 0 || v.length < 2 || /^=/.test(v)) { box.hidden = true; return; }
      var res = plSearch(v, 7); if (!res.length) { box.hidden = true; return; }
      box.innerHTML = res.map(function (r, i) { return '<button type="button" data-sug="' + i + '"><span><b>' + esc(r.it.name) + '</b><small>' + (r.it.ml ? r.it.ml + ' ml' : '') + (r.it.mrp ? ' · MRP ₹' + fmtCell(r.it.mrp) : '') + '</small></span><i>' + (r.mine ? 'on your sheet' : 'price list') + '</i></button>'; }).join('');
      box.hidden = false;
      box.querySelectorAll('[data-sug]').forEach(function (b) {
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        b.onclick = function () {
          var it = res[+b.dataset.sug].it, g = d.grid, r = sp.sel[0]; spSnap(d);
          var was = d.ai && d.ai[r] ? d.ai[r][SC.item] : null;
          g[r][SC.item] = it.name; if (it.ml) g[r][SC.size] = String(it.ml);
          regAdd(it.name, it.ml || g[r][SC.size], 'sheet');
          if (was && String(was).trim() && String(was).trim() !== it.name) { s2g(was, it.name); }
          save(); sp.sel = [r, SC.open]; sp.anchor = sp.sel; drawShopDay();
          var f = document.getElementById('spFx'); if (f) try { f.focus(); } catch (e) {}
        };
      });
    };
    var s2g = function (was, to) { var s2 = shop(), k = String(was).trim().toLowerCase(); s2.gloss[k] = { to: to, n: ((s2.gloss[k] || {}).n || 0) + 1 }; s2.fixes++; };
    fx.addEventListener('input', render2);
    fx.addEventListener('focus', render2);
    fx.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 150); });
  }

  // ---------- phone-friendly editing: the sheet as brand cards, a row editor with a number pad, a name picker ----------
  // a row with only a size under a brand belongs to that brand
  // "100 pipers 750" → item "100 pipers", size "750"
  function splitSize(item, size) {
    var it = String(item || '').trim(), sz = String(size == null ? '' : size).trim(), m = /^(.*?)[\s-]*(\d{2,4})\s*(ml)?\.?$/i.exec(it);
    if (m && m[1].trim() && /^(60|90|180|200|275|330|375|500|650|700|750|1000|2000)$/.test(m[2]) && (!sz || sz.replace(/[^0-9]/g, '') === m[2])) { it = m[1].trim(); sz = m[2]; }
    return [it, sz];
  }
  function fillDownNames(g) {
    var last = '', n = 0;
    dataRows(g).forEach(function (r) {
      var it = String(g[r][SC.item] || '').trim(), hasNum = [SC.open, SC.recv, SC.sales, SC.close, SC.amt].some(function (c) { return isNum(g[r][c]); });
      if (it) { last = it; return; }
      if (last && String(g[r][SC.size] || '').trim() && hasNum) { g[r][SC.item] = last; n++; }
    });
    return n;
  }
  // yesterday's rows (same size, closing = today's opening, near the same place) give today's names
  function yRows(k) {
    var pk = prevDayKey(k); if (!pk) return null; var pg = shop().days[pk].grid; if (!pg) return null;
    var rows = dataRows(pg).filter(function (r) { return String(pg[r][SC.item] || '').trim(); });
    return { k: pk, rows: rows.map(function (r, i) { return { i: i, r: r, name: String(pg[r][SC.item]).trim(), size: String(pg[r][SC.size] || '').replace(/[^0-9]/g, ''), close: isNum(cellVal(pg, r, SC.close)) ? num(cellVal(pg, r, SC.close)) : null }; }) };
  }
  function yMatch(Y, g, r, pos) {
    if (!Y) return null;
    var size = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''), o = isNum(g[r][SC.open]) ? num(g[r][SC.open]) : null, raw = String(g[r][SC.item] || '').trim();
    var same = Y.rows.filter(function (y) { return !size || y.size === size; });
    var hit = o != null ? same.filter(function (y) { return y.close === o; }) : [];
    var near = function (a) { return a.slice().sort(function (x, y) { return Math.abs(x.i - pos) - Math.abs(y.i - pos); })[0]; };
    if (hit.length === 1 || (hit.length > 1 && Math.abs(near(hit).i - pos) <= 4)) return { y: near(hit), how: 'close' };
    // same place on the page and a similar name
    var at = same.filter(function (y) { return Math.abs(y.i - pos) <= 1 && raw && (normName(y.name) === normName(raw) || nameScore(raw, y.name) >= .6); });
    if (at.length) return { y: near(at), how: 'place' };
    return null;
  }
  function carryNames(k) {
    var d = shopDay(k), g = d && d.grid; if (!g) return null;
    var Y = yRows(k); if (!Y) return null;
    var rows = dataRows(g).filter(function (r) { return String(g[r][SC.size] || '').trim() || String(g[r][SC.item] || '').trim(); }), n = 0;
    d.from = {};
    rows.forEach(function (r, i) {
      var m = yMatch(Y, g, r, i); if (!m) return;
      if (String(g[r][SC.item] || '').trim() !== m.y.name) g[r][SC.item] = m.y.name;
      d.from[r] = 1; n++;
    });
    d.carried = { n: n, of: rows.length, k: Y.k };
    return d.carried;
  }
  // the list
  function shopListHtml(d) {
    var g = d.grid, ck = shopChecks(sp.k), h = '';
    if (d.sheetDate && d.sheetDate !== sp.k) h += '<div class="notice">📅 The sheet says <b>' + new Date(d.sheetDate + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</b>, but it’s saved under ' + new Date(sp.k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '. <button type="button" class="link" id="lsMove">Move it to ' + new Date(d.sheetDate + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '</button> · <button type="button" class="link" id="lsKeep">It’s right</button></div>';
    if (d.carried && d.carried.n) h += '<div class="lsban"><span>↺</span><p>' + (d.carried.reg ? '<b>' + d.carried.n + ' of ' + d.carried.of + ' rows matched to your items</b><br>by his short name, size and yesterday’s closing; the order on the page doesn’t matter' : '<b>Names from ' + new Date(d.carried.k + 'T00:00:00').toLocaleDateString('en', { weekday: 'long' }) + '’s sheet</b><br>' + d.carried.n + ' of ' + d.carried.of + ' rows matched') + '</p></div>';
    h += inkSummary(d) + asksHtml(d) + missingHtml(d);
    var bad = Object.keys(ck.bad).length;
    h += '<div class="row between"><button type="button" class="nib sm' + (sp.lph ? ' on' : '') + '" id="lsPh">📷 ' + (sp.lph ? 'Hide photo' : 'Show photo') + '</button><span class="cap">' + (bad ? '<span style="color:#B3372B">' + ck.msgs.filter(function (m) { return m.r != null; }).length + ' to check</span>' : '✓ adds up') + '</span></div>';
    if (sp.lph && d.photos.length) h += '<div class="shphoto" id="spPh"><img id="spImg" alt="Sheet photo" style="width:' + (sp.zoom * 100) + '%"></div>';
    var groups = [], cur = null;
    dataRows(g).forEach(function (r) {
      var it = String(g[r][SC.item] || '').trim(), any = it || String(g[r][SC.size] || '').trim() || [SC.open, SC.sales, SC.close].some(function (c) { return isNum(g[r][c]); });
      if (!any) return;
      if (!cur || it !== cur.name || !it) { cur = { name: it, rows: [] }; groups.push(cur); }
      cur.rows.push(r);
    });
    var labs = [[SC.open, 'open'], [SC.recv, 'in'], [SC.sales, 'sold'], [SC.rate, 'rate'], [SC.amt, 'amt'], [SC.close, 'close']];
    h += groups.map(function (G) {
      var r0 = G.rows[0], inPL = !PL || !PL.items.length || !G.name || plFind(G.name, g[r0][SC.size]), raw = d.ai && d.ai[r0] ? String(d.ai[r0][SC.item] || '').trim() : '';
      var tag = !G.name ? '<span class="lstag bad">pick a name</span>' : d.from && d.from[r0] ? '<span class="lstag">from yesterday</span>' : !inPL ? '<span class="lstag warn">not in price list</span>' : '';
      var ik = d.ink && d.ink[r0], im = d.inkm && d.inkm[r0];
      var hh = '<div class="lsg' + (im && im.st === 'conflict' ? ' cf' : '') + '"><button type="button" class="lshead" data-lsname="' + r0 + '">' + (ik ? inkImg(ik.id) : '') + (G.name ? '<b>' + esc(G.name) + '</b>' : '<span class="hw">' + esc(raw || '?') + '</span>') + (im ? inkBadge(im) : tag) + '<span class="lsed" aria-hidden="true">✎</span></button>';
      if (im && im.st === 'conflict') hh += '<button type="button" class="ikmsg" data-ikw="' + r0 + '">Writing looks like <b>' + esc(inkBrandName(im.alt)) + '</b> (' + im.ap + '%), but it was read as ' + esc(G.name || raw) + '. Tap to choose.</button>';
      G.rows.forEach(function (r) {
        hh += '<button type="button" class="lsrow" data-lsrow="' + r + '" aria-label="Edit ' + esc((G.name || 'row') + ' ' + (g[r][SC.size] || '')) + '"><span class="lssz">' + esc(g[r][SC.size] || '—') + '</span>' + labs.map(function (l) {
          var v = g[r][l[0]], show = v === '' || v == null ? '' : fmtCell(cellVal(g, r, l[0]));
          return '<span class="lsc' + (ck.bad[r + ',' + l[0]] ? ' bad' : '') + (show === '' ? ' em' : '') + '"><b>' + esc(show) + '</b><small>' + l[1] + '</small></span>';
        }).join('') + '</button>';
        ck.msgs.filter(function (m) { return m.r === r; }).forEach(function (m) { hh += '<span class="lsmsg">' + m.t.replace(/<b>[^<]*<\/b>: /, '') + '</span>'; });
      });
      return hh + '</div>';
    }).join('');
    if (!groups.length) h += '<p class="muted small">No rows yet.</p>';
    h += '<button type="button" class="btn line small" id="lsAdd">+ Add a row</button>';
    h += '<div class="lstot"><span>Total sales</span><b>' + inr(daySales(d)) + '</b></div>';
    return h;
  }
  function bindShopList(o, d) {
    var q = function (x) { return o.querySelector(x); };
    q('#lsPh').onclick = function () { sp.lph = !sp.lph; drawShopDay(); };
    var mv = q('#lsMove'); if (mv) mv.onclick = function () { var to = d.sheetDate; if (!moveShopDay(sp.k, to)) return; closeShopDay(); openShopDay(to); toast('Moved to ' + new Date(to + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' })); };
    var kp2 = q('#lsKeep'); if (kp2) kp2.onclick = function () { d.sheetDate = null; save(); drawShopDay(); };
    bindAsks(o, d); fillInk(o);
    o.querySelectorAll('[data-ikw]').forEach(function (b) { b.onclick = function () { sp.step = 'ink'; sp.inkRow = b.dataset.ikw; drawShopDay(); document.getElementById('overlay').scrollTop = 0; }; });
    o.querySelectorAll('[data-lsrow]').forEach(function (b) { b.onclick = function () { openRowEd(+b.dataset.lsrow); }; });
    o.querySelectorAll('[data-lsname]').forEach(function (b) { b.onclick = function () { openNamePick(+b.dataset.lsname, 'sheet'); }; });
    q('#lsAdd').onclick = function () {
      var g = d.grid; spSnap(d); var at = g.length - 1; var nr = SHCOLS.map(function () { return ''; });
      var lastR = dataRows(g).filter(function (r) { return String(g[r][SC.item] || '').trim(); }).pop(); if (lastR) nr[SC.item] = g[lastR][SC.item];
      g.splice(at, 0, nr); if (d.ai) d.ai.splice(at, 0, SHCOLS.map(function () { return ''; })); d.grid = withTotalRow(g); save(); openRowEd(at, 'size');
    };
  }
  // --- row editor ---
  var REF = [['size', SC.size, 'Size ml'], ['open', SC.open, 'Opening'], ['recv', SC.recv, 'Received'], ['sales', SC.sales, 'Sold'], ['rate', SC.rate, 'Rate ₹'], ['amt', SC.amt, 'Amount ₹'], ['close', SC.close, 'Closing']];
  function openRowEd(r, f) { sp.step = 'row'; sp.row = r; sp.fld = f || 'open'; sp.fresh = true; var o = document.getElementById('overlay'); drawShopDay(); o.scrollTop = 0; }
  function recostHtml(g, r) {
    var nm = String(g[r][SC.item] || '').trim(), cst = nm ? costFor(nm, g[r][SC.size], sp.k) : null, rt0 = num(cellVal(g, r, SC.rate));
    return cst ? 'Cost ' + inr(cst.c, 2) + ' a bottle <small>(' + cst.src + (cst.d ? ' ' + new Date(cst.d + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '') + (cst.tcs ? ', incl. TCS' : '') + ')</small>' + (rt0 ? ' · margin <b class="' + (rt0 < cst.c ? 'neg' : '') + '">' + ((rt0 - cst.c) / rt0 * 100).toFixed(1) + '%</b>' : '') : '<span class="muted">No cost yet: link this item to a KSBCL bill or indent</span>';
  }
  function rowEdHtml(d) {
    var g = d.grid, r = sp.row, rows = dataRows(g), idx = rows.indexOf(r), nm = String(g[r][SC.item] || '').trim(), raw = d.ai && d.ai[r] ? String(d.ai[r][SC.item] || '').trim() : '';
    var h = '<div class="red"><button type="button" class="redname" id="reName"><b>' + (nm ? esc(nm) : '<span class="hw">pick a name</span>') + '</b><small>' + (g[r][SC.size] ? esc(g[r][SC.size]) + ' ml' : 'no size') + (raw && raw !== nm ? ' · <span class="hw">' + esc(raw) + '</span> on the sheet' : '') + ' · change ✎</small></button><span class="cap">row ' + (idx + 1) + ' of ' + rows.length + '</span></div>';
    h += '<div class="recost" id="reCost">' + recostHtml(g, r) + '</div>';
    h += '<div class="refs">' + REF.map(function (f) { return '<button type="button" class="ref' + (sp.fld === f[0] ? ' on' : '') + '" data-ref="' + f[0] + '"><small>' + f[2] + '</small><b id="rev-' + f[0] + '"></b></button>'; }).join('') + '</div>';
    h += '<div class="rehint" id="reHint" hidden></div>';
    h += '<div class="rekp">' + ['1', '2', '3', '⌫', '4', '5', '6', 'C', '7', '8', '9', '‹', '.', '0', '00', '›'].map(function (k) { return '<button type="button" data-kp="' + k + '"' + (k === '›' || k === '‹' ? ' class="nx" aria-label="' + (k === '›' ? 'Next box' : 'Previous box') + '"' : k === '⌫' ? ' aria-label="Delete"' : k === 'C' ? ' aria-label="Clear"' : '') + '>' + k + '</button>'; }).join('') + '</div>';
    h += '<div class="row" style="gap:10px"><button type="button" class="btn line" style="flex:1" id="rePrev"' + (idx > 0 ? '' : ' disabled') + '>‹ Prev row</button><button type="button" class="btn jungle" style="flex:1" id="reNext">' + (idx < rows.length - 1 ? 'Next row ›' : 'Done ✓') + '</button></div>';
    var gr = groupRows(g, r);
    h += '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn ghost small" id="reList">‹ List</button>' + (gr.length > 1 && gr[0] !== r ? '<button type="button" class="btn ghost small" id="reSplit">✂ New brand from here</button>' : '') + '<button type="button" class="btn ghost small" id="reDel">Delete row</button></div>';
    return h;
  }
  function bindRowEd(o, d) {
    var g = d.grid, r = sp.row, q = function (x) { return o.querySelector(x); };
    var col = function (f) { return REF.filter(function (x) { return x[0] === f; })[0][1]; };
    var autoAmt = function () { var s = cellVal(g, r, SC.sales), rt = cellVal(g, r, SC.rate); return isNum(s) && isNum(rt) && String(g[r][SC.sales]).trim() !== '' && String(g[r][SC.rate]).trim() !== '' ? Math.round(num(s) * num(rt) * 100) / 100 : null; };
    var paint = function () {
      var ck = shopChecks(sp.k);
      REF.forEach(function (f) {
        var el = q('#rev-' + f[0]), v = g[r][f[1]], show = v === '' || v == null ? '' : typeof v === 'string' && v.charAt(0) === '=' ? fmtCell(cellVal(g, r, f[1])) : String(v);
        el.textContent = show === '' ? (f[0] === 'recv' ? '—' : '') : show;
        var b = el.parentNode; b.classList.toggle('on', sp.fld === f[0]); b.classList.toggle('bad', !!ck.bad[r + ',' + f[1]]); b.classList.toggle('fresh', sp.fld === f[0] && sp.fresh && show !== '');
      });
      // a hint when the row doesn't add up
      var v = function (c) { return isNum(cellVal(g, r, c)) && String(g[r][c]).trim() !== '' ? num(cellVal(g, r, c)) : null; };
      var o2 = v(SC.open), rc = v(SC.recv) || 0, sl = v(SC.sales), cl = v(SC.close), hint = null;
      var pk = prevDayKey(sp.k), pc = null;
      if (pk) { var pg = shop().days[pk].grid, key = rowKey(g, r); dataRows(pg).forEach(function (x) { if (rowKey(pg, x) === key && isNum(cellVal(pg, x, SC.close))) pc = num(cellVal(pg, x, SC.close)); }); }
      if (o2 != null && sl != null && cl != null && Math.abs(o2 + rc - sl - cl) > .01) hint = { t: 'Closing should be <b>' + fmtCell(o2 + rc - sl) + '</b> (' + o2 + (rc ? ' + ' + rc : '') + ' − ' + sl + ').', f: 'close', v: o2 + rc - sl };
      else if (pc != null && o2 != null && pc !== o2) hint = { t: 'Yesterday closed at <b>' + fmtCell(pc) + '</b>, but opening says ' + o2 + '.', f: 'open', v: pc };
      else if (o2 != null && sl != null && cl == null) hint = { t: 'Closing will be <b>' + fmtCell(o2 + rc - sl) + '</b>.', f: 'close', v: o2 + rc - sl };
      var dg = learnt ? Object.keys(learnt().digits || {}).filter(function (p) { return learnt().digits[p] >= 2; }) : [];
      if (hint && hint.f === 'close' && cl != null) { var sw = digitSwap(cl, hint.v); if (sw && dg.indexOf(sw) >= 0) { var a = sw.split('>'); hint.t += ' His ' + a[1] + ' can look like a ' + a[0] + '.'; } }
      var rc2 = q('#reCost'); if (rc2) rc2.innerHTML = recostHtml(g, r);
      var hb = q('#reHint'); hb.hidden = !hint;
      if (hint) { hb.innerHTML = '<span>' + hint.t + '</span><button type="button" id="reUse">Use ' + fmtCell(hint.v) + '</button>'; q('#reUse').onclick = function () { set(hint.f, String(Math.round(hint.v * 100) / 100), true); sp.fld = hint.f; sp.fresh = true; paint(); }; }
    };
    var set = function (f, val, commit) {
      var c = col(f), was = g[r][c]; if (String(was) === String(val)) return;
      if (!sp.snapRow) { spSnap(d); sp.snapRow = true; }
      var amtWasAuto = String(g[r][SC.amt] || '').trim() === '' || (autoAmt() != null && num(g[r][SC.amt]) === autoAmt());
      g[r][c] = val; d.edited = true;
      if ((f === 'sales' || f === 'rate') && amtWasAuto) { var a = autoAmt(); if (a != null) g[r][SC.amt] = String(a); }
      if (commit) learnFix(d, r, c, val);
      clearTimeout(sp.saveT); sp.saveT = setTimeout(save, 400);
    };
    var commitField = function () { var c = col(sp.fld); learnFix(d, r, c, g[r][c]); save(); };
    var move = function (dir) {
      commitField();
      var all = REF.map(function (x) { return x[0]; }), i = all.indexOf(sp.fld) + dir;
      if (i >= all.length) return goRow(1);
      if (i < 0) i = 0;
      sp.fld = all[i]; sp.fresh = true; paint();
    };
    var goRow = function (dir) {
      commitField(); var rows = dataRows(g), i = rows.indexOf(r) + dir;
      if (i < 0) return; if (i >= rows.length) { sp.step = 'sheet'; sp.view = 'list'; drawShopDay(); return; }
      sp.row = rows[i]; sp.fld = 'open'; sp.fresh = true; sp.snapRow = false; drawShopDay();
    };
    o.querySelectorAll('[data-ref]').forEach(function (b) { b.onclick = function () { commitField(); sp.fld = b.dataset.ref; sp.fresh = true; paint(); }; });
    o.querySelectorAll('[data-kp]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.onclick = function () {
        var k = b.dataset.kp, c = col(sp.fld), cur = String(g[r][c] == null ? '' : g[r][c]);
        if (/^=/.test(cur)) cur = String(fmtCell(cellVal(g, r, c))).replace(/,/g, '');
        if (k === '›') return move(1); if (k === '‹') return move(-1);
        if (k === '⌫') { set(sp.fld, sp.fresh ? '' : cur.slice(0, -1)); }
        else if (k === 'C') set(sp.fld, '');
        else { if (k === '.' && !sp.fresh && cur.indexOf('.') >= 0) return; set(sp.fld, (sp.fresh ? '' : cur) + k); }
        sp.fresh = false; paint();
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
      };
    });
    q('#rePrev').onclick = function () { goRow(-1); };
    q('#reNext').onclick = function () { goRow(1); };
    q('#reList').onclick = function () { commitField(); sp.step = 'sheet'; sp.view = 'list'; drawShopDay(); var el = document.querySelector('[data-lsrow="' + r + '"]'); if (el) el.scrollIntoView({ block: 'center' }); };
    q('#reName').onclick = function () { commitField(); openNamePick(r, 'row'); };
    var rs = q('#reSplit'); if (rs) rs.onclick = function () { commitField(); openNamePick(r, 'row', 'down'); };
    q('#reDel').onclick = function () { if (!confirm('Delete this row?')) return; spSnap(d); g.splice(r, 1); if (d.ai) d.ai.splice(r, 1); d.from = null; d.grid = withTotalRow(g); save(); sp.step = 'sheet'; sp.view = 'list'; drawShopDay(); };
    paint();
  }
  // --- name picker: yesterday's sheet first, then the price list ---
  function openNamePick(r, back, mode) { sp.step = 'name'; sp.nrow = r; sp.nback = back; sp.nq = ''; sp.nmode = mode || (back === 'row' ? 'one' : 'all'); drawShopDay(); document.getElementById('overlay').scrollTop = 0; }
  function namePickHtml(d) {
    var g = d.grid, r = sp.nrow, raw = d.ai && d.ai[r] ? String(d.ai[r][SC.item] || '').trim() : '', nm = String(g[r][SC.item] || '').trim();
    var grp = groupRows(g, r);
    var h = '<div class="npk"><small>On the sheet</small><span class="hw">' + esc(raw || nm || '—') + ' ' + esc(g[r][SC.size] || '') + '</span>' + (nm && nm !== raw ? '<small>now: <b>' + esc(nm) + '</b></small>' : '') + '</div>';
    if (grp.length > 1) {
      var below = grp.slice(grp.indexOf(r)), opts = [['one', 'Only this row', g[r][SC.size] || '']];
      if (below.length > 1 && below.length < grp.length) opts.push(['down', 'This row and below', below.map(function (x) { return g[x][SC.size] || '?'; }).join(', ')]);
      opts.push(['all', 'Whole brand', grp.map(function (x) { return g[x][SC.size] || '?'; }).join(', ')]);
      if (!opts.some(function (o) { return o[0] === sp.nmode; })) sp.nmode = below.length > 1 && below.length < grp.length ? 'down' : 'one';
      h += '<div class="npmode"><span class="cap npcap">Change the name of</span>' + opts.map(function (o) { return '<button type="button" data-nmode="' + o[0] + '" class="' + (sp.nmode === o[0] ? 'on' : '') + '"><b>' + o[1] + '</b><small>' + esc(o[2]) + '</small></button>'; }).join('') + '</div>';
    }
    h += '<input class="text" id="npQ" placeholder="Search: a few letters or initials" autocomplete="off" autocapitalize="off" value="' + esc(sp.nq || '') + '">';
    h += '<div id="npRes">' + namePickResults(d) + '</div>';
    h += '<button type="button" class="btn ghost small" id="npBack">‹ Back</button>';
    if (raw) h += '<p class="muted small">Your pick is remembered for “' + esc(raw) + '” next time.</p>';
    return h;
  }
  // the rows that share this row's name, starting here and going down
  function groupRows(g, r) { var nm = String(g[r][SC.item] || '').trim(), out = [r]; if (!nm) return out; var rows = dataRows(g), i = rows.indexOf(r) + 1; while (i < rows.length && String(g[rows[i]][SC.item] || '').trim() === nm) out.push(rows[i++]); var j = rows.indexOf(r) - 1; while (j >= 0 && String(g[rows[j]][SC.item] || '').trim() === nm) out.unshift(rows[j--]); return out; }
  function namePickResults(d) {
    var g = d.grid, r = sp.nrow, q = (sp.nq || '').trim(), size = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''), Y = yRows(sp.k), h = '', list = [];
    var rows = dataRows(g).filter(function (x) { return String(g[x][SC.size] || '').trim() || String(g[x][SC.item] || '').trim(); });
    var best = Y ? yMatch(Y, g, r, rows.indexOf(r)) : null;
    var add = function (name, sub, cls, ml, mrp) { var i = list.length; list.push({ name: name, ml: ml, mrp: mrp }); return '<button type="button" class="r' + (cls ? ' ' + cls : '') + '" data-npk="' + i + '"><span class="t">' + esc(name) + (ml ? ' ' + esc(ml) : '') + '<small>' + sub + '</small></span></button>'; };
    if (best && !q) h += '<span class="cap npcap">Best match from yesterday</span><div class="list">' + add(best.y.name, 'row ' + (best.y.i + 1) + ' yesterday' + (best.how === 'close' ? ' · closed at ' + best.y.close + ' = today’s opening ✓' : ' · same place on the page'), 'npbest', '', null) + '</div>';
    if (Y) {
      var seen = {}, ys = Y.rows.filter(function (y) { var k = y.name; if (seen[k]) return false; seen[k] = 1; return !q || nameScore(q, y.name) > .45 || normName(y.name).indexOf(normName(q)) >= 0; });
      if (size && !q) ys.sort(function (a, b) { return (b.size === size) - (a.size === size) || a.i - b.i; });
      if (ys.length) h += '<span class="cap npcap">' + new Date(Y.k + 'T00:00:00').toLocaleDateString('en', { weekday: 'long' }) + '’s sheet' + (q ? '' : ', in order') + '</span><div class="list">' + ys.slice(0, q ? 8 : 12).map(function (y) { return add(y.name, 'row ' + (y.i + 1) + (y.close != null ? ' · closed at ' + y.close : ''), '', '', null); }).join('') + '</div>';
    }
    if (q || !Y) {
      var res = plSearch((q || String(g[r][SC.item] || '')) + (size ? ' ' + size : ''), 8, size);
      if (res.length) h += '<span class="cap npcap">Price list</span><div class="list">' + res.map(function (x) { return add(x.it.name, (x.it.ml ? x.it.ml + ' ml' : '') + (x.it.mrp ? ' · MRP ₹' + fmtCell(x.it.mrp) : '') + (x.mine ? ' · on your sheets' : ''), '', '', x.it.mrp); }).join('') + '</div>';
      if (q) h += '<div class="list">' + add(q, 'use exactly what you typed', '', '', null) + '</div>';
    }
    if (!h) h = '<p class="muted small">Type a few letters to search the price list.</p>';
    sp.nlist = list;
    return h;
  }
  function bindNamePick(o, d) {
    var g = d.grid, r = sp.nrow, q = function (x) { return o.querySelector(x); };
    var back = function () { if (sp.nback === 'row') { sp.step = 'row'; sp.row = r; sp.fresh = true; } else { sp.step = 'sheet'; sp.view = 'list'; } drawShopDay(); };
    var bindRes = function () {
      o.querySelectorAll('[data-npk]').forEach(function (b) {
        b.onclick = function () {
          var it = sp.nlist[+b.dataset.npk]; if (!it) return; spSnap(d);
          var gr = groupRows(g, r), grp = sp.nmode === 'all' ? gr : sp.nmode === 'down' ? gr.slice(gr.indexOf(r)) : [r], raw = d.ai && d.ai[r] ? String(d.ai[r][SC.item] || '').trim() : String(g[r][SC.item] || '').trim();
          grp.forEach(function (x) { g[x][SC.item] = it.name; var rk = regAdd(it.name, g[x][SC.size], 'sheet'), rw = d.ai && d.ai[x] ? String(d.ai[x][SC.item] || '').trim() : ''; if (rk && rw) regAlias(rk, rw, 2); d.rid = d.rid || {}; d.rid[x] = rk; });
          d.ask = (d.ask || []).filter(function (a) { return grp.indexOf(a.r) < 0; });
          if (d.ink) { var ikr = grp.filter(function (x) { return d.ink[x]; })[0]; if (ikr != null) inkLoad().then(function () { inkLearn(it.name, d.ink[ikr]); inkMatch(sp.k); return inkSave(); }).then(function () { save(); }); }
          if (raw && raw.toLowerCase() !== it.name.toLowerCase()) { var s2 = shop(), k = raw.toLowerCase(); s2.gloss[k] = { to: it.name, n: ((s2.gloss[k] || {}).n || 0) + 1 }; s2.fixes++; }
          d.edited = true; save(); toast(grp.length > 1 ? grp.length + ' rows named' : 'Named'); back();
        };
      });
    };
    var inp = q('#npQ');
    inp.addEventListener('input', function () { sp.nq = inp.value; q('#npRes').innerHTML = namePickResults(d); bindRes(); });
    o.querySelectorAll('[data-nmode]').forEach(function (b) { b.onclick = function () { sp.nmode = b.dataset.nmode; o.querySelectorAll('[data-nmode]').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    q('#npBack').onclick = back;
    bindRes();
  }

  // ---------- Your items: one permanent list (shop.items), his short names, KSBCL names, costs ----------
  var BPC = { 2000: 6, 1750: 6, 1500: 6, 1000: 9, 750: 12, 700: 12, 650: 12, 500: 24, 375: 24, 330: 24, 275: 24, 200: 48, 180: 48, 90: 96, 60: 150 };
  function resolveKey(k) { var m = shop().rekey || {}, n = 0; while (k && m[k] && n++ < 20) k = m[k]; return k; }
  function regKey(name, size) { return resolveKey(itemKey(name, size)); }
  function regItem(key) { bills(); return shop().items[resolveKey(key)] || null; }
  function regAll() { bills(); var it = shop().items; return Object.keys(it).map(function (k) { var x = it[k]; x.key = k; x.alias = x.alias || {}; return x; }); }
  function regAdd(name, size, src, extra) {
    bills(); var s2 = shop(), sz = String(size || '').replace(/[^0-9]/g, ''), key = regKey(name, sz);
    if (!String(name || '').trim()) return null;
    if (!s2.items[key]) s2.items[key] = { item: String(name).trim(), size: sz, src: src || 'sheet', alias: {}, at: dkey(new Date()) };
    var x = s2.items[key]; x.alias = x.alias || {}; if (extra) Object.keys(extra).forEach(function (f) { if (extra[f] != null) x[f] = extra[f]; });
    return key;
  }
  function regAlias(key, raw, n) {
    var x = regItem(key); raw = String(raw || '').trim(); if (!x || !raw) return;
    if (normName(raw) === normName(x.item)) return;
    x.alias = x.alias || {}; var k = raw.toLowerCase(); x.alias[k] = (x.alias[k] || 0) + (n || 1);
  }
  function repoint(from, to) {
    var s2 = shop(); s2.rekey = s2.rekey || {}; if (from !== to) s2.rekey[from] = to;
    Object.keys(s2.map || {}).forEach(function (m) { if (s2.map[m] === from) s2.map[m] = to; });
    Object.keys(s2.bills || {}).forEach(function (id) { (s2.bills[id].items || []).forEach(function (it) { if (it.key === from) it.key = to; }); });
  }
  function regRename(key, name) {
    var s2 = shop(); key = resolveKey(key); var x = s2.items[key]; name = String(name || '').trim(); if (!x || !name) return key;
    var nk = itemKey(name, x.size); if (nk === key) { x.item = name; return key; }
    if (s2.items[nk]) return regMerge(key, nk);
    x.alias = x.alias || {}; var ol = x.item.toLowerCase(); x.alias[ol] = (x.alias[ol] || 0) + 2; x.item = name; s2.items[nk] = x; delete s2.items[key]; repoint(key, nk); return nk;
  }
  function regMerge(from, to) {
    var s2 = shop(); from = resolveKey(from); to = resolveKey(to); if (from === to) return to;
    var a = s2.items[from], b = s2.items[to]; if (!a || !b) return to;
    b.alias = b.alias || {}; Object.keys(a.alias || {}).forEach(function (k) { b.alias[k] = (b.alias[k] || 0) + a.alias[k]; });
    regAlias(to, a.item, 2); if (!b.full && a.full) b.full = a.full;
    delete s2.items[from]; repoint(from, to); return to;
  }
  // every name on a sheet becomes an item, and what was learnt before carries over
  function regSync(skip) {
    var s2 = shop(); bills();
    // names from the sheets, except rows still waiting for an answer and the sheet being read right now
    Object.keys(s2.days).forEach(function (k) { var d = s2.days[k], g = d.grid; if (!g || k === skip || d.status === 'reading') return; var pend = {}; (d.ask || []).forEach(function (a) { pend[a.r] = 1; }); dataRows(g).forEach(function (r) { if (pend[r]) return; var n = String(g[r][SC.item] || '').trim(), sz = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''); if (n && sz && !s2.items[regKey(n, sz)]) regAdd(n, sz, 'sheet'); }); });
    if (!s2.regv) {
      s2.regv = 1;
      Object.keys(s2.gloss || {}).forEach(function (raw) { var to = s2.gloss[raw].to; regAll().forEach(function (x) { if (normName(x.item) === normName(to)) regAlias(x.key, raw, s2.gloss[raw].n); }); });
      Object.keys(s2.alias || {}).forEach(function (sheetName) { regAll().forEach(function (x) { if (x.item === sheetName && !x.full) x.full = s2.alias[sheetName]; }); });
    }
  }
  // how well a written name fits an item: 3 = certain (a learnt short name or the same name)
  function brandAliases() { var m = {}; regAll().forEach(function (x) { Object.keys(x.alias).forEach(function (a) { (m[a] = m[a] || {})[normName(x.item)] = 1; }); }); return m; }
  function fitScore(raw, x, BA) {
    raw = String(raw || '').trim(); if (!raw) return 0; var lr = raw.toLowerCase(), s = 0;
    if (normName(raw) === normName(x.item) || (x.full && normName(raw) === normName(shortBillName(x.full)))) return 3;
    if (x.alias[lr]) return 3 + Math.min(.5, x.alias[lr] / 20);
    if (BA && BA[lr] && BA[lr][normName(x.item)]) return 2.8;
    var g = shop().gloss[lr]; if (g && normName(g.to) === normName(x.item)) return 2.8;
    s = Math.max(nameScore(raw, x.item), nameScore(x.item, raw) * .95, x.full ? nameScore(raw, shortBillName(x.full)) : 0);
    Object.keys(x.alias).forEach(function (a) { s = Math.max(s, nameScore(raw, a) * .9); });
    return s * 1.6;
  }
  function regCands(raw, size, max) {
    var sz = String(size || '').replace(/[^0-9]/g, ''), BA = brandAliases();
    return regAll().filter(function (x) { return !sz || !x.size || x.size === sz; }).map(function (x) { return { key: x.key, x: x, s: fitScore(raw, x, BA) }; })
      .filter(function (c) { return c.s > .5; }).sort(function (a, b) { return b.s - a.s; }).slice(0, max || 4);
  }
  // match every row of a day to your items: his short name, size, yesterday's closing, place on the page
  function regAssign(k) {
    var d = shopDay(k), g = d && d.grid; if (!g) return null;
    regSync(k); var BA = brandAliases(), all = regAll(), pk = prevDayKey(k), pc = {}, pp = {};
    if (pk) { var pg = shop().days[pk].grid, pi = 0; dataRows(pg).forEach(function (r) { var n = String(pg[r][SC.item] || '').trim(); if (!n) return; var kk = regKey(n, pg[r][SC.size]); if (isNum(cellVal(pg, r, SC.close))) pc[kk] = num(cellVal(pg, r, SC.close)); pp[kk] = pi++; }); }
    var rows = dataRows(g).filter(function (r) { return String(g[r][SC.size] || '').trim() || String(g[r][SC.item] || '').trim(); });
    var used = {}, n = 0; d.rid = {}; d.ask = [];
    rows.forEach(function (r, i) {
      var raw = d.ai && d.ai[r] ? String(d.ai[r][SC.item] || '').trim() : '', filled = String(g[r][SC.item] || '').trim(), q = raw || filled;
      var sz = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''), o = isNum(g[r][SC.open]) && String(g[r][SC.open]).trim() !== '' ? num(g[r][SC.open]) : null;
      var sc = all.filter(function (x) { return !sz || !x.size || x.size === sz; }).map(function (x) {
        var s = fitScore(q, x, BA); if (o != null && pc[x.key] === o) s += 1.5; if (pp[x.key] != null && Math.abs(pp[x.key] - i) <= 3) s += .3; if (used[x.key]) s -= 1.2; return { key: x.key, x: x, s: s };
      }).sort(function (a, b) { return b.s - a.s; });
      var b1 = sc[0], b2 = sc[1];
      if (b1 && b1.s >= 2.6 && (!b2 || b1.s - b2.s >= .4)) { g[r][SC.item] = b1.x.item; d.rid[r] = b1.key; used[b1.key] = 1; n++; if (raw) regAlias(b1.key, raw); return; }
      var top = sc.filter(function (c) { return c.s >= .9; }).slice(0, 3).map(function (c) { return c.key; });
      if (b1 && b1.s >= 1.6) { g[r][SC.item] = b1.x.item; d.rid[r] = b1.key; used[b1.key] = 1; }
      if (raw || top.length) d.ask.push({ r: r, raw: q, size: sz, cands: top, guess: b1 && b1.s >= 1.6 ? b1.key : null, child: !raw });
    });
    // a brand's size rows wait for the answer on the brand row
    var heads = {}; d.ask.forEach(function (a) { if (!a.child) heads[a.raw.toLowerCase()] = 1; });
    d.ask = d.ask.filter(function (a) { return !a.child || !heads[a.raw.toLowerCase()]; });
    d.carried = { n: n, of: rows.length, k: pk, reg: true };
    return d.carried;
  }
  // answer "is this one of your items?"
  function answerAsk(d, a, key, mode) {
    var g = d.grid, s2 = shop(), raw = a.raw;
    var rowsOf = [a.r]; // the size rows under a brand row follow it
    if (!a.child) { var rs = dataRows(g), i = rs.indexOf(a.r) + 1; while (i < rs.length && !(d.ai && d.ai[rs[i]] && String(d.ai[rs[i]][SC.item] || '').trim()) && String(g[rs[i]][SC.item] || '').trim().toLowerCase() === String(g[a.r][SC.item] || '').trim().toLowerCase()) rowsOf.push(rs[i++]); }
    var brand = null;
    if (mode === 'new') brand = raw;
    else { var x = regItem(key); if (!x) return; brand = x.item; }
    rowsOf.forEach(function (r) {
      var sz = String(g[r][SC.size] || '').replace(/[^0-9]/g, ''), k2 = r === a.r && mode !== 'new' ? resolveKey(key) : null;
      if (!k2) { var same = regAll().filter(function (y) { return normName(y.item) === normName(brand) && y.size === sz; })[0]; k2 = same ? same.key : regAdd(brand, sz, 'sheet'); }
      g[r][SC.item] = regItem(k2).item; d.rid = d.rid || {}; d.rid[r] = k2;
      if (raw && mode !== 'new') regAlias(k2, raw, 2);
    });
    if (raw && mode !== 'new') { var gk = raw.toLowerCase(); s2.gloss[gk] = { to: brand, n: ((s2.gloss[gk] || {}).n || 0) + 1 }; }
    d.ask = (d.ask || []).filter(function (y) { return y !== a && rowsOf.indexOf(y.r) < 0; });
    if (d.ink && d.ink[a.r]) { var nm3 = String(g[a.r][SC.item] || '').trim(); inkLoad().then(function () { inkLearn(nm3, d.ink[a.r]); inkMatch(sp ? sp.k : null); return inkSave(); }); }
    d.edited = true; save();
  }
  // items on yesterday's sheet that are missing today
  function missingToday(k, d) {
    var pk = prevDayKey(k), out = { miss: [], zero: 0 }; if (!pk || !d.grid) return out;
    var pg = shop().days[pk].grid, here = {}; dataRows(d.grid).forEach(function (r) { var n = String(d.grid[r][SC.item] || '').trim(); if (n) here[regKey(n, d.grid[r][SC.size])] = 1; });
    dataRows(pg).forEach(function (r) {
      var n = String(pg[r][SC.item] || '').trim(); if (!n) return; var kk = regKey(n, pg[r][SC.size]); if (here[kk] || (d.gone && d.gone[kk])) return;
      var c = isNum(cellVal(pg, r, SC.close)) ? num(cellVal(pg, r, SC.close)) : null;
      if (c === 0) out.zero++; else out.miss.push({ key: kk, name: n, size: String(pg[r][SC.size] || ''), close: c });
    });
    return out;
  }
  function asksHtml(d) {
    var h = '';
    (d.ask || []).slice(0, 6).forEach(function (a, i) {
      h += '<div class="askc"><span class="cap">On the sheet</span><b><span class="hw">' + esc(a.raw || '?') + '</span> ' + esc(a.size || '') + ' is…</b><div class="askb">' + a.cands.map(function (key) { var x = regItem(key); if (!x) return ''; var al = Object.keys(x.alias || {}).slice(0, 2); return '<button type="button" data-ask="' + i + '" data-ak="' + esc(key) + '" class="' + (a.guess === key ? 'on' : '') + '"><b>' + esc(x.item) + ' ' + esc(x.size || '') + '</b>' + (al.length ? '<small>he writes ' + al.map(esc).join(', ') + '</small>' : x.src !== 'sheet' ? '<small>from your ' + x.src + 's</small>' : '') + '</button>'; }).join('') +
        '<button type="button" data-ask="' + i + '" data-ak="__new"><b>A new item</b><small>add “' + esc(a.raw) + ' ' + esc(a.size) + '” to your items</small></button><button type="button" data-ask="' + i + '" data-ak="__pick"><b>Something else…</b><small>search your items and the name list</small></button></div></div>';
    });
    if ((d.ask || []).length > 6) h += '<span class="muted small">+ ' + (d.ask.length - 6) + ' more after these</span>';
    return h;
  }
  function missingHtml(d) {
    var m = missingToday(sp.k, d); if (!m.miss.length && !m.zero) return '';
    var h = '<div class="misc"><b>Not on today’s sheet</b>';
    if (m.zero) h += '<span class="muted small">' + m.zero + ' item' + (m.zero > 1 ? 's' : '') + ' closed at 0 yesterday: sold out ✓ (kept in your items)</span>';
    h += m.miss.slice(0, 8).map(function (x) { return '<div class="misr"><span>' + esc(x.name) + ' ' + esc(x.size) + '<small> · ' + (x.close != null ? 'had ' + x.close + ' yesterday' : 'on yesterday’s sheet') + '</small></span><button type="button" data-madd="' + esc(x.key) + '">Add row</button><button type="button" data-mgone="' + esc(x.key) + '" class="g">Not now</button></div>'; }).join('');
    return h + '</div>';
  }
  function bindAsks(o, d) {
    o.querySelectorAll('[data-ask]').forEach(function (b) { b.onclick = function () {
      var a = d.ask[+b.dataset.ask], k = b.dataset.ak; if (!a) return; spSnap(d);
      if (k === '__pick') { openNamePick(a.r, 'sheet', a.child ? 'one' : 'all'); return; }
      answerAsk(d, a, k === '__new' ? null : k, k === '__new' ? 'new' : 'same'); drawShopDay();
    }; });
    o.querySelectorAll('[data-madd]').forEach(function (b) { b.onclick = function () {
      var m = missingToday(sp.k, d).miss.filter(function (x) { return x.key === b.dataset.madd; })[0]; if (!m) return; spSnap(d);
      var g = d.grid, nr = SHCOLS.map(function () { return ''; }); nr[SC.item] = m.name; nr[SC.size] = m.size; if (m.close != null) nr[SC.open] = String(m.close);
      g.splice(g.length - 1, 0, nr); if (d.ai) d.ai.splice(d.ai.length - 1, 0, SHCOLS.map(function () { return ''; })); d.grid = withTotalRow(g); save(); openRowEd(g.length - 2, 'sales');
    }; });
    o.querySelectorAll('[data-mgone]').forEach(function (b) { b.onclick = function () { d.gone = d.gone || {}; d.gone[b.dataset.mgone] = 1; save(); drawShopDay(); }; });
  }
  // cost per bottle: the latest KSBCL bill or indent for that item (old price lists are ignored)
  // cost per bottle (TCS included) from the KSBCL bill or indent that applied on that date; the latest one if no date
  function costFor(item, size, asOf) {
    var hs = costHist(regKey(item, size)); if (!hs.length) return null;
    var pick = null; if (asOf) hs.forEach(function (h) { if (h.d && h.d <= asOf) pick = h; });
    return pick || (asOf ? hs[0] : hs[hs.length - 1]);
  }

  // ---------- expenses tab ----------
  function expHtml(d) {
    var exp = d.exp = d.exp || [], et = exp.reduce(function (a, e) { return a + num(e.v); }, 0), w = d.written && d.written.expenses;
    var h = '<div class="shtiles ttq"><div><b class="display">' + inr(et) + '</b><small>expenses today</small></div><div><b class="display">' + (w ? inr(w) : '—') + '</b><small>' + (w ? (Math.abs(w - et) < .5 ? '✓ sheet’s written total' : '⚠ sheet’s written total') : 'no total on the sheet') + '</small></div></div>';
    var names = {}; Object.keys(shop().days).forEach(function (k) { (shop().days[k].exp || []).forEach(function (e) { if (e.t) names[e.t] = 1; }); });
    h += '<datalist id="expNames">' + Object.keys(names).slice(0, 60).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    h += '<div class="stack" style="gap:8px">' + exp.map(function (e, i) { return '<div class="exr' + (sp.ei === i ? ' on' : '') + '"><input class="exn" data-exn="' + i + '" value="' + esc(e.t || '') + '" placeholder="what was it?" list="expNames" autocomplete="off"><button type="button" class="exv" data-exv="' + i + '">' + (e.v ? inr(e.v) : '₹ —') + '</button><button type="button" class="tkx" data-exd="' + i + '" aria-label="Remove">✕</button></div>'; }).join('') + '</div>';
    if (!exp.length) h += '<p class="muted small">No expenses read from the sheet.</p>';
    h += '<button type="button" class="btn line" id="exAdd">+ Add expense</button>';
    if (sp.ei != null && exp[sp.ei]) h += '<div class="rekp" id="exKp">' + ['1', '2', '3', '⌫', '4', '5', '6', 'C', '7', '8', '9', '✓', '.', '0', '00', '›'].map(function (k) { return '<button type="button" data-ekp="' + k + '"' + (k === '›' || k === '✓' ? ' class="nx"' : '') + '>' + k + '</button>'; }).join('') + '</div>';
    h += '<p class="muted small">Tap an amount to change it on the number pad, or tap the name to rename it.</p>';
    return h;
  }
  function bindExp(o, d) {
    var exp = d.exp, q = function (x) { return o.querySelector(x); };
    o.querySelectorAll('[data-exn]').forEach(function (el) { el.addEventListener('input', function () { exp[+el.dataset.exn].t = el.value; clearTimeout(sp.saveT); sp.saveT = setTimeout(save, 400); }); el.addEventListener('focus', function () { if (sp.ei != null) { sp.ei = null; var kp = q('#exKp'); if (kp) kp.remove(); o.querySelectorAll('.exr').forEach(function (r) { r.classList.remove('on'); }); } }); });
    o.querySelectorAll('[data-exv]').forEach(function (b) { b.onclick = function () { sp.ei = +b.dataset.exv; sp.efresh = true; drawShopDay(); }; });
    o.querySelectorAll('[data-exd]').forEach(function (b) { b.onclick = function () { exp.splice(+b.dataset.exd, 1); sp.ei = null; save(); drawShopDay(); }; });
    q('#exAdd').onclick = function () { exp.push({ t: '', v: 0 }); sp.ei = null; save(); drawShopDay(); var ins = o.querySelectorAll('[data-exn]'); if (ins.length) ins[ins.length - 1].focus(); };
    o.querySelectorAll('[data-ekp]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.onclick = function () {
        var k = b.dataset.ekp, e = exp[sp.ei]; if (!e) return; var cur = e.v ? String(e.v) : '';
        if (k === '✓') { sp.ei = null; save(); drawShopDay(); return; }
        if (k === '›') { sp.ei = sp.ei + 1 < exp.length ? sp.ei + 1 : null; sp.efresh = true; save(); drawShopDay(); return; }
        if (k === '⌫') cur = sp.efresh ? '' : cur.slice(0, -1); else if (k === 'C') cur = ''; else cur = (sp.efresh ? '' : cur) + k;
        sp.efresh = false; e.v = num(cur); var bt = o.querySelector('[data-exv="' + sp.ei + '"]'); if (bt) bt.textContent = cur ? '₹' + cur : '₹ —';
        clearTimeout(sp.saveT); sp.saveT = setTimeout(save, 400);
      };
    });
  }
  // ---------- Your items screen ----------
  function regStock() { var sn = stockNow(), m = {}; sn.list.forEach(function (x) { m[resolveKey(x.key)] = x; }); return m; }
  function lastRate(key) { var s2 = shop(), ks = Object.keys(s2.days).sort().reverse(); for (var i = 0; i < ks.length; i++) { var g = s2.days[ks[i]].grid; if (!g) continue; var rs = dataRows(g); for (var j = 0; j < rs.length; j++) { var r = rs[j]; if (String(g[r][SC.item] || '').trim() && regKey(g[r][SC.item], g[r][SC.size]) === key && isNum(cellVal(g, r, SC.rate)) && num(cellVal(g, r, SC.rate))) return num(cellVal(g, r, SC.rate)); } } return null; }
  function shopItemsSheet() {
    regSync(); var s2 = shop(), st = regStock(), q = (shopUi.iq || '').toLowerCase(), all = regAll(), aq = s2.askq || [];
    var list = all.filter(function (x) { return !q || x.item.toLowerCase().indexOf(q) >= 0 || Object.keys(x.alias).some(function (a) { return a.indexOf(q) >= 0; }); }).sort(function (a, b) { return a.item.localeCompare(b.item) || (+b.size - +a.size); });
    var h = '';
    if (aq.length) h += '<button type="button" class="r askban" data-sheet="shopsame"><span class="t">' + aq.length + ' name' + (aq.length > 1 ? 's' : '') + ' to confirm<small>from your KSBCL indents: are they items you already have?</small></span>' + CHEV + '</button>';
    h += '<input class="text" id="iiq" placeholder="Search your ' + all.length + ' items" value="' + esc(shopUi.iq || '') + '">';
    h += '<div class="stack" style="gap:8px">' + list.slice(0, 150).map(function (x) {
      var sk = st[x.key], qty = sk ? sk.qty : null, al = Object.keys(x.alias).sort(function (a, b) { return x.alias[b] - x.alias[a]; }).slice(0, 4), c = costFor(x.item, x.size), rt = c ? lastRate(x.key) : null, pc = c && rt ? (rt - c.c) / rt * 100 : null;
      return '<button type="button" class="itc' + (qty === 0 ? ' zero' : '') + '" data-sheet="shopitem:' + esc(x.key) + '"><span class="itt"><b>' + esc(x.item) + ' <span class="muted">' + esc(x.size || '') + '</span></b><b class="q">' + (qty == null ? '—' : fmtN(qty)) + '</b></span><span class="itm">' + (al.length ? '<small>he writes</small>' + al.map(function (a) { return '<span class="hw">' + esc(a) + '</span>'; }).join('') : '') + '<i></i>' + (pc != null ? '<span class="tkpill">' + pc.toFixed(1) + '%</span>' : '') + '<span class="tkpill src ' + x.src + '">' + (qty === 0 ? 'sold out · kept' : x.src) + '</span></span></button>';
    }).join('') + '</div>';
    if (list.length > 150) h += '<p class="muted small">Showing 150 of ' + list.length + '. Search to find the rest.</p>';
    h += '<p class="muted small">Every item keeps its place here, even at 0. His short names are learnt from each sheet you check; KSBCL names come from your bills and indents. % = profit margin from his selling rate and the latest cost.</p>';
    return { title: 'Your items', cap: all.length + ' items', html: '<div class="stack" style="gap:10px">' + h + '</div>', bind: function (r) { var i = r.querySelector('#iiq'); i.addEventListener('input', function () { shopUi.iq = i.value; var pos = i.selectionStart; drawSheet(); var j = document.getElementById('iiq'); if (j) { j.focus(); j.setSelectionRange(pos, pos); } }); } };
  }
  function shopItemSheet(key) {
    var x = regItem(key); if (!x) return { title: 'Item', cap: '', html: '<p class="muted">This item was merged or removed.</p>', bind: function () {} };
    key = resolveKey(key); var c = costFor(x.item, x.size), rt = lastRate(key), st = regStock()[key];
    var h = '<label class="lab rng">Name on your sheets<input class="text" id="itName" value="' + esc(x.item) + '"></label>';
    if (!INK) inkLoad().then(function () { if (ui.sheet && ui.sheet.kind === 'shopitem') drawSheet(); });
    var smp = ((INK || {})[brandKey(x.item)] || []);
    h += '<div class="card stack" style="gap:8px"><div class="row between"><b style="font-size:14px">How he writes it</b><span class="muted small">' + smp.length + ' sample' + (smp.length === 1 ? '' : 's') + '</span></div>' + (smp.length ? '<div class="inkgal">' + smp.slice().reverse().map(function (s2_) { return '<span class="inkg">' + inkImg(s2_.id) + '<button type="button" data-ikdel="' + s2_.id + '" aria-label="Remove this sample">×</button></span>'; }).join('') + '</div><span class="muted small">Tap × on a sample that’s wrong.</span>' : '<span class="muted small">Samples are saved when you close a day or confirm a name.</span>') + '</div>';
    h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">He writes</b><div class="row" style="gap:6px;flex-wrap:wrap">' + (Object.keys(x.alias).length ? Object.keys(x.alias).map(function (a) { return '<span class="alc"><span class="hw">' + esc(a) + '</span><button type="button" data-ald="' + esc(a) + '" aria-label="Forget">×</button></span>'; }).join('') : '<span class="muted small">nothing learnt yet</span>') + '</div></div>';
    h += '<div class="list">' + row({ t: 'KSBCL name', sub: x.full ? esc(x.full) : 'not linked yet: it links when a bill or indent with this item comes in' }) + row({ t: 'Size', v: x.size ? x.size + ' ml' : '—' }) + row({ t: 'Stock now', v: st ? fmtN(st.qty) : '—' }) + row({ t: 'Cost per bottle', sub: c ? 'from your ' + c.src + (c.d ? ' of ' + new Date(c.d + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '') + (c.tcs ? ' · incl. ' + inr(c.c - c.base, 2) + ' TCS' : '') : 'no bill or indent yet', v: c ? inr(c.c, 2) : '—' }) + row({ t: 'His selling rate', v: rt ? inr(rt) : '—' }) + row({ t: 'Profit margin', v: c && rt ? ((rt - c.c) / rt * 100).toFixed(1) + '%' : '—' }) + '</div>';
    var same = regAll().filter(function (y) { return y.key !== key && (!x.size || y.size === x.size); }).sort(function (a, b) { return a.item.localeCompare(b.item); });
    h += '<label class="lab rng">Same as another item? Merge into<select class="text" id="itMerge"><option value="">— pick an item —</option>' + same.map(function (y) { return '<option value="' + esc(y.key) + '">' + esc(y.item) + ' ' + esc(y.size || '') + '</option>'; }).join('') + '</select></label>';
    h += '<button type="button" class="btn jungle" id="itSave">Save</button>';
    return { title: esc(x.item), cap: x.size ? x.size + ' ml' : '', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-ald]').forEach(function (b) { b.onclick = function () { delete x.alias[b.dataset.ald]; save(); drawSheet(); }; });
      fillInk(r);
      r.querySelectorAll('[data-ikdel]').forEach(function (b) { b.onclick = function () { var bk = brandKey(x.item); INK[bk] = (INK[bk] || []).filter(function (s3) { return s3.id !== b.dataset.ikdel; }); inkSave(); drawSheet(); }; });
      r.querySelector('#itSave').onclick = function () {
        var nk = key, nm = r.querySelector('#itName').value.trim(), mg = r.querySelector('#itMerge').value;
        if (nm && nm !== x.item) nk = regRename(key, nm);
        if (mg) { if (!confirm('Merge “' + x.item + '” into “' + regItem(mg).item + '”? His short names move over too.')) return; nk = regMerge(nk, mg); }
        save(); toast('Saved · used from the next sheet'); openSheet('shopitems');
      };
    } };
  }
  // the queue of "same item?" questions from indents
  function shopSameSheet() {
    var s2 = shop(), aq = s2.askq = (s2.askq || []).filter(function (a) { return a && a.name; }), a = aq[0];
    if (!a) return { title: 'All confirmed', cap: '', html: '<div class="notice ok">✓ Nothing left to confirm.</div><button type="button" class="btn jungle" data-sheet="shopitems">Your items</button>', bind: function () {} };
    var cands = (a.cands || []).map(regItem).filter(Boolean);
    var h = '<div class="card stack" style="gap:8px"><span class="cap">On your KSBCL ' + (a.src || 'indent') + 's</span><b style="font-size:16px">' + esc(a.name) + ' ' + esc(a.ml) + '</b>' + (a.n ? '<span class="muted small">' + a.n + ' time' + (a.n > 1 ? 's' : '') + (a.last ? ' · last ' + new Date(a.last + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '') + '</span>' : '') + '</div>';
    h += '<span class="cap">Is it this item from your sheets?</span><div class="askb">' + cands.map(function (x, i) { var al = Object.keys(x.alias || {}).slice(0, 2); return '<button type="button" data-sq="' + i + '"' + (i === 0 ? ' class="on"' : '') + '><b>' + esc(x.item) + ' ' + esc(x.size) + '</b><small>' + (al.length ? 'he writes ' + al.map(esc).join(', ') : x.src) + '</small></button>'; }).join('') + '<button type="button" data-sq="new"><b>No, it’s new</b><small>add it to your items under the KSBCL name</small></button></div>';
    h += '<p class="muted small">If yes, your sheets show the KSBCL name from the next day, and his short name stays linked to it. ' + aq.length + ' to go.</p>';
    return { title: 'Same item?', cap: aq.length + ' to confirm', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-sq]').forEach(function (b) { b.onclick = function () {
        var v = b.dataset.sq, short = shortBillName(a.name), mk = normName(a.name) + '|' + a.ml;
        if (v === 'new') { s2.map[mk] = regAdd(short, a.ml, a.src || 'indent', { full: a.name }); }
        else { var x = cands[+v], nk = regRename(x.key, short); regItem(nk).full = a.name; s2.map[mk] = nk; }
        aq.shift(); save(); drawSheet();
      }; });
    } };
  }
  // ---------- past KSBCL indents (PDF / Excel / photos): which items the shop stocks, and their latest cost ----------
  var indJob = null;
  function indentLinkAll() {
    var s2 = shop(), ind = s2.indents || {}, seen = {}; s2.askq = s2.askq || []; regSync();
    Object.keys(ind).forEach(function (id) { var n = ind[id]; (n.items || []).forEach(function (it) { var mk = normName(it.name) + '|' + it.ml; var e = seen[mk] = seen[mk] || { name: it.name, ml: it.ml, n: 0, last: '' }; e.n++; if ((n.date || '') > e.last) e.last = n.date || ''; }); });
    var asked = {}; s2.askq.forEach(function (a) { asked[normName(a.name) + '|' + a.ml] = 1; });
    var added = 0, linked = 0, ask = 0;
    Object.keys(seen).forEach(function (mk) {
      if (s2.map[mk] && regItem(s2.map[mk])) return; if (asked[mk]) return;
      var e = seen[mk], short = shortBillName(e.name);
      var exact = regAll().filter(function (x) { return x.size === e.ml && (normName(x.item) === normName(short) || (x.full && normName(x.full) === normName(e.name))); })[0];
      if (exact) { s2.map[mk] = exact.key; if (!exact.full) exact.full = e.name; linked++; return; }
      var c = regCands(short, e.ml, 3).filter(function (y) { return y.x.src === 'sheet' || Object.keys(y.x.alias).length; });
      if (c.length && c[0].s >= 1.2) { s2.askq.push({ name: e.name, ml: e.ml, cands: c.map(function (y) { return y.key; }), src: 'indent', n: e.n, last: e.last }); ask++; return; }
      s2.map[mk] = regAdd(short, e.ml, 'indent', { full: e.name }); added++;
    });
    return { added: added, linked: linked, ask: ask };
  }
  function importIndents(files) {
    var s2 = shop(); s2.indents = s2.indents || {}; indJob = { stage: 'Opening…', n: 0 }; drawSheet();
    var P = 'This is from the KSBCL (Karnataka State Beverages Corporation) stock indent / invoice history of one liquor shop. Extract every indent or invoice in it, with its number, date and items. For each item: the full product name as printed (without pack codes in brackets), size in ml, bottles per case (from text like "180MLx48Btls"), cases, loose bottles, the rate per case (issue price) and the amount. Skip totals and headers.\nAlso give each indent’s item total, its TCS amount (tax collected at source, sometimes written TDS) and the final invoice value, if shown.\nReply JSON: {"indents":[{"no":"text","date":"YYYY-MM-DD","itemTotal":number|null,"tcs":number|null,"invoiceValue":number|null,"items":[{"name":"text","ml":180,"perCase":48,"cases":2,"loose":0,"rate":5869.6,"amount":11739.2}]}]}';
    var take = function (r) {
      (r.indents || []).forEach(function (x, i) {
        var dt = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : '', id = String(x.no || '').trim() || (dt + '#' + i + '#' + (x.items || []).length);
        var cur = s2.indents[id] = s2.indents[id] || { no: String(x.no || ''), date: dt, items: [] };
        ['itemTotal', 'tcs', 'invoiceValue'].forEach(function (f) { if (num(x[f])) cur[f] = num(x[f]); });
        (x.items || []).forEach(function (it) {
          var ml = String(it.ml || '').replace(/[^0-9]/g, ''), nm = String(it.name || '').trim(); if (!nm || !ml) return;
          if (cur.items.some(function (y) { return y.name === nm && y.ml === ml && y.cases === num(it.cases); })) return;
          cur.items.push({ name: nm, ml: ml, per: num(it.perCase) || BPC[+ml] || 0, cases: num(it.cases), loose: num(it.loose), rate: num(it.rate), amount: num(it.amount) });
        });
      });
      save();
    };
    var chain = Promise.resolve(), fi = 0;
    files.forEach(function (f) {
      chain = chain.then(function () {
        fi++; indJob.stage = 'Reading file ' + fi + ' of ' + files.length; drawSheet();
        if (/^image\//.test(f.type)) return blobToDataURL(f).then(function (u) { return geminiImages(P, [u], .1); }).then(take);
        return f.arrayBuffer().then(function (buf) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? pdfLines(buf) : xlsxLines(buf); }).then(function (lines) {
          var chunks = []; for (var i = 0; i < lines.length; i += 160) chunks.push(lines.slice(i, i + 160));
          var c2 = Promise.resolve();
          chunks.forEach(function (ch, ci) { c2 = c2.then(function () { indJob.stage = 'File ' + fi + ': part ' + (ci + 1) + ' of ' + chunks.length; drawSheet(); return geminiCall({ contents: [{ parts: [{ text: P + '\n\nLINES:\n' + ch.join('\n') }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }).then(function (t) { take(JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, ''))); }).catch(function () { indJob.miss = (indJob.miss || 0) + 1; }); }); });
          return c2;
        });
      });
    });
    chain.then(function () { var res = indentLinkAll(); save(); indJob = null; indRes = res; drawSheet(); toast('Indents read' + (res.ask ? ' · ' + res.ask + ' names to confirm' : '')); })
      .catch(function (e) { indJob = { stage: 'Couldn’t read it: ' + (e.message || e), err: true }; drawSheet(); });
  }
  var indRes = null;
  function shopIndentSheet() {
    var s2 = shop(), ind = s2.indents || {}, ids = Object.keys(ind), items = {}, dates = [];
    ids.forEach(function (id) { if (ind[id].date) dates.push(ind[id].date); (ind[id].items || []).forEach(function (it) { items[normName(it.name) + '|' + it.ml] = 1; }); });
    dates.sort(); var fmt = function (k) { return new Date(k + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }); };
    var h = '<p class="muted" style="margin:0">Your previous KSBCL stock indents (PDF, Excel or photos). The app learns which items your shop actually stocks, and the latest cost of each for the profit margins.</p>';
    h += '<div class="shtiles ttq"><div><b class="display">' + ids.length + '</b><small>indents</small></div><div><b class="display">' + Object.keys(items).length + '</b><small>items</small></div><div><b class="display" style="font-size:16px">' + (dates.length ? fmt(dates[0]) + '–' + fmt(dates[dates.length - 1]) : '—') + '</b><small>dates</small></div></div>';
    if (indJob) h += '<div class="' + (indJob.err ? 'notice' : 'shreading') + '">' + (indJob.err ? '' : '<span class="wpulse"></span>') + '<b>' + esc(indJob.stage) + '</b></div>';
    if (indRes && !indJob) h += '<div class="notice ok">✓ ' + indRes.linked + ' linked to your items · ' + indRes.added + ' added as new' + (indRes.ask ? ' · <b>' + indRes.ask + ' to confirm</b>' : '') + '</div>';
    if ((s2.askq || []).length) h += '<button type="button" class="btn coral" data-sheet="shopsame">Confirm ' + s2.askq.length + ' name' + (s2.askq.length > 1 ? 's' : '') + ' →</button>';
    h += '<input type="file" id="indFile" accept=".pdf,.xlsx,.xls,.csv,image/*,application/pdf" multiple hidden><button type="button" class="btn jungle" id="indUp"' + (indJob && !indJob.err ? ' disabled' : '') + '>⤒ Upload indent file' + (ids.length ? 's (adds to these)' : '') + '</button>';
    if (!hasAI()) h += '<div class="notice">Reading indents needs your free Gemini key (Settings → Visualization).</div>';
    if (ids.length) h += '<div class="list">' + ids.map(function (id) { return ind[id]; }).sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; }).slice(0, 12).map(function (n) { var c = n.items.reduce(function (a, it) { return a + it.cases; }, 0); var f = tcsFactor(n); return '<div class="r"><span class="t">' + esc(n.no || 'Indent') + '<small>' + (n.date ? new Date(n.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' : '') + n.items.length + ' items · ' + c + ' cases' + (f > 1 ? ' · TCS ' + ((f - 1) * 100).toFixed(2) + '% shared over the items' : ' · no TCS found') + '</small></span></div>'; }).join('') + '</div>';
    return { title: 'Past indents', cap: ids.length ? ids.length + ' indents' : '', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      var f = r.querySelector('#indFile'); r.querySelector('#indUp').onclick = function () { if (!hasAI()) { toast('Add your Gemini key first'); return; } f.click(); };
      f.onchange = function () { var fs = [].slice.call(f.files); f.value = ''; if (fs.length) importIndents(fs); };
    } };
  }

  // --- the day screen: photos + sheet + close the day ---
  function openShopDay(k) {
    if (!PL) loadPL().then(function () { if (sp && sp.k === k) drawShopDay(); });
    resetOverlay(); closeSheet();
    var d = shopDay(k, true); if (!d.grid && d.status !== 'reading' && !d.photos.length) { d.grid = blankGrid(); save(); }
    sp = { k: k, view: d.grid ? 'list' : 'photo', sel: null, anchor: null, range: false, ph: 0, zoom: 1, step: 'sheet', hist: [] };
    drawShopDay(); showOverlay('spo');
  }
  function closeShopDay() { sp = null; closeOverlayEl(); if (ui.tab === 'shop') render(); }
  function drawShopDay() {
    var o = document.getElementById('overlay'), d = shopDay(sp.k, true), keepY = o.scrollTop;
    var gridBox = o.querySelector('.shgrid'), keepGX = gridBox ? gridBox.scrollLeft : 0, keepGY = gridBox ? gridBox.scrollTop : 0;
    var dl = new Date(sp.k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
    var h = '<div class="inner shd"><div class="row between"><button type="button" class="btn ghost small" id="spBack">‹ Shop</button><span class="cap">' + dl + '</span><span class="row" style="gap:6px">' + (sp.step === 'sheet' ? '<button type="button" class="nib sm" id="spDelDay" aria-label="Delete this day">🗑</button>' : '') + '<button type="button" class="btn ghost small" id="spClose">Done</button></span></div>';
    var head = function () { o.querySelector('#spBack').onclick = closeShopDay; o.querySelector('#spClose').onclick = closeShopDay; };
    if (sp.step === 'ink' && d.ink && d.ink[sp.inkRow] && d.grid[sp.inkRow]) { o.innerHTML = h + inkWhichHtml(d) + '</div>'; head(); bindInkWhich(o, d); return; }
    if (sp.step === 'ink') sp.step = 'sheet';
    if (sp.step === 'row' && d.grid && d.grid[sp.row]) { o.innerHTML = h + rowEdHtml(d) + '</div>'; head(); bindRowEd(o, d); return; }
    if (sp.step === 'name' && d.grid && d.grid[sp.nrow]) { o.innerHTML = h + namePickHtml(d) + '</div>'; head(); bindNamePick(o, d); return; }
    if (sp.step === 'row' || sp.step === 'name') sp.step = 'sheet';
    if (sp.step === 'close') { o.innerHTML = h + shopCloseHtml(d) + '</div>'; head(); bindShopClose(o, d); o.scrollTop = 0; return; }
    if (sp.step === 'names') { o.innerHTML = h + namesHtml(d) + '</div>'; head(); bindNames(o, d); o.scrollTop = 0; return; }
    if (sp.step === 'profit') { o.innerHTML = h + profitHtml(d) + '</div>'; head(); o.querySelector('#pfBack').onclick = function () { sp.step = 'sheet'; drawShopDay(); }; o.querySelector('#pfNext').onclick = function () { sp.step = 'close'; drawShopDay(); }; o.scrollTop = 0; return; }
    if (d.status === 'queued') h += '<div class="notice">📶 <b>Waiting for internet.</b> The photos are saved and are read automatically when you’re back online.</div>';
    if (d.status === 'reading') h += '<div class="shreading"><span class="wpulse"></span><b>Reading your sheet…</b><span class="muted small">' + d.photos.length + ' photo' + (d.photos.length === 1 ? '' : 's') + ' · usually 20–60 seconds</span></div>';
    h += '<div class="seg2 shseg" role="tablist">' + [['photo', 'Photo'], ['list', 'List'], ['exp', 'Expenses'], ['sheet', 'Grid']].map(function (v) { return '<button type="button" role="tab" data-spv="' + v[0] + '" aria-selected="' + (sp.view === v[0]) + '">' + v[1] + '</button>'; }).join('') + '</div>';
    if (sp.view === 'both') sp.view = 'list';
    if (sp.view === 'photo') {
      h += '<div class="shphoto' + (sp.view === 'photo' ? ' big' : '') + '" id="spPh">' + (d.photos.length ? '<img id="spImg" alt="Sheet photo" style="width:' + (sp.zoom * 100) + '%">' : '<span class="muted small" style="padding:30px;display:block;text-align:center">No photo yet</span>') + '</div>';
      h += '<div class="row between shphbar"><span class="row" style="gap:4px">' + (d.photos.length > 1 ? '<button type="button" class="nib" data-sph="-1" aria-label="Previous photo">‹</button><span class="cap">' + (sp.ph + 1) + ' / ' + d.photos.length + '</span><button type="button" class="nib" data-sph="1" aria-label="Next photo">›</button>' : '') + '<button type="button" class="nib sm" id="spAddPh">+ Photo</button>' + (d.photos.length ? '<button type="button" class="nib sm" id="spDelPh" aria-label="Delete this photo">🗑</button>' : '') + '</span>' +
        '<span class="row" style="gap:4px"><button type="button" class="nib" id="spZo" aria-label="Zoom out">−</button><span class="cap">' + Math.round(sp.zoom * 100) + '%</span><button type="button" class="nib" id="spZi" aria-label="Zoom in">+</button></span></div>';
      h += '<input type="file" id="spFile" accept="image/*" multiple hidden>';
    }
    if (sp.view === 'exp') h += expHtml(d);
    else if (sp.view === 'list' && d.grid) h += shopListHtml(d);
    else if (sp.view === 'sheet' && d.grid) h += shopGridHtml(d);
    else if (sp.view !== 'photo' && sp.view !== 'exp' && !d.grid) h += '<p class="muted small">The sheet appears here once the photos are read.</p>';
    if (d.grid && sp.view === 'sheet') {
      var ck = shopChecks(sp.k);
      if (ck.msgs.length) h += '<div class="shissues">' + ck.msgs.slice(0, 12).map(function (m) { return '<button type="button" class="shiss"' + (m.r != null ? ' data-goto="' + m.r + ',' + m.c + '"' : '') + '>⚠ ' + m.t + '</button>'; }).join('') + (ck.msgs.length > 12 ? '<span class="muted small">+ ' + (ck.msgs.length - 12) + ' more</span>' : '') + '</div>';
      else h += '<div class="notice ok">✓ Every row adds up.</div>';
      if (PL && PL.items.length) { var ncn = nameChecks(d).filter(function (x) { return x.conf !== 'same' && x.conf !== 'none'; }).length; if (ncn) h += '<button type="button" class="shiss ncnudge" id="spNames2">✓ ' + ncn + ' name' + (ncn > 1 ? 's' : '') + ' can be matched to the exact price-list names → Check</button>'; }
    }
    h += '<div class="row" style="gap:10px;margin-top:4px">' + (hasAI() && d.photos.length ? '<button type="button" class="btn line small" id="spRead">↻ Read again</button>' : '') + '<button type="button" class="btn coral" style="flex:1" id="spNext"' + (d.grid ? '' : ' disabled') + '>' + 'Close the day →' + '</button></div>';
    o.innerHTML = h + '</div>';
    o.scrollTop = keepY;
    var gb = o.querySelector('.shgrid'); if (gb) { gb.scrollLeft = keepGX; gb.scrollTop = keepGY; }
    bindShopDay(o, d);
  }
  function selRange() {
    if (!sp.sel) return null;
    var a = sp.anchor || sp.sel, b = sp.sel;
    return { r1: Math.min(a[0], b[0]), r2: Math.max(a[0], b[0]), c1: Math.min(a[1], b[1]), c2: Math.max(a[1], b[1]) };
  }
  function rangeName(rg) { return colName(rg.c1) + (rg.r1 + 1) + (rg.r1 === rg.r2 && rg.c1 === rg.c2 ? '' : ':' + colName(rg.c2) + (rg.r2 + 1)); }
  function shopGridHtml(d) {
    var g = d.grid, ck = shopChecks(sp.k), rg = selRange(), sel = sp.sel;
    var raw = sel ? (g[sel[0]] && g[sel[0]][sel[1]] != null ? g[sel[0]][sel[1]] : '') : '';
    var h = '<div class="shfbar"><span class="shref">' + (sel ? rangeName(rg) : '—') + '</span><span class="shfx">ƒx</span><input id="spFx" class="shfin" value="' + esc(raw) + '" placeholder="' + (sel ? 'type a value, or = for a formula' : 'tap a cell') + '"' + (sel ? '' : ' disabled') + ' autocomplete="off" autocapitalize="off" enterkeyhint="next"></div><div class="shsug" id="spSug" hidden></div>';
    h += '<div class="shfns">' + ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ROUND', 'IF', 'SUMIF', '+', '−', '×', '÷', '%', '(', ')'].map(function (f) { return '<button type="button" data-fn="' + f + '">' + f + '</button>'; }).join('') + '</div>';
    h += '<div class="shtools"><button type="button" class="nib sm' + (sp.range ? ' on' : '') + '" id="spRange">⬚ Select range</button><button type="button" class="nib sm" id="spAddRow">+ Row</button><button type="button" class="nib sm" id="spDelRow"' + (sel && sel[0] > 0 && g[sel[0]][0] !== 'TOTAL' ? '' : ' disabled') + '>− Row</button><button type="button" class="nib sm" id="spSort"' + (sel ? '' : ' disabled') + '>⇅ Sort</button><button type="button" class="nib sm" id="spFill">ƒ Fill maths</button><button type="button" class="nib sm" id="spNames">✓ Names</button><button type="button" class="nib sm" id="spUndo">↶ Undo</button></div>';
    h += '<div class="shgrid"><table class="shtab"><thead><tr><th class="corner"></th>' + SHCOLS.map(function (c, ci) { return '<th data-col="' + ci + '"' + (rg && ci >= rg.c1 && ci <= rg.c2 ? ' class="on"' : '') + '>' + colName(ci) + '</th>'; }).join('') + '</tr></thead><tbody>';
    g.forEach(function (rw, r) {
      var tot = rw[0] === 'TOTAL';
      h += '<tr' + (r === 0 ? ' class="hd"' : tot ? ' class="tot"' : '') + '><th>' + (r + 1) + '</th>' + SHCOLS.map(function (c, ci) {
        var v = r === 0 ? rw[ci] : cellVal(g, r, ci), cls = [];
        if (rg && r >= rg.r1 && r <= rg.r2 && ci >= rg.c1 && ci <= rg.c2) cls.push('sel');
        if (sel && sel[0] === r && sel[1] === ci) cls.push('cur');
        if (ck.bad[r + ',' + ci]) cls.push('bad');
        if (typeof rw[ci] === 'string' && rw[ci].charAt(0) === '=') cls.push('fx');
        if (typeof v === 'number') cls.push('n');
        if (ci === 0) cls.push('name');
        return '<td data-rc="' + r + ',' + ci + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + esc(r === 0 ? v : fmtCell(v)) + '</td>';
      }).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    // status bar like Excel: select cells to see the maths
    if (rg) {
      var vals = []; for (var r = rg.r1; r <= rg.r2; r++) for (var c = rg.c1; c <= rg.c2; c++) if (r > 0) { var v = cellVal(g, r, c); if (typeof v === 'number') vals.push(v); }
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      h += '<div class="shstat"><span>Sum <b>' + fmtCell(sum) + '</b></span><span>Avg <b>' + (vals.length ? fmtCell(sum / vals.length) : '—') + '</b></span><span>Count <b>' + vals.length + '</b></span><span>Min <b>' + (vals.length ? fmtCell(Math.min.apply(null, vals)) : '—') + '</b></span><span>Max <b>' + (vals.length ? fmtCell(Math.max.apply(null, vals)) : '—') + '</b></span></div>';
    }
    return h;
  }
  function spSnap(d) { sp.hist.push(JSON.stringify(d.grid)); if (sp.hist.length > 60) sp.hist.shift(); }
  function learnFix(d, r, c, val) {
    // remember how the owner corrects what the AI read, so the next day reads better
    var s2 = shop(), was = d.ai && d.ai[r] ? d.ai[r][c] : null;
    if (was == null || String(was) === String(val)) return;
    s2.fixes++;
    if ((c === SC.item) && String(was).trim() && String(val).trim()) {
      var k = String(was).trim().toLowerCase(); s2.gloss[k] = { to: String(val).trim(), n: ((s2.gloss[k] || {}).n || 0) + 1 };
    }
    d.ai[r][c] = val;
  }
  function bindShopDay(o, d) {
    var q = function (s2) { return o.querySelector(s2); };
    q('#spBack').onclick = closeShopDay; q('#spClose').onclick = closeShopDay;
    q('#spDelDay').onclick = function () { var k = sp.k; if (!confirm('Delete ' + new Date(k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' with its photos and sheet? This can’t be undone.')) return; shopDeleteDay(k); closeShopDay(); toast('Day deleted'); };
    o.querySelectorAll('[data-spv]').forEach(function (b) { b.onclick = function () { sp.view = b.dataset.spv; drawShopDay(); }; });
    // photo
    var img = q('#spImg');
    if (img && d.photos.length) { sp.ph = Math.min(sp.ph, d.photos.length - 1); idbGet('shopimg-' + d.photos[sp.ph]).then(function (u) { if (u) img.src = u; }); }
    o.querySelectorAll('[data-sph]').forEach(function (b) { b.onclick = function () { sp.ph = (sp.ph + +b.dataset.sph + d.photos.length) % d.photos.length; drawShopDay(); }; });
    var zi = q('#spZi'), zo = q('#spZo');
    if (zi) zi.onclick = function () { sp.zoom = Math.min(4, sp.zoom + .5); drawShopDay(); };
    if (zo) zo.onclick = function () { sp.zoom = Math.max(1, sp.zoom - .5); drawShopDay(); };
    var ph = q('#spPh');
    if (ph) { // pinch to zoom the photo
      var pts = {}, pd = null;
      ph.addEventListener('pointerdown', function (e) { pts[e.pointerId] = e; var ids = Object.keys(pts); if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pd = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: sp.zoom }; } });
      ph.addEventListener('pointermove', function (e) { if (!pts[e.pointerId]) return; pts[e.pointerId] = e; var ids = Object.keys(pts); if (pd && ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]], dd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); sp.zoom = Math.max(1, Math.min(4, pd.z * dd / pd.d)); if (img) img.style.width = (sp.zoom * 100) + '%'; } });
      var pu = function (e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pd = null; };
      ph.addEventListener('pointerup', pu); ph.addEventListener('pointercancel', pu);
      ph.style.touchAction = 'pan-x pan-y';
    }
    var fi = q('#spFile');
    var ap = q('#spAddPh'); if (ap) ap.onclick = function () { fi.click(); };
    if (fi) fi.onchange = function () { var fs = [].slice.call(fi.files); if (!fs.length) return; Promise.all(fs.map(blobToDataURL)).then(function (us) { shopAddPhotos(us, sp.k); }); };
    var dp = q('#spDelPh'); if (dp) dp.onclick = function () { if (!confirm('Delete this photo?')) return; var id = d.photos.splice(sp.ph, 1)[0]; idbDel('shopimg-' + id).catch(function () {}); sp.ph = 0; save(); drawShopDay(); };
    var rd = q('#spRead'); if (rd) rd.onclick = function () { if (d.grid && d.grid.length > 3 && !confirm('Read the photos again? Your edits on this sheet will be replaced.')) return; shopRead(sp.k); };
    q('#spNext').onclick = function () { if (!d.grid) return; sp.step = 'profit'; drawShopDay(); };
    var nb2 = q('#spNames2'); if (nb2) nb2.onclick = function () { sp.step = 'names'; drawShopDay(); };
    var nb = q('#spNames'); if (nb) nb.onclick = function () { sp.step = 'names'; drawShopDay(); };
    itemSuggest(o, d);
    if (sp.view === 'exp') { bindExp(o, d); return; }
    if (!d.grid || sp.view === 'photo') return;
    if (sp.view === 'list') { bindShopList(o, d); return; }
    // grid
    var g = d.grid, fx = q('#spFx');
    var put = function (r, c, v) {
      if (r === 0) return;
      var was = g[r][c]; if (String(was) === String(v)) return;
      g[r][c] = v; learnFix(d, r, c, v); d.edited = true; save();
    };
    var refresh = function () { drawShopDay(); var f2 = document.getElementById('spFx'); return f2; };
    o.querySelectorAll('[data-rc]').forEach(function (td) {
      td.onclick = function () {
        var rc = td.dataset.rc.split(',').map(Number);
        // while typing a formula, tapping a cell adds its name to the formula (like Excel)
        if (fx && document.activeElement === fx && /^=/.test(fx.value) && sp.sel && (rc[0] !== sp.sel[0] || rc[1] !== sp.sel[1])) {
          var pos = fx.selectionStart || fx.value.length; fx.value = fx.value.slice(0, pos) + colName(rc[1]) + (rc[0] + 1) + fx.value.slice(pos);
          put(sp.sel[0], sp.sel[1], fx.value); var keep = fx.value; var f3 = refresh(); if (f3) { f3.value = keep; f3.focus(); f3.setSelectionRange(keep.length, keep.length); } return;
        }
        if (sp.commitPending) sp.commitPending();
        if (sp.range && sp.sel) { sp.sel = rc; drawShopDay(); return; }
        sp.sel = rc; sp.anchor = rc; drawShopDay();
        var f4 = document.getElementById('spFx'); if (f4 && rc[0] > 0) { try { f4.focus(); f4.setSelectionRange(f4.value.length, f4.value.length); } catch (e) {} }
      };
    });
    o.querySelectorAll('[data-col]').forEach(function (th) { th.onclick = function () { var c = +th.dataset.col, rows = dataRows(g); sp.anchor = [rows[0] || 1, c]; sp.sel = [rows[rows.length - 1] || 1, c]; drawShopDay(); }; });
    if (fx) {
      var startVal = fx.value;
      fx.addEventListener('focus', function () { startVal = fx.value; });
      fx.addEventListener('input', function () { if (!sp.sel) return; var td = o.querySelector('[data-rc="' + sp.sel[0] + ',' + sp.sel[1] + '"]'); if (td && !/^=/.test(fx.value)) td.textContent = fx.value; });
      var commit = function (move) {
        if (!sp.sel) return; var v = fx.value.trim();
        if (v !== String(startVal)) { spSnap(d); put(sp.sel[0], sp.sel[1], v); startVal = v; }
        if (move && sp.sel[0] < g.length - 1) { sp.sel = [sp.sel[0] + 1, sp.sel[1]]; sp.anchor = sp.sel; }
        var f5 = refresh(); if (move && f5) { try { f5.focus(); } catch (e) {} }
      };
      fx.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(true); } });
      // leaving the box saves what was typed (but never while the screen is being redrawn)
      sp.commitPending = function () { if (!sp.sel || !fx.isConnected) return; var v = fx.value.trim(); if (v !== String(startVal)) { spSnap(d); put(sp.sel[0], sp.sel[1], v); startVal = v; } };
      fx.addEventListener('blur', function () { setTimeout(function () { if (fx.isConnected && sp && document.activeElement !== fx) { var before = String(startVal); sp.commitPending(); if (String(startVal) !== before) drawShopDay(); } }, 0); });
    }
    o.querySelectorAll('[data-fn]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.onclick = function () {
        if (!sp.sel || !fx) { toast('Tap the cell for the answer first'); return; }
        var f = b.dataset.fn, ins = { '+': '+', '−': '-', '×': '*', '÷': '/', '%': '%', '(': '(', ')': ')' }[f];
        var rg = selRange(), many = rg && (rg.r1 !== rg.r2 || rg.c1 !== rg.c2);
        if (!ins) {
          // a function: if a range is selected, write the answer in the cell just below/after it
          if (many) {
            var tr = rg.c1 === rg.c2 ? [Math.min(rg.r2 + 1, g.length - 1), rg.c1] : [rg.r1, Math.min(rg.c2 + 1, SHCOLS.length - 1)];
            spSnap(d); put(tr[0], tr[1], '=' + f + '(' + rangeName(rg) + ')'); sp.sel = tr; sp.anchor = tr; sp.range = false; drawShopDay(); return;
          }
          ins = f + '(';
        }
        var v = fx.value; if (!/^=/.test(v)) v = '=' + (v && !ins.match(/^[A-Z]/) ? v : '');
        fx.value = v + ins; fx.focus(); fx.setSelectionRange(fx.value.length, fx.value.length);
      };
    });
    q('#spRange').onclick = function () { sp.range = !sp.range; if (sp.range && sp.sel) sp.anchor = sp.sel; drawShopDay(); toast(sp.range ? 'Now tap the last cell of the range' : 'Range off'); };
    q('#spAddRow').onclick = function () {
      spSnap(d); var at = sp.sel && sp.sel[0] > 0 && g[sp.sel[0]][0] !== 'TOTAL' ? sp.sel[0] + 1 : g.length - 1;
      g.splice(at, 0, SHCOLS.map(function () { return ''; })); if (d.ai) d.ai.splice(at, 0, SHCOLS.map(function () { return ''; }));
      d.grid = withTotalRow(g); save(); sp.sel = [at, 0]; sp.anchor = sp.sel; drawShopDay();
    };
    q('#spDelRow').onclick = function () {
      if (!sp.sel || sp.sel[0] === 0) return; var r = sp.sel[0]; if (g[r][0] === 'TOTAL') return;
      spSnap(d); g.splice(r, 1); if (d.ai) d.ai.splice(r, 1); d.grid = withTotalRow(g); save(); sp.sel = null; sp.anchor = null; drawShopDay();
    };
    q('#spSort').onclick = function () {
      if (!sp.sel) return; var c = sp.sel[1], rows = dataRows(g).map(function (r) { return g[r]; }), asc = sp.sortCol === c ? !sp.sortAsc : true;
      spSnap(d); rows.sort(function (a, b) { var x = isNum(a[c]) ? num(a[c]) : String(a[c]).toLowerCase(), y = isNum(b[c]) ? num(b[c]) : String(b[c]).toLowerCase(); return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); });
      d.grid = withTotalRow([g[0]].concat(rows)); d.ai = null; sp.sortCol = c; sp.sortAsc = asc; save(); drawShopDay(); toast('Sorted by ' + SHCOLS[c] + (asc ? ' ↑' : ' ↓'));
    };
    q('#spFill').onclick = function () {
      if (!confirm('Fill in the maths where it’s blank?\nTotal = Opening + Received\nAmount = Sales × Rate\nClosing = Total − Sales')) return;
      spSnap(d); var n = 0;
      dataRows(g).forEach(function (r) {
        var R = r + 1, has = function (c) { return g[r][c] !== '' && g[r][c] != null; };
        if (!has(SC.item) && !has(SC.open)) return;
        if (!has(SC.total) && has(SC.open)) { g[r][SC.total] = '=C' + R + '+D' + R; n++; }
        if (!has(SC.amt) && has(SC.sales) && has(SC.rate)) { g[r][SC.amt] = '=F' + R + '*G' + R; n++; }
        if (!has(SC.close) && has(SC.open)) { g[r][SC.close] = '=C' + R + '+D' + R + '-F' + R; n++; }
      });
      save(); drawShopDay(); toast(n ? n + ' cells filled with formulas' : 'Nothing blank to fill');
    };
    q('#spUndo').onclick = function () { if (!sp.hist.length) { toast('Nothing to undo'); return; } d.grid = JSON.parse(sp.hist.pop()); save(); drawShopDay(); };
    o.querySelectorAll('[data-goto]').forEach(function (b) { b.onclick = function () { var rc = b.dataset.goto.split(',').map(Number); sp.sel = rc; sp.anchor = rc; drawShopDay(); var td = o.querySelector('td.cur'); if (td) td.scrollIntoView({ block: 'center', inline: 'center' }); }; });
  }

  // --- close the day: sales → profit % → profit → expenses → net income ---
  function shopCloseHtml(d) {
    var pr = profitRows(d), auto = pr.avg != null ? Math.round(pr.avg * 10) / 10 : null;
    var s2 = shop(), sales = d.salesOverride != null ? d.salesOverride : daySales(d), pct = d.pct != null ? d.pct : auto != null ? auto : s2.pct, profit = pct != null && pct !== '' ? sales * num(pct) / 100 : null;
    var exp = d.exp || [], et = exp.reduce(function (a, e) { return a + num(e.v); }, 0), net = profit != null ? profit - et : null;
    var h = '<h1 class="display" style="font-size:30px;margin:0">Close the day</h1>';
    if (d.pct != null && auto != null && Math.abs(d.pct - auto) >= .1) h += '<div class="notice"><b>The KSBCL costs give ' + auto + '%</b> (this day was saved with ' + d.pct + '%). <button type="button" class="link" id="scAuto">Use ' + auto + '%</button></div>';
    h += '<div class="shf"><div><span class="lab">Total sales</span><small>' + (d.salesOverride != null ? 'typed by you' : 'sum of the Amount column') + (d.written && d.written.sales && Math.abs(d.written.sales - daySales(d)) > .5 ? ' · sheet says ' + inr(d.written.sales) : '') + '</small></div><label class="shmoney">₹<input id="scSales" inputmode="decimal" value="' + Math.round(sales * 100) / 100 + '"></label></div>';
    h += '<div class="shf hi"><div><span class="lab">Profit percentage</span><small>' + (d.pct == null && auto != null ? 'worked out from each item · tap to type your own' : s2.pct != null ? 'your usual: ' + s2.pct + '%' : 'type your margin') + '</small></div><label class="shmoney"><input id="scPct" inputmode="decimal" value="' + (pct == null ? '' : pct) + '" placeholder="20">%</label></div>';
    h += '<div class="shf"><div><span class="lab">Profit</span><small>' + (profit != null ? fmtCell(sales) + ' × ' + pct + '%' : 'appears when you type the %') + '</small></div><b class="shv" id="scProfit">' + (profit != null ? inr(profit) : '—') + '</b></div>';
    h += '<div class="card stack shexp" style="gap:6px"><div class="row between"><span class="lab">Expenses today</span><b id="scExpT">' + inr(et) + '</b></div>' + exp.map(function (e, i) {
      return '<div class="row shexr" style="gap:8px"><input class="tkin" data-ei="' + i + '" data-ek="t" value="' + esc(e.t) + '" placeholder="what"><label class="shmoney sm">₹<input data-ei="' + i + '" data-ek="v" inputmode="decimal" value="' + (e.v || '') + '"></label><button type="button" class="tkx" data-edel="' + i + '" aria-label="Remove">✕</button></div>';
    }).join('') + '<button type="button" class="link" id="scAddExp" style="align-self:flex-start">+ Add expense</button>' + (d.written && d.written.expenses && Math.abs(d.written.expenses - et) > .5 ? '<span class="muted small">The sheet’s written expense total is ' + inr(d.written.expenses) + '</span>' : '') + '</div>';
    h += '<div class="shnet"><div><span class="cap">Net income</span><small>profit − expenses</small></div><b class="display" id="scNet">' + (net != null ? inr(net) : '—') + '</b></div>';
    h += '<p class="muted small" id="scCash">Cash in hand (sales − expenses): <b>' + inr(sales - et) + '</b>' + (d.written && d.written.balance ? ' · sheet says ' + inr(d.written.balance) : '') + '</p>';
    var mn = new Date(sp.k + 'T00:00:00').toLocaleDateString('en', { month: 'long' });
    if (d.status === 'closed') h += '<div class="row" style="gap:8px"><button type="button" class="btn jungle" style="flex:1" id="scCard">🖼 Daily card</button><button type="button" class="btn wa" style="flex:1" id="scWa">Text summary</button></div>';
    h += '<div class="row" style="gap:10px"><button type="button" class="btn line" id="scBack">‹ Sheet</button><button type="button" class="btn coral" style="flex:1" id="scSave">' + (d.status === 'closed' ? 'Update ' + mn + ' file' : 'Save to ' + mn + ' file') + '</button></div>';
    return h;
  }
  function bindShopClose(o, d) {
    var s2 = shop(), q = function (x) { return o.querySelector(x); };
    var calc = function () {
      var sales = num(q('#scSales').value), pv = q('#scPct').value.trim(), pct = pv === '' ? null : num(pv), et = (d.exp || []).reduce(function (a, e) { return a + num(e.v); }, 0);
      var profit = pct != null ? sales * pct / 100 : null;
      q('#scProfit').textContent = profit != null ? inr(profit) : '—'; q('#scExpT').textContent = inr(et);
      q('#scNet').textContent = profit != null ? inr(profit - et) : '—';
      q('#scCash').innerHTML = 'Cash in hand (sales − expenses): <b>' + inr(sales - et) + '</b>';
      return { sales: sales, pct: pct, profit: profit, et: et };
    };
    q('#scSales').addEventListener('input', function () { var v = num(q('#scSales').value); d.salesOverride = Math.abs(v - daySales(d)) > .5 ? v : null; save(); calc(); });
    q('#scPct').addEventListener('input', function () { var v = q('#scPct').value.trim(); d.pct = v === '' ? null : num(v); save(); calc(); });
    o.querySelectorAll('[data-ei]').forEach(function (el) { el.addEventListener('input', function () { var e = d.exp[+el.dataset.ei]; e[el.dataset.ek] = el.dataset.ek === 'v' ? num(el.value) : el.value; save(); calc(); }); });
    o.querySelectorAll('[data-edel]').forEach(function (b) { b.onclick = function () { d.exp.splice(+b.dataset.edel, 1); save(); drawShopDay(); }; });
    q('#scAddExp').onclick = function () { (d.exp = d.exp || []).push({ t: '', v: 0 }); save(); drawShopDay(); var ins = o.querySelectorAll('[data-ek="t"]'); if (ins.length) ins[ins.length - 1].focus(); };
    q('#scBack').onclick = function () { sp.step = 'sheet'; drawShopDay(); };
    var au = q('#scAuto'); if (au) au.onclick = function () { d.pct = null; save(); drawShopDay(); };
    var cdb = q('#scCard'); if (cdb) cdb.onclick = function () { var k3 = sp.k; closeShopDay(); openSheet('shopcard:' + k3); };
    var wa = q('#scWa'); if (wa) wa.onclick = function () { waShare(daySummaryText(sp.k)); };
    q('#scSave').onclick = function () {
      var c = calc(); if (c.pct == null) { toast('Type the profit percentage first'); q('#scPct').focus(); return; }
      d.sales = c.sales; d.pct = c.pct; d.profit = c.profit; d.expTotal = c.et; d.net = c.profit - c.et; d.cash = c.sales - c.et; d.status = 'closed'; d.closedAt = new Date().toISOString(); d.ask = []; regSync(); inkLearnDay(sp.k);
      s2.pct = c.pct; save();
      var ck2 = sp.k; closeShopDay(); toast('Saved · net ' + inr(d.net));
      if (s2.waAsk !== false) openSheet('shopshare:' + ck2);
    };
  }

  // --- month file: Excel (sheet per day + summary) or PDF ---
  function shopMonthSheet(m) {
    var ks = shopMonthDays(m).slice().reverse(), s2 = shop(), mt = monthTotals(m), md = new Date(m + '-01T00:00:00');
    var h = '<div class="shmtab"><table><thead><tr><th>Date</th><th>Sales</th><th>Profit</th><th>Exp.</th><th>Net</th></tr></thead><tbody>' + ks.map(function (k) {
      var d = s2.days[k], c = d.status === 'closed';
      return '<tr' + (c ? '' : ' class="open"') + ' data-shday="' + k + '"><td>' + new Date(k + 'T00:00:00').getDate() + ' ' + md.toLocaleDateString('en', { month: 'short' }) + '</td><td>' + (c ? fmtCell(d.sales) : 'open') + '</td><td>' + (c ? fmtCell(Math.round(d.profit)) : '') + '</td><td>' + (c ? fmtCell(d.expTotal) : '') + '</td><td>' + (c ? fmtCell(Math.round(d.net)) : '') + '</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td>Total</td><td>' + fmtCell(mt.sales) + '</td><td>' + fmtCell(Math.round(mt.profit)) + '</td><td>' + fmtCell(mt.exp) + '</td><td>' + fmtCell(Math.round(mt.net)) + '</td></tr></tfoot></table></div>';
    if (!ks.length) h = '<p class="muted">No days in this month yet.</p>';
    h += '<span class="cap">Inside the Excel file</span><div class="optrow"><span class="opt sm">📊 Month summary</span>' + ks.filter(function (k) { return s2.days[k].grid; }).map(function (k) { return '<span class="opt sm">📄 ' + new Date(k + 'T00:00:00').getDate() + ' ' + md.toLocaleDateString('en', { month: 'short' }) + '</span>'; }).join('') + '</div>';
    h += '<div class="row" style="gap:10px"><button type="button" class="btn jungle" style="flex:1" id="smXls"' + (ks.length ? '' : ' disabled') + '>Share Excel</button><button type="button" class="btn line" style="flex:1" id="smPdf"' + (ks.length ? '' : ' disabled') + '>Save as PDF</button></div>';
    if (ks.length) h += '<button type="button" class="btn line" id="smRe">↻ Recalculate profit with KSBCL costs</button>';
    if (ks.length) h += '<button type="button" class="btn wa" id="smWa">Share the month on WhatsApp</button>';
    h += '<p class="muted small">Each closed day adds its own sheet and a row to the summary. Days still open are left out of the totals.</p>';
    return { title: md.toLocaleDateString('en', { month: 'long', year: 'numeric' }), cap: esc(s2.name), html: h, bind: function (r) {
      r.querySelectorAll('[data-shday]').forEach(function (tr) { tr.onclick = function () { openShopDay(tr.dataset.shday); }; });
      var x = r.querySelector('#smXls'); if (x) x.onclick = function () { shopExcel(m); };
      var p = r.querySelector('#smPdf'); if (p) p.onclick = function () { shopPdf(m); };
      var re = r.querySelector('#smRe'); if (re) re.onclick = function () {
        var n = 0, skip = 0;
        ks.forEach(function (k) { var d = s2.days[k]; if (d.status !== 'closed' || !d.grid) return; var pr = profitRows(d, k); if (pr.avg == null) { skip++; return; } var pct = Math.round(pr.avg * 10) / 10; if (pct === d.pct) return; d.pct = pct; d.profit = d.sales * pct / 100; d.net = d.profit - (d.expTotal || 0); n++; });
        save(); drawSheet(); toast(n ? n + ' day' + (n > 1 ? 's' : '') + ' updated' + (skip ? ' · ' + skip + ' without costs left as they were' : '') : skip ? 'No costs for those days yet: link items to your bills or indents' : 'Already up to date');
      };
      var wm = r.querySelector('#smWa'); if (wm) wm.onclick = function () { waShare(monthSummaryText(m)); };
    } };
  }
  var XLS = null;
  function loadXlsx() { return window.XLSX ? Promise.resolve(window.XLSX) : XLS || (XLS = loadScript('xlsx.mini.min.js').then(function () { return window.XLSX; }).catch(function (e) { XLS = null; throw e; })); }
  function shopExcel(m) {
    toast('Building the Excel file…');
    loadXlsx().then(function (X) {
      var s2 = shop(), ks = shopMonthDays(m).slice().reverse(), wb2 = X.utils.book_new(), md = new Date(m + '-01T00:00:00');
      var mname = md.toLocaleDateString('en', { month: 'long', year: 'numeric' });
      // summary
      var sum = [[s2.name + ' · ' + mname], [], ['Date', 'Total sales', 'Profit %', 'Profit', 'Expenses', 'Net income', 'Cash in hand']], r0 = 4;
      ks.forEach(function (k) { var d = s2.days[k]; if (d.status !== 'closed') return; sum.push([k, d.sales, d.pct, Math.round(d.profit * 100) / 100, d.expTotal, Math.round(d.net * 100) / 100, d.cash]); });
      var last = sum.length;
      var ws = X.utils.aoa_to_sheet(sum);
      ['B', 'D', 'E', 'F', 'G'].forEach(function (c) { ws[c + (last + 1)] = { t: 'n', f: 'SUM(' + c + r0 + ':' + c + last + ')' }; });
      ws['A' + (last + 1)] = { t: 's', v: 'Total' };
      ws['!ref'] = 'A1:G' + (last + 1); ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 13 }];
      X.utils.book_append_sheet(wb2, ws, 'Month summary');
      // one sheet per day, formulas kept
      ks.forEach(function (k) {
        var d = s2.days[k]; if (!d.grid) return;
        var aoa = [[s2.name + ' · Statement of Sales · ' + k], []], g = d.grid, off = 2;
        g.forEach(function (rw) { aoa.push(rw.map(function () { return ''; })); });
        var sh = X.utils.aoa_to_sheet(aoa);
        g.forEach(function (rw, r) {
          rw.forEach(function (v, c) {
            var ref = colName(c) + (r + off + 1);
            if (typeof v === 'string' && v.charAt(0) === '=') {
              // shift references down by the 2 title rows
              var f = v.slice(1).replace(/(\$?[A-Z]{1,2}\$?)(\d+)/g, function (all, L, n) { return L + (+n + off); });
              var cv = cellVal(g, r, c); sh[ref] = { t: typeof cv === 'number' ? 'n' : 's', v: cv, f: f };
            } else if (r > 0 && isNum(v)) sh[ref] = { t: 'n', v: num(v) };
            else if (v !== '' && v != null) sh[ref] = { t: 's', v: String(v) };
          });
        });
        var rr = g.length + off + 2;
        var put = function (a, b, f) { sh['A' + rr] = { t: 's', v: a }; sh['B' + rr] = f ? { t: 'n', v: b, f: f } : (typeof b === 'number' ? { t: 'n', v: b } : { t: 's', v: String(b == null ? '' : b) }); rr++; };
        sh['A' + rr] = { t: 's', v: 'Expenses' }; rr++;
        var e0 = rr;
        (d.exp || []).forEach(function (e) { sh['A' + rr] = { t: 's', v: e.t || 'expense' }; sh['B' + rr] = { t: 'n', v: num(e.v) }; rr++; });
        var e1 = rr - 1; rr++;
        var salesRow = rr; put('Total sales', d.status === 'closed' ? d.sales : daySales(d));
        var pctRow = rr; put('Profit %', d.pct == null ? '' : d.pct);
        var profRow = rr; put('Profit', d.profit || 0, 'B' + salesRow + '*B' + pctRow + '/100');
        var expRow = rr; put('Expenses', d.expTotal || 0, e1 >= e0 ? 'SUM(B' + e0 + ':B' + e1 + ')' : '0');
        put('Net income', d.net || 0, 'B' + profRow + '-B' + expRow);
        put('Cash in hand', d.cash || 0, 'B' + salesRow + '-B' + expRow);
        sh['!ref'] = 'A1:' + colName(SHCOLS.length - 1) + rr;
        sh['!cols'] = SHCOLS.map(function (c, i) { return { wch: i === 0 ? 22 : 10 }; });
        var nm = new Date(k + 'T00:00:00').getDate() + ' ' + md.toLocaleDateString('en', { month: 'short' });
        X.utils.book_append_sheet(wb2, sh, nm);
      });
      var out = X.write(wb2, { bookType: 'xlsx', type: 'array' }), fname = s2.name.replace(/[^A-Za-z0-9]+/g, '-') + '-' + m + '.xlsx';
      var file = new File([out], fname, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      shareFile(file, s2.name + ' · ' + mname);
    }).catch(function (e) { toast('Couldn’t build the file: ' + (e.message || e)); });
  }
  function shareFile(file, title) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: title }).catch(function () {}); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast('Saved to Downloads');
  }
  function shopPdf(m) {
    var s2 = shop(), ks = shopMonthDays(m).slice().reverse(), mt = monthTotals(m), md = new Date(m + '-01T00:00:00'), mname = md.toLocaleDateString('en', { month: 'long', year: 'numeric' });
    var css = 'body{font-family:Arial,sans-serif;color:#16302A;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:8px}th,td{border:1px solid #cfc6b6;padding:4px 6px;text-align:right}th{background:#0F4D40;color:#fff}td:first-child,th:first-child{text-align:left}tfoot td{font-weight:bold;background:#FFE6B8}.pb{page-break-before:always}';
    var h = '<h1>' + esc(s2.name) + ' · ' + mname + '</h1><table><thead><tr><th>Date</th><th>Sales</th><th>Profit %</th><th>Profit</th><th>Expenses</th><th>Net</th><th>Cash</th></tr></thead><tbody>' +
      ks.filter(function (k) { return s2.days[k].status === 'closed'; }).map(function (k) { var d = s2.days[k]; return '<tr><td>' + k + '</td><td>' + fmtCell(d.sales) + '</td><td>' + d.pct + '</td><td>' + fmtCell(Math.round(d.profit)) + '</td><td>' + fmtCell(d.expTotal) + '</td><td>' + fmtCell(Math.round(d.net)) + '</td><td>' + fmtCell(d.cash) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td>' + fmtCell(mt.sales) + '</td><td></td><td>' + fmtCell(Math.round(mt.profit)) + '</td><td>' + fmtCell(mt.exp) + '</td><td>' + fmtCell(Math.round(mt.net)) + '</td><td>' + fmtCell(mt.cash) + '</td></tr></tfoot></table>';
    ks.forEach(function (k) {
      var d = s2.days[k]; if (!d.grid) return; var g = d.grid;
      h += '<h2 class="pb">' + k + '</h2><table><thead><tr>' + SHCOLS.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + g.slice(1).map(function (rw, i) { return '<tr>' + rw.map(function (v, c) { return '<td>' + esc(fmtCell(cellVal(g, i + 1, c))) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
      if (d.status === 'closed') h += '<table style="width:50%"><tr><td>Total sales</td><td>' + fmtCell(d.sales) + '</td></tr><tr><td>Profit (' + d.pct + '%)</td><td>' + fmtCell(Math.round(d.profit)) + '</td></tr><tr><td>Expenses</td><td>' + fmtCell(d.expTotal) + '</td></tr><tr><td><b>Net income</b></td><td><b>' + fmtCell(Math.round(d.net)) + '</b></td></tr></table>';
    });
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    var doc = f.contentWindow.document; doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(s2.name) + ' ' + m + '</title><style>' + css + '</style></head><body>' + h + '</body></html>'); doc.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Printing isn’t available here'); } setTimeout(function () { f.remove(); }, 60000); }, 300);
    toast('Choose “Save as PDF”, then share it');
  }
  function shopLearnSheet() {
    var s2 = shop(), ks = Object.keys(s2.gloss).sort(function (a, b) { return s2.gloss[b].n - s2.gloss[a].n; });
    var h = '<p class="muted" style="margin:0">Every time you fix a brand name the AI misread, the app remembers it. Next time it reads that word the right way, and the names you’ve used before guide it too.</p>';
    h += '<div class="list">' + row({ t: '📚 Teach from old sheets', sub: teachSub(), sheet: 'shopteach' }) + '</div>';
    if (learnt().usual.length || learnt().examples.length) h += learnedHtml();
    h += ks.length ? '<div class="list">' + ks.map(function (k) { return '<div class="r"><span class="t"><span class="hw">' + esc(k) + '</span> → ' + esc(s2.gloss[k].to) + '<small>fixed ' + s2.gloss[k].n + '×</small></span><button type="button" class="fx" data-gdel="' + esc(k) + '" aria-label="Forget">×</button></div>'; }).join('') + '</div>' : '<div class="notice">Nothing learnt yet. Fix a misread name in the Item column and it shows up here.</div>';
    h += '<div class="card stack" style="gap:6px"><span class="cap">Checks on every sheet</span><span style="font-size:13px;line-height:1.6">✓ Opening matches yesterday’s closing<br>✓ Opening + received − sales = closing<br>✓ Sales × rate = amount<br>✓ Amounts add up to the written total</span></div>';
    h += '<p class="muted small">' + s2.fixes + ' corrections so far. Photos are read by Google’s Gemini using your own key. Everything else stays on your phone.</p>';
    return { title: 'Learning', cap: ks.length + ' words', html: h, bind: function (r) { fillThumbs(r); r.querySelectorAll('[data-gdel]').forEach(function (b) { b.onclick = function () { delete s2.gloss[b.dataset.gdel]; save(); drawSheet(); }; }); } };
  }
  function shopSetSheet() {
    var s2 = shop();
    var h = '<label class="lab rng">Shop name<input class="text" id="ssName" value="' + esc(s2.name) + '"></label><label class="lab rng">Usual profit %<input class="text" id="ssPct" inputmode="decimal" value="' + (s2.pct == null ? '' : s2.pct) + '" placeholder="e.g. 20"></label><label class="lab rng">Handwriting match needed (%)<input class="text" id="ssInk" inputmode="numeric" value="' + inkThr() + '"><small class="muted">80 = his writing must look at least 80% like earlier samples to count as the same name</small></label><button type="button" class="btn jungle" id="ssSave">Save</button><div class="list" style="margin-top:8px">' + row({ t: '🧹 Start fresh', sub: 'delete old sheets, bills or learning', sheet: 'shopreset' }) + '</div>';
    return { title: 'Shop settings', cap: '', html: h, bind: function (r) { r.querySelector('#ssSave').onclick = function () { s2.name = r.querySelector('#ssName').value.trim() || 'My shop'; var p = r.querySelector('#ssPct').value.trim(); s2.pct = p === '' ? null : num(p); var ik = num(r.querySelector('#ssInk').value); s2.inkThr = ik >= 40 && ik <= 99 ? ik : 80; save(); closeSheet(); render(); }; } };
  }

  // ---------- Teach from old sheets: read many past sheets once, learn his names, habits and usual list ----------
  var TT = { busy: false, th: {}, adding: null, tab: 'sure', names: null, lock: null };
  function teach() {
    var s2 = shop(); s2.teach = s2.teach || { jobs: [], backfill: true, stage: 'pick', pick: {} }; s2.teach.pick = s2.teach.pick || {};
    return s2.teach;
  }
  function teachSub() { var t = teach(), n = t.jobs.length, dn = t.jobs.filter(function (j) { return j.st !== 'wait'; }).length; return t.stage === 'reading' ? (t.running ? 'reading ' : 'paused · ') + dn + ' of ' + n + ' sheets' : t.stage === 'names' ? 'all read · confirm his short names' : learnt().sheets ? 'learnt from ' + learnt().sheets + ' sheets · add more' : 'read many past sheets at once so it learns faster'; }
  function learnt() { var s2 = shop(); s2.learn = s2.learn || { digits: {}, notes: {}, usual: [], examples: [] }; return s2.learn; }
  var DIGNAME = function (p) { var a = p.split('>'); return 'his ' + a[1] + ' gets read as ' + a[0]; };
  // hints for the AI from everything learnt so far
  function learnHints() {
    var L = learnt(), out = '';
    if (L.usual.length) out += 'The items this shop usually writes, in their usual order (a smudged name is most likely the item in that position): ' + L.usual.slice(0, 80).map(function (x) { return x.item + (x.size ? ' ' + x.size : ''); }).join('; ') + '.\n';
    var dg = Object.keys(L.digits).filter(function (k) { return L.digits[k] >= 2; }).sort(function (a, b) { return L.digits[b] - L.digits[a]; }).slice(0, 6);
    if (dg.length) out += 'Digits that are easy to misread in this writer’s hand: ' + dg.map(function (p) { var a = p.split('>'); return 'his "' + a[1] + '" looks like "' + a[0] + '"'; }).join('; ') + '. Only when a digit is unclear, use the row (opening + received − sales = closing, sales × rate = amount) to decide.\n';
    var nt = Object.keys(L.notes).filter(function (k) { return L.notes[k] >= 2; }).sort(function (a, b) { return L.notes[b] - L.notes[a]; }).slice(0, 6);
    if (nt.length) out += 'How this writer writes: ' + nt.join('; ') + '.\n';
    return out;
  }
  function shopHints() {
    var s2 = shop(), known = {}; bills();
    Object.keys(s2.days).forEach(function (k) { var g = s2.days[k].grid; if (g) dataRows(g).forEach(function (r) { if (g[r][0]) known[g[r][0]] = 1; }); });
    Object.keys(s2.items).forEach(function (k) { known[s2.items[k].item + (s2.items[k].size ? ' ' + s2.items[k].size : '')] = 1; });
    var mine = []; Object.keys(s2.items).forEach(function (k) { var x = s2.items[k]; Object.keys(x.alias || {}).forEach(function (a) { mine.push({ a: a, t: x.item + ' ' + (x.size || ''), n: x.alias[a] }); }); });
    mine.sort(function (a, b) { return b.n - a.n; });
    var al0 = mine.slice(0, 150).map(function (m) { return '"' + m.a + '" = ' + m.t.trim(); });
    var al = Object.keys(s2.alias).map(function (k) { return '"' + k + '" = ' + s2.alias[k]; });
    var gl = Object.keys(s2.gloss).sort(function (a, b) { return s2.gloss[b].n - s2.gloss[a].n; }).slice(0, 120).map(function (k) { return '"' + k + '" → "' + s2.gloss[k].to + '"'; });
    return (Object.keys(known).length ? 'Items this shop stocks (from its sheets, bills and indents): ' + Object.keys(known).slice(0, 250).join(', ') + '.\n' : '') +
      (al0.length ? 'How this writer writes them (his short name = the item): ' + al0.join('; ') + '. Write the name as he wrote it on the page.\n' : '') +
      (al.length ? 'Short names this shop uses and the full brand they stand for (from KSBCL bills): ' + al.slice(0, 120).join('; ') + '. Write the short name the shop uses.\n' : '') +
      (gl.length ? 'This writer’s short names and what they mean (read these the corrected way): ' + gl.join('; ') + '.\n' : '') + learnHints();
  }
  // example pages (photo + correct reading) shown to the AI before the new day's photos
  function exampleParts() {
    var ex = learnt().examples.slice(0, 3);
    return Promise.all(ex.map(function (e) { return idbGet('shopimg-' + e.id).catch(function () { return null; }); })).then(function (us) {
      return Promise.all(us.map(function (u) { return u ? shrinkImage(u, 1400) : null; })).then(function (s) {
        var parts = [];
        s.forEach(function (u, i) {
          if (!u) return;
          parts.push({ inline_data: { mime_type: 'image/jpeg', data: u.split(',')[1] } });
          parts.push({ text: 'EXAMPLE ' + (parts.length / 2 + .5 | 0) + ': a page in this same handwriting, read correctly (item, size, opening, received, total, sales, rate, amount, closing):\n' + ex[i].rows.slice(0, 30).map(function (r) { return r.slice(0, 9).join(' | '); }).join('\n') });
        });
        if (parts.length) parts.push({ text: 'Those were examples only. Now read the NEW page(s) below.' });
        return parts;
      });
    }).catch(function () { return []; });
  }
  function geminiImagesEx(prompt, dataUrls, temp) {
    return exampleParts().then(function (pre) {
      return Promise.all(dataUrls.map(function (u) { return shrinkImage(u, 1800); })).then(function (us) {
        var parts = pre.concat(us.map(function (u) { return { inline_data: { mime_type: 'image/jpeg', data: u.split(',')[1] } }; }));
        parts.push({ text: prompt });
        return geminiCall({ contents: [{ parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: temp == null ? .1 : temp } });
      });
    }).then(function (t) { return JSON.parse(t.replace(/^\s*```(json)?/, '').replace(/```\s*$/, '')); });
  }
  function teachPrompt() {
    return 'This photo is ONE page of a handwritten "Statement of Sales" from a liquor shop in Karnataka, India (Laxmi Wines). Read every filled row carefully.\n' +
      'Columns on the form: Type of Liquors (brand + size), Opening Balance, Stock Received, Total, Sales, Rate, Amount (Rs.), Closing Balance, Remarks.\n' +
      'Each numbered row (Sl. No.) on the form is ONE row in your answer: same order, never merge, split, skip or invent rows. The "Type of Liquor" column has a handwritten brand name and, at its right end, the bottle size in ml (60, 90, 180, 275, 330, 375, 500, 650, 750, 1000, 2000). Copy the size exactly as written: 60 is common, never change it to 90. Put the size in "size", never inside "item".\n' +
      'A row with ONLY a size (no name) is the same brand as the nearest row above it that has a name: repeat that brand. A row with its OWN handwritten name is a NEW brand, however short or abbreviated (like "RC W", "R Stg", "BCD", "N.P."): write that name, never the brand from above. Names can also be in Kannada. A price like 650 or 330 written next to a beer can be its size; anything else goes in "remarks".\n' +
      'A dash "-" or "—" in a number column means 0. Skip rows with no numbers at all. Keep numbers exactly as written; do not correct the maths.\n' +
      'Return any list of expenses and written day totals too. Read the date written on the page (Indian day/month/year order) as "YYYY-MM-DD", or null if there is none.\n' +
      'If the photo is too blurry to read or is not a sales sheet, set "readable" to false.\n' +
      'In "notes" give up to 3 short, general observations about HOW this person writes (for example "a dash means 0", "½ next to a beer means 650 ml", "cases and bottles written as 2-6"), only if clearly seen on this page.\n' +
      shopHints() +
      'Reply JSON: {"readable":true,"date":"YYYY-MM-DD"|null,"rows":[{"sl":1,"item":"brand","size":"750","open":number|null,"recv":number|null,"total":number|null,"sales":number|null,"rate":number|null,"amount":number|null,"close":number|null,"remarks":"text"}],"expenses":[{"name":"text","amount":number}],"written":{"sales":number|null,"expenses":number|null,"balance":number|null},"notes":["..."]}';
  }
  function teachWake(on) {
    if (on) { if (TT.lock || !('wakeLock' in navigator)) return; navigator.wakeLock.request('screen').then(function (w) { TT.lock = w; w.addEventListener('release', function () { TT.lock = null; }); }).catch(function () {}); }
    else if (TT.lock) { try { TT.lock.release(); } catch (e) {} TT.lock = null; }
  }
  function teachDraw() {
    if (ui.sheet && ui.sheet.kind === 'shopteach') drawSheet();
    var dm = document.getElementById('tdim'); if (dm) { var t = teach(), n = t.jobs.length, dn = t.jobs.filter(function (j) { return j.st !== 'wait'; }).length; dm.querySelector('b').textContent = t.stage === 'reading' ? dn + ' / ' + n : '✓'; dm.querySelector('span').textContent = t.stage === 'reading' ? (t.running ? 'Reading his sheets… keep the phone on charge' : 'Paused') : 'All read. Tap to see the names'; }
    if (ui.tab === 'shop' && !ui.sheet && !sp && !bp) render();
  }
  function teachDim(on) {
    var dm = document.getElementById('tdim');
    if (!on) { if (dm) dm.remove(); return; }
    if (dm) return;
    dm = document.createElement('div'); dm.id = 'tdim'; dm.setAttribute('role', 'button'); dm.setAttribute('aria-label', 'Wake the screen');
    dm.innerHTML = '<b class="display"></b><span></span><small>tap to wake</small>';
    dm.onclick = function () { teachDim(false); }; document.body.appendChild(dm); teachDraw();
  }
  // add photos one by one (keeps memory low even with 60+ big photos)
  function teachAdd(files) {
    var t = teach(); files = files.slice().sort(function (a, b) { return (a.lastModified - b.lastModified) || (a.name < b.name ? -1 : 1); });
    TT.adding = { i: 0, n: files.length }; teachDraw();
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () { return blobToDataURL(f); }).then(function (u) { return Promise.all([shrinkImage(u, 2000), shrinkImage(u, 200)]); }).then(function (a) {
        var id = 'tc' + Date.now().toString(36) + i;
        TT.th[id] = a[1];
        return Promise.all([idbPut('shopimg-' + id, a[0]), idbPut('teachth-' + id, a[1])]).then(function () { t.jobs.push({ id: id, st: 'wait' }); TT.adding.i = i + 1; if (i % 3 === 2) { save(); teachDraw(); } });
      }).catch(function () {});
    });
    chain.then(function () { TT.adding = null; if (t.stage === 'done') t.stage = 'pick'; save(); teachDraw(); });
  }
  function teachRun() {
    var t = teach(); if (TT.busy || !t.running) return;
    var j = t.jobs.filter(function (x) { return x.st === 'wait'; })[0];
    if (!j) { t.running = false; teachWake(false); save(); teachAnalyse(); return; }
    if (!hasAI()) { t.running = false; save(); toast('Reading needs your free Gemini key (Settings → Visualization)'); teachDraw(); return; }
    TT.busy = true; t.stage = 'reading'; teachWake(true); teachDraw();
    var gap = 4000;
    idbGet('shopimg-' + j.id).then(function (u) { if (!u) throw new Error('photo missing'); return geminiImages(teachPrompt(), [u], .1); }).then(function (r) {
      var nv2 = function (v) { return v == null || v === '' ? '' : String(v); };
      j.rows = (r.rows || []).filter(function (x) { return x && (x.item || x.open != null || x.sales != null); }).map(function (x) { var ss = splitSize(x.item, x.size); x.size = ss[1]; return [ss[0], nv2(x.size), nv2(x.open), nv2(x.recv), nv2(x.total), nv2(x.sales), nv2(x.rate), nv2(x.amount), nv2(x.close), nv2(x.remarks)]; });
      fillDownNames([SHCOLS].concat(j.rows));
      var dt = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date >= '2015-01-01' && r.date <= dkey(new Date()) ? r.date : null;
      j.date = dt; j.exp = (r.expenses || []).filter(function (e) { return e && (e.name || e.amount); }).map(function (e) { return { t: String(e.name || ''), v: num(e.amount) }; });
      j.written = r.written || {}; j.notes = (r.notes || []).slice(0, 3).map(function (x) { return String(x).trim().toLowerCase().replace(/\.$/, ''); }).filter(Boolean);
      j.st = r.readable === false || !j.rows.length ? 'bad' : 'read';
    }).catch(function (e) {
      j.tries = (j.tries || 0) + 1; gap = 10000;
      if (j.tries >= 3) { j.st = 'err'; j.err = String(e.message || e).slice(0, 80); }
    }).then(function () {
      TT.busy = false; save(); teachDraw();
      if (t.running) setTimeout(teachRun, document.hidden ? 1000 : gap);
    });
  }
  // a misread digit: same length, exactly one digit different → "read>meant"
  function digitSwap(a, b) {
    a = String(a == null ? '' : a).replace(/[,\s]/g, ''); b = String(b); if (!/^\d+$/.test(a) || a.length !== b.length || a === b) return null;
    var p = null; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (p) return null; p = a[i] + '>' + b[i]; } return p;
  }
  function addDays(k, n) { var d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return dkey(d); }
  // all read pages grouped by date, with the numbers checked across days and fixed where two checks agree
  function teachDays() {
    var t = teach(), s2 = shop(), by = {}, checked = 0;
    var mapName = function (x) { var g = s2.gloss[String(x).trim().toLowerCase()]; return g ? g.to : String(x).trim(); };
    t.jobs.forEach(function (j) {
      if (j.st !== 'read') return;
      j.rows.forEach(function (r) { [2, 3, 5, 6, 7, 8].forEach(function (c) { if (isNum(r[c])) checked++; }); });
      if (!j.date) return;
      var D = by[j.date] = by[j.date] || { k: j.date, rows: [], ids: [], exp: [], written: {} };
      D.ids.push(j.id); (j.exp || []).forEach(function (e) { D.exp.push(e); });
      Object.keys(j.written || {}).forEach(function (f) { if (j.written[f] != null) D.written[f] = j.written[f]; });
      j.rows.forEach(function (r) { var c = r.slice(); c[0] = mapName(r[0]); c.job = j.id; c.hw = r[0]; D.rows.push(c); });
    });
    var ks = Object.keys(by).sort(), fixes = [], digits = {};
    var key = function (r) { return normName(r[0]).replace(/ /g, '') + '|' + String(r[1] || '').replace(/[^0-9]/g, ''); };
    var colMap = function (D, c) { var m = {}; D.rows.forEach(function (r) { if (isNum(r[c])) m[key(r)] = num(r[c]); }); return m; };
    var dshort = function (k) { return new Date(k + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }); };
    ks.forEach(function (k, i) {
      var D = by[k], P = i && ks[i - 1] === addDays(k, -1) ? by[ks[i - 1]] : null, N = ks[i + 1] === addDays(k, 1) ? by[ks[i + 1]] : null;
      var pc = P ? colMap(P, 8) : {}, no = N ? colMap(N, 2) : {};
      D.rows.forEach(function (r) {
        var v = function (c) { return isNum(r[c]) ? num(r[c]) : null; }, kk = key(r);
        var fix = function (c, to, why) { var p = digitSwap(r[c], to); if (!p) return false; fixes.push({ k: k, item: r[0], hw: r.hw, size: r[1], col: c, from: r[c], to: String(to), why: why }); digits[p] = (digits[p] || 0) + 1; r[c] = String(to); return true; };
        var o = v(2), rc = v(3) || 0, sl = v(5), rt = v(6), am = v(7), cl = v(8);
        if (o != null && sl != null && cl != null && Math.abs(o + rc - sl - cl) > .01) {
          var cl2 = o + rc - sl, o2 = cl - rc + sl, sl2 = o + rc - cl;
          if (N && no[kk] === cl2 && fix(8, cl2, 'Opening on ' + dshort(N.k) + ' was ' + cl2 + ', and ' + (o + rc) + ' − ' + sl + ' sold = ' + cl2 + '.')) {}
          else if (P && pc[kk] === o2 && fix(2, o2, dshort(P.k) + ' closed at ' + o2 + ', and ' + cl + ' + ' + sl + ' sold = ' + o2 + '.')) {}
          else if (rt && am != null && sl2 > 0 && Math.abs(sl2 * rt - am) < .5 && fix(5, sl2, sl2 + ' × ₹' + rt + ' = ₹' + am + ', and ' + (o + rc) + ' − ' + cl + ' = ' + sl2 + '.')) { sl = sl2; }
        }
        sl = v(5);
        if (sl != null && rt && am != null && Math.abs(sl * rt - am) > .5) {
          if (fix(7, Math.round(sl * rt), sl + ' × ₹' + rt + ' = ₹' + Math.round(sl * rt) + '.')) {}
          else if (sl && Math.abs(am / sl - Math.round(am / sl)) < 1e-9) fix(6, Math.round(am / sl), '₹' + am + ' ÷ ' + sl + ' = ₹' + Math.round(am / sl) + '.');
        }
      });
    });
    return { by: by, ks: ks, fixes: fixes, digits: digits, checked: checked };
  }
  // every short name he writes, matched to the price list
  function teachNames() {
    var t = teach(), s2 = shop(), cnt = {}, out = [];
    t.jobs.forEach(function (j) { if (j.st === 'read') j.rows.forEach(function (r) { var hw = String(r[0] || '').trim(); if (!hw) return; var sz = String(r[1] || '').replace(/[^0-9]/g, ''), k = hw + '|' + sz; cnt[k] = cnt[k] || { hw: hw, size: sz, n: 0 }; cnt[k].n++; }); });
    Object.keys(cnt).forEach(function (k) {
      var x = cnt[k], g = s2.gloss[x.hw.toLowerCase()], full = (s2.alias || {})[x.hw];
      var c = plSearch((g ? g.to : full || x.hw) + (x.size ? ' ' + x.size : ''), 5, x.size, true);
      var conf;
      if (g) { conf = 'known'; c = c.filter(function (y) { return normName(y.it.name) !== normName(g.to); }); }
      else if (!c.length) conf = 'none';
      else { var top = c[0], gap = c[1] ? top.s - c[1].s : 1; conf = normName(top.it.name) === normName(x.hw) ? 'same' : top.s >= 1.15 && gap >= .12 ? 'sure' : top.s >= .9 ? 'likely' : 'pick'; }
      out.push({ k: k, hw: x.hw, size: x.size, n: x.n, cands: c, conf: conf, known: g ? g.to : null });
    });
    out.sort(function (a, b) { return b.n - a.n; });
    out.forEach(function (x) { if (t.pick[x.k] == null) t.pick[x.k] = x.conf === 'none' || x.conf === 'pick' ? '' : x.conf === 'known' ? 'k' : '0'; });
    return out;
  }
  function teachTab(x) { return x.conf === 'none' ? 'new' : x.conf === 'likely' || x.conf === 'pick' ? 'check' : 'sure'; }
  function teachAnalyse() {
    var t = teach(); t.stage = 'names'; TT.tab = 'sure'; save();
    loadPL().then(function () { TT.names = teachNames(); save(); teachDraw(); if (!ui.sheet || ui.sheet.kind !== 'shopteach') toast('All sheets read · check the names in Shop → Teach'); });
  }
  function teachFinish() {
    var t = teach(), s2 = shop(), L = learnt(), names = TT.names || teachNames(), named = 0;
    names.forEach(function (x) {
      var p = t.pick[x.k]; if (p == null || p === '' || p === 'k') return;
      var c = x.cands[+p]; if (!c) return;
      var gk = x.hw.toLowerCase(); s2.gloss[gk] = { to: c.it.name, n: Math.max(x.n, (s2.gloss[gk] || {}).n || 0) }; named++;
    });
    var res = teachDays(), by = res.by, ks = res.ks;
    // his usual list, in his order
    var pos = {}; ks.forEach(function (k) { var rs = by[k].rows; rs.forEach(function (r, i) { if (!r[0]) return; var kk = r[0] + '|' + String(r[1] || '').replace(/[^0-9]/g, ''); var p = pos[kk] = pos[kk] || { item: r[0], size: String(r[1] || '').replace(/[^0-9]/g, ''), s: 0, n: 0 }; p.s += i / Math.max(1, rs.length - 1); p.n++; }); });
    var need = Math.max(2, Math.ceil(ks.length * .4));
    var usual = Object.keys(pos).map(function (k) { return pos[k]; }).filter(function (p) { return p.n >= need || ks.length < 3; }).sort(function (a, b) { return a.s / a.n - b.s / b.n; }).slice(0, 80).map(function (p) { return { item: p.item, size: p.size }; });
    if (usual.length) L.usual = usual;
    Object.keys(res.digits).forEach(function (p) { L.digits[p] = (L.digits[p] || 0) + res.digits[p]; });
    t.jobs.forEach(function (j) { if (j.st === 'read') (j.notes || []).forEach(function (n) { L.notes[n] = (L.notes[n] || 0) + 1; }); });
    // example pages: the cleanest, fullest pages from different days
    var clean = function (r) { var v = function (c) { return isNum(r[c]) ? num(r[c]) : null; }; var o = v(2), rc = v(3) || 0, sl = v(5), rt = v(6), am = v(7), cl = v(8); return !(o != null && sl != null && cl != null && Math.abs(o + rc - sl - cl) > .01) && !(sl != null && rt && am != null && Math.abs(sl * rt - am) > .5); };
    var pages = []; ks.forEach(function (k) { by[k].ids.forEach(function (id) { var rs = by[k].rows.filter(function (r) { return r.job === id; }); if (rs.length >= 5 && rs.every(clean)) pages.push({ id: id, date: k, rows: rs.map(function (r) { return r.slice(0, 10); }) }); }); });
    pages.sort(function (a, b) { return b.rows.length - a.rows.length; });
    var ex = [], used = {}; pages.forEach(function (p) { if (ex.length < 3 && !used[p.date]) { used[p.date] = 1; ex.push(p); } });
    if (ex.length) L.examples = ex;
    // fill the past days into the accounts
    var added = 0, closed = 0, skipped = 0;
    if (t.backfill) ks.forEach(function (k) {
      var D = by[k], ex2 = s2.days[k]; if (ex2 && ex2.grid) { skipped++; return; }
      var g = withTotalRow([SHCOLS.slice()].concat(D.rows.map(function (r) { return r.slice(0, 10); })));
      var d = s2.days[k] = { photos: D.ids.slice(), grid: g, ai: g.map(function (rw) { return rw.slice(); }), exp: D.exp.slice(), written: D.written, status: 'draft', at: new Date().toISOString(), src: 'teach' };
      added++;
      var pr = profitRows(d, k), pct = pr.avg != null ? Math.round(pr.avg * 10) / 10 : s2.pct;
      if (pct != null && pct !== '') { var sales = daySales(d), et = d.exp.reduce(function (a, e) { return a + num(e.v); }, 0); d.pct = pct; d.sales = sales; d.profit = sales * pct / 100; d.expTotal = et; d.net = d.profit - et; d.cash = sales - et; d.status = 'closed'; d.closedAt = new Date().toISOString(); closed++; }
    });
    // his short names go onto your items
    regSync(); names.forEach(function (x) { var p = t.pick[x.k], to = p === 'k' ? x.known : p != null && p !== '' && x.cands[+p] ? x.cands[+p].it.name : null; if (!to) return; regAll().forEach(function (y) { if (normName(y.item) === normName(to)) regAlias(y.key, x.hw, x.n); }); });
    L.sheets = (L.sheets || 0) + t.jobs.filter(function (j) { return j.st === 'read'; }).length; L.at = new Date().toISOString();
    t.result = { sheets: t.jobs.filter(function (j) { return j.st === 'read'; }).length, named: named, fixes: res.fixes.length, added: added, closed: closed, skipped: skipped, first: ks[0] || null };
    t.stage = 'done'; t.running = false; teachWake(false); save(); teachDraw();
  }
  // start again with new photos: drop the old photos that no day or example uses
  function teachReset() {
    var t = teach(), s2 = shop(), keep = {};
    Object.keys(s2.days).forEach(function (k) { (s2.days[k].photos || []).forEach(function (id) { keep[id] = 1; }); });
    learnt().examples.forEach(function (e) { keep[e.id] = 1; });
    t.jobs.forEach(function (j) { if (!keep[j.id]) { idbDel('shopimg-' + j.id).catch(function () {}); idbDel('teachth-' + j.id).catch(function () {}); } });
    s2.teach = { jobs: [], backfill: t.backfill, stage: 'pick', pick: {} }; TT.names = null; save(); teachDraw();
  }
  function thumbImg(id) { return '<img class="ttimg" data-tth="' + id + '" alt=""' + (TT.th[id] ? ' src="' + TT.th[id] + '"' : '') + '>'; }
  function fillThumbs(r) { r.querySelectorAll('[data-tth]').forEach(function (im) { var id = im.dataset.tth; if (TT.th[id]) return; idbGet('teachth-' + id).then(function (u) { if (u) { TT.th[id] = u; im.src = u; } }).catch(function () {}); }); }
  function shopTeachSheet() {
    var t = teach(), L = learnt(), h = '', cap = '', bind = [];
    var dshort = function (k) { return k ? new Date(k + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '?'; };
    var tile = function (v, l) { return '<div><b class="display">' + v + '</b><small>' + l + '</small></div>'; };
    if (t.stage === 'pick') {
      cap = 'from your old sheets';
      h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">How it learns</b>' + ['Reads every old sheet, one at a time.', 'Checks the numbers: each day’s <b>closing</b> must be the next day’s <b>opening</b>, and sold × rate = amount. Where one figure breaks both, it works out what he meant.', 'Collects all his short names and matches them to your price list in one go. You confirm once.', 'Keeps 3 clean sheets as examples it shows the AI every day after.'].map(function (x, i) { return '<div class="ttstep"><span>' + (i + 1) + '</span><p>' + x + '</p></div>'; }).join('') + '</div>';
      h += '<input type="file" id="ttFile" accept="image/*" multiple hidden><button type="button" class="ttdrop" id="ttAdd"' + (TT.adding ? ' disabled' : '') + '><span style="font-size:26px">📚</span><b>' + (TT.adding ? 'Adding photo ' + TT.adding.i + ' of ' + TT.adding.n + '…' : t.jobs.length ? 'Add more photos' : 'Add photos of old sheets') + '</b><small>Pick many at once · days in a row help most · 30 is plenty to start</small></button>';
      if (t.jobs.length) h += '<div class="ttgrid">' + t.jobs.slice(0, 11).map(function (j) { return '<div class="ttth">' + thumbImg(j.id) + '</div>'; }).join('') + (t.jobs.length > 11 ? '<div class="ttth more">+' + (t.jobs.length - 11) + '</div>' : '') + '</div>';
      h += '<label class="ttsw"><span><b>Also save these days to my accounts</b><small>fills in past months: sales, profit, stock</small></span><input type="checkbox" id="ttBack"' + (t.backfill ? ' checked' : '') + '><i></i></label>';
      if (!hasAI()) h += '<div class="notice">Reading needs your free Gemini key (Settings → Visualization).</div>';
      h += '<button type="button" class="btn jungle" id="ttGo"' + (t.jobs.length && !TT.adding && hasAI() ? '' : ' disabled') + '>Start learning' + (t.jobs.length ? ' · ' + t.jobs.length + ' sheet' + (t.jobs.length > 1 ? 's' : '') : '') + '</button>';
      if (t.jobs.length) h += '<button type="button" class="btn ghost small" id="ttClear">Remove these photos</button>';
      bind.push(function (r) {
        var f = r.querySelector('#ttFile'); r.querySelector('#ttAdd').onclick = function () { f.click(); };
        f.onchange = function () { var fs = [].slice.call(f.files); f.value = ''; if (fs.length) teachAdd(fs); };
        r.querySelector('#ttBack').onchange = function (e) { t.backfill = e.target.checked; save(); };
        r.querySelector('#ttGo').onclick = function () { t.running = true; t.stage = 'reading'; save(); teachRun(); };
        var c = r.querySelector('#ttClear'); if (c) c.onclick = function () { if (confirm('Remove the ' + t.jobs.length + ' photos?')) teachReset(); };
      });
    } else if (t.stage === 'reading') {
      var n = t.jobs.length, dn = t.jobs.filter(function (j) { return j.st !== 'wait'; }).length, cur = t.jobs.filter(function (j) { return j.st === 'wait'; })[0];
      var res = teachDays(), nm = {}; t.jobs.forEach(function (j) { if (j.st === 'read') j.rows.forEach(function (r) { if (r[0]) nm[r[0] + '|' + r[1]] = 1; }); });
      cap = (t.running ? 'reading sheet ' + Math.min(n, dn + 1) : 'paused at ' + dn) + ' of ' + n;
      h += '<div class="ttbar"><i style="width:' + Math.round(dn / Math.max(1, n) * 100) + '%"></i></div>';
      h += '<div class="shtiles ttq">' + tile(fmtN(Object.keys(nm).length), 'short names') + tile(fmtN(res.checked), 'numbers checked') + tile(res.fixes.length, 'figures fixed') + '</div>';
      var left = n - dn; if (t.running && left) h += '<p class="muted small" style="margin:0">About ' + Math.max(1, Math.round(left * 9 / 60)) + ' min left. Keep the app open: the screen stays on while it reads.</p>';
      var STS = { read: ['✓', '#CDEFEA'], bad: ['blurry', '#FFD9D3'], err: ['failed', '#FFD9D3'], wait: ['', ''] };
      h += '<div class="ttgrid">' + t.jobs.map(function (j) {
        var now = cur && j.id === cur.id && t.running, fx = res.fixes.filter(function (f) { return f.k === j.date; }).length, s = now ? ['reading', '#fff'] : j.st === 'read' && fx ? [fx + ' fixed', '#FFE6B8'] : STS[j.st] || ['', ''];
        return '<div class="ttth' + (now ? ' now' : '') + (j.st === 'wait' && !now ? ' wait' : '') + '">' + thumbImg(j.id) + '<small>' + (j.st === 'read' ? dshort(j.date) : '') + '</small>' + (s[0] ? '<span class="tkpill" style="background:' + s[1] + '">' + s[0] + '</span>' : '') + '</div>';
      }).join('') + '</div>';
      var lf = res.fixes[res.fixes.length - 1];
      if (lf) h += '<div class="card stack" style="gap:6px"><b style="font-size:13px">Just fixed on ' + dshort(lf.k) + '</b><div class="row" style="gap:8px;align-items:center"><span class="hw" style="font-size:14px">' + esc(lf.hw || lf.item) + ' ' + esc(lf.size || '') + ' · ' + SHCOLS[lf.col].toLowerCase() + ' <s>' + esc(lf.from) + '</s></span><b>→ ' + esc(lf.to) + '</b></div><span class="muted small">' + esc(lf.why) + ' So it was ' + esc(lf.to) + '.</span></div>';
      var errs = t.jobs.filter(function (j) { return j.st === 'err'; }).length;
      if (errs) h += '<div class="notice">' + errs + ' sheet' + (errs > 1 ? 's' : '') + ' couldn’t be read (AI busy or no internet). <button type="button" class="link" id="ttRetry">Try again</button></div>';
      h += '<div class="row" style="gap:10px"><button type="button" class="btn line" style="flex:1" id="ttPause">' + (t.running ? 'Pause' : 'Continue') + '</button><button type="button" class="btn jungle" style="flex:1" id="ttDim">🌙 Dim screen</button></div>';
      h += '<p class="muted small">Put the phone on charge and leave it. If you switch apps it pauses, and carries on from the same sheet when you come back. Blurry sheets are skipped.</p>';
      if (!t.running && dn) h += '<button type="button" class="btn ghost small" id="ttStop">Stop here and use the ' + t.jobs.filter(function (j) { return j.st === 'read'; }).length + ' read so far</button>';
      bind.push(function (r) {
        r.querySelector('#ttPause').onclick = function () { t.running = !t.running; save(); if (t.running) teachRun(); else teachWake(false); teachDraw(); };
        r.querySelector('#ttDim').onclick = function () { teachDim(true); };
        var rt = r.querySelector('#ttRetry'); if (rt) rt.onclick = function () { t.jobs.forEach(function (j) { if (j.st === 'err') { j.st = 'wait'; j.tries = 0; } }); t.running = true; save(); teachRun(); };
        var sp2 = r.querySelector('#ttStop'); if (sp2) sp2.onclick = function () { t.jobs = t.jobs.filter(function (j) { return j.st !== 'wait'; }); save(); teachAnalyse(); };
      });
    } else if (t.stage === 'names') {
      var names = TT.names; if (!names) { if (PL) names = TT.names = teachNames(); else { loadPL().then(function () { TT.names = teachNames(); teachDraw(); }); return { title: 'Names', cap: '', html: '<p class="muted">Loading…</p>', bind: function () {} }; } }
      var cnt = { sure: 0, check: 0, new: 0 }; names.forEach(function (x) { cnt[teachTab(x)]++; });
      cap = names.length + ' found · ' + (names.length - cnt.new) + ' matched';
      if (!PL || !PL.items.length) h += '<div class="notice">Add the KSBCL price list first (Shop → Price list) so his short names can be matched to the exact names.</div>';
      h += '<div class="ttseg">' + [['sure', 'Sure'], ['check', 'Check'], ['new', 'New']].map(function (x) { return '<button type="button" data-ttab="' + x[0] + '" class="' + (TT.tab === x[0] ? 'on' : '') + '">' + x[1] + ' ' + cnt[x[0]] + '</button>'; }).join('') + '</div>';
      var show = names.filter(function (x) { return teachTab(x) === TT.tab; });
      var CONF = { known: ['learnt', '#CDEFEA'], same: ['exact', '#CDEFEA'], sure: ['sure', '#CDEFEA'], likely: ['likely', '#FFE6B8'], pick: ['pick one', '#FFD9D3'], none: ['new', '#F1E6D6'] };
      h += show.length ? '<div class="stack" style="gap:8px">' + show.map(function (x) {
        var p = t.pick[x.k];
        return '<div class="ncrow ttn"><span class="hw">' + esc(x.hw) + (x.size ? ' ' + x.size : '') + '<small>seen ' + x.n + '×</small></span><select data-tpk="' + esc(x.k) + '"><option value="">keep “' + esc(x.hw) + '”</option>' + (x.known ? '<option value="k"' + (p === 'k' ? ' selected' : '') + '>' + esc(x.known) + '</option>' : '') + x.cands.map(function (c, k) { return '<option value="' + k + '"' + (String(k) === p ? ' selected' : '') + '>' + esc(c.it.name) + (c.it.ml ? ' ' + c.it.ml : '') + '</option>'; }).join('') + '</select><span class="tkpill" style="background:' + CONF[x.conf][1] + '">' + CONF[x.conf][0] + '</span></div>';
      }).join('') + '</div>' : '<div class="notice">Nothing here.</div>';
      if (TT.tab === 'sure' && cnt.sure) h += '<button type="button" class="btn line" id="ttAcc">Looks right · go to the ' + cnt.check + ' to check</button>';
      if (TT.tab === 'new' && cnt.new) h += '<p class="muted small" style="margin:0">Not in the price list. Keep them as he writes them, or pick the right one.</p>';
      h += '<button type="button" class="btn jungle" id="ttSave">Save what it learned</button>';
      h += '<p class="muted small">Sorted by how often he writes them, so the top few cover most of every sheet. You can fix any of these later in Shop → Learning.</p>';
      bind.push(function (r) {
        r.querySelectorAll('[data-ttab]').forEach(function (b) { b.onclick = function () { TT.tab = b.dataset.ttab; drawSheet(); }; });
        r.querySelectorAll('[data-tpk]').forEach(function (s) { s.onchange = function () { t.pick[s.dataset.tpk] = s.value; save(); }; });
        var a = r.querySelector('#ttAcc'); if (a) a.onclick = function () { TT.tab = cnt.check ? 'check' : 'new'; drawSheet(); r.scrollTop = 0; };
        r.querySelector('#ttSave').onclick = function () { teachFinish(); toast('Learned · it uses this on every new sheet'); };
      });
    } else {
      var R = t.result || {};
      cap = R.sheets ? 'from ' + R.sheets + ' sheets' : '';
      h += learnedHtml();
      if (R.added) h += '<div class="list"><button type="button" class="r" id="ttMonth"><span class="t">' + R.added + ' day' + (R.added > 1 ? 's' : '') + ' added to accounts<small>' + (R.closed < R.added ? (R.added - R.closed) + ' still open: add a KSBCL bill or indent for costs, or your usual profit % (Shop settings), to close them' : 'sales, profit and stock filled in') + (R.skipped ? ' · ' + R.skipped + ' already there, left as they were' : '') + '</small></span>' + CHEV + '</button></div>';
      h += '<p class="muted small">Each new day’s photo is read with all of this. Every fix you make still teaches it more.</p>';
      h += '<div class="row" style="gap:10px"><button type="button" class="btn line" style="flex:1" id="ttMore">Teach more</button><button type="button" class="btn jungle" style="flex:1" id="ttDone">Done</button></div>';
      bind.push(function (r) {
        r.querySelector('#ttMore').onclick = teachReset;
        r.querySelector('#ttDone').onclick = function () { closeSheet(); render(); };
        var m = r.querySelector('#ttMonth'); if (m) m.onclick = function () { shopUi.month = (R.first || dkey(new Date())).slice(0, 7); closeSheet(); ui.tab = 'shop'; render(); };
      });
    }
    return { title: { pick: 'Teach', reading: 'Reading', names: 'Names', done: 'Learned' }[t.stage] || 'Teach', cap: cap, html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) { bind.forEach(function (f) { f(r); }); fillThumbs(r); } };
  }
  function learnedHtml() {
    var L = learnt(), s2 = shop(), h = '';
    var dg = Object.keys(L.digits).filter(function (k) { return L.digits[k] >= 2; }).sort(function (a, b) { return L.digits[b] - L.digits[a]; }).slice(0, 5);
    var nt = Object.keys(L.notes).filter(function (k) { return L.notes[k] >= 2; }).sort(function (a, b) { return L.notes[b] - L.notes[a]; }).slice(0, 5);
    h += '<div class="shtiles ttq"><div><b class="display">' + Object.keys(s2.gloss).length + '</b><small>names</small></div><div><b class="display">' + L.usual.length + '</b><small>usual items</small></div><div><b class="display">' + (dg.length + nt.length) + '</b><small>habits</small></div></div>';
    if (dg.length || nt.length) h += '<div class="card stack" style="gap:2px"><b style="font-size:14px;margin-bottom:4px">His writing habits</b>' + dg.map(function (p) { var a = p.split('>'); return '<div class="tthab"><span class="hw">' + a[1] + ' / ' + a[0] + '</span><span>his ' + a[1] + ' often reads as ' + a[0] + '</span><small>fixed ' + L.digits[p] + '×</small></div>'; }).join('') + nt.map(function (x) { return '<div class="tthab"><span class="hw">✎</span><span>' + esc(x) + '</span><small>' + L.notes[x] + ' sheets</small></div>'; }).join('') + '</div>';
    if (L.usual.length) h += '<details class="card ttus"><summary><b>His usual list (' + L.usual.length + ' items)</b><span>See order ›</span></summary><ol>' + L.usual.map(function (x) { return '<li>' + esc(x.item) + (x.size ? ' <small>' + x.size + '</small>' : '') + '</li>'; }).join('') + '</ol><p class="muted small" style="margin:0">Same order every day, so a smudged name in row 7 is almost always the row-7 item.</p></details>';
    if (L.examples.length) h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Example sheets shown to the AI</b><div class="row" style="gap:6px;align-items:center">' + L.examples.map(function (e) { return '<div class="ttth sm">' + thumbImg(e.id) + '<small>' + new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '</small></div>'; }).join('') + '<span class="muted small" style="flex:1">the cleanest sheets, with every figure checked</span></div></div>';
    return h;
  }
  // carry on after the app was in the background or reopened
  document.addEventListener('visibilitychange', function () { if (document.hidden) return; var t = state.shop && state.shop.teach; if (t && t.running) { teachWake(true); if (!TT.busy) teachRun(); } });
  setTimeout(function () { var t = state.shop && state.shop.teach; if (t && t.running && !TT.busy) teachRun(); }, 2500);

  // ---------- Morning breath: Bhastrika (bellows) + Kapalabhati (skull-shining) ----------
  var BRLV = {
    gentle: { name: 'Gentle', bhR: 2, bhN: 15, bhS: 2.4, kpR: 2, kpN: 20, kpP: 50, rest: 30, quiet: 60 },
    regular: { name: 'Regular', bhR: 3, bhN: 20, bhS: 2, kpR: 3, kpN: 30, kpP: 60, rest: 30, quiet: 60 },
    strong: { name: 'Strong', bhR: 3, bhN: 30, bhS: 1.6, kpR: 3, kpN: 60, kpP: 80, rest: 30, quiet: 90 }
  };
  var BREX = {
    bh: { name: 'Bhastrika', en: 'bellows breath', how: 'Breathe in and out through the nose, both strong and equal, filling and emptying the chest. Keep the shoulders still.' },
    kp: { name: 'Kapalabhati', en: 'skull-shining breath', how: 'Short, sharp breaths out through the nose by snapping the belly in. Let the breath in happen on its own.' }
  };
  var br = null;
  function prana() {
    var p = state.prana = state.prana || {};
    if (!p.lv) p.lv = 'regular'; if (!p.order) p.order = 'bk'; if (p.sound == null) p.sound = true; if (p.voice == null) p.voice = true; if (p.vib == null) p.vib = true;
    p.log = p.log || {}; p.custom = p.custom || Object.assign({}, BRLV.regular, { name: 'My own' });
    return p;
  }
  function brCfg() { var p = prana(); return p.lv === 'custom' ? p.custom : BRLV[p.lv] || BRLV.regular; }
  function brDone(k) { return !!(state.prana && state.prana.log && state.prana.log[k || dkey(new Date())]); }
  function brStreak() { var n = 0, d = new Date(); if (!brDone(dkey(d))) d.setDate(d.getDate() - 1); while (brDone(dkey(d))) { n++; d.setDate(d.getDate() - 1); } return n; }
  function brPhases() {
    var c = brCfg(), p = prana(), order = p.order === 'kb' ? ['kp', 'bh'] : ['bh', 'kp'], out = [{ t: 'prep', s: 8 }];
    order.forEach(function (ex, ei) {
      var R = ex === 'bh' ? c.bhR : c.kpR, N = ex === 'bh' ? c.bhN : c.kpN, beat = ex === 'bh' ? c.bhS : 60 / c.kpP;
      out.push({ t: 'intro', ex: ex, s: 6 });
      for (var r = 1; r <= R; r++) {
        out.push({ t: 'work', ex: ex, r: r, R: R, n: N, beat: beat, s: N * beat });
        if (r < R || ei < order.length - 1) out.push({ t: 'rest', ex: ex, s: c.rest, last: r === R });
      }
    });
    out.push({ t: 'quiet', s: c.quiet });
    return out;
  }
  function brMins() { return Math.round(brPhases().reduce(function (a, x) { return a + x.s; }, 0) / 60); }
  function brTone(f1, f2, dur, vol, type) {
    if (!prana().sound || !(window.AudioContext || window.webkitAudioContext)) return;
    try { var c = actx(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = type || 'sine'; o.frequency.setValueAtTime(f1, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(.03, dur / 4)); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + .05); } catch (e) {}
  }
  function brBell() { brTone(660, 0, 1.6, .12); setTimeout(function () { brTone(990, 0, 1.2, .06); }, 40); }
  function brSay(t) { if (!prana().voice || !window.speechSynthesis) return; try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.rate = .95; u.lang = 'en-IN'; speechSynthesis.speak(u); } catch (e) {} }
  function brBuzz(p) { if (prana().vib && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }
  function openBreath() {
    resetOverlay(); closeSheet();
    br = { stage: prana().ack ? 'ready' : 'safety', phases: brPhases(), i: 0 };
    drawBreath(); showOverlay('bro');
  }
  function brStop(keep) {
    if (!br) return;
    if (br.raf) cancelAnimationFrame(br.raf); br.raf = null;
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {}
    if (br.lock) { try { br.lock.release(); } catch (e) {} br.lock = null; }
    if (!keep) br = null;
  }
  function closeBreath() { brStop(); closeOverlayEl(); if (ui.tab === 'trail') render(); }
  function drawBreath() {
    var o = document.getElementById('overlay'), c = brCfg(), p = prana(), h = '<div class="inner">';
    var order = p.order === 'kb' ? ['kp', 'bh'] : ['bh', 'kp'];
    if (br.stage === 'safety' || br.stage === 'ready') {
      h += '<div class="row between"><span class="cap">Morning breath</span><button type="button" class="nib" id="brX" aria-label="Close">✕</button></div>';
      h += '<h1 class="display" style="margin:0;line-height:1.05">Bhastrika +<br><i>Kapalabhati</i></h1>';
      if (br.stage === 'safety') {
        h += '<div class="brcard"><b>Before you start</b><ul><li>Do it first thing, on an <b>empty stomach</b>, sitting upright.</li><li>Breathe through the <b>nose</b>. Strong, not straining.</li><li><b>Stop and breathe normally</b> if you feel dizzy, light-headed, tingling or any chest pain.</li><li>Skip it, or ask your doctor first, if you have high blood pressure, a heart condition, a hernia, epilepsy, recent surgery on the belly or chest, or are pregnant.</li><li>Never do it while driving or in water.</li></ul></div>';
        h += '<button type="button" class="btn solid" id="brAck">I understand · continue</button>';
      } else {
        h += '<div class="brplan">' + order.map(function (ex) { var R = ex === 'bh' ? c.bhR : c.kpR, N = ex === 'bh' ? c.bhN : c.kpN; return '<div><b>' + BREX[ex].name + '</b><small>' + BREX[ex].en + '</small><span>' + R + ' × ' + N + (ex === 'bh' ? ' breaths' : ' strokes') + '</span></div>'; }).join('') + '<div><b>Sit still</b><small>notice the body</small><span>' + (c.quiet >= 60 ? Math.round(c.quiet / 60 * 10) / 10 + ' min' : c.quiet + ' s') + '</span></div></div>';
        h += '<p class="muted" style="margin:0">' + c.name + ' · about ' + brMins() + ' min · ' + c.rest + ' s of normal breathing between rounds. The app counts and paces each breath with a sound' + (p.voice ? ' and a voice' : '') + '.</p>';
        h += '<button type="button" class="btn solid" id="brGo">Begin</button><button type="button" class="btn ghost" id="brSet">Change rounds, pace or order</button>';
      }
    } else if (br.stage === 'run') {
      h += '<div class="row between"><button type="button" class="nib" id="brX" aria-label="Stop">✕</button><span class="cap" id="brCap"></span></div>';
      h += '<div class="brstage"><div class="brorb" id="brOrb"><span id="brLbl"></span><b class="display" id="brCnt"></b></div></div>';
      h += '<div class="brtxt"><span class="display" id="brT"></span><p id="brS"></p></div>';
      h += '<div class="brbar" id="brBar">' + br.phases.map(function (x) { return '<i class="' + x.t + '" style="flex:' + Math.max(1, x.s) + '"></i>'; }).join('') + '</div>';
      h += '<div class="row" style="gap:10px"><button type="button" class="btn ghost" style="flex:1" id="brP">Pause</button><button type="button" class="btn ghost" style="flex:1" id="brK">Skip ›</button></div>';
    } else {
      var L = p.log[dkey(new Date())] || {}, s = brStreak();
      h += '<div class="row between"><span class="cap">Morning breath</span><button type="button" class="nib" id="brX" aria-label="Close">✕</button></div>';
      h += '<div class="brstage"><div class="brorb done"><svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#0F4D40" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>';
      h += '<h1 class="display" style="margin:0;text-align:center">Done.<br><i>Carry this calm into the day.</i></h1>';
      h += '<div class="brplan"><div><b>' + (L.bh || 0) + '</b><small>Bhastrika breaths</small></div><div><b>' + (L.kp || 0) + '</b><small>Kapalabhati strokes</small></div><div><b>' + s + '</b><small>day' + (s === 1 ? '' : 's') + ' in a row</small></div></div>';
      h += '<button type="button" class="btn solid" id="brEnd">Done</button>';
    }
    o.innerHTML = h + '</div>';
    var q = function (x) { return o.querySelector(x); };
    q('#brX').onclick = function () { if (br.stage === 'run' && br.i > 1 && !confirm('Stop the breathing session?')) return; closeBreath(); };
    if (q('#brAck')) q('#brAck').onclick = function () { p.ack = true; save(); br.stage = 'ready'; drawBreath(); };
    if (q('#brSet')) q('#brSet').onclick = function () { closeBreath(); openSheet('breath'); };
    if (q('#brEnd')) q('#brEnd').onclick = closeBreath;
    if (q('#brGo')) q('#brGo').onclick = function () { actx(); br.stage = 'run'; br.i = 0; br.started = new Date().toISOString(); br.done = { bh: 0, kp: 0 }; drawBreath(); brEnter(0); if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (w) { if (br) br.lock = w; else w.release(); }).catch(function () {}); };
    if (q('#brP')) q('#brP').onclick = function () { brPause(!br.paused); };
    if (q('#brK')) q('#brK').onclick = function () { brNext(); };
  }
  function brEnter(i) {
    br.i = i; br.t0 = performance.now(); br.beat = -1; br.paused = false;
    var ph = br.phases[i]; if (!ph) return brFinish();
    var nx = br.phases[i + 1];
    var T = { prep: 'Sit tall', intro: BREX[ph.ex] && BREX[ph.ex].name, work: BREX[ph.ex] && BREX[ph.ex].name, rest: 'Breathe normally', quiet: 'Sit still' }[ph.t];
    var S = ph.t === 'prep' ? 'Spine straight, shoulders soft, mouth closed. Hands on the knees.' : ph.t === 'intro' ? BREX[ph.ex].how : ph.t === 'work' ? (ph.ex === 'bh' ? 'In and out, strong and even.' : 'Snap the belly in on each OUT. The in-breath is passive.') : ph.t === 'rest' ? (nx && nx.t === 'intro' ? 'Next: ' + BREX[nx.ex].name : 'Next: round ' + (nx ? nx.r : '') + ' of ' + (nx ? nx.R : '')) : 'Eyes closed. Notice the tingling, the heartbeat, the quiet.';
    var tt = document.getElementById('brT'), ss = document.getElementById('brS'); if (tt) tt.textContent = T; if (ss) ss.textContent = S;
    var cp = document.getElementById('brCap'); if (cp) cp.textContent = ph.t === 'work' ? BREX[ph.ex].en + ' · round ' + ph.r + ' of ' + ph.R : ph.t === 'intro' ? 'next up' : ph.t === 'rest' ? 'rest' : '';
    document.querySelectorAll('#brBar i').forEach(function (b, k) { b.classList.toggle('on', k < i); b.classList.toggle('cur', k === i); });
    var orb = document.getElementById('brOrb'); if (orb) orb.className = 'brorb ' + ph.t + (ph.ex ? ' ' + ph.ex : '');
    if (ph.t === 'prep') brSay('Sit tall. Breathe through the nose.');
    else if (ph.t === 'intro') { brBell(); brSay(BREX[ph.ex].name + '.'); }
    else if (ph.t === 'work') { brBuzz(60); brSay((ph.r === 1 ? '' : 'Round ' + ph.r + '. ') + 'Begin.'); }
    else if (ph.t === 'rest') { brBell(); brBuzz([60, 60, 60]); brSay('Rest. Breathe normally.'); }
    else if (ph.t === 'quiet') { brBell(); brBuzz([60, 60, 60]); brSay('Sit still, and notice.'); }
    if (!br.raf) br.raf = requestAnimationFrame(brTick);
  }
  function brNext() { if (!br) return; var ph = br.phases[br.i]; if (ph && ph.t === 'work') br.done[ph.ex] += Math.min(ph.n, Math.max(0, br.beat + 1)); brEnter(br.i + 1); }
  function brPause(on) {
    if (!br || br.stage !== 'run') return;
    if (on && !br.paused) { br.paused = true; br.pausedAt = performance.now(); if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {} }
    else if (!on && br.paused) { br.paused = false; br.t0 += performance.now() - br.pausedAt; }
    var b = document.getElementById('brP'); if (b) b.textContent = br.paused ? 'Resume' : 'Pause';
    var orb = document.getElementById('brOrb'); if (orb) orb.classList.toggle('paused', br.paused);
  }
  function brTick() {
    if (!br || br.stage !== 'run') return;
    br.raf = requestAnimationFrame(brTick);
    var ph = br.phases[br.i]; if (!ph) return;
    var el = br.paused ? (br.pausedAt - br.t0) / 1000 : (performance.now() - br.t0) / 1000;
    var orb = document.getElementById('brOrb'), lbl = document.getElementById('brLbl'), cnt = document.getElementById('brCnt');
    if (!orb) return;
    var sc = 1, label = '', count = '';
    if (ph.t === 'work') {
      var b = Math.floor(el / ph.beat), f = (el % ph.beat) / ph.beat;
      if (b !== br.beat && b < ph.n && !br.paused) { br.beat = b; if (ph.ex === 'kp') brTone(190, 120, .07, .25, 'triangle'); else brTone(300, 420, ph.beat * .45, .07); }
      if (ph.ex === 'bh' && !br.paused && b < ph.n && f >= .5 && br.half !== b) { br.half = b; brTone(420, 300, ph.beat * .45, .07); }
      if (ph.ex === 'bh') { var e = f < .5 ? f * 2 : 2 - f * 2; e = e * e * (3 - 2 * e); sc = .72 + .5 * e; label = f < .5 ? 'IN' : 'OUT'; }
      else { sc = f < .22 ? 1 - .28 * Math.sin(Math.PI * f / .22) : 1; label = f < .35 ? 'OUT' : ''; }
      count = Math.min(ph.n, b + 1) + '<small>/' + ph.n + '</small>';
    } else {
      var cyc = 10, g = (el % cyc) / cyc, e2 = g < .4 ? g / .4 : g < .5 ? 1 : 1 - (g - .5) / .5; e2 = e2 * e2 * (3 - 2 * e2);
      sc = .8 + .25 * e2; count = Math.max(0, Math.ceil(ph.s - el)); label = ph.t === 'intro' ? 'get ready' : ph.t === 'prep' ? 'settle' : g < .4 ? 'in' : g < .5 ? '' : 'out';
    }
    orb.style.transform = 'scale(' + sc.toFixed(3) + ')';
    if (lbl.textContent !== label) lbl.textContent = label;
    var ch = String(count); if (cnt.innerHTML !== ch) cnt.innerHTML = ch;
    if (!br.paused && el >= ph.s) brNext();
  }
  function brFinish() {
    var c = brCfg(), k = dkey(new Date()), p = prana();
    p.log[k] = { at: new Date().toISOString(), bh: br.done.bh, kp: br.done.kp, lv: p.lv, mins: Math.round((Date.now() - new Date(br.started || Date.now())) / 60000) };
    save(); brBell(); brSay('Well done.'); brBuzz([80, 60, 80]);
    brStop(true); br.stage = 'done'; drawBreath();
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && br && br.stage === 'run') brPause(true); });
  function breathCard() {
    var k = dkey(new Date()); if (brDone(k)) return '';
    var c = brCfg(), s = brStreak(), p = prana(), order = p.order === 'kb' ? ['kp', 'bh'] : ['bh', 'kp'];
    return '<div class="hero brhero"><button type="button" class="brgo" data-breath="1" aria-label="Start morning breath"><span class="cap">First thing · morning breath' + (s ? ' · ' + s + '-day streak' : '') + '</span><span class="display brh">' + order.map(function (x) { return BREX[x].name; }).join(' + ') + '</span><small>' + c.bhR + ' × ' + c.bhN + ' breaths · ' + c.kpR + ' × ' + c.kpN + ' strokes · about ' + brMins() + ' min</small><span class="brplay">' + PLAY + '</span></button></div>';
  }
  function breathSheet() {
    var p = prana(), c = brCfg(), k = dkey(new Date());
    var h = '<div class="ttseg">' + ['gentle', 'regular', 'strong', 'custom'].map(function (l) { return '<button type="button" data-brlv="' + l + '" class="' + (p.lv === l ? 'on' : '') + '">' + (l === 'custom' ? 'My own' : BRLV[l].name) + '</button>'; }).join('') + '</div>';
    var fld = function (key, lab, unit, step) { return '<label class="brf"><span>' + lab + '</span><input inputmode="decimal" data-brc="' + key + '" value="' + c[key] + '"' + (p.lv === 'custom' ? '' : ' disabled') + '><small>' + unit + '</small></label>'; };
    h += '<div class="card stack" style="gap:6px"><b>Bhastrika</b>' + fld('bhR', 'Rounds', '') + fld('bhN', 'Breaths per round', '') + fld('bhS', 'Seconds per breath', 'in + out') + '</div>';
    h += '<div class="card stack" style="gap:6px"><b>Kapalabhati</b>' + fld('kpR', 'Rounds', '') + fld('kpN', 'Strokes per round', '') + fld('kpP', 'Pace', 'per minute') + '</div>';
    h += '<div class="card stack" style="gap:6px"><b>Between and after</b>' + fld('rest', 'Rest between rounds', 'seconds') + fld('quiet', 'Sit still at the end', 'seconds') + '</div>';
    if (p.lv !== 'custom') h += '<p class="muted small" style="margin:0">Pick “My own” to change the numbers. Start gentle and move up when it feels easy.</p>';
    h += '<div class="list">' + row({ t: 'Order', sub: p.order === 'kb' ? 'Kapalabhati first, then Bhastrika' : 'Bhastrika first (warms up), then Kapalabhati', id: 'brOrd' }) + '</div>';
    var tg = function (key, lab, sub) { return '<label class="ttsw"><span><b>' + lab + '</b><small>' + sub + '</small></span><input type="checkbox" data-brt="' + key + '"' + (p[key] ? ' checked' : '') + '><i></i></label>'; };
    h += tg('sound', 'Pacing sound', 'a soft tone on every breath') + tg('voice', 'Voice', 'announces rounds and rests') + tg('vib', 'Vibrate', 'at the start and end of each round');
    var days = []; for (var i = 13; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); days.push(dkey(d)); }
    h += '<div class="card stack" style="gap:8px"><b>Last 2 weeks</b><div class="brdays">' + days.map(function (x) { return '<i class="' + (brDone(x) ? 'on' : '') + (x === k ? ' today' : '') + '" title="' + x + '"></i>'; }).join('') + '</div><small class="muted">' + brStreak() + '-day streak · ' + Object.keys(p.log).length + ' sessions in all</small></div>';
    h += '<p class="muted small">A “Morning breath” reminder comes to your phone at 6:30 am. Stop and breathe normally if you feel dizzy. If you have high blood pressure, a heart condition, a hernia or are pregnant, ask your doctor first.</p>';
    h += '<button type="button" class="btn jungle" id="brStart">' + (brDone(k) ? 'Do it again' : 'Start now') + ' · ' + brMins() + ' min</button>';
    return { title: 'Morning breath', cap: (BRLV[p.lv] || { name: 'my own' }).name.toLowerCase(), html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-brlv]').forEach(function (b) { b.onclick = function () { p.lv = b.dataset.brlv; save(); drawSheet(); }; });
      r.querySelectorAll('[data-brc]').forEach(function (inp) { inp.onchange = function () { var v = num(inp.value), key = inp.dataset.brc, lim = { bhR: [1, 10], bhN: [5, 120], bhS: [1, 6], kpR: [1, 10], kpN: [5, 300], kpP: [20, 120], rest: [0, 300], quiet: [0, 600] }[key]; p.custom[key] = Math.min(lim[1], Math.max(lim[0], v || lim[0])); save(); drawSheet(); }; });
      r.querySelectorAll('[data-brt]').forEach(function (cb) { cb.onchange = function () { p[cb.dataset.brt] = cb.checked; save(); }; });
      r.querySelector('#brOrd').onclick = function () { p.order = p.order === 'kb' ? 'bk' : 'kb'; save(); drawSheet(); };
      r.querySelector('#brStart').onclick = openBreath;
    } };
  }

  // ---------- delete a day / start fresh ----------
  function shopPhotoInUse() { var keep = {}; (learnt().examples || []).forEach(function (e) { keep[e.id] = 1; }); return keep; }
  function shopDeleteDay(k) {
    var s2 = shop(), d = s2.days[k]; if (!d) return; var keep = shopPhotoInUse();
    (d.photos || []).forEach(function (id) { if (!keep[id]) idbDel('shopimg-' + id).catch(function () {}); });
    Object.keys(bills()).forEach(function (id) { var b = s2.bills[id]; if (b.status === 'added' && b.applied === k) { b.status = 'pending'; b.applied = null; } });
    delete s2.days[k]; save();
  }
  function shopResetSheet() {
    var s2 = shop(); bills(); ui.rs = ui.rs || { days: true, bills: false, learn: false, prices: false };
    var nd = Object.keys(s2.days).length, nb = Object.keys(s2.bills).length, nl = Object.keys(s2.gloss).length + Object.keys(s2.alias).length + (learnt().usual.length ? 1 : 0), np = PL && PL.items ? PL.items.length : 0;
    var tg = function (key, lab, sub) { return '<label class="ttsw"><span><b>' + lab + '</b><small>' + sub + '</small></span><input type="checkbox" data-rs="' + key + '"' + (ui.rs[key] ? ' checked' : '') + '><i></i></label>'; };
    var h = '<p class="muted" style="margin:0">Choose what to delete. Everything else stays.</p>';
    h += tg('days', 'Sales sheets', nd + ' day' + (nd === 1 ? '' : 's') + ' with their photos, and the month totals');
    h += tg('bills', 'Stock-in bills', nb + ' KSBCL bill' + (nb === 1 ? '' : 's') + ' and the stock they added');
    h += tg('learn', 'Handwriting learning', nl ? 'his short names, habits, usual list and example sheets' : 'nothing learnt yet');
    h += tg('prices', 'KSBCL price list', np ? fmtN(np) + ' items' : 'not added');
    h += '<p class="muted small" style="margin:0">Tip: keep the handwriting learning and the price list, so the fresh start still reads his writing well.</p>';
    h += '<button type="button" class="btn coral" id="rsGo">Delete selected</button>';
    return { title: 'Start fresh', cap: esc(s2.name), html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-rs]').forEach(function (cb) { cb.onchange = function () { ui.rs[cb.dataset.rs] = cb.checked; }; });
      r.querySelector('#rsGo').onclick = function () {
        var o = ui.rs, what = []; if (o.days) what.push(nd + ' sales days'); if (o.bills) what.push(nb + ' bills'); if (o.learn) what.push('the handwriting learning'); if (o.prices) what.push('the price list');
        if (!what.length) { toast('Nothing selected'); return; }
        if (!confirm('Delete ' + what.join(', ') + '? This can’t be undone.')) return;
        var keepImg = {};
        if (!o.learn) learnt().examples.forEach(function (e) { keepImg[e.id] = 1; });
        if (!o.days) Object.keys(s2.days).forEach(function (k) { (s2.days[k].photos || []).forEach(function (id) { keepImg[id] = 1; }); });
        if (!o.bills) Object.keys(s2.bills).forEach(function (id) { (s2.bills[id].photos || []).forEach(function (pid) { keepImg[pid] = 1; }); });
        var drop = function (ids) { ids.forEach(function (id) { if (!keepImg[id]) idbDel('shopimg-' + id).catch(function () {}); }); };
        if (o.days) { Object.keys(s2.days).forEach(function (k) { drop(s2.days[k].photos || []); }); s2.days = {}; Object.keys(s2.bills).forEach(function (id) { var b = s2.bills[id]; if (b.status === 'added') { b.status = 'pending'; b.applied = null; } }); }
        if (o.bills) { Object.keys(s2.bills).forEach(function (id) { drop(s2.bills[id].photos || []); }); s2.bills = {}; s2.items = {}; s2.map = {}; }
        if (o.learn) { INK = {}; idbDel('inkf').catch(function () {}); learnt().examples.forEach(function (e) { drop([e.id]); }); s2.gloss = {}; s2.alias = {}; s2.fixes = 0; s2.learn = { digits: {}, notes: {}, usual: [], examples: [] }; }
        var t = s2.teach; if (t && t.jobs) { drop(t.jobs.map(function (j) { return j.id; })); t.jobs.forEach(function (j) { idbDel('teachth-' + j.id).catch(function () {}); }); }
        s2.teach = { jobs: [], backfill: t ? t.backfill !== false : true, stage: 'pick', pick: {} }; TT.names = null;
        if (o.prices) { PL = { items: [], asOf: null }; idbDel('pricelist').catch(function () {}); }
        shopUi.month = null; save(); closeSheet(); ui.tab = 'shop'; render(); toast('Done · fresh start');
      };
    } };
  }

  // ---------- My money: personal expenses (quick add, voice, payment screenshots, month view) ----------
  var MCATS = [['fuel', '⛽', 'Fuel', 'petrol diesel fuel shell bharat indian oil hp pump'], ['food', '🍽', 'Food', 'food lunch dinner breakfast hotel restaurant meal biryani swiggy zomato cafe'], ['tea', '☕', 'Tea & snacks', 'tea coffee snacks juice bakery chai'], ['groc', '🛒', 'Groceries', 'grocery groceries vegetables milk supermarket kirana store mart'], ['sport', '🏸', 'Badminton', 'badminton shuttle court gym sport'], ['car', '🚗', 'Car & bike', 'car bike service tyre parking toll wash'], ['bills', '📱', 'Bills', 'recharge mobile electricity internet wifi bill phone dth'], ['home', '🏠', 'Home', 'rent home house repair'], ['health', '💊', 'Health', 'medicine doctor pharmacy medical hospital'], ['gift', '🎁', 'Gifts', 'gift present'], ['travel', '✈', 'Travel', 'bus train flight cab uber ola auto ticket travel'], ['fun', '🎬', 'Fun', 'movie cinema party outing'], ['other', '📦', 'Other', '']];
  function money() {
    var m = state.money = state.money || {}; m.items = m.items || []; m.pay = m.pay || 'upi'; m.payee = m.payee || {};
    if (!m.cats) m.cats = MCATS.map(function (c) { return { id: c[0], ic: c[1], n: c[2], kw: c[3] }; });
    return m;
  }
  function mcat(id) { return money().cats.filter(function (c) { return c.id === id; })[0] || { id: 'other', ic: '📦', n: 'Other' }; }
  function mcatsByUse() {
    var m = money(), cut = dkey(new Date(Date.now() - 60 * 864e5)), n = {};
    m.items.forEach(function (x) { if (x.d >= cut) n[x.cat] = (n[x.cat] || 0) + 1; });
    return m.cats.slice().sort(function (a, b) { return (n[b.id] || 0) - (n[a.id] || 0); });
  }
  function guessCat(text) {
    var t = ' ' + String(text || '').toLowerCase() + ' ', m = money(), best = null;
    var pk = Object.keys(m.payee).filter(function (p) { return t.indexOf(p) >= 0; })[0]; if (pk) return m.payee[pk];
    m.cats.forEach(function (c) { (c.kw || '').split(' ').forEach(function (w) { if (w && !best && t.indexOf(w) >= 0) best = c.id; }); if (!best && t.indexOf(c.n.toLowerCase()) >= 0) best = c.id; });
    return best;
  }
  // "250 petrol" / "petrol 250 at shell" → amount, category, note
  function parseSpend(text) {
    var t = String(text || ''), num2 = /(\d+(?:[.,]\d+)?)/.exec(t.replace(/₹|rs\.?|rupees?/gi, ' ')), amt = num2 ? parseFloat(num2[1].replace(',', '')) : null;
    var rest = t.replace(/₹|rs\.?|rupees?/gi, ' ').replace(num2 ? num2[1] : '', ' ').replace(/\s+/g, ' ').trim();
    return { v: amt, cat: guessCat(t), note: rest };
  }
  var ms = null; // the quick-add screen
  function openSpend(pre) {
    resetOverlay(); closeSheet(); var m = money();
    ms = Object.assign({ v: '', cat: null, note: '', pay: m.pay, d: dkey(new Date()), id: null, more: false }, pre || {});
    if (ms.v != null && ms.v !== '') ms.v = String(ms.v); ms.fresh = !!ms.v;
    drawSpend(); showOverlay('mso');
  }
  function closeSpend() { if (ms && ms.rec) try { ms.rec.abort(); } catch (e) {} ms = null; closeOverlayEl(); render(); }
  function drawSpend() {
    var o = document.getElementById('overlay'), m = money(), cats = mcatsByUse(), tk = dkey(new Date()), yk = dkey(new Date(Date.now() - 864e5));
    var show = ms.more ? cats : cats.slice(0, 8); if (ms.cat && show.every(function (c) { return c.id !== ms.cat; })) show = show.concat([mcat(ms.cat)]);
    var h = '<div class="inner msi"><div class="row between"><button type="button" class="btn ghost small" id="msX">‹ Back</button><span class="cap">' + (ms.id ? 'Edit expense' : 'New expense') + '</span><button type="button" class="btn ghost small" id="msMonth">Month</button></div>';
    h += '<div class="mscard"><div class="row" style="gap:6px">' + [[tk, 'Today'], [yk, 'Yesterday']].map(function (x) { return '<button type="button" class="mschip sm' + (ms.d === x[0] ? ' on' : '') + '" data-msd="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '<input type="date" class="msdate" id="msD" value="' + ms.d + '" max="' + tk + '"></div>';
    h += '<div class="msamt" id="msAmt">₹ <b id="msV">' + esc(ms.v || '') + '</b><i></i></div>';
    h += '<div class="mscats">' + show.map(function (c) { return '<button type="button" class="mschip' + (ms.cat === c.id ? ' on' : '') + '" data-msc="' + c.id + '">' + c.ic + ' ' + esc(c.n) + '</button>'; }).join('') + '<button type="button" class="mschip" id="msMore">' + (ms.more ? '− less' : '+ more') + '</button></div>';
    h += '<input class="msnote" id="msN" placeholder="note (optional): where, what" value="' + esc(ms.note || '') + '" autocomplete="off">';
    h += '<div class="row" style="gap:6px">' + [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']].map(function (x) { return '<button type="button" class="mschip sm' + (ms.pay === x[0] ? ' on' : '') + '" data-msp="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
    h += '<div class="rekp mskp">' + ['1', '2', '3', '⌫', '4', '5', '6', 'C', '7', '8', '9', '🎤', '.', '0', '00', '✓'].map(function (k) { return '<button type="button" data-mk="' + k + '"' + (k === '✓' || k === '🎤' ? ' class="nx"' : '') + ' aria-label="' + ({ '⌫': 'Delete', 'C': 'Clear', '🎤': 'Say it', '✓': 'Save' }[k] || k) + '">' + k + '</button>'; }).join('') + '</div>';
    if (ms.heard) h += '<p class="muted small" style="margin:0">Heard: “' + esc(ms.heard) + '”</p>';
    if (ms.id) h += '<button type="button" class="btn ghost small" id="msDel">Delete this expense</button>';
    o.innerHTML = h + '</div>';
    var q = function (x) { return o.querySelector(x); };
    q('#msX').onclick = closeSpend;
    q('#msMonth').onclick = function () { closeSpend(); openSheet('money'); };
    o.querySelectorAll('[data-msd]').forEach(function (b) { b.onclick = function () { ms.d = b.dataset.msd; drawSpend(); }; });
    q('#msD').onchange = function () { if (q('#msD').value) { ms.d = q('#msD').value; drawSpend(); } };
    o.querySelectorAll('[data-msc]').forEach(function (b) { b.onclick = function () { ms.cat = b.dataset.msc; o.querySelectorAll('[data-msc]').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    q('#msMore').onclick = function () { ms.more = !ms.more; drawSpend(); };
    q('#msN').addEventListener('input', function () { ms.note = q('#msN').value; });
    o.querySelectorAll('[data-msp]').forEach(function (b) { b.onclick = function () { ms.pay = b.dataset.msp; o.querySelectorAll('[data-msp]').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    var del = q('#msDel'); if (del) del.onclick = function () { if (!confirm('Delete this expense?')) return; m.items = m.items.filter(function (x) { return x.id !== ms.id; }); save(); toast('Deleted'); var back = ms.back; closeSpend(); if (back) openSheet(back); };
    o.querySelectorAll('[data-mk]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.onclick = function () {
        var k = b.dataset.mk, cur = ms.fresh ? '' : String(ms.v || '');
        if (k === '✓') return saveSpend();
        if (k === '🎤') return listenSpend();
        if (k === '⌫') cur = cur.slice(0, -1); else if (k === 'C') cur = ''; else { if (k === '.' && cur.indexOf('.') >= 0) return; if (cur.length >= 8) return; cur += k; }
        ms.v = cur; ms.fresh = false; q('#msV').textContent = cur;
      };
    });
  }
  function saveSpend() {
    var m = money(), v = num(ms.v);
    if (!v) { toast('Type the amount'); return; }
    if (!ms.cat) { ms.cat = guessCat(ms.note) || null; if (!ms.cat) { toast('Tap a category'); var c = document.querySelector('.mscats'); if (c) c.classList.add('nudge'); return; } }
    var it = ms.id ? m.items.filter(function (x) { return x.id === ms.id; })[0] : null;
    if (!it) { it = { id: 'm' + Date.now().toString(36), at: new Date().toISOString() }; m.items.push(it); }
    it.v = v; it.cat = ms.cat; it.note = String(ms.note || '').trim(); it.pay = ms.pay; it.d = ms.d;
    m.pay = ms.pay;
    if (ms.payee) m.payee[ms.payee.toLowerCase()] = ms.cat;
    save(); toast('₹' + fmtCell(v) + ' · ' + mcat(ms.cat).n + ' saved');
    var back = ms.back; closeSpend(); if (back) openSheet(back);
  }
  function listenSpend() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice isn’t available in this browser'); return; }
    var r = new SR(); r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1; ms.rec = r;
    var b = document.querySelector('[data-mk="🎤"]'); if (b) { b.classList.add('rec'); b.textContent = '●'; }
    r.onresult = function (e) {
      var t = e.results[0][0].transcript, p = parseSpend(t); if (!ms) return;
      ms.heard = t; if (p.v) { ms.v = String(p.v); ms.fresh = true; } if (p.cat) ms.cat = p.cat; if (p.note) ms.note = p.note; drawSpend();
    };
    r.onerror = function (e) { toast(e.error === 'not-allowed' ? 'Allow the microphone for this app' : 'Didn’t catch that'); };
    r.onend = function () { var b2 = document.querySelector('[data-mk="🎤"]'); if (b2) { b2.classList.remove('rec'); b2.textContent = '🎤'; } };
    try { r.start(); } catch (e) { toast('Voice couldn’t start'); }
  }
  // a GPay / PhonePe / bank screenshot shared to the app
  function readPayShot(dataUrl) {
    if (!hasAI()) { openSpend(); toast('Reading screenshots needs your Gemini key'); return; }
    toast('Reading the payment…');
    geminiImages('This is a screenshot of a payment in an Indian payments app (Google Pay, PhonePe, Paytm, a bank app) or a receipt. Find the amount paid, who it was paid to, and the date. Reply JSON: {"amount":number,"to":"payee name or null","date":"YYYY-MM-DD" or null,"what":"short description or null"}', [dataUrl]).then(function (r) {
      var v = num(r.amount); if (!v) { openSpend(); toast('Couldn’t find an amount in that picture'); return; }
      var to = String(r.to || '').trim(), dt = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date <= dkey(new Date()) ? r.date : dkey(new Date());
      openSpend({ v: v, pay: 'upi', note: [to, r.what].filter(Boolean).join(' · '), d: dt, cat: guessCat(to + ' ' + (r.what || '')), payee: to || null });
      toast('Check it and tap ✓');
    }).catch(function (e) { openSpend(); toast('AI: ' + (e.message || 'failed')); });
  }
  function moneySheet(arg) {
    var m = money(), mk = arg || shopUi.mm || dkey(new Date()).slice(0, 7), md = new Date(mk + '-01T00:00:00');
    var items = m.items.filter(function (x) { return x.d.slice(0, 7) === mk; }).sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (a.at < b.at ? 1 : -1); });
    var tot = items.reduce(function (a, x) { return a + x.v; }, 0), byC = {}; items.forEach(function (x) { byC[x.cat] = (byC[x.cat] || 0) + x.v; });
    var pm = new Date(md); pm.setMonth(pm.getMonth() - 1); var pk = dkey(pm).slice(0, 7), prevC = {}; m.items.forEach(function (x) { if (x.d.slice(0, 7) === pk) prevC[x.cat] = (prevC[x.cat] || 0) + x.v; });
    var now = new Date(), days = mk === dkey(now).slice(0, 7) ? now.getDate() : new Date(md.getFullYear(), md.getMonth() + 1, 0).getDate();
    var h = '<div class="row between"><button type="button" class="nib" data-mm="-1" aria-label="Previous month">‹</button><b class="display" style="font-size:20px">' + md.toLocaleDateString('en', { month: 'long', year: 'numeric' }) + '</b><button type="button" class="nib" data-mm="1" aria-label="Next month">›</button></div>';
    h += '<div class="shtiles ttq"><div><b class="display">' + inr(tot) + '</b><small>spent</small></div><div><b class="display">' + inr(days ? tot / days : 0) + '</b><small>a day</small></div><div><b class="display">' + (m.budget ? Math.round(tot / m.budget * 100) + '%' : '—') + '</b><small>' + (m.budget ? 'of ' + inr(m.budget) : 'no budget') + '</small></div></div>';
    if (m.budget) h += '<div class="ttbar"><i style="width:' + Math.min(100, Math.round(tot / m.budget * 100)) + '%;background:' + (tot > m.budget ? '#E5484D' : '#12A39A') + '"></i></div>';
    var cs = Object.keys(byC).sort(function (a, b) { return byC[b] - byC[a]; }), mx = cs.length ? byC[cs[0]] : 1;
    if (cs.length) h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">By category</b>' + cs.map(function (c) { var d2 = byC[c] - (prevC[c] || 0); return '<div class="hbar"><span>' + mcat(c).ic + ' ' + esc(mcat(c).n) + '</span><span class="b"><i style="background:#12A39A;width:' + Math.round(byC[c] / mx * 100) + '%"></i></span><span style="text-align:right">' + inr(byC[c]) + '</span></div>'; }).join('') + '</div>';
    var up = cs.filter(function (c) { return prevC[c] && byC[c] - prevC[c] > 500; })[0];
    if (up) h += '<p class="muted small" style="margin:0">' + mcat(up).n + ' is up ' + inr(byC[up] - prevC[up]) + ' on ' + pm.toLocaleDateString('en', { month: 'long' }) + '.</p>';
    h += '<button type="button" class="btn coral" id="mnAdd">+ Add expense</button>';
    var lastD = '';
    h += items.length ? '<div class="list">' + items.slice(0, 120).map(function (x) {
      var dh = x.d !== lastD ? '<div class="mnday">' + (x.d === dkey(new Date()) ? 'Today' : new Date(x.d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })) + '</div>' : ''; lastD = x.d;
      return dh + '<button type="button" class="r" data-mni="' + x.id + '"><span class="t">' + mcat(x.cat).ic + ' ' + esc(mcat(x.cat).n) + '<small>' + esc([x.pay ? x.pay.toUpperCase() : '', x.note].filter(Boolean).join(' · ')) + '</small></span><span class="v strong">' + inr(x.v) + '</span></button>';
    }).join('') + '</div>' : '<p class="muted small">Nothing this month yet.</p>';
    h += '<div class="list">' + row({ t: 'Monthly budget', v: m.budget ? inr(m.budget) : 'set', id: 'mnBud' }) + '</div>';
    h += '<p class="muted small">Your own spending only. Shop expenses stay in the shop. Tip: share a GPay or PhonePe payment screenshot to Attention and it fills itself.</p>';
    return { title: 'My money', cap: items.length + ' entries', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-mm]').forEach(function (b) { b.onclick = function () { var d = new Date(md); d.setMonth(d.getMonth() + +b.dataset.mm); shopUi.mm = dkey(d).slice(0, 7); drawSheet(); }; });
      r.querySelector('#mnAdd').onclick = function () { openSpend({ back: 'money' }); };
      r.querySelectorAll('[data-mni]').forEach(function (b) { b.onclick = function () { var x = m.items.filter(function (y) { return y.id === b.dataset.mni; })[0]; if (x) openSpend({ id: x.id, v: x.v, cat: x.cat, note: x.note, pay: x.pay, d: x.d, back: 'money' }); }; });
      r.querySelector('#mnBud').onclick = function () { var v = prompt('Monthly budget for your own spending (₹)', m.budget || ''); if (v == null) return; m.budget = num(v) || null; save(); drawSheet(); };
    } };
  }

  // ---------- full backup: everything, including photos (file, or your Google Drive) ----------
  function makeBackup() {
    var copy = JSON.parse(JSON.stringify(state)); delete copy.keys; delete copy.code; delete copy.aiKey;
    if (copy.gdrive) delete copy.gdrive.tok;
    var out = { kind: 'attention-full', v: 2, at: new Date().toISOString(), app: APP_VERSION, state: copy, idb: {} };
    return idbKeys().then(function (keys) {
      keys = keys.filter(function (k) { return String(k).indexOf('snap-') !== 0; });
      return Promise.all(keys.map(function (k) { return idbGet(k).then(function (v) { if (v != null) out.idb[k] = v; }).catch(function () {}); }));
    }).then(function () { return new Blob([JSON.stringify(out)], { type: 'application/json' }); });
  }
  function restoreBackup(d) {
    if (d && d.kind === 'attention-full') {
      var code = state.code, keys = state.keys, ak = state.aiKey, gd = state.gdrive;
      return Promise.all(Object.keys(d.idb || {}).map(function (k) { return idbPut(k, d.idb[k]).catch(function () {}); })).then(function () {
        state = d.state; state.code = state.code || code; state.keys = state.keys || keys; if (ak) state.aiKey = ak; if (gd) state.gdrive = Object.assign({}, state.gdrive || {}, gd);
        migrate(state); NOTES = null; PL = null; plLoading = null; save(); return loadNotes();
      }).then(function () { syncGoal(); render(); });
    }
    return Promise.reject(new Error('not a full backup'));
  }
  var GD = { tok: null, exp: 0, busy: false, msg: null, files: null };
  function gdrive() { var g = state.gdrive = state.gdrive || {}; return g; }
  function gdToken() {
    if (GD.tok && Date.now() < GD.exp - 60000) return Promise.resolve(GD.tok);
    var g = gdrive(); if (!g.cid) return Promise.reject(new Error('add your Google client ID first'));
    var ready = window.google && window.google.accounts ? Promise.resolve() : loadScript('https://accounts.google.com/gsi/client');
    return ready.then(function () {
      return new Promise(function (res, rej) {
        var tc = window.google.accounts.oauth2.initTokenClient({ client_id: g.cid.trim(), scope: 'https://www.googleapis.com/auth/drive.appdata',
          callback: function (r) { if (r.error) rej(new Error(r.error)); else { GD.tok = r.access_token; GD.exp = Date.now() + (r.expires_in || 3600) * 1000; g.ok = true; save(); res(GD.tok); } },
          error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'sign-in closed' : (e && e.type) || 'sign-in failed')); } });
        tc.requestAccessToken({ prompt: g.ok ? '' : 'consent' });
      });
    });
  }
  function gdFetch(url, opt) { return gdToken().then(function (t) { opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {}); return fetch(url, opt); }).then(function (r) { if (r.status === 401) { GD.tok = null; } if (!r.ok) throw new Error('Drive said ' + r.status); return r; }); }
  function gdList() { return gdFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=100&orderBy=createdTime%20desc&fields=files(id,name,size,createdTime)').then(function (r) { return r.json(); }).then(function (j) { GD.files = (j.files || []).filter(function (f) { return /^attention-backup/.test(f.name); }); return GD.files; }); }
  function gdBackup() {
    if (GD.busy) return Promise.resolve(); GD.busy = true; GD.msg = 'Packing everything…'; drawSheet();
    var g = gdrive(), blob;
    return gdToken().then(function () { return makeBackup(); }).then(function (b) {
      blob = b; GD.msg = 'Uploading ' + (blob.size / 1048576).toFixed(1) + ' MB…'; drawSheet();
      return gdFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' }, body: JSON.stringify({ name: 'attention-backup-' + new Date().toISOString().slice(0, 16).replace(':', '-') + '.json', parents: ['appDataFolder'] }) });
    }).then(function (r) { var loc = r.headers.get('Location'); if (!loc) throw new Error('no upload link'); return fetch(loc, { method: 'PUT', body: blob }); })
      .then(function (r) { if (!r.ok) throw new Error('upload failed ' + r.status); return gdList(); })
      .then(function (files) { // keep the newest 30
        return Promise.all(files.slice(30).map(function (f) { return gdFetch('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'DELETE' }).catch(function () {}); }));
      }).then(function () { g.last = new Date().toISOString(); g.size = blob.size; GD.msg = null; GD.busy = false; save(); drawSheet(); if (ui.tab === 'trail' && !ui.sheet) render(); toast('Backed up to Google Drive'); })
      .catch(function (e) { GD.busy = false; GD.msg = 'Backup failed: ' + (e.message || e); drawSheet(); toast(GD.msg); });
  }
  function gdRestore(f) {
    if (!confirm('Replace everything on this phone with the backup from ' + new Date(f.createdTime).toLocaleString('en') + '?')) return;
    GD.busy = true; GD.msg = 'Downloading…'; drawSheet();
    gdFetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media').then(function (r) { return r.json(); }).then(restoreBackup)
      .then(function () { GD.busy = false; GD.msg = null; closeSheet(); toast('Restored from Google Drive'); })
      .catch(function (e) { GD.busy = false; GD.msg = 'Restore failed: ' + (e.message || e); drawSheet(); });
  }
  // pack everything and hand it to the phone's share menu: Drive (pick a folder), WhatsApp, Gmail…
  var SB = { file: null, busy: false };
  function shareBackupFile(file) {
    return navigator.share({ files: [file], title: 'Attention backup ' + dkey(new Date()) }).then(function () {
      state.lastShareBackup = new Date().toISOString(); state.lastBackup = state.lastShareBackup; save(); SB.file = null; toast('Backup sent ✓'); drawSheet(); if (ui.tab === 'trail' && !ui.sheet) render();
    });
  }
  function shareBackup() {
    if (SB.busy) return; SB.busy = true; SB.file = null; drawSheet();
    makeBackup().then(function (blob) {
      var file = new File([blob], 'attention-backup-' + dkey(new Date()) + '.txt', { type: 'text/plain' });
      SB.busy = false;
      if (!(navigator.canShare && navigator.canShare({ files: [file] }))) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); state.lastBackup = new Date().toISOString(); save(); drawSheet(); toast('Saved to Downloads (sharing isn’t available here)'); return; }
      SB.file = file;
      return shareBackupFile(file).catch(function (e) { if (e && e.name === 'AbortError') { SB.file = null; drawSheet(); return; } drawSheet(); });
    }).catch(function (e) { SB.busy = false; toast('Couldn’t pack the backup: ' + (e.message || e)); drawSheet(); });
  }
  function backupDue() {
    var g = state.gdrive; if (g && g.cid && g.ok) return !g.last || Date.now() - new Date(g.last) > 20 * 3600 * 1000;
    var hasData = state.shop && Object.keys(state.shop.days || {}).length; if (!hasData) return false;
    var last = state.lastShareBackup || state.lastBackup; return !last || Date.now() - new Date(last) > 20 * 3600 * 1000;
  }
  function backupSheet() {
    var g = gdrive(), h = '', ls = state.lastShareBackup;
    h += '<div class="card stack" style="gap:10px"><b style="font-size:15px">☁ Back up to Google Drive</b><span class="muted small" style="margin:0">Packs everything (photos too) and opens your phone’s share menu. Tap <b>Drive</b>, choose a folder like “Attention Backups”, tap <b>Save</b>. No setup needed. WhatsApp or Gmail work too.</span>' +
      (SB.busy ? '<div class="shreading"><span class="wpulse"></span><b>Packing everything…</b></div>' : SB.file ? '<button type="button" class="btn jungle" id="sbSend">Send the backup (' + (SB.file.size / 1048576).toFixed(1) + ' MB) →</button>' : '<button type="button" class="btn jungle" id="sbGo">☁ Back up now</button>') +
      '<span class="muted small">' + (ls ? 'Last sent ' + ago(ls) : 'Not backed up this way yet') + '</span></div>';
    if (g.cid) {
      h += '<div class="card stack" style="gap:10px"><div class="row" style="gap:10px;align-items:center"><span class="gdic">☁</span><span style="flex:1;display:flex;flex-direction:column"><b>Google Drive</b><small class="muted">a private app folder only Attention can see</small></span><span class="tkpill" style="background:' + (g.ok ? '#CDEFEA' : '#FFE6B8') + '">' + (g.ok ? 'on' : 'not signed in') + '</span></div>' +
        '<div class="shtiles ttq"><div><b class="display" style="font-size:16px">' + (g.last ? ago(g.last) : 'never') + '</b><small>last backup</small></div><div><b class="display" style="font-size:16px">' + (g.size ? (g.size / 1048576).toFixed(1) + ' MB' : '—') + '</b><small>incl. photos</small></div><div><b class="display" style="font-size:16px">30</b><small>kept</small></div></div></div>';
      if (GD.msg) h += '<div class="' + (GD.busy ? 'shreading' : 'notice') + '">' + (GD.busy ? '<span class="wpulse"></span>' : '') + '<b>' + esc(GD.msg) + '</b></div>';
      h += '<button type="button" class="btn jungle" id="gdNow"' + (GD.busy ? ' disabled' : '') + '>☁ Back up now</button>';
      h += '<button type="button" class="btn line" id="gdList"' + (GD.busy ? ' disabled' : '') + '>Restore from Drive…</button>';
      if (GD.files) h += GD.files.length ? '<div class="list">' + GD.files.slice(0, 12).map(function (f, i) { return '<button type="button" class="r" data-gdr="' + i + '"><span class="t">' + new Date(f.createdTime).toLocaleString('en', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + '<small>' + (f.size ? (f.size / 1048576).toFixed(1) + ' MB' : '') + '</small></span><span class="v">Restore</span></button>'; }).join('') + '</div>' : '<p class="muted small">No backups on Drive yet.</p>';
      h += '<p class="muted small">The app reminds you once a day on Today (“☁ Back up”). One tap and it goes to your Drive. Web apps can’t run while closed, so it needs that tap.</p>';
      h += '<details class="card"><summary class="muted small">Change the Google client ID</summary><input class="text" id="gdCid" value="' + esc(g.cid) + '" style="margin-top:8px"><button type="button" class="btn line small" id="gdSave" style="margin-top:8px">Save</button></details>';
    } else {
      h += '<details class="card"><summary class="muted small">Advanced: connect Drive directly (one-time Google setup, about 10 minutes)</summary><div class="stack" style="gap:8px;margin-top:8px"><ol class="gdsteps"><li>Open <b>console.cloud.google.com</b> and sign in. Make a new project called <b>Attention</b>.</li><li>Search <b>Google Drive API</b> → Enable.</li><li><b>Google Auth Platform → Get started</b>: app name Attention, your email, <b>External</b>, then add yourself under <b>Audience → Test users</b>.</li><li><b>Clients → Create client</b> → type <b>Web application</b>. Under <b>Authorised JavaScript origins</b> add <b>https://shravan-flow.github.io</b>. Create.</li><li>Copy the <b>Client ID</b> (ends in .apps.googleusercontent.com) and paste it here.</li></ol><input class="text" id="gdCid" placeholder="123…apps.googleusercontent.com"><button type="button" class="btn line" id="gdSave">Connect</button></div></details>';
    }
    h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Backup file on this phone</b><p class="muted small" style="margin:0">Everything in one file, photos included. Keep it in your Downloads or send it to yourself.</p><div class="row" style="gap:8px"><button type="button" class="btn line" style="flex:1" id="bkFile">Save file</button><button type="button" class="btn line" style="flex:1" id="bkOpen">Restore file</button><input type="file" id="bkIn" accept="application/json,.json,text/plain,.txt" hidden></div></div>';
    return { title: 'Backup', cap: g.last ? 'last ' + ago(g.last) : '', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      var q = function (x) { return r.querySelector(x); };
      var sg = q('#sbGo'); if (sg) sg.onclick = shareBackup;
      var sd = q('#sbSend'); if (sd) sd.onclick = function () { shareBackupFile(SB.file).catch(function () {}); };
      var sv = q('#gdSave'); if (sv) sv.onclick = function () { var v = q('#gdCid').value.trim(); if (!/\.apps\.googleusercontent\.com$/.test(v)) { toast('That doesn’t look like a client ID'); return; } g.cid = v; g.ok = false; GD.tok = null; save(); gdBackup(); };
      var bn = q('#gdNow'); if (bn) bn.onclick = function () { gdBackup(); };
      var gl = q('#gdList'); if (gl) gl.onclick = function () { GD.msg = 'Looking…'; GD.busy = true; drawSheet(); gdList().then(function () { GD.busy = false; GD.msg = null; drawSheet(); }).catch(function (e) { GD.busy = false; GD.msg = e.message; drawSheet(); }); };
      r.querySelectorAll('[data-gdr]').forEach(function (b) { b.onclick = function () { gdRestore(GD.files[+b.dataset.gdr]); }; });
      q('#bkFile').onclick = function () { toast('Packing…'); makeBackup().then(function (blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'attention-full-backup-' + dkey(new Date()) + '.json'; a.click(); state.lastBackup = new Date().toISOString(); save(); }); };
      var bi = q('#bkIn'); q('#bkOpen').onclick = function () { bi.click(); };
      bi.onchange = function () { var f = bi.files[0]; if (!f) return; f.text().then(function (t) { var d = JSON.parse(t); if (d.kind !== 'attention-full') throw new Error('use Settings → Your data → Restore file for older backups'); if (!confirm('Replace everything on this phone with this backup from ' + new Date(d.at).toLocaleString('en') + '?')) return; return restoreBackup(d).then(function () { closeSheet(); toast('Backup restored'); }); }).catch(function (e) { toast('Could not restore: ' + e.message); }); };
    } };
  }

  // ---------- photos taken without internet wait, and are read when it's back ----------
  function isNetErr(e) { return !navigator.onLine || (e && (e.name === 'TypeError' || /network|failed to fetch|load failed/i.test(e.message || ''))); }
  var qBusy = false;
  function runQueue() {
    if (qBusy || !navigator.onLine || !hasAI() || !state.shop) return;
    var s2 = shop(), dk = Object.keys(s2.days).filter(function (k) { return s2.days[k].status === 'queued'; })[0];
    var bk = Object.keys(s2.bills || {}).filter(function (id) { return s2.bills[id].status === 'queued'; })[0];
    if (!dk && !bk) return;
    qBusy = true; toast('Back online · reading the waiting photos');
    if (dk) { shopRead(dk); setTimeout(function () { qBusy = false; runQueue(); }, 15000); }
    else { billRead(bk); setTimeout(function () { qBusy = false; runQueue(); }, 15000); }
  }
  window.addEventListener('online', function () { setTimeout(runQueue, 1500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(runQueue, 1500); });
  setTimeout(runQueue, 3000);
  function queuedCount() { var s2 = state.shop; if (!s2) return 0; return Object.keys(s2.days || {}).filter(function (k) { return s2.days[k].status === 'queued'; }).length + Object.keys(s2.bills || {}).filter(function (id) { return s2.bills[id].status === 'queued'; }).length; }

  // ---------- long-press shortcuts: open a camera straight from the app icon ----------
  function quickCamSheet(kind) {
    var bill = kind === 'bill';
    return { title: bill ? 'Stock in' : 'Today’s sheet', cap: '', html: '<div class="stack" style="gap:12px"><button type="button" class="btn coral qcam" id="qcGo">📷 ' + (bill ? 'Photos of the KSBCL bill' : 'Photos of today’s sales sheet') + '</button><p class="muted small" style="margin:0">Pick or take all the pages at once.</p></div>', bind: function (r) {
      r.querySelector('#qcGo').onclick = function () { var f = document.getElementById(bill ? 'shBillFile' : 'shFile'); closeSheet(); if (f) f.click(); };
    } };
  }

  // ---------- shop insights: WhatsApp summary, what to order next, dashboard, checks ----------
  function waShare(text) {
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    var w = window.open(url, '_blank'); if (!w) location.href = url;
  }
  function daySold(d) { var g = d.grid, out = {}; if (!g) return out; dataRows(g).forEach(function (r) { var nm = String(g[r][SC.item] || '').trim(), sl = cellVal(g, r, SC.sales); if (!nm || !isNum(sl) || !num(sl)) return; var k = nm + (g[r][SC.size] ? ' ' + g[r][SC.size] : ''); out[k] = (out[k] || 0) + num(sl); }); return out; }
  function cashGap(d) { if (!d || d.status !== 'closed' || !d.written || !d.written.balance) return null; var exp = (d.sales || 0) - (d.expTotal || 0), gap = d.written.balance - exp; return Math.abs(gap) >= 100 ? gap : null; }
  function daySummaryText(k) {
    var s2 = shop(), d = s2.days[k]; if (!d) return '';
    var sold = daySold(d), top = Object.keys(sold).sort(function (a, b) { return sold[b] - sold[a]; }).slice(0, 3);
    var bl = Object.keys(bills()).map(function (id) { return s2.bills[id]; }).filter(function (b) { return b.applied === k; });
    var cases = bl.reduce(function (a, b) { return a + b.items.reduce(function (x, it) { return x + it.cases; }, 0); }, 0);
    var sales = d.status === 'closed' ? d.sales : daySales(d), et = (d.exp || []).reduce(function (a, e) { return a + num(e.v); }, 0);
    var t = '*' + s2.name + ' · ' + new Date(k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '*\n';
    t += 'Sales: ' + inr(sales) + '\n';
    if (d.status === 'closed') t += 'Profit (' + d.pct + '%): ' + inr(d.profit) + '\n';
    t += 'Expenses: ' + inr(et) + '\n';
    if (d.status === 'closed') t += '*Net: ' + inr(d.net) + '*\n';
    t += 'Cash in hand: ' + inr(sales - et) + (d.written && d.written.balance ? ' (sheet says ' + inr(d.written.balance) + ')' : '') + '\n';
    if (top.length) t += 'Top: ' + top.map(function (x) { return x + ' (' + sold[x] + ')'; }).join(', ') + '\n';
    if (cases) t += 'Stock in: ' + cases + ' case' + (cases > 1 ? 's' : '') + '\n';
    var gap = cashGap(d); if (gap) t += '⚠ cash ' + (gap < 0 ? 'short ' : 'over ') + inr(Math.abs(gap)) + '\n';
    return t.trim();
  }
  function monthSummaryText(m) {
    var s2 = shop(), mt = monthTotals(m), md = new Date(m + '-01T00:00:00');
    return ('*' + s2.name + ' · ' + md.toLocaleDateString('en', { month: 'long', year: 'numeric' }) + '*\n' + mt.n + ' days closed\nSales: ' + inr(mt.sales) + '\nProfit: ' + inr(mt.profit) + '\nExpenses: ' + inr(mt.exp) + '\n*Net: ' + inr(mt.net) + '*');
  }
  function shopShareSheet(k) {
    var s2 = shop(), t = daySummaryText(k);
    var h = '<div class="wabox"><div class="wab">' + esc(t).replace(/\*([^*]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</div></div>';
    h = '<button type="button" class="btn jungle" data-sheet="shopcard:' + k + '">🖼 Daily card for stakeholders</button>' + h;
    h += '<button type="button" class="btn wa" id="waGo">Send the text on WhatsApp</button>';
    h += '<label class="ttsw"><span><b>Ask every time I close a day</b><small>you pick the chat in WhatsApp</small></span><input type="checkbox" id="waAsk"' + (s2.waAsk !== false ? ' checked' : '') + '><i></i></label>';
    return { title: 'Day summary', cap: new Date(k + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }), html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelector('#waGo').onclick = function () { waShare(t); };
      r.querySelector('#waAsk').onchange = function (e) { s2.waAsk = e.target.checked; save(); };
    } };
  }
  // --- sales speed and cost history per item ---
  function salesWindow(days) {
    var s2 = shop(), cut = dkey(new Date(Date.now() - days * 864e5)), by = {}, n = 0;
    Object.keys(s2.days).forEach(function (k) { if (k < cut) return; var g = s2.days[k].grid; if (!g) return; n++; dataRows(g).forEach(function (r) { var nm = String(g[r][SC.item] || '').trim(); if (!nm) return; var key = regKey(nm, g[r][SC.size]), sl = cellVal(g, r, SC.sales); if (isNum(sl)) by[key] = (by[key] || 0) + num(sl); }); });
    return { by: by, days: n };
  }
  // the TCS on a bill or indent is shared out over its items in proportion to their amounts
  function tcsFactor(x) {
    var items = x.items || [], tot = num(x.itemTotal) || items.reduce(function (a, it) { return a + num(it.amount); }, 0);
    var inv = num(x.invoiceValue) || (num(x.tcs) ? tot + num(x.tcs) : 0);
    return tot && inv > tot && inv / tot < 1.2 ? inv / tot : 1;
  }
  function costHist(key) {
    var s2 = shop(), out = []; key = resolveKey(key); var me = s2.items[key], keys = {}; keys[key] = 1;
    if (me) Object.keys(me.alias || {}).forEach(function (a) { keys[regKey(a, me.size)] = 1; });
    var per = function (x) { return num(x.per) || BPC[+String(x.ml || (me && me.size) || '').replace(/[^0-9]/g, '')] || null; };
    Object.keys(bills()).forEach(function (id) { var b = s2.bills[id]; if (b.status !== 'added' && b.status !== 'pending') return; var f = tcsFactor(b); (b.items || []).forEach(function (it) { if (keys[resolveKey(it.key)] && it.rate && per(it)) out.push({ d: b.date, c: it.rate / per(it) * f, base: it.rate / per(it), tcs: f > 1, src: 'bill' }); }); });
    Object.keys(s2.indents || {}).forEach(function (id) { var n = s2.indents[id], f = tcsFactor(n); (n.items || []).forEach(function (it) { if (keys[resolveKey((s2.map || {})[normName(it.name) + '|' + it.ml])] && it.rate && per(it)) out.push({ d: n.date || '', c: it.rate / per(it) * f, base: it.rate / per(it), tcs: f > 1, src: 'indent' }); }); });
    return out.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  }
  function perCase(key) { var x = regItem(key), best = null; Object.keys(bills()).forEach(function (id) { (shop().bills[id].items || []).forEach(function (it) { if (resolveKey(it.key) === key && it.per) best = it.per; }); }); return best || (x && BPC[+x.size]) || 12; }
  // --- what to order next ---
  function orderPlan() {
    var s2 = shop(), cover = s2.cover || 7, sw = salesWindow(14), st = regStock(), adj = s2.orderAdj || {}, rows = [], slow = [];
    var sw30 = salesWindow(30);
    regAll().forEach(function (x) {
      var k = x.key, sold = sw.by[k] || 0, rate = sw.days ? sold / sw.days : 0, qty = st[k] ? st[k].qty : 0, per = perCase(k);
      if (rate > 0) {
        var left = qty / rate, need = rate * (cover + 2) - qty, cases = need > 0 ? Math.ceil(need / per) : 0;
        if (adj[k] != null) cases = Math.max(0, cases + adj[k]);
        if (cases > 0 || left <= 3) rows.push({ k: k, x: x, qty: qty, rate: rate, left: left, cases: cases, per: per, c: costFor(x.item, x.size) });
      } else if (qty > 0 && (sw30.by[k] || 0) <= 2 && sw30.days >= 7) { var c = costFor(x.item, x.size); slow.push({ x: x, qty: qty, sold: sw30.by[k] || 0, val: c ? c.c * qty : null }); }
    });
    rows.sort(function (a, b) { return a.left - b.left; });
    return { rows: rows, slow: slow, days: sw.days, cover: cover };
  }
  function shopOrderSheet() {
    var s2 = shop(), P = orderPlan(), h = '';
    if (P.days < 3) return { title: 'What to order', cap: '', html: '<div class="notice">Needs at least 3 days of sales sheets to see how fast things sell. ' + P.days + ' so far.</div>', bind: function () {} };
    h += '<div class="row between"><span class="muted small">Enough for</span><span class="row" style="gap:6px">' + [5, 7, 10, 14].map(function (n) { return '<button type="button" class="mschip sm' + (P.cover === n ? ' on' : '') + '" data-cov="' + n + '">' + n + ' days</button>'; }).join('') + '</span></div>';
    h += P.rows.length ? '<div class="stack" style="gap:8px">' + P.rows.map(function (o) {
      var urg = o.left <= 3;
      return '<div class="ordr' + (urg ? ' urg' : '') + '"><span class="t"><b>' + esc(o.x.item) + ' <span class="muted">' + esc(o.x.size) + '</span></b><small>' + fmtN(o.qty) + ' in stock · sells ' + (o.rate >= 1 ? Math.round(o.rate) : o.rate.toFixed(1)) + '/day · ' + (o.left < 1 ? 'runs out today' : 'runs out in ' + Math.round(o.left) + ' day' + (Math.round(o.left) === 1 ? '' : 's')) + '</small></span><span class="ordq"><button type="button" data-oadj="' + esc(o.k) + '" data-d="-1" aria-label="One case less">−</button><b>' + o.cases + '</b><button type="button" data-oadj="' + esc(o.k) + '" data-d="1" aria-label="One case more">+</button><small>cs</small></span></div>';
    }).join('') + '</div>' : '<div class="notice ok">✓ Nothing is running low for the next ' + P.cover + ' days.</div>';
    var tc = P.rows.reduce(function (a, o) { return a + o.cases; }, 0), cost = P.rows.reduce(function (a, o) { return a + (o.c ? o.c.c * o.per * o.cases : 0); }, 0);
    h += '<div class="shtiles ttq"><div><b class="display">' + tc + '</b><small>cases</small></div><div><b class="display">' + (cost ? inrK(cost) : '—') + '</b><small>approx. cost</small></div><div><b class="display">' + P.days + '</b><small>days of sales used</small></div></div>';
    if (P.slow.length) h += '<div class="card stack" style="gap:6px"><b style="font-size:14px">Slow-moving</b>' + P.slow.sort(function (a, b) { return (b.val || 0) - (a.val || 0); }).slice(0, 6).map(function (x) { return '<span style="font-size:13px;line-height:1.45">' + esc(x.x.item) + ' ' + esc(x.x.size) + ': ' + x.qty + ' bottles, sold ' + x.sold + ' in 30 days' + (x.val ? ' · ' + inr(x.val) + ' on the shelf' : '') + '</span>'; }).join('') + '</div>';
    if (tc) h += '<button type="button" class="btn wa" id="ordWa">Share the list on WhatsApp</button>';
    h += '<p class="muted small">From the last 14 days of sheets: how fast each item sells, today’s stock, and enough for ' + P.cover + ' days plus 2 days for delivery. Use − and + to change a suggestion.</p>';
    return { title: 'What to order', cap: tc + ' cases', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-cov]').forEach(function (b) { b.onclick = function () { s2.cover = +b.dataset.cov; s2.orderAdj = {}; save(); drawSheet(); }; });
      r.querySelectorAll('[data-oadj]').forEach(function (b) { b.onclick = function () { s2.orderAdj = s2.orderAdj || {}; var k = b.dataset.oadj; s2.orderAdj[k] = (s2.orderAdj[k] || 0) + +b.dataset.d; save(); drawSheet(); }; });
      var w = r.querySelector('#ordWa'); if (w) w.onclick = function () { waShare('*' + s2.name + ' · indent ' + new Date().toLocaleDateString('en', { day: 'numeric', month: 'short' }) + '*\n' + P.rows.filter(function (o) { return o.cases; }).map(function (o) { return o.x.item + ' ' + o.x.size + ' ml: ' + o.cases + ' cs'; }).join('\n') + '\nTotal: ' + tc + ' cases'); };
    } };
  }
  // --- dashboard ---
  function shopDashSheet(arg) {
    var s2 = shop(), m = arg || shopUi.month || dkey(new Date()).slice(0, 7), md = new Date(m + '-01T00:00:00'), mt = monthTotals(m);
    var pm = new Date(md); pm.setMonth(pm.getMonth() - 1); var pmk = dkey(pm).slice(0, 7), pt = monthTotals(pmk);
    var ks = Object.keys(s2.days).filter(function (k) { return k.slice(0, 7) === m && s2.days[k].grid; }).sort();
    var vals = ks.map(function (k) { var d = s2.days[k]; return { k: k, v: d.status === 'closed' ? d.sales : daySales(d) }; }), mx = Math.max.apply(null, vals.map(function (x) { return x.v; }).concat([1]));
    var best = vals.slice().sort(function (a, b) { return b.v - a.v; })[0];
    var h = '<div class="row between"><button type="button" class="nib" data-dm="-1" aria-label="Previous month">‹</button><b class="display" style="font-size:20px">' + md.toLocaleDateString('en', { month: 'long', year: 'numeric' }) + '</b><button type="button" class="nib" data-dm="1" aria-label="Next month">›</button></div>';
    h += '<div class="shtiles ttq"><div><b class="display">' + inrK(mt.sales) + '</b><small>sales</small></div><div><b class="display">' + inrK(mt.net) + '</b><small>net</small></div><div><b class="display">' + (mt.n && pt.n ? ((mt.sales / mt.n) / (pt.sales / pt.n) * 100 - 100).toFixed(0) + '%' : '—') + '</b><small>a day vs ' + pm.toLocaleDateString('en', { month: 'short' }) + '</small></div></div>';
    if (vals.length) h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Daily sales</b><div class="dbars">' + vals.map(function (x) { return '<i title="' + x.k + ' ' + inr(x.v) + '" style="height:' + Math.max(3, Math.round(x.v / mx * 100)) + '%' + (best && x.k === best.k ? ';background:#FFB23F' : '') + '"></i>'; }).join('') + '</div><span class="muted small">Best day: ' + new Date(best.k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + inr(best.v) + '</span></div>';
    // per item: bottles sold and profit
    var it = {};
    ks.forEach(function (k) { var g = s2.days[k].grid; dataRows(g).forEach(function (r) { var nm = String(g[r][SC.item] || '').trim(); if (!nm) return; var key = regKey(nm, g[r][SC.size]), sl = num(cellVal(g, r, SC.sales)), rt = num(cellVal(g, r, SC.rate)); if (!sl) return; var e = it[key] = it[key] || { n: nm + ' ' + (g[r][SC.size] || ''), sold: 0, rev: 0, prof: null }; e.sold += sl; e.rev += sl * rt; var c = costFor(nm, g[r][SC.size], k); if (c && rt) e.prof = (e.prof || 0) + sl * (rt - c.c); }); });
    var arr = Object.keys(it).map(function (k) { return it[k]; });
    var bs = arr.slice().sort(function (a, b) { return b.sold - a.sold; }).slice(0, 6), bmx = bs.length ? bs[0].sold : 1;
    if (bs.length) h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Best sellers</b>' + bs.map(function (x) { return '<div class="hbar"><span>' + esc(x.n) + '</span><span class="b"><i style="background:#12A39A;width:' + Math.round(x.sold / bmx * 100) + '%"></i></span><span style="text-align:right">' + fmtN(x.sold) + '</span></div>'; }).join('') + '</div>';
    var pr = arr.filter(function (x) { return x.prof != null; }).sort(function (a, b) { return b.prof - a.prof; });
    if (pr.length) { var sel = pr.slice(0, 5).concat(pr.length > 5 ? pr.slice(-2).filter(function (x) { return x.prof < pr[4].prof; }) : []), pmx = Math.max.apply(null, sel.map(function (x) { return Math.abs(x.prof); }).concat([1]));
      h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Profit by item</b>' + sel.map(function (x) { var pc = x.rev ? x.prof / x.rev * 100 : 0; return '<div class="hbar wide"><span>' + esc(x.n) + '</span><span class="b"><i style="background:' + (x.prof < 0 ? '#E5484D' : '#0F4D40') + ';width:' + Math.round(Math.abs(x.prof) / pmx * 100) + '%"></i></span><span style="text-align:right">' + inrK(x.prof) + ' · ' + pc.toFixed(0) + '%</span></div>'; }).join('') + '</div>'; }
    else h += '<p class="muted small">Profit by item appears once costs come in from your KSBCL bills or indents.</p>';
    return { title: 'Dashboard', cap: mt.n + ' days closed', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-dm]').forEach(function (b) { b.onclick = function () { var d = new Date(md); d.setMonth(d.getMonth() + +b.dataset.dm); ui.sheet.arg = dkey(d).slice(0, 7); drawSheet(); }; });
    } };
  }
  // --- checks: cash, stock going missing, cost rises ---
  function shopAlerts() {
    var s2 = shop(), out = [], cut = dkey(new Date(Date.now() - 31 * 864e5));
    Object.keys(s2.days).filter(function (k) { return k >= cut; }).sort().reverse().forEach(function (k) {
      var d = s2.days[k], gap = cashGap(d); if (!gap) return;
      var exp = (d.sales || 0) - (d.expTotal || 0);
      out.push({ id: 'cash:' + k, kind: 'cash', bad: gap < 0, k: k, t: 'Cash ' + (gap < 0 ? 'short ' : 'over ') + inr(Math.abs(gap)) + ' on ' + new Date(k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }), d: 'Sales ' + inr(d.sales) + ' − expenses ' + inr(d.expTotal) + ' = ' + inr(exp) + ' expected. The sheet’s balance says ' + inr(d.written.balance) + '.' });
    });
    var miss = {};
    Object.keys(s2.days).filter(function (k) { return k >= cut; }).forEach(function (k) { var g = s2.days[k].grid; if (!g) return; dataRows(g).forEach(function (r) { var nm = String(g[r][SC.item] || '').trim(), v = function (c) { return isNum(cellVal(g, r, c)) && String(g[r][c]).trim() !== '' ? num(cellVal(g, r, c)) : null; }; if (!nm) return; var o = v(SC.open), rc = v(SC.recv) || 0, sl = v(SC.sales), cl = v(SC.close); if (o == null || sl == null || cl == null) return; var gone = o + rc - sl - cl; if (gone > 0.01) { var key = regKey(nm, g[r][SC.size]), e = miss[key] = miss[key] || { n: nm + ' ' + (g[r][SC.size] || ''), b: 0, days: [] }; e.b += gone; e.days.push(k); } }); });
    Object.keys(miss).forEach(function (key) { var e = miss[key]; if (e.days.length < 2 && e.b < 3) return; out.push({ id: 'miss:' + key + ':' + e.days.length, kind: 'miss', bad: true, k: e.days.slice().sort().pop(), t: e.n + ': ' + fmtN(e.b) + ' bottle' + (e.b === 1 ? '' : 's') + ' missing', d: 'On ' + e.days.length + ' day' + (e.days.length > 1 ? 's' : '') + ' this month, closing was lower than opening + received − sold.' }); });
    regAll().forEach(function (x) {
      var hs = costHist(x.key); if (hs.length < 2) return; var a = hs[hs.length - 2], b = hs[hs.length - 1]; if (b.c <= a.c * 1.01 || b.d < cut) return;
      var rt = lastRate(x.key), mNow = rt ? (rt - b.c) / rt * 100 : null, mWas = rt ? (rt - a.c) / rt * 100 : null;
      out.push({ id: 'cost:' + x.key + ':' + b.d, kind: 'cost', bad: false, t: 'Cost went up: ' + x.item + ' ' + x.size, d: 'New ' + b.src + ': ' + inr(b.c, 2) + ' a bottle (was ' + inr(a.c, 2) + ').' + (rt ? ' At your rate of ' + inr(rt) + ', the margin is now ' + mNow.toFixed(1) + '% (was ' + mWas.toFixed(1) + '%).' : ''), key: x.key });
    });
    var seen = s2.seen || {};
    out.forEach(function (a) { a.seen = !!seen[a.id]; });
    return out;
  }
  function newAlerts() { try { return state.shop ? shopAlerts().filter(function (a) { return !a.seen; }).length : 0; } catch (e) { return 0; } }
  function shopChecksSheet() {
    var s2 = shop(), al = shopAlerts(), open = al.filter(function (a) { return !a.seen; }), done = al.filter(function (a) { return a.seen; });
    var card = function (a) { return '<div class="alc2 ' + a.kind + (a.seen ? ' seen' : '') + '"><b>' + ({ cash: '💸', miss: '📉', cost: '🏷' }[a.kind]) + ' ' + esc(a.t) + '</b><span>' + esc(a.d) + '</span><span class="row" style="gap:6px">' + (a.k ? '<button type="button" data-aday="' + a.k + '">Open that day</button>' : '') + (a.key ? '<button type="button" data-sheet="shopitem:' + esc(a.key) + '">See the item</button>' : '') + (a.seen ? '' : '<button type="button" class="g" data-aseen="' + esc(a.id) + '">Got it</button>') + '</span></div>'; };
    var h = open.length ? open.map(card).join('') : '<div class="notice ok">✓ Nothing new to look at.</div>';
    if (done.length) h += '<details><summary class="muted small">' + done.length + ' already seen</summary><div class="stack" style="gap:8px;margin-top:8px">' + done.map(card).join('') + '</div></details>';
    h += '<p class="muted small">Checked over the last month every time you open the shop: cash against the sheet’s balance, bottles that disappear, and costs that went up on new bills or indents.</p>';
    return { title: 'Checks', cap: open.length ? open.length + ' new' : 'all clear', html: '<div class="stack" style="gap:10px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-aseen]').forEach(function (b) { b.onclick = function () { s2.seen = s2.seen || {}; s2.seen[b.dataset.aseen] = 1; save(); drawSheet(); markShopTab(); }; });
      r.querySelectorAll('[data-aday]').forEach(function (b) { b.onclick = function () { var k = b.dataset.aday; closeSheet(); openShopDay(k); }; });
    } };
  }
  function markShopTab() { var t = document.querySelector('.tab[data-tab="shop"]'); if (t) t.classList.toggle('dot', newAlerts() > 0); }

  // ---------- daily card: one picture for stakeholders on WhatsApp ----------
  function cardCfg() {
    var s2 = shop(), c = s2.card = s2.card || {};
    var def = { sales: true, profit: true, exp: false, trend: true, top: true, stock: true, month: true, aftertax: true, tax: 30, fixed: 0, theme: 'green', lang: 'en', knName: '' };
    Object.keys(def).forEach(function (k) { if (c[k] == null) c[k] = def[k]; });
    return c;
  }
  var KN = { wd: ['ಭಾನುವಾರ', 'ಸೋಮವಾರ', 'ಮಂಗಳವಾರ', 'ಬುಧವಾರ', 'ಗುರುವಾರ', 'ಶುಕ್ರವಾರ', 'ಶನಿವಾರ'], mo: ['ಜನವರಿ', 'ಫೆಬ್ರವರಿ', 'ಮಾರ್ಚ್', 'ಏಪ್ರಿಲ್', 'ಮೇ', 'ಜೂನ್', 'ಜುಲೈ', 'ಆಗಸ್ಟ್', 'ಸೆಪ್ಟೆಂಬರ್', 'ಅಕ್ಟೋಬರ್', 'ನವೆಂಬರ್', 'ಡಿಸೆಂಬರ್'] };
  function cardWords(kn, dd) {
    var wd = dd.getDay(), mo = dd.getMonth(), enW = dd.toLocaleDateString('en', { weekday: 'long' }), enM = dd.toLocaleDateString('en', { month: 'long' });
    return kn ? { report: 'ದೈನಂದಿನ ವರದಿ', date: KN.wd[wd] + ', ' + dd.getDate() + ' ' + KN.mo[mo] + ' ' + dd.getFullYear(), sales: 'ಮಾರಾಟ', vs: function (p) { return 'ಕಳೆದ ' + KN.wd[wd] + 'ಕ್ಕಿಂತ ' + p; }, net: 'ನಿವ್ವಳ ಲಾಭ', margin: 'ಲಾಭಾಂಶ', last7: 'ಕಳೆದ 7 ದಿನಗಳು', exp: 'ಖರ್ಚು', cash: 'ಕೈಯಲ್ಲಿರುವ ನಗದು', stock: 'ಬಂದ ಸ್ಟಾಕ್', cases: function (n) { return n + ' ಕೇಸ್'; }, top: 'ಹೆಚ್ಚು ಮಾರಾಟವಾದವು', after: KN.mo[mo] + '\u200cನಲ್ಲಿ ಇಲ್ಲಿಯವರೆಗೆ · ತೆರಿಗೆ ನಂತರದ ಲಾಭ', fx: function (n, f, t) { return n + ' ನಿವ್ವಳ' + (f ? ' − ' + f + ' ನಿಗದಿತ ವೆಚ್ಚ' : '') + ' − ' + t + '% ತೆರಿಗೆ'; }, month: function (v) { return KN.mo[mo] + '\u200cನಲ್ಲಿ ಇಲ್ಲಿಯವರೆಗೆ ಮಾರಾಟ: ' + v; } }
      : { report: 'DAILY REPORT', date: enW + ', ' + dd.getDate() + ' ' + enM + ' ' + dd.getFullYear(), sales: 'Sales', vs: function (p) { return p + ' vs last ' + dd.toLocaleDateString('en', { weekday: 'short' }); }, net: 'Net', margin: 'margin', last7: 'Last 7 days', exp: 'Expenses', cash: 'Cash in hand', stock: 'Stock in', cases: function (n) { return n + ' case' + (n > 1 ? 's' : ''); }, top: 'Top sellers', after: enM + ' so far · profit after tax', fx: function (n, f, t) { return n + ' net' + (f ? ' − ' + f + ' fixed' : '') + ' − ' + t + '% tax'; }, month: function (v) { return enM + ' so far: ' + v + ' sales'; } };
  }
  function daySalesOf(d) { return !d ? null : d.status === 'closed' ? d.sales : d.grid ? daySales(d) : null; }
  // this month's net up to a day, minus fixed monthly costs (pro rata) and tax
  function monthAfterTax(k) {
    var s2 = shop(), c = cardCfg(), m = k.slice(0, 7), net = 0, sales = 0, n = 0;
    Object.keys(s2.days).forEach(function (x) { if (x.slice(0, 7) !== m || x > k) return; var d = s2.days[x]; var sv = daySalesOf(d); if (sv) sales += sv; if (d.status === 'closed') { net += d.net || 0; n++; } });
    var dim = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate(), day = +k.slice(8, 10);
    var fixed = num(c.fixed) * Math.min(1, day / dim), pre = net - fixed, tax = pre > 0 ? pre * num(c.tax) / 100 : 0;
    return { sales: sales, net: net, fixed: fixed, pre: pre, tax: tax, after: pre - tax, n: n };
  }
  function cardData(k) {
    var s2 = shop(), d = s2.days[k], sales = daySalesOf(d) || 0;
    var wk = dkey(new Date(new Date(k + 'T00:00:00').getTime() - 7 * 864e5)), prev = daySalesOf(s2.days[wk]);
    var trend = []; for (var i = 6; i >= 0; i--) { var dk = dkey(new Date(new Date(k + 'T00:00:00').getTime() - i * 864e5)); trend.push({ k: dk, v: daySalesOf(s2.days[dk]) || 0 }); }
    var sold = daySold(d), top = Object.keys(sold).sort(function (a, b) { return sold[b] - sold[a]; }).slice(0, 3).map(function (x) { return { n: x, q: sold[x] }; });
    var bl = Object.keys(bills()).map(function (id) { return s2.bills[id]; }).filter(function (b) { return b.applied === k; });
    var cases = 0, first = ''; bl.forEach(function (b) { b.items.forEach(function (it) { cases += it.cases; if (!first) first = shortBillName(it.name) + ' ' + it.ml; }); });
    var et = (d.exp || []).reduce(function (a, e) { return a + num(e.v); }, 0);
    return { k: k, name: s2.name, sales: sales, chg: prev ? (sales - prev) / prev * 100 : null, closed: d.status === 'closed', net: d.net, pct: d.pct, exp: et, cash: sales - et, trend: trend, top: top, cases: cases, first: first, mon: monthAfterTax(k) };
  }
  function drawCard(k) {
    var c = cardCfg(), D = cardData(k), W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d'), kn = c.lang === 'kn', F = '"Space Grotesk", "Noto Sans Kannada", system-ui, sans-serif', M = kn ? F : '"Space Mono", monospace', Wd = cardWords(kn, new Date(k + 'T00:00:00'));
    var blue = c.theme === 'blue', g = x.createLinearGradient(0, 0, W * .6, H);
    g.addColorStop(0, blue ? '#1B2F5A' : '#0F4D40'); g.addColorStop(.65, blue ? '#24407A' : '#12665A'); g.addColorStop(1, blue ? '#2E5296' : '#12A39A');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,178,63,.92)'; x.beginPath(); x.arc(W - 40, 40, 230, 0, Math.PI * 2); x.fill();
    var rr = function (X, Y, w, h, r, fill) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); x.fillStyle = fill; x.fill(); };
    var txt = function (t, X, Y, size, opt) { opt = opt || {}; x.font = (opt.w || 400) + ' ' + size + 'px ' + (opt.mono ? M : F); x.fillStyle = opt.c || '#fff'; x.textAlign = opt.a || 'left'; x.textBaseline = 'alphabetic'; var mw = opt.max; if (mw) { var s = size; while (x.measureText(t).width > mw && s > 12) { s -= 2; x.font = (opt.w || 400) + ' ' + s + 'px ' + (opt.mono ? M : F); } } x.fillText(t, X, Y); };
    var P = 72, y = 110;
    txt(Wd.report, P, y, 26, { mono: true, c: 'rgba(255,255,255,.8)' }); y += 66;
    txt(kn && c.knName ? c.knName : D.name, P, y, 66, { w: 700, max: 760 }); y += 50;
    txt(Wd.date, P, y, 34, { c: 'rgba(255,255,255,.85)' }); y += 50;
    var showNet = c.profit && D.closed, tw = showNet ? 560 : W - 2 * P;
    if (c.sales) {
      rr(P, y, tw, 250, 34, 'rgba(255,255,255,.13)');
      txt(Wd.sales, P + 34, y + 58, 30, { c: 'rgba(255,255,255,.8)' });
      txt(inr(D.sales), P + 34, y + 160, 96, { w: 700, max: tw - 68 });
      if (D.chg != null) txt(Wd.vs((D.chg >= 0 ? '▲ ' : '▼ ') + Math.abs(D.chg).toFixed(0) + '%'), P + 34, y + 214, 28, { c: D.chg >= 0 ? '#9FF0D9' : '#FFC2B8', max: tw - 68 });
      if (showNet) {
        var nx = P + tw + 24, nw = W - P - nx; rr(nx, y, nw, 250, 34, '#FFB23F');
        txt(Wd.net, nx + 30, y + 58, 30, { c: '#0F4D40', max: nw - 60 }); txt(inr(D.net), nx + 30, y + 150, 70, { w: 700, c: '#0F4D40', max: nw - 60 }); txt(Wd.margin + ' ' + D.pct + '%', nx + 30, y + 214, 28, { c: '#0F4D40', max: nw - 60 });
      }
      y += 280;
    }
    if (c.trend) {
      rr(P, y, W - 2 * P, 210, 30, 'rgba(255,255,255,.09)'); txt(Wd.last7, P + 30, y + 48, 26, { c: 'rgba(255,255,255,.8)' });
      var mx = Math.max.apply(null, D.trend.map(function (t) { return t.v; }).concat([1])), bw = (W - 2 * P - 60 - 6 * 14) / 7;
      D.trend.forEach(function (t, i) { var h = Math.max(6, t.v / mx * 120), bx = P + 30 + i * (bw + 14); rr(bx, y + 186 - h, bw, h, 8, i === 6 ? '#FFB23F' : 'rgba(255,255,255,.45)'); });
      y += 240;
    }
    var rows = [];
    if (c.exp) { rows.push([Wd.exp, inr(D.exp)]); rows.push([Wd.cash, inr(D.cash)]); }
    if (c.stock && D.cases) rows.push([Wd.stock, Wd.cases(D.cases) + (D.first ? ' · ' + D.first : '')]);
    rows.forEach(function (r) { txt(r[0], P, y + 38, 32, { c: 'rgba(255,255,255,.8)' }); txt(r[1], W - P, y + 38, 32, { w: 700, a: 'right', max: 600 }); x.fillStyle = 'rgba(255,255,255,.16)'; x.fillRect(P, y + 60, W - 2 * P, 2); y += 76; });
    if (c.top && D.top.length) { y += 10; txt(Wd.top, P, y + 30, 28, { c: 'rgba(255,255,255,.75)' }); txt(D.top.map(function (t) { return t.n + ' · ' + t.q; }).join('    '), P, y + 76, 32, { w: 600, max: W - 2 * P }); y += 110; }
    var by = H - 90;
    if (c.aftertax && D.mon.n) {
      var bh = 150, bt = by - bh - 20; rr(P, bt, W - 2 * P, bh, 30, 'rgba(255,255,255,.15)');
      txt(Wd.after, P + 32, bt + 60, 30, { c: 'rgba(255,255,255,.85)', max: 560 });
      txt(Wd.fx(inrK(D.mon.net), D.mon.fixed ? inrK(D.mon.fixed) : 0, num(c.tax)), P + 32, bt + 106, 26, { c: 'rgba(255,255,255,.65)', max: 560 });
      txt(inr(D.mon.after), W - P - 32, bt + 100, 64, { w: 700, a: 'right', c: '#FFD27A', max: 380 });
    }
    txt(c.month ? Wd.month(inrK(D.mon.sales)) : '', P, H - 50, 28, { c: 'rgba(255,255,255,.85)' });
    txt('◎ Attention', W - P, H - 50, 28, { c: 'rgba(255,255,255,.85)', a: 'right' });
    return cv;
  }
  function cardFonts() { try { return Promise.all([['700 40px "Space Grotesk"'], ['400 40px "Space Grotesk"'], ['400 20px "Space Mono"'], ['400 40px "Noto Sans Kannada"', 'ಕನ್ನಡ'], ['700 40px "Noto Sans Kannada"', 'ಕನ್ನಡ']].map(function (f) { return document.fonts.load(f[0], f[1]); })).catch(function () {}); } catch (e) { return Promise.resolve(); } }
  function shareCard(k) {
    cardFonts().then(function () {
      var cv = drawCard(k), name = shop().name.replace(/[^a-z0-9]+/gi, '-') + '-' + k + '.png';
      cv.toBlob(function (blob) {
        var file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: shop().name + ' ' + k }).catch(function () {});
        else { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); toast('Saved the picture: attach it in WhatsApp'); }
      }, 'image/png');
    });
  }
  function shopCardSheet(k) {
    var c = cardCfg(), s2 = shop();
    var tg = function (key, lab, sub) { return '<label class="ttsw"><span><b>' + lab + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span><input type="checkbox" data-cc="' + key + '"' + (c[key] ? ' checked' : '') + '><i></i></label>'; };
    var dks = Object.keys(s2.days).filter(function (x) { return s2.days[x].grid; }).sort().reverse().slice(0, 30);
    var h = '<div class="cardlang"><span class="cap">Language</span>' + [['en', 'English'], ['kn', 'ಕನ್ನಡ']].map(function (t) { return '<button type="button" class="mschip' + (c.lang === t[0] ? ' on' : '') + '" data-clang="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (dks.length > 1) h += '<label class="lab rng">Day<select class="text" id="cardDay">' + dks.map(function (x) { return '<option value="' + x + '"' + (x === k ? ' selected' : '') + '>' + new Date(x + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + (s2.days[x].status === 'closed' ? '' : ' (not closed)') + '</option>'; }).join('') + '</select></label>';
    if (c.lang === 'kn') h += '<label class="lab rng">Shop name in Kannada (optional)<input class="text" id="knName" value="' + esc(c.knName || '') + '" placeholder="ಲಕ್ಷ್ಮಿ ವೈನ್ಸ್"></label>';
    h += '<img id="cardImg" class="cardimg" alt="Daily card preview">';
    h += '<button type="button" class="btn wa" id="cardGo">Share the card on WhatsApp</button>';
    h += '<details class="card"' + (s2.cardOpen ? ' open' : '') + ' id="cardOpts"><summary><b>What to show</b></summary><div class="stack" style="gap:8px;margin-top:10px">' +
      tg('sales', 'Sales', 'with the change vs the same day last week') + tg('profit', 'Profit and net', 'margin %, net after expenses (closed days)') + tg('exp', 'Expenses and cash in hand', '') + tg('trend', '7-day trend', '') + tg('top', 'Top sellers', 'top 3 items') + tg('stock', 'Stock in', 'KSBCL bills that arrived') + tg('month', 'Month so far', 'sales this month') + tg('aftertax', 'Month profit after tax', 'this month’s net − fixed costs − tax') +
      '<label class="brf"><span>Tax rate</span><input inputmode="decimal" data-cn="tax" value="' + c.tax + '"><small>% of profit</small></label>' +
      '<label class="brf"><span>Fixed monthly costs</span><input inputmode="decimal" data-cn="fixed" value="' + (c.fixed || 0) + '"><small>₹ a month</small></label>' +
      '<div class="row" style="gap:6px">' + [['green', 'Green'], ['blue', 'Blue']].map(function (t) { return '<button type="button" class="mschip sm' + (c.theme === t[0] ? ' on' : '') + '" data-cth="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div></details>';
    h += '<p class="muted small">Fixed monthly costs (licence fee, rent…) are spread over the days. Tax is taken off this month’s profit when it’s above zero. The TCS is already inside the bottle costs.</p>';
    return { title: 'Daily card', cap: new Date(k + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }), html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      var paint = function () { cardFonts().then(function () { var im = r.querySelector('#cardImg'); if (im) im.src = drawCard(k).toDataURL('image/png'); }); };
      paint();
      r.querySelector('#cardGo').onclick = function () { shareCard(k); };
      var cdy = r.querySelector('#cardDay'); if (cdy) cdy.onchange = function () { openSheet('shopcard:' + cdy.value); };
      r.querySelectorAll('[data-clang]').forEach(function (b) { b.onclick = function () { c.lang = b.dataset.clang; save(); drawSheet(); }; });
      var kn2 = r.querySelector('#knName'); if (kn2) kn2.onchange = function () { c.knName = kn2.value.trim(); save(); paint(); };
      r.querySelector('#cardOpts').addEventListener('toggle', function (e) { s2.cardOpen = e.target.open; });
      r.querySelectorAll('[data-cc]').forEach(function (cb) { cb.onchange = function () { c[cb.dataset.cc] = cb.checked; save(); paint(); }; });
      r.querySelectorAll('[data-cn]').forEach(function (inp) { inp.onchange = function () { c[inp.dataset.cn] = Math.max(0, num(inp.value)); save(); paint(); }; });
      r.querySelectorAll('[data-cth]').forEach(function (b) { b.onclick = function () { c.theme = b.dataset.cth; save(); r.querySelectorAll('[data-cth]').forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); }; });
    } };
  }

  // ---------- a sales sheet for any day, not just today ----------
  function moveShopDay(from, to) {
    var s2 = shop(), d = s2.days[from], t = s2.days[to];
    if (!d) return false;
    if (t && (t.grid || (t.photos || []).length)) { toast('There’s already a sheet on that day: open it, or delete it first'); return false; }
    d.sheetDate = null; delete d.carried; s2.days[to] = d; delete s2.days[from];
    regAssign(to); save(); return true;
  }
  function missingDays() {
    var s2 = shop(), ks = Object.keys(s2.days).filter(function (k) { var d = s2.days[k]; return d.grid || (d.photos || []).length; }).sort(), out = [];
    var start = new Date(); start.setDate(1); if (ks[0] && ks[0] < dkey(start)) start = new Date(Math.max(new Date(ks[0] + 'T00:00:00').getTime(), Date.now() - 45 * 864e5));
    var have = {}; ks.forEach(function (k) { have[k] = 1; });
    for (var d = new Date(start); dkey(d) < dkey(new Date()); d.setDate(d.getDate() + 1)) if (!have[dkey(d)]) out.push(dkey(d));
    return out;
  }
  function shopPickSheet() {
    var s2 = shop(), tk = dkey(new Date()), yk = dkey(new Date(Date.now() - 864e5)), sel = shopUi.pickSel || tk, miss = missingDays();
    var fmt = function (k) { return new Date(k + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }); };
    var has = s2.days[sel] && (s2.days[sel].grid || (s2.days[sel].photos || []).length);
    var h = '<div class="row" style="gap:6px;flex-wrap:wrap">' + [[tk, 'Today'], [yk, 'Yesterday']].map(function (x) { return '<button type="button" class="mschip' + (sel === x[0] ? ' on' : '') + '" data-pk="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '<input type="date" class="msdate" id="pkD" value="' + sel + '" max="' + tk + '"></div>';
    if (miss.length) h += '<div class="card stack" style="gap:8px"><b style="font-size:14px">Days with no sheet yet</b><div class="row" style="gap:6px;flex-wrap:wrap">' + miss.slice(-40).map(function (k) { return '<button type="button" class="mschip sm' + (sel === k ? ' on' : '') + '" data-pk="' + k + '">' + fmt(k) + '</button>'; }).join('') + '</div><span class="muted small">Fill them oldest first: each day’s opening is checked against the day before.</span></div>';
    h += '<div class="pkday"><span class="cap">Sheet for</span><b class="display">' + new Date(sel + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' }) + '</b>' + (has ? '<span class="muted small">There’s already a sheet for this day: new photos are added to it.</span>' : '') + '</div>';
    h += '<button type="button" class="btn coral qcam" id="pkCam">📷 Photos of the sheet</button>';
    h += '<button type="button" class="btn line" id="pkType">' + (has ? 'Open that day' : '✎ Type it in instead') + '</button>';
    return { title: 'Sales sheet', cap: 'which day?', html: '<div class="stack" style="gap:12px">' + h + '</div>', bind: function (r) {
      r.querySelectorAll('[data-pk]').forEach(function (b) { b.onclick = function () { shopUi.pickSel = b.dataset.pk; drawSheet(); }; });
      var di = r.querySelector('#pkD'); di.onchange = function () { if (di.value && di.value <= tk) { shopUi.pickSel = di.value; drawSheet(); } };
      r.querySelector('#pkCam').onclick = function () { shopUi.pickKey = sel; shopUi.pickSel = null; var f = document.getElementById('shFile'); closeSheet(); if (f) f.click(); };
      r.querySelector('#pkType').onclick = function () { shopUi.pickSel = null; closeSheet(); openShopDay(sel); };
    } };
  }

  // ---------- his handwriting as a second check: cut each brand name from the photo, compare with earlier samples ----------
  var INK = null; // { brandKey: [{ id, v: base64 of 64x24 bytes, ar }] }
  function inkThr() { var t = state.shop && state.shop.inkThr; return t == null ? 80 : t; }
  function inkLoad() { return INK ? Promise.resolve(INK) : idbGet('inkf').then(function (x) { INK = x || {}; return INK; }).catch(function () { INK = {}; return INK; }); }
  function inkSave() { return idbPut('inkf', INK || {}).catch(function () {}); }
  function brandKey(n) { return normName(n).replace(/ /g, ''); }
  function inkDescCanvas(canvas) {
    var W = canvas.width, H = canvas.height, px = canvas.getContext('2d').getImageData(0, 0, W, H).data, g = new Float32Array(W * H), hist = new Array(256).fill(0), i, t, x, y;
    for (i = 0; i < W * H; i++) { var v = (px[i * 4] * .299 + px[i * 4 + 1] * .587 + px[i * 4 + 2] * .114) | 0; g[i] = v; hist[v]++; }
    var tot = W * H, sum = 0; for (t = 0; t < 256; t++) sum += t * hist[t];
    var sB = 0, wB = 0, best = 0, thr = 128; for (t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; var wF = tot - wB; if (!wF) break; sB += t * hist[t]; var mB = sB / wB, mF = (sum - sB) / wF, bt = wB * wF * (mB - mF) * (mB - mF); if (bt > best) { best = bt; thr = t; } }
    var x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (g[y * W + x] < thr) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (n < 10) return null;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1, OW = 64, OH = 24, m = new Float32Array(OW * OH);
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) if (g[y * W + x] < thr) { m[Math.min(OH - 1, ((y - y0) / bh * OH) | 0) * OW + Math.min(OW - 1, ((x - x0) / bw * OW) | 0)] += 1; }
    for (var pass = 0; pass < 2; pass++) { var b = new Float32Array(OW * OH); for (y = 0; y < OH; y++) for (x = 0; x < OW; x++) { var s = 0, c = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = y + dy, xx = x + dx; if (yy >= 0 && yy < OH && xx >= 0 && xx < OW) { s += m[yy * OW + xx]; c++; } } b[y * OW + x] = s / c; } m = b; }
    // store as bytes (0–255 of the normalised map) to keep it small
    var mx = 0; for (i = 0; i < m.length; i++) if (m[i] > mx) mx = m[i];
    var bytes = new Uint8Array(m.length); for (i = 0; i < m.length; i++) bytes[i] = mx ? Math.round(m[i] / mx * 255) : 0;
    var str = ''; for (i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return { v: btoa(str), ar: Math.round(bw / bh * 100) / 100 };
  }
  var inkVecCache = {};
  function inkVec(d) {
    if (inkVecCache[d.v]) return inkVecCache[d.v];
    var s = atob(d.v), m = new Float32Array(s.length), mean = 0, i; for (i = 0; i < s.length; i++) { m[i] = s.charCodeAt(i); mean += m[i]; } mean /= m.length;
    var nn = 0; for (i = 0; i < m.length; i++) { m[i] -= mean; nn += m[i] * m[i]; } nn = Math.sqrt(nn) || 1; for (i = 0; i < m.length; i++) m[i] /= nn;
    return (inkVecCache[d.v] = m);
  }
  function inkSim(a, b) {
    var A = inkVec(a), Bv = inkVec(b), OW = 64, OH = 24, best = -1;
    for (var sy = -1; sy <= 1; sy++) for (var sx = -3; sx <= 3; sx++) { var s = 0; for (var y = 0; y < OH; y++) { var yy = y + sy; if (yy < 0 || yy >= OH) continue; for (var x = 0; x < OW; x++) { var xx = x + sx; if (xx < 0 || xx >= OW) continue; s += A[y * OW + x] * Bv[yy * OW + xx]; } } if (s > best) best = s; }
    var r = Math.min(a.ar, b.ar) / Math.max(a.ar, b.ar);
    return Math.max(0, Math.round(best * (.75 + .25 * r) * 100));
  }
  // cut the name out of the photo: box = [ymin, xmin, ymax, xmax] in 0–1000
  function inkCrop(photoUrl, box) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () {
        var W = im.width, H = im.height, y0 = box[0] / 1000 * H, x0 = box[1] / 1000 * W, y1 = box[2] / 1000 * H, x1 = box[3] / 1000 * W;
        var ph = (y1 - y0) * .12, pw = (x1 - x0) * .04; y0 = Math.max(0, y0 - ph); y1 = Math.min(H, y1 + ph); x0 = Math.max(0, x0 - pw); x1 = Math.min(W, x1 + pw);
        var cw = x1 - x0, ch = y1 - y0; if (cw < 8 || ch < 6) { res(null); return; }
        var k = Math.min(1, 64 / ch), c = document.createElement('canvas'); c.width = Math.max(8, Math.round(cw * k)); c.height = Math.max(6, Math.round(ch * k));
        var x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.3)'; x.drawImage(im, x0, y0, cw, ch, 0, 0, c.width, c.height);
        res({ url: c.toDataURL('image/jpeg', .7), d: inkDescCanvas(c) });
      }; im.onerror = function () { res(null); }; im.src = photoUrl;
    });
  }
  // after a sheet is read: cut each brand name, compare with his earlier writing
  function inkProcess(k) {
    var d = shopDay(k); if (!d || !d.boxes) return Promise.resolve();
    return Promise.all([inkLoad(), shopPhotos(d)]).then(function (a) {
      var imgs = a[1], rows = Object.keys(d.boxes);
      d.ink = d.ink || {};
      return rows.reduce(function (p, r) {
        return p.then(function () {
          var bx = d.boxes[r], img = imgs[bx.p || 0] || imgs[0]; if (!img) return;
          return inkCrop(img, bx.b).then(function (c) { if (!c || !c.d) return; var id = 'ik' + Date.now().toString(36) + r; d.ink[r] = { id: id, d: c.d }; return idbPut('ink-' + id, c.url); });
        });
      }, Promise.resolve());
    }).then(function () { inkMatch(k); save(); if (sp && sp.k === k) drawShopDay(); });
  }
  function inkBest(desc, bk) { var ss = (INK || {})[bk] || []; var b = 0; ss.forEach(function (s) { var v = inkSim(desc, s); if (v > b) b = v; }); return ss.length ? b : null; }
  function inkMatch(k) {
    var d = shopDay(k), g = d && d.grid; if (!g || !d.ink || !INK) return;
    var thr = inkThr(); d.inkm = {};
    Object.keys(d.ink).forEach(function (r) {
      if (!g[r]) return; var nm = String(g[r][SC.item] || '').trim(), mine = brandKey(nm), desc = d.ink[r].d;
      var pa = nm ? inkBest(desc, mine) : null, best = null, bp = 0;
      Object.keys(INK).forEach(function (bk) { if (bk === mine) return; var v = inkBest(desc, bk); if (v != null && v > bp) { bp = v; best = bk; } });
      var st = pa == null ? 'new' : pa >= thr ? 'ok' : pa >= 60 ? 'likely' : 'low';
      if (best && bp >= thr && (pa == null || bp > pa + 5)) st = 'conflict';
      d.inkm[r] = { st: st, p: pa, alt: best, ap: bp };
    });
  }
  function inkBrandName(bk) { var x = regAll().filter(function (y) { return brandKey(y.item) === bk; })[0]; return x ? x.item : bk; }
  // a confirmed name: keep this snippet as a sample of how he writes it (newest 12 per brand)
  function inkLearn(name, ent) {
    if (!ent || !ent.d || !name) return; var bk = brandKey(name); INK = INK || {};
    var arr = INK[bk] = INK[bk] || []; if (arr.some(function (s) { return s.id === ent.id; })) return;
    arr.push({ id: ent.id, v: ent.d.v, ar: ent.d.ar }); while (arr.length > 12) { var old = arr.shift(); idbDel('ink-' + old.id).catch(function () {}); }
  }
  function inkLearnDay(k) {
    var d = shopDay(k); if (!d || !d.ink || !d.grid) return Promise.resolve();
    return inkLoad().then(function () { Object.keys(d.ink).forEach(function (r) { var m = (d.inkm || {})[r]; if (m && m.st === 'conflict') return; var nm = d.grid[r] && String(d.grid[r][SC.item] || '').trim(); if (nm) inkLearn(nm, d.ink[r]); }); return inkSave(); });
  }
  function inkImg(id, cls) { return '<img class="' + (cls || 'inkimg') + '" data-ink="' + id + '" alt="his writing">'; }
  function fillInk(root) { root.querySelectorAll('img[data-ink]').forEach(function (im) { idbGet('ink-' + im.dataset.ink).then(function (u) { if (u) im.src = u; }).catch(function () {}); }); }
  function inkBadge(m) {
    if (!m) return '';
    if (m.st === 'ok') return '<span class="ikb ok">✓ ' + m.p + '%</span>';
    if (m.st === 'likely') return '<span class="ikb lk">likely ' + m.p + '%</span>';
    if (m.st === 'conflict') return '<span class="ikb cf">check</span>';
    if (m.st === 'low') return '<span class="ikb lo">' + m.p + '%</span>';
    return '<span class="ikb nw">new</span>';
  }
  function inkSummary(d) {
    if (!d.inkm) return ''; var c = { ok: 0, likely: 0, conflict: 0, low: 0, new: 0 }; Object.keys(d.inkm).forEach(function (r) { c[d.inkm[r].st]++; });
    var parts = []; if (c.ok) parts.push(c.ok + ' ✓'); if (c.likely) parts.push(c.likely + ' likely'); if (c.conflict) parts.push(c.conflict + ' to check'); if (c.low) parts.push(c.low + ' unsure'); if (c.new) parts.push(c.new + ' new');
    return parts.length ? '<div class="inksum"><b>His writing: ' + parts.join(' · ') + '</b><small>✓ = the writing matches earlier samples of that name, ' + inkThr() + '% or more</small></div>' : '';
  }
  // "Which one is it?"
  function inkWhichHtml(d) {
    var r = sp.inkRow, g = d.grid, m = (d.inkm || {})[r] || {}, nm = String(g[r][SC.item] || '').trim(), ent = d.ink[r];
    var opts = []; if (m.alt) opts.push({ bk: m.alt, p: m.ap, why: 'his writing on earlier days looks closest' }); opts.push({ bk: brandKey(nm), p: m.p, why: 'what the AI read', name: nm });
    var h = '<h1 class="display" style="font-size:28px;margin:0">Which one is it?</h1><div class="inkbig"><span class="cap">On this sheet</span>' + inkImg(ent.id, 'inkimg big') + '<small>' + esc(g[r][SC.size] || '') + ' ml</small></div>';
    h += opts.map(function (o, i) { var ss = ((INK || {})[o.bk] || []).slice(-3); return '<button type="button" class="inkopt' + (i === 0 ? ' on' : '') + '" data-iko="' + i + '"><span class="row between" style="gap:8px"><b>' + esc(o.name || inkBrandName(o.bk)) + '</b>' + (o.p != null ? '<span class="ikb ' + (o.p >= inkThr() ? 'ok' : o.p >= 60 ? 'lk' : 'lo') + '">' + o.p + '%</span>' : '') + '</span><small>' + o.why + '</small><span class="row" style="gap:6px">' + ss.map(function (s) { return inkImg(s.id, 'inkimg sm'); }).join('') + '</span></button>'; }).join('');
    h += '<button type="button" class="btn line" id="ikElse">Something else…</button><button type="button" class="btn ghost small" id="ikBack">‹ List</button>';
    h += '<p class="muted small">Your answer is saved as one more sample of how he writes it.</p>';
    sp.inkOpts = opts; return h;
  }
  // the AI's text belongs to another item already → don't teach it as a name for this one
  function inkRawOther(raw, size, rk) {
    var low = String(raw).toLowerCase().trim(), k2 = regKey(raw, size);
    if (k2 && k2 !== rk && regItem(k2)) return true;
    return regAll().some(function (x) { return x.key !== rk && (String(x.item || '').toLowerCase().trim() === low || x.alias[low]); });
  }
  function bindInkWhich(o, d) {
    var r = sp.inkRow, q = function (x) { return o.querySelector(x); };
    fillInk(o);
    q('#ikBack').onclick = function () { sp.step = 'sheet'; sp.view = 'list'; drawShopDay(); };
    q('#ikElse').onclick = function () { openNamePick(+r, 'sheet', 'all'); };
    o.querySelectorAll('[data-iko]').forEach(function (b) { b.onclick = function () {
      var op = sp.inkOpts[+b.dataset.iko], name = op.name || inkBrandName(op.bk), g = d.grid; spSnap(d);
      groupRows(g, +r).forEach(function (x) { g[x][SC.item] = name; var rk = regAdd(name, g[x][SC.size], 'sheet'); var raw = d.ai && d.ai[x] ? String(d.ai[x][SC.item] || '').trim() : ''; if (rk && raw && !inkRawOther(raw, g[x][SC.size], rk)) regAlias(rk, raw, 2); });
      inkLoad().then(function () { inkLearn(name, d.ink[r]); return inkSave(); }).then(function () { inkMatch(sp.k); save(); sp.step = 'sheet'; sp.view = 'list'; drawShopDay(); toast('Saved · one more sample of his writing'); });
    }; });
  }

  // ---------- shell ----------
  function render() {
    migrate(state);
    if (syncCalendarTargets()) { save(); syncGoal(); }
    var view = document.getElementById('view');
    if (ui.tab === 'trail') { view.innerHTML = renderToday(); bindTrail(view, todayNum()); bindTargets(view); }
    else if (ui.tab === 'log') { view.innerHTML = renderLog(); bindLog(view); }
    else if (ui.tab === 'shop') { view.innerHTML = renderShop(); bindShop(view); }
    else if (ui.tab === 'fit') { view.innerHTML = renderFit(); bindFit(view); if (fitUi.view === 'plan') stravaSync(false); }
    else { view.innerHTML = renderSettings(); bindSettings(view); stravaSync(false); }
    updateEye(); markShopTab();
    document.querySelectorAll('.tab[data-tab]').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); t.setAttribute('aria-current', t.dataset.tab === ui.tab ? 'page' : 'false'); });
    drawSheet();
  }
  document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { closeSheet(); ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); });
  });
  document.getElementById('checkinBtn').addEventListener('click', openCheckin);
  document.getElementById('notesFab').addEventListener('click', function () { openNotes(); });

  if ('serviceWorker' in navigator) {
    var hadSW = !!navigator.serviceWorker.controller, t0 = Date.now();
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadSW) return;
      var busy = !document.getElementById('overlay').hidden || ui.sheet;
      if (Date.now() - t0 < 20000 && !busy) location.reload(); else toast('A new version is ready: close and reopen the app');
    });
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.type === 'move') { var mm = /move=([a-z0-9]+)/.exec(e.data.url || ''); openMove(mm ? mm[1] : suggestMove()); return; }
      if (e.data.type === 'goal') { if (/win=1/.test(e.data.url || '')) { hitSingle(); openGoal(); } else if (vz) return; else openMorning(); return; }
      if (e.data.type === 'tonight') { resetOverlay(); closeOverlayEl(); ui.tab = 'trail'; render(); openSheet('tonight'); return; }
      if (e.data.type === 'breathe') { openBreath(); return; }
      if (e.data.type === 'checkin' && !ci) openCheckin();
    });
  }
  var lastDay = todayNum();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && todayNum() !== lastDay) { lastDay = todayNum(); ui.sel = null; render(); } });

  render();
  loadNotes().then(updateEye);
  syncGoal();
  loadHolidays(false);
  stravaSync(false);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) stravaSync(false); });
  if (/[?&]win=1/.test(location.search)) { hitSingle(); openGoal(); }
  else if (/[?&]goal=1/.test(location.search)) openMorning();
  else if (/[?&]shared=1/.test(location.search)) { history.replaceState(history.state, '', location.pathname); receiveShared(); }
  else if (/[?&]tonight=1/.test(location.search)) { openSheet('tonight'); history.replaceState(history.state, '', location.pathname); }
  else if (/[?&]go=spend/.test(location.search)) { history.replaceState(history.state, '', location.pathname); openSpend(); }
  else if (/[?&]go=(sheet|bill)/.test(location.search)) { var gk2 = /go=bill/.test(location.search) ? 'bill' : 'sheet'; history.replaceState(history.state, '', location.pathname); ui.tab = 'shop'; render(); openSheet(gk2 === 'sheet' ? 'shoppick' : 'quickcam:' + gk2); }
  else if (/[?&]breathe=1/.test(location.search)) { history.replaceState(history.state, '', location.pathname); openBreath(); }
  else if (/[?&]checkin=1/.test(location.search)) openCheckin();
})();
