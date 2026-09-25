/* Attention — thirty days on the trail, plus random mindful check-ins. */
(function () {
  'use strict';

  var STORE_KEY = 'attention.v1';
  var APP_VERSION = '11';
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
    el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" fill="#FFC23A"/></svg><span>' + esc(text) + '</span>';
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
  var SEC = { 1: '#E0312B', 2: '#FF5A1F', 3: '#1D5BD8', 4: '#17A864' };
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

  function renderTrail() {
    var today = todayNum(), sel = ui.sel || today, xp = totalXp(), lv = levelFor(xp), st = streak();
    var pct = lv.next ? Math.round((xp - lv.floor) / (lv.next - lv.floor) * 100) : 100;
    var h = '<div class="stack">';
    h += '<header class="topbar"><span class="wordmark">ATTENTION<i>.</i></span><span class="eyebrow">' + new Date().toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }) + '</span></header>';

    // hero livery card
    h += '<section class="hero" aria-label="Your progress"><span class="streakpill" aria-label="' + st + ' day streak"><svg class="flame" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="' + FLAME + '" fill="#FFC23A"/></svg>' + st + '</span>' +
      '<div><span class="lbl">DAY</span><div class="racenum">' + String(today).padStart(2, '0') + '<small>/30</small></div></div>' +
      '<div class="meta"><div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0"><span class="lbl">LV ' + lv.num + '</span><span class="lvl">' + lv.title + '</span>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div><span class="sub">' + (lv.next ? xp + ' / ' + lv.next + ' XP → ' + lv.nextTitle : xp + ' XP · Legend') + '</span></div></div></section>';

    h += goalCard();

    // quests
    var d = state.days[sel], pn = phaseFor(sel), sitM = pn <= 2 ? 5 : pn === 3 ? 10 : 15, sprM = pn === 3 ? 20 : 25, locked = sel > today;
    var quests = [{ f: 'sit', n: 'Sit quietly', dd: sitM + ' min · just notice', xp: 10, mins: sitM }];
    if (pn >= 2) quests.push({ f: 'singleTask', n: 'One thing, fully', dd: 'no phone while you do it', xp: 15 });
    if (pn >= 3) quests.push({ f: 'sprint', n: 'Focus sprint', dd: sprM + ' min · one task only', xp: 20, mins: sprM });
    var hasNote = !!(d.note || '').trim();
    var flags = quests.map(function (q) { return d[q.f]; }).concat([hasNote]);
    var got = flags.filter(Boolean).length, perfect = got === flags.length;
    var cins = checkinsOn(sel).length;
    var tag = ['Locked', 'var(--raised)', 'var(--dim)'];
    if (perfect) tag = ['Perfect', 'var(--bone)', '#fff'];
    else if (d.sit) tag = ['Cleared', 'var(--green)', '#fff'];
    else if (sel === today) tag = ['Today', 'var(--red)', '#fff'];
    else if (sel < today) tag = ['Missed', 'var(--raised)', 'var(--bone2)'];

    h += '<section class="card stack" style="gap:12px" aria-label="Quests for day ' + sel + '">' +
      '<div class="row between" style="align-items:flex-start"><div style="display:flex;flex-direction:column;gap:4px"><span class="eyebrow"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + SEC[pn] + ';margin-right:6px"></i>' + Z[pn].name + ' · ' + dateOf(sel) + '</span>' +
      '<h1>Day ' + sel + '</h1><p class="italic">' + Z[pn].desc + '</p></div>' +
      '<span class="chip" style="background:' + tag[1] + ';color:' + tag[2] + '">' + tag[0] + '</span></div>';
    if (locked) h += '<div class="notice"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>This day opens on ' + dateOf(sel) + '. Here’s what’s waiting.</span></div>';
    h += '<div>';
    quests.forEach(function (q) {
      h += '<div class="quest"><label><input class="qchk" type="checkbox" data-q="' + q.f + '"' + (d[q.f] ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
        '<span style="display:flex;flex-direction:column"><span class="t">' + q.n + '</span><span class="d">' + q.dd + '</span></span></label>' +
        (q.mins ? '<button type="button" class="btn small" data-begin="' + q.f + '" data-mins="' + q.mins + '"' + (locked ? ' disabled' : '') + ' aria-label="Begin ' + q.n + ' timer">▶ Go</button>' : '') +
        '<span class="xp' + (d[q.f] ? ' done' : '') + '">+' + q.xp + '</span></div>';
    });
    h += '<div class="quest"><div style="flex:1;display:flex;flex-direction:column"><span class="t">Mindful check-ins</span><span class="d">' + cins + ' of ' + PINGS + ' answered · from your pings</span></div>' +
      '<span class="xp' + (cins >= PINGS ? ' done' : '') + '">+5 ea</span></div>';
    h += '<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1.5px solid var(--line2)"><div class="row between"><label for="journal" style="font-size:13px;font-weight:600">Journal: what pulled your attention away?</label><span class="xp' + (hasNote ? ' done' : '') + '">+5</span></div>' +
      '<input class="text" id="journal" type="text" value="' + esc(d.note) + '" placeholder="a thought, a ping, a craving…"' + (locked ? ' disabled' : '') + '></div></div>';
    if (ui.timer && ui.timer.day === sel) {
      var t = ui.timer, m = Math.floor(t.remaining / 60), s = t.remaining % 60;
      h += '<div class="timer"><div class="ring"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="#333" stroke-width="5"/><circle id="tRing" cx="32" cy="32" r="27" fill="none" stroke="#FFC23A" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="' + (169.6 * (1 - t.remaining / t.total)).toFixed(1) + '"/></svg><span id="tText">' + m + ':' + (s < 10 ? '0' : '') + s + '</span></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:8px"><span style="font-size:13px">' + (t.kind === 'sit' ? 'Sitting' : 'Focus sprint') + '. Breathing is enough. Finish for +' + (t.kind === 'sit' ? 10 : 20) + ' XP.</span><button type="button" class="btn small" id="stopT" style="align-self:flex-start">Stop</button></div></div>';
    }
    h += '<div class="perfect' + (perfect ? ' on' : '') + '"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" fill="' + (perfect ? '#FFC23A' : '#B3A999') + '"/></svg>' +
      '<div style="flex:1"><span style="font-size:13px;font-weight:600">' + (perfect ? 'Perfect day. Bonus claimed.' : 'Perfect day bonus: ' + got + ' of ' + flags.length) + '</span><div class="segs" aria-hidden="true">' +
      flags.map(function (f) { return '<i' + (f ? ' class="on"' : '') + '></i>'; }).join('') + '</div></div><span style="font-family:var(--mono);font-size:12px;font-weight:700">+10</span></div></section>';

    h += bodyCard();

    // rings: four concentric rings, one per phase, one arc per day (inner ring = first days)
    var RR = { 1: 62, 2: 92, 3: 122, 4: 152 }, C = 175;
    function arc(r, a0, a1) {
      var p = function (a) { var t = (a - 90) * Math.PI / 180; return (C + r * Math.cos(t)).toFixed(2) + ' ' + (C + r * Math.sin(t)).toFixed(2); };
      return 'M' + p(a0) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p(a1);
    }
    var sd = state.days[sel];
    h += '<section class="stack" style="gap:12px" aria-label="Thirty days"><div class="row between"><h2>Thirty days</h2><span class="muted" style="font-size:12px">inside out · tap a day</span></div><div class="ringmap">' +
      '<svg viewBox="0 0 350 350" role="group" aria-label="Your 30 days as four rings">';
    [1, 2, 3, 4].forEach(function (p) {
      var z = Z[p], cnt = z.last - z.first + 1, span = 360 / cnt, gap = 28 / RR[p] * 180 / Math.PI;
      for (var n = z.first; n <= z.last; n++) {
        var i = n - z.first, a0 = i * span + gap / 2, a1 = (i + 1) * span - gap / 2, dd = state.days[n];
        var col = '#E4DBCC', op = 1, dash = '';
        if (dd.sit) col = SEC[p];
        else if (n === today) col = '#141414';
        else if (n < today) { col = SEC[p]; op = .28; }
        var isSel = n === sel;
        var lab = 'Day ' + n + ', ' + dateOf(n) + (dd.sit ? ', completed' : n === today ? ', today' : n < today ? ', missed' : ', not yet');
        h += '<g class="seg' + (isSel ? ' sel' : '') + '" data-day="' + n + '" role="button" tabindex="0" aria-label="' + lab + '" aria-pressed="' + isSel + '">' +
          '<path d="' + arc(RR[p], a0, a1) + '" stroke="transparent" stroke-width="30" fill="none"/>' +
          (isSel ? '<path d="' + arc(RR[p], a0, a1) + '" stroke="#141414" stroke-width="27" stroke-linecap="round" fill="none"/><path d="' + arc(RR[p], a0, a1) + '" stroke="#fff" stroke-width="22" stroke-linecap="round" fill="none"/>' : '') +
          '<path d="' + arc(RR[p], a0, a1) + '" stroke="' + col + '" stroke-opacity="' + op + '" stroke-width="' + (isSel ? 16 : 18) + '" stroke-linecap="round" fill="none"' + dash + '/>' +
          (n === today && !dd.sit ? '<path class="breathe-arc" d="' + arc(RR[p], a0, a1) + '" stroke="#141414" stroke-width="30" stroke-opacity=".12" stroke-linecap="round" fill="none"/>' : '') + '</g>';
      }
    });
    h += '<text x="175" y="168" text-anchor="middle" class="rm-num">' + String(sel).padStart(2, '0') + '</text>' +
      '<text x="175" y="196" text-anchor="middle" class="rm-sub">' + (sel === today ? 'TODAY' : dateOf(sel).toUpperCase()) + '</text></svg></div><div class="sectors">';
    [1, 2, 3, 4].forEach(function (p) {
      var z = Z[p], done = 0, tot = z.last - z.first + 1;
      for (var j = z.first; j <= z.last; j++) if (state.days[j].sit) done++;
      h += '<div class="sector"><i style="background:' + SEC[p] + '"></i><span>' + z.name + '</span><b>' + done + '/' + tot + '</b></div>';
    });
    h += '</div></section>';

    // badges
    var sits = 0, sprints = 0, p1 = 0; for (var i = 1; i <= 30; i++) { if (state.days[i].sit) sits++; if (state.days[i].sprint) sprints++; if (i <= 5 && state.days[i].sit) p1++; }
    var nMv = (state.moves || []).filter(function (m) { return !m.skipped; }).length, allRound = false, perDay = {};
    (state.moves || []).forEach(function (m) { if (m.skipped) return; var k = dkey(new Date(m.t)); (perDay[k] = perDay[k] || {})[m.cat] = 1; });
    Object.keys(perDay).forEach(function (k) { if (Object.keys(perDay[k]).length >= 4) allRound = true; });
    var best = bestStreak(), nC = state.checkins.length, nG = Object.keys(state.goals || {}).filter(function (k) { return state.goals[k].achievedAt; }).length;
    var B = [['Green Flag', 'flag', '#17A864', sits >= 1, '0/1 sit'], ['Hat-trick', 'three', '#FF5A1F', best >= 3, Math.min(best, 3) + '/3 days'], ['Seven Straight', 'seven', '#E0312B', best >= 7, Math.min(best, 7) + '/7 days'],
      ['Pit Stop', 'wrench', '#0E9C95', nC >= 10, Math.min(nC, 10) + '/10'], ['Flat Out', 'gauge', '#1D5BD8', sprints >= 1, '0/1 sprint'], ['Sector One', 'curve', '#7B3FE4', p1 >= 5, p1 + '/5 sits'],
      ['Chequered', 'cup', '#FFC23A', nG >= 5, Math.min(nG, 5) + '/5 goals'], ['Full Distance', 'helmet', '#141414', sits >= 30, sits + '/30'],
      ['Mover', 'bolt', '#FF5A1F', nMv >= 25, Math.min(nMv, 25) + '/25 moves'], ['All-rounder', 'grid4', '#1D5BD8', allRound, 'all 4 in a day']];
    var earned = B.filter(function (b) { return b[3]; }).length;
    h += '<section class="stack" style="gap:14px" aria-label="Badges"><div class="row between"><h2>Badges</h2><span class="muted" style="font-size:12px">' + earned + ' of ' + B.length + '</span></div><div class="badges">';
    B.forEach(function (b) {
      h += '<div class="badge"><div class="roundel' + (b[3] ? ' on' : '') + '" style="' + (b[3] ? 'background:' + b[2] : '') + '"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[b[1]] + '" fill="none" stroke="' + (b[3] ? (b[2] === '#FFC23A' ? '#141414' : '#fff') : '#B3A999') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<b style="color:' + (b[3] ? 'var(--bone)' : 'var(--dim)') + '">' + b[0] + '</b><small>' + (b[3] ? 'Earned' : b[4]) + '</small></div>';
    });
    h += '</div></section>';
    h += '<p class="muted" style="font-size:12px;margin:0">XP: sit +10 · one thing fully +15 · focus sprint +20 · journal +5 · check-in +5 (up to ' + PINGS + ' a day) · perfect day +10 · daily goal set +5, achieved +20.</p></div>';
    return h;
  }

  function goalCard() {
    var g = todayGoal(), h;
    if (!g) {
      return '<section class="card goal" aria-label="Today’s target"><div class="row between"><span class="eyebrow">Today’s target</span><span class="xp" style="background:rgba(0,0,0,.08);color:#141414">+5</span></div>' +
        '<p class="gtext">What’s the one thing you want to get done today?</p>' +
        '<button type="button" class="btn solid" data-goal="open">Set today’s target</button></section>';
    }
    if (g.achievedAt) {
      return '<section class="card goal won" aria-label="Today’s target"><div class="row between"><span class="eyebrow">Target hit · ' + timeOf(g.achievedAt) + '</span><span class="xp" style="background:rgba(255,255,255,.22);color:#fff">+20</span></div>' +
        '<p class="gtext">' + esc(g.text) + '</p>' +
        '<span class="muted" style="font-size:12px">' + g.updates.length + ' update' + (g.updates.length === 1 ? '' : 's') + ' along the way. Check-ins carry on as usual.</span></section>';
    }
    var last = g.updates[g.updates.length - 1];
    h = '<section class="card goal" aria-label="Today’s target"><div class="row between"><span class="eyebrow">Today’s target</span><span class="eyebrow">set ' + timeOf(g.setAt) + '</span></div>' +
      '<p class="gtext">' + esc(g.text) + '</p>';
    h += last ? '<div class="upd"><span style="font-family:var(--mono);font-size:11px;color:#5A4300">LATEST · ' + timeOf(last.t) + '</span><span style="font-size:14px">' + esc(last.text) + '</span></div>' : '<span style="font-size:13px;color:#5A4300">Each ping will ask how it’s going.</span>';
    h += '<div class="row"><button type="button" class="btn" data-goal="open" style="flex:1">Add update</button><button type="button" class="btn solid" data-goal="win" style="flex:1">Hit it · +20</button></div></section>';
    return h;
  }

  function bindTrail(view) {
    var mn = view.querySelector('#moveNow'); if (mn) mn.addEventListener('click', function () { openMove(suggestMove()); });
    var today = todayNum(), sel = ui.sel || today;
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
      b.addEventListener('click', function () { startTimer(sel, b.dataset.begin, +b.dataset.mins); });
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
      var go = function () { ui.sel = +b.dataset.day; render(); var q = document.querySelector('[aria-label^="Quests for day"]'); if (q) q.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
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
  var DCOL = ['#E0312B', '#7B3FE4', '#1D5BD8', '#0E9C95', '#FF5A1F', '#C2185B', '#B8860B', '#5B6CFF', '#6B645B', '#17A864'];
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
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  function drawCheckin() {
    var o = document.getElementById('overlay'), h = '<div class="inner">';
    o.classList.toggle('dark', ci.stage === 'breathe');
    h += '<div class="row between"><span class="eyebrow">Mindful check-in</span><div class="row" style="gap:8px">' + (ci.stage === 'reflect' ? '<button type="button" class="btn ghost small" id="ciDiscard">Discard</button>' : '') + '<button type="button" class="btn ghost small" id="ciClose">Close</button></div></div>';
    if (ci.stage === 'reflect') h += '<span class="muted" style="font-size:12px;margin-top:-10px">Saved as you type. Close any time and come back.</span>';
    if (ci.stage === 'goal') {
      var gg = todayGoal(), lu = gg.updates[gg.updates.length - 1];
      h += '<section class="card goal" style="gap:10px"><span class="eyebrow">Goal check · 1 of 3</span><p class="gtext">' + esc(gg.text) + '</p>' +
        (lu ? '<div class="upd"><span style="font-family:var(--mono);font-size:11px;color:#5A4300">LAST UPDATE · ' + timeOf(lu.t) + '</span><span style="font-size:14px">' + esc(lu.text) + '</span></div>' : '') + '</section>';
      h += '<div class="stack" style="gap:8px"><label for="gcText"><h1 style="font-size:22px">How’s it going?</h1></label><textarea class="text" id="gcText" style="min-height:90px;font-size:16px" placeholder="e.g. base plate done, clamps next · or type “achieved”"></textarea></div>';
      h += '<button type="button" class="btn solid" id="gcSave">Save update → breathe</button>';
      h += '<button type="button" class="btn" id="gcWin" style="background:var(--green);border-color:var(--green);color:#fff">✓ Achieved it · +20 XP</button>';
      h += '<button type="button" class="btn ghost" id="gcSkip">Skip the goal this time</button>';
    } else if (ci.stage === 'breathe') {
      h += '<div><h1>Pause here.</h1><p class="muted" style="margin:6px 0 0">Let whatever you were doing wait for a minute. Just follow the light.</p></div>';
      h += '<div class="breath"><svg class="rings" id="orb" viewBox="0 0 260 260" width="260" height="260" aria-hidden="true"><g><circle cx="130" cy="130" r="24" fill="none" stroke="#2BD576" stroke-width="7" stroke-linecap="round" stroke-dasharray="18.1 7.0"/></g><g class="rev"><circle cx="130" cy="130" r="37" fill="none" stroke="#27C27A" stroke-width="7" stroke-linecap="round" stroke-dasharray="20.9 8.1"/></g><g><circle cx="130" cy="130" r="50" fill="none" stroke="#1FAE86" stroke-width="7" stroke-linecap="round" stroke-dasharray="22.6 8.8"/></g><g class="rev"><circle cx="130" cy="130" r="63" fill="none" stroke="#169A91" stroke-width="7" stroke-linecap="round" stroke-dasharray="23.8 9.2"/></g><g><circle cx="130" cy="130" r="76" fill="none" stroke="#10869A" stroke-width="7" stroke-linecap="round" stroke-dasharray="24.6 9.6"/></g><g class="rev"><circle cx="130" cy="130" r="89" fill="none" stroke="#1273A3" stroke-width="7" stroke-linecap="round" stroke-dasharray="25.2 9.8"/></g><g><circle cx="130" cy="130" r="102" fill="none" stroke="#1D5BD8" stroke-width="7" stroke-linecap="round" stroke-dasharray="25.6 10.0"/></g><g class="rev"><circle cx="130" cy="130" r="115" fill="none" stroke="#2A4BB0" stroke-width="7" stroke-linecap="round" stroke-dasharray="26.0 10.1"/></g></svg><svg class="prog" viewBox="0 0 260 260" width="260" height="260" aria-hidden="true"><circle id="ciRing" cx="130" cy="130" r="127" fill="none" stroke="#FFC23A" stroke-width="3" stroke-linecap="round" stroke-dasharray="798" stroke-dashoffset="798"/></svg>' +
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
        h += '<div class="notice"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#FFC23A" stroke="#141414" stroke-width="1.4"/></svg><span>Goal: ' + esc(g.text) + (g.updates.length ? ' · last update ' + timeOf(g.updates[g.updates.length - 1].t) : '') + '</span></div>';
      } else if (g && !g.achievedAt) {
        h += '<section class="card stack" style="gap:10px"><span class="eyebrow">Today’s goal</span><p style="margin:0;font-family:var(--serif);font-size:18px;line-height:1.3">' + esc(g.text) + '</p>' +
          '<label for="ciGoal" style="font-size:14px;color:var(--bone2)">How’s it going? <span class="muted">(type “achieved” when it’s done)</span></label>' +
          '<textarea class="text" id="ciGoal" placeholder="e.g. drafted two sections, stuck on the budget">' + esc(ci.gUpd) + '</textarea>' +
          '<button type="button" class="dchip" id="ciWin" aria-pressed="' + ci.gWin + '" style="align-self:flex-start">' + (ci.gWin ? '✓ Achieved' : 'Mark as achieved') + '</button></section>';
      } else if (g) {
        h += '<div class="notice" style="color:var(--ember)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#E0312B" stroke="#E0312B" stroke-width="1.6"/></svg><span>Goal achieved at ' + timeOf(g.achievedAt) + '. Just the check-in now.</span></div>';
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
        h += '<div class="perfect on"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="#E0312B" stroke="#E0312B" stroke-width="1.6"/></svg><span style="font-size:14px">Done. Progress checks have stopped for today; mindful check-ins carry on.</span></div>';
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
    var h = '<section class="card stack body" style="gap:14px" aria-label="Movement today"><div class="row between"><div style="display:flex;flex-direction:column;gap:2px"><span class="eyebrow">Body clock · every 30 min</span><h1>Move</h1></div>' +
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
  function closeMove() { stopMoveTimer(); mv = null; document.getElementById('overlay').hidden = true; document.body.style.overflow = ''; if (location.search) history.replaceState(null, '', location.pathname); }
  function logMove(m, d, skipped) {
    state.moves = state.moves || [];
    state.moves.push({ t: new Date().toISOString(), id: m.id, cat: m.cat, secs: d.secs || null, reps: d.reps || null, skipped: !!skipped });
    save();
  }

  // ---------- insights ----------
  function renderLog() {
    var list = state.checkins.slice().reverse(), counts = {};
    state.checkins.forEach(function (c) { c.distractions.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; }); });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6);
    var max = top.length ? counts[top[0]] : 1;
    var pres = state.checkins.filter(function (c) { return c.presence; });
    var avg = pres.length ? (pres.reduce(function (a, c) { return a + c.presence; }, 0) / pres.length).toFixed(1) : '–';
    var todayC = checkinsOn(dayNumFor(new Date())).length;
    var h = '<div class="stack"><header><h1>Insights</h1><p class="muted" style="margin:4px 0 0;font-size:14px">What keeps pulling you away, from your check-ins.</p></header>';
    h += '<div class="stat3"><div><b>' + todayC + '</b><small>check-ins today</small></div><div><b>' + state.checkins.length + '</b><small>all time</small></div><div><b>' + avg + '</b><small>avg presence /5</small></div></div>';
    h += '<section class="card stack" style="gap:12px"><h2>Top distractions</h2>';
    if (!top.length) h += '<p class="muted" style="margin:0;font-size:14px">Nothing yet. Your first check-in will start this chart.</p>';
    top.forEach(function (d) { var ix = DISTRACTIONS.indexOf(d); h += '<div class="hbar"><span>' + esc(d) + '</span><span class="b"><i style="background:' + (ix >= 0 ? DCOL[ix] : '#141414') + ';width:' + Math.round(counts[d] / max * 100) + '%"></i></span><span style="text-align:right">' + counts[d] + '</span></div>'; });
    h += '</section>';
    if (LIB) {
      var all = (state.moves || []).filter(function (m) { return !m.skipped; }), tk = dkey(new Date()), tmv = all.filter(function (m) { return dkey(new Date(m.t)) === tk; });
      var sk = (state.moves || []).filter(function (m) { return m.skipped && dkey(new Date(m.t)) === tk; }).length;
      var cc = { yoga: 0, cardio: 0, strength: 0, stretch: 0 }; all.forEach(function (m) { cc[m.cat]++; });
      var mx = Math.max(1, cc.yoga, cc.cardio, cc.strength, cc.stretch);
      h += '<section class="card stack" style="gap:12px"><div class="row between"><h2>Movement</h2><span class="muted" style="font-size:12px">today ' + tmv.length + ' done · ' + sk + ' skipped</span></div>';
      Object.keys(cc).forEach(function (c) { h += '<div class="hbar"><span>' + LIB.categories[c].name + '</span><span class="b"><i style="background:' + LIB.categories[c].color + ';width:' + Math.round(cc[c] / mx * 100) + '%"></i></span><span style="text-align:right">' + cc[c] + '</span></div>'; });
      h += '<span class="muted" style="font-size:12px">' + all.length + ' movement snacks in total</span></section>';
    }
    var gk = Object.keys(state.goals || {}).sort().reverse();
    var won = gk.filter(function (k) { return state.goals[k].achievedAt; }).length;
    h += '<section class="card"><div class="row between" style="margin-bottom:6px"><h2>Daily goals</h2><span class="muted" style="font-size:12px">' + won + ' of ' + gk.length + ' achieved</span></div>';
    if (!gk.length) h += '<p class="muted" style="margin:0;font-size:14px">Set a target on the Today tab and it will show up here.</p>';
    gk.slice(0, 20).forEach(function (k) {
      var g = state.goals[k], d = new Date(k + 'T00:00:00');
      h += '<div class="entry"><div class="row between"><span style="font-size:13px;color:var(--bone2)">' + d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + '</span>' +
        (g.achievedAt ? '<span class="xp done">Achieved ' + timeOf(g.achievedAt) + '</span>' : '<span class="xp" style="background:var(--raised);color:var(--dim)">Not marked</span>') + '</div>' +
        '<span style="font-size:14px">' + esc(g.text) + '</span>' + '<button type="button" class="del" data-delgoal="' + k + '" aria-label="Delete this goal">Delete</button>' + (g.updates.length ? '<span class="muted" style="font-size:12px">' + g.updates.length + ' update' + (g.updates.length === 1 ? '' : 's') + ' · last: “' + esc(g.updates[g.updates.length - 1].text) + '”</span>' : '') + '</div>';
    });
    h += '</section><section class="card"><h2 style="margin-bottom:6px">Recent check-ins</h2>';
    if (!list.length) h += '<p class="muted" style="margin:0;font-size:14px">Tap <b style="color:var(--ember)">Check in</b> below, or wait for your next ping.</p>';
    list.slice(0, 40).forEach(function (c) {
      var t = new Date(c.t);
      h += '<div class="entry"><div class="row between"><span style="font-size:13px;color:var(--bone2)">' + t.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) + '</span>' +
        (c.presence ? '<span class="xp">' + c.presence + '/5</span>' : '') + '</div>' +
        (c.distractions.length ? '<span style="font-size:14px">' + esc(c.distractions.join(', ')) + '</span>' : '') +
        (c.note ? '<span class="muted" style="font-size:13px">“' + esc(c.note) + '”</span>' : '') +
        '<button type="button" class="del" data-delci="' + esc(c.t) + '" aria-label="Delete this check-in">Delete</button></div>';
    });
    h += '</section></div>';
    return h;
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
  function renderSettings() {
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var perm = supported ? Notification.permission : 'unsupported';
    var standalone = window.matchMedia('(display-mode: standalone)').matches;
    var h = '<div class="stack"><header><h1>Reminders</h1><p class="muted" style="margin:4px 0 0;font-size:14px">' + esc(PING_INFO) + '</p></header>';
    if (!standalone) h += '<section class="card stack" style="gap:10px"><h2>1 · Put the app on your home screen</h2><ol class="steps"><li>In Chrome, tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</li><li>Open <b>Attention</b> from your home screen and come back to this tab.</li></ol></section>';
    h += '<section class="card stack" style="gap:12px"><h2>' + (standalone ? '1' : '2') + ' · Turn on notifications</h2>';
    if (!supported) h += '<p class="muted" style="margin:0">This browser can’t receive reminders. Open the app in Chrome.</p>';
    else if (perm === 'denied') h += '<p style="margin:0;color:var(--bone2)">Notifications are blocked. Long-press the Attention icon → <b>App info</b> → <b>Notifications</b> → turn on, then reopen the app.</p>';
    else h += '<p class="muted" style="margin:0;font-size:14px">Tap the button and choose <b>Allow</b>. You’ll get a private setup code to paste into GitHub.</p><button type="button" class="btn solid" id="subBtn">' + (state.code ? 'Show my connection code again' : 'Turn on reminders') + '</button>';
    if (state.code) {
      try { var ep = JSON.parse(atob(state.code.slice(6))).s.endpoint; h += '<span class="eyebrow">Connection ID …' + esc(ep.slice(-6)) + '</span>'; } catch (e) {}
      h += '<label for="code" style="font-size:13px;color:var(--bone2)">Your private setup code</label><textarea class="code" id="code" readonly>' + esc(state.code) + '</textarea><button type="button" class="btn" id="copyBtn">Copy code</button>' +
        '<p class="muted" style="margin:0;font-size:13px">Paste it only into GitHub: your <b>attention</b> project → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>New repository secret</b>. Name: <b>PUSH_SETUP</b>. Don’t share it anywhere else.</p>';
    }
    h += '</section>';
    if (supported && perm === 'granted') h += '<section class="card stack" style="gap:10px"><h2>Test on this phone</h2><p class="muted" style="margin:0;font-size:14px">Shows a sample reminder right now, to check that notifications appear. Tap it to open a check-in.</p><button type="button" class="btn" id="testBtn">Show a sample reminder</button></section>';
    var last = state.savedAt ? new Date(state.savedAt) : null;
    h += '<section class="card stack" style="gap:12px" id="dataCard"><h2>Your data</h2>' +
      '<div class="notice" style="color:var(--sage-hi)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Auto-save is on' + (last ? ' · last saved ' + last.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '') + '</span></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Every tap and every letter you type is saved instantly, in two places on this phone, plus a daily snapshot (last 14 days). It stays on this phone only; clearing Chrome’s data or uninstalling would erase it, so save a backup file once a week.</p>' +
      '<div class="row" style="flex-wrap:wrap"><button type="button" class="btn" id="expBtn">Save backup file</button><button type="button" class="btn" id="impBtn">Restore from file</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>' +
      '<div class="stack" style="gap:8px"><span style="font-size:14px;color:var(--bone2)">Go back to an earlier day</span><div id="snaps" class="row" style="flex-wrap:wrap;gap:8px"><span class="muted" style="font-size:13px">Loading…</span></div></div>' +
      '<div class="stack" style="gap:8px;padding-top:12px;border-top:1px solid var(--line2)"><span style="font-size:14px;color:var(--bone2)">Delete</span>' +
      '<p class="muted" style="margin:0;font-size:13px">Remove single check-ins or goals from the Insights tab. Or:</p>' +
      '<div class="row" style="flex-wrap:wrap"><button type="button" class="btn ghost" id="delCi">Delete all check-ins</button><button type="button" class="btn ghost" id="resetBtn" style="border-color:#E0312B;color:#C0261F">Erase everything</button></div></div></section>' +
      '<p class="eyebrow" style="text-align:center;margin:0">App version ' + APP_VERSION + '</p></div>';
    return h;
  }
  function bindSettings(view) {
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
    view.querySelector('#expBtn').onclick = function () {
      var a = document.createElement('a'), copy = JSON.parse(JSON.stringify(state));
      delete copy.keys; delete copy.code;
      a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
      a.download = 'attention-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    };
    var imp = view.querySelector('#impFile');
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
      save(); ui.sel = null; ui.tab = 'trail'; render();
    };
  }

  // ---------- shell ----------
  function render() {
    var view = document.getElementById('view');
    if (ui.tab === 'trail') { view.innerHTML = renderTrail(); bindTrail(view); }
    else if (ui.tab === 'log') { view.innerHTML = renderLog(); bindLog(view); }
    else { view.innerHTML = renderSettings(); bindSettings(view); }
    document.querySelectorAll('.tab[data-tab]').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); t.setAttribute('aria-current', t.dataset.tab === ui.tab ? 'page' : 'false'); });
  }
  document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); });
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
