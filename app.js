/* Attention — thirty days on the trail, plus random mindful check-ins. */
(function () {
  'use strict';

  var STORE_KEY = 'attention.v1';
  var PING_INFO = '5 gentle pings a day at random times between 9am and 9pm, at least an hour apart. Each one opens a 1–2 minute pause and a quick question.';

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
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || fresh(); } catch (e) { state = fresh(); }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

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
    1: { name: 'I · The Clearing', desc: 'Just notice, don’t fix.', first: 1, last: 5 },
    2: { name: 'II · The Forest', desc: 'Add a single-tasking rule.', first: 6, last: 12 },
    3: { name: 'III · The Ridge', desc: 'Extend the sit, add a focus sprint.', first: 13, last: 20 },
    4: { name: 'IV · The Summit', desc: 'Stack it, and start noticing your triggers.', first: 21, last: 30 }
  };
  function checkinsOn(n) { return state.checkins.filter(function (c) { return dayNumFor(new Date(c.t)) === n; }); }
  function dayXp(n) {
    var d = state.days[n], pn = phaseFor(n), xp = 0, need = 2, got = 0;
    if (d.sit) { xp += 10; got++; }
    if ((d.note || '').trim()) { xp += 5; got++; }
    if (pn >= 2) { need++; if (d.singleTask) { xp += 15; got++; } }
    if (pn >= 3) { need++; if (d.sprint) { xp += 20; got++; } }
    if (got === need) xp += 10;
    xp += Math.min(checkinsOn(n).length, 5) * 5;
    return xp;
  }
  function totalXp() { var t = 0; for (var i = 1; i <= 30; i++) t += dayXp(i); return t; }
  var LEVELS = [[0, 'Wanderer'], [40, 'Noticer'], [110, 'Returner'], [230, 'Settler'], [400, 'Steady Flame'], [620, 'Pathfinder'], [900, 'Keeper'], [1250, 'Summit Mind']];
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
    el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" fill="#15191A"/></svg><span>' + esc(text) + '</span>';
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 2000);
  }
  function mutate(fn) {
    var before = totalXp(), lv = levelFor(before).num;
    fn(); save();
    var after = totalXp(), nl = levelFor(after);
    if (nl.num > lv) toast('Level up · ' + nl.title);
    else if (after > before) toast('+' + (after - before) + ' XP');
    render();
  }

  // ---------- trail view ----------
  var PTS = []; for (var k = 0; k < 30; k++) PTS.push([175 + 105 * Math.sin(k * 0.6), 1580 - k * 52]);
  function curve(n) {
    var d = 'M' + PTS[0][0].toFixed(1) + ' ' + PTS[0][1];
    for (var a = 0; a < n - 1; a++) {
      var p0 = PTS[Math.max(a - 1, 0)], p1 = PTS[a], p2 = PTS[a + 1], p3 = PTS[Math.min(a + 2, 29)];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
        (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1];
    }
    return d;
  }
  var ICON = {
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    spark: 'M12 3c1.5 3.5-3 4.5-3 8.5a3 3 0 0 0 6 0c0-1-.6-1.8-1-2.6 2 1 3 3 3 5.1a5 5 0 0 1-10 0C7 9 10.5 7.5 12 3z',
    torch: 'M12 3c1.2 2-1.6 2.6-1.6 4.6a1.6 1.6 0 0 0 3.2 0M9 10h6l-1.5 3h-3zM10.5 13l1 8h1l1-8',
    target: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M12 11.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6',
    tent: 'M3 20L12 5l9 15zM12 5v15M9.5 20l2.5-5 2.5 5',
    peak: 'M2 20l7-11 4 6 2.5-3.5L22 20zM9 9V3l4 1.5L9 6',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'
  };
  var FLAME = 'M12 2c2 4-3 5-3 9a3 3 0 1 0 6 0c0-1-1-2-1-3 2 1 3 3 3 5a5 5 0 0 1-10 0c0-5 3-6 5-11z';
  function hex(fill, stroke) { return '<svg width="100%" height="100%" viewBox="0 0 60 68" aria-hidden="true"><polygon points="30,2 57,17.5 57,50.5 30,66 3,50.5 3,17.5" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/></svg>'; }

  function renderTrail() {
    var today = todayNum(), sel = ui.sel || today, xp = totalXp(), lv = levelFor(xp), st = streak();
    var pct = lv.next ? Math.round((xp - lv.floor) / (lv.next - lv.floor) * 100) : 100;
    var h = '<div class="stack">';
    h += '<header class="stack" style="gap:4px"><h1>Thirty days of attention</h1><p class="muted" style="margin:0;font-size:14px">A daily return to one thing. Climb the trail, one sit at a time.</p></header>';

    // HUD
    h += '<section class="card hud" aria-label="Your progress"><div class="hex">' + hex('#2B2415', '#CB9A45') +
      '<div class="in"><span class="lv">LV</span><span class="n">' + lv.num + '</span></div></div>' +
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px"><span style="font-family:var(--serif);font-size:19px;line-height:1.1">' + lv.title + '</span>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<span class="muted" style="font-size:12px">' + (lv.next ? xp + ' / ' + lv.next + ' XP · ' + (lv.next - xp) + ' to ' + lv.nextTitle : xp + ' XP · top of the mountain') + '</span></div>' +
      '<div class="streak"><svg class="flame" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" style="transform:scale(' + Math.min(1 + st * 0.04, 1.4).toFixed(2) + ')"><path d="' + FLAME + '" fill="#CB9A45"/></svg><b>' + st + '</b><small>day streak</small></div></section>';

    // quests
    var d = state.days[sel], pn = phaseFor(sel), sitM = pn <= 2 ? 5 : pn === 3 ? 10 : 15, sprM = pn === 3 ? 20 : 25, locked = sel > today;
    var quests = [{ f: 'sit', n: 'Sit quietly', dd: sitM + ' min · just notice', xp: 10, mins: sitM }];
    if (pn >= 2) quests.push({ f: 'singleTask', n: 'One thing, fully', dd: 'no phone while you do it', xp: 15 });
    if (pn >= 3) quests.push({ f: 'sprint', n: 'Focus sprint', dd: sprM + ' min · one task only', xp: 20, mins: sprM });
    var hasNote = !!(d.note || '').trim();
    var flags = quests.map(function (q) { return d[q.f]; }).concat([hasNote]);
    var got = flags.filter(Boolean).length, perfect = got === flags.length;
    var cins = checkinsOn(sel).length;
    var tag = ['Locked', '', 'var(--raised)', 'var(--dim)'];
    if (perfect) tag = ['Perfect', '', 'var(--ember)', 'var(--ink)'];
    else if (d.sit) tag = ['Cleared', '', 'var(--sage-soft)', 'var(--sage-hi)'];
    else if (sel === today) tag = ['Today', '', 'rgba(203,154,69,.18)', 'var(--ember)'];
    else if (sel < today) tag = ['Missed', '', 'var(--raised)', 'var(--bone2)'];

    h += '<section class="card stack" style="gap:12px" aria-label="Quests for day ' + sel + '">' +
      '<div class="row between" style="align-items:flex-start"><div style="display:flex;flex-direction:column;gap:4px"><span class="eyebrow">' + Z[pn].name + ' · ' + dateOf(sel) + '</span>' +
      '<h2 style="font-size:26px;line-height:1.1">Day ' + sel + ' quests</h2><p class="italic">' + Z[pn].desc + '</p></div>' +
      '<span class="chip" style="background:' + tag[2] + ';color:' + tag[3] + '">' + tag[0] + '</span></div>';
    if (locked) h += '<div class="notice"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>This stretch of trail opens on ' + dateOf(sel) + '. Here’s what’s waiting.</span></div>';
    h += '<div>';
    quests.forEach(function (q) {
      h += '<div class="quest"><label><input class="qchk" type="checkbox" data-q="' + q.f + '"' + (d[q.f] ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
        '<span style="display:flex;flex-direction:column"><span class="t">' + q.n + '</span><span class="d">' + q.dd + '</span></span></label>' +
        (q.mins ? '<button type="button" class="btn small" data-begin="' + q.f + '" data-mins="' + q.mins + '"' + (locked ? ' disabled' : '') + ' aria-label="Begin ' + q.n + ' timer">▶ Begin</button>' : '') +
        '<span class="xp' + (d[q.f] ? ' done' : '') + '">+' + q.xp + ' XP</span></div>';
    });
    h += '<div class="quest"><div style="flex:1;display:flex;flex-direction:column"><span class="t">Mindful check-ins</span><span class="d">' + cins + ' of 5 answered · from your random pings</span></div>' +
      '<span class="xp' + (cins >= 5 ? ' done' : '') + '">+5 each</span></div>';
    h += '<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line2)"><div class="row between"><label for="journal" style="font-size:13px;color:var(--bone2)">Journal: what pulled your attention away?</label><span class="xp' + (hasNote ? ' done' : '') + '">+5 XP</span></div>' +
      '<input class="text" id="journal" type="text" value="' + esc(d.note) + '" placeholder="a thought, a ping, a craving…"' + (locked ? ' disabled' : '') + '></div></div>';
    if (ui.timer && ui.timer.day === sel) {
      var t = ui.timer, m = Math.floor(t.remaining / 60), s = t.remaining % 60;
      h += '<div class="timer"><div class="ring"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="#262D30" stroke-width="5"/><circle id="tRing" cx="32" cy="32" r="27" fill="none" stroke="#CB9A45" stroke-width="5" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="' + (169.6 * (1 - t.remaining / t.total)).toFixed(1) + '"/></svg><span id="tText">' + m + ':' + (s < 10 ? '0' : '') + s + '</span></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:8px"><span style="font-size:13px;color:var(--bone2)">' + (t.kind === 'sit' ? 'Sitting' : 'Focus sprint') + '. Breathing is enough. Finish to claim +' + (t.kind === 'sit' ? 10 : 20) + ' XP.</span><button type="button" class="btn ghost small" id="stopT" style="align-self:flex-start">Stop</button></div></div>';
    }
    h += '<div class="perfect' + (perfect ? ' on' : '') + '"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" fill="' + (perfect ? '#CB9A45' : '#5E686B') + '"/></svg>' +
      '<div style="flex:1"><span style="font-size:13px">' + (perfect ? 'Perfect day. Bonus claimed.' : 'Perfect day bonus: ' + got + ' of ' + flags.length + ' done') + '</span><div class="segs" aria-hidden="true">' +
      flags.map(function (f) { return '<i' + (f ? ' class="on"' : '') + '></i>'; }).join('') + '</div></div><span style="font-size:12px;font-weight:600;color:var(--ember)">+10</span></div></section>';

    // badges
    var sits = 0, sprints = 0, p1 = 0; for (var i = 1; i <= 30; i++) { if (state.days[i].sit) sits++; if (state.days[i].sprint) sprints++; if (i <= 5 && state.days[i].sit) p1++; }
    var best = bestStreak(), nC = state.checkins.length;
    var B = [['First Light', 'sun', sits >= 1, '0/1 sit'], ['Kindling', 'spark', best >= 3, Math.min(best, 3) + '/3 streak'], ['Steady Flame', 'torch', best >= 7, Math.min(best, 7) + '/7 streak'],
      ['Present', 'eye', nC >= 10, Math.min(nC, 10) + '/10 check-ins'], ['Deep Work', 'target', sprints >= 1, '0/1 sprint'], ['Clearing', 'tent', p1 >= 5, p1 + '/5 sits'],
      ['Summit', 'peak', sits >= 30, sits + '/30 sits']];
    var earned = B.filter(function (b) { return b[2]; }).length;
    h += '<section class="stack" style="gap:14px" aria-label="Badges"><div class="row between"><h2>Badges</h2><span class="muted" style="font-size:12px">' + earned + ' of ' + B.length + ' earned</span></div><div class="badges">';
    B.forEach(function (b) {
      h += '<div class="badge"><div class="h">' + hex(b[2] ? '#2B2415' : '#1B2022', b[2] ? '#CB9A45' : '#30383B') + '<div class="ic"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[b[1]] + '" fill="none" stroke="' + (b[2] ? '#E7C07A' : '#6B7478') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>' +
        '<b style="color:' + (b[2] ? 'var(--bone)' : 'var(--dim)') + '">' + b[0] + '</b><small>' + (b[2] ? 'Earned' : b[3]) + '</small></div>';
    });
    h += '</div></section>';

    // trail map
    var reached = 1; for (var r = today; r >= 1; r--) if (state.days[r].sit) { reached = r; break; }
    var decor = document.getElementById('trail-decor').content.firstElementChild.innerHTML;
    h += '<section class="stack" style="gap:12px" aria-label="The trail"><div class="row between"><h2>The trail</h2><span class="muted" style="font-size:12px">Tap a stop to see its quests</span></div><div class="map">' +
      '<svg viewBox="0 0 350 1640" preserveAspectRatio="none" aria-hidden="true">' + decor +
      '<path d="' + curve(30) + '" fill="none" stroke="#3A4447" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 13"/>' +
      '<path d="' + curve(reached) + '" fill="none" stroke="#CB9A45" stroke-width="6" stroke-linecap="round"/></svg>';
    var tops = { 1: 1362, 2: 997, 3: 582, 4: 12 };
    [1, 2, 3, 4].forEach(function (p) {
      var z = Z[p], lx = PTS[z.last - 1][0], done = 0, tot = z.last - z.first + 1;
      for (var j = z.first; j <= z.last; j++) if (state.days[j].sit) done++;
      h += '<div class="zone" style="top:' + (tops[p] / 1640 * 100).toFixed(2) + '%;' + (lx < 175 ? 'right:12px' : 'left:12px') + '">' + z.name + ' <b style="color:' + (done === tot ? 'var(--sage)' : 'var(--ember)') + '">' + done + '/' + tot + '</b></div>';
    });
    for (var n = 1; n <= 30; n++) {
      var dd = state.days[n], p2 = phaseFor(n), ms = n === Z[p2].last, x = PTS[n - 1][0], y = PTS[n - 1][1];
      var cls = 'node' + (ms ? ' big' : '') + (dd.sit ? ' done' : '') + (n === today ? ' today' : '') + (n < today && !dd.sit ? ' missed' : '') + (n > today ? ' future' : '') + (n === sel ? ' sel' : '');
      var lab = 'Day ' + n + ', ' + dateOf(n) + (dd.sit ? ', completed' : n === today ? ', today' : n < today ? ', missed' : ', locked');
      h += '<div class="spot" style="left:' + (x / 350 * 100).toFixed(2) + '%;top:' + (y / 1640 * 100).toFixed(2) + '%">';
      if (n === today) h += '<span class="pulse"></span><span class="you">YOU</span>';
      h += '<button type="button" class="' + cls + '" data-day="' + n + '" aria-label="' + lab + '" aria-pressed="' + (n === sel) + '">' +
        (dd.sit ? '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#15191A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' : n) + '</button>';
      if (ms) {
        var pd = true; for (var q = Z[p2].first; q <= Z[p2].last; q++) if (!state.days[q].sit) pd = false;
        h += '<svg class="chest" style="' + (x < 175 ? 'left:62px' : 'right:62px') + '" viewBox="0 0 30 26" aria-hidden="true"><path d="M3 11h24v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="' + (pd ? '#CB9A45' : '#262D30') + '" stroke="' + (pd ? '#6F5A2C' : '#5E686B') + '" stroke-width="1.5"/><path d="M3 11c0-5 3-8 12-8s12 3 12 8z" fill="' + (pd ? '#E7C07A' : '#30383B') + '" stroke="' + (pd ? '#6F5A2C' : '#5E686B') + '" stroke-width="1.5"/><rect x="12.5" y="9" width="5" height="6" rx="1" fill="' + (pd ? '#6F5A2C' : '#5E686B') + '"/></svg>';
      }
      h += '</div>';
    }
    h += '</div></section>';
    h += '<p class="muted" style="font-size:12px;margin:0">XP: sit +10 · one thing fully +15 · focus sprint +20 · journal +5 · check-in +5 (up to 5 a day) · perfect day +10.</p></div>';
    return h;
  }

  function bindTrail(view) {
    var today = todayNum(), sel = ui.sel || today;
    view.querySelectorAll('[data-q]').forEach(function (cb) {
      cb.addEventListener('change', function () { var f = cb.dataset.q, v = cb.checked; mutate(function () { state.days[sel][f] = v; }); });
    });
    var j = view.querySelector('#journal');
    if (j) j.addEventListener('change', function () { var v = j.value; mutate(function () { state.days[sel].note = v; }); });
    view.querySelectorAll('[data-begin]').forEach(function (b) {
      b.addEventListener('click', function () { startTimer(sel, b.dataset.begin, +b.dataset.mins); });
    });
    var stop = view.querySelector('#stopT');
    if (stop) stop.addEventListener('click', function () { clearInterval(ui.timer.iv); ui.timer = null; render(); });
    view.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () { ui.sel = +b.dataset.day; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
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
  var ci = null;
  function openCheckin() {
    ci = { stage: 'breathe', secs: 60, running: false, left: 60, picks: [], presence: 0, note: '' };
    drawCheckin();
    document.getElementById('overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeCheckin() {
    if (ci && ci.iv) clearInterval(ci.iv);
    if (ci && ci.bt) clearTimeout(ci.bt);
    ci = null;
    document.getElementById('overlay').hidden = true;
    document.body.style.overflow = '';
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  function drawCheckin() {
    var o = document.getElementById('overlay'), h = '<div class="inner">';
    h += '<div class="row between"><span class="eyebrow">Mindful check-in</span><button type="button" class="btn ghost small" id="ciClose">Close</button></div>';
    if (ci.stage === 'breathe') {
      h += '<div><h1>Pause here.</h1><p class="muted" style="margin:6px 0 0">Let whatever you were doing wait for a minute. Just follow the light.</p></div>';
      h += '<div class="breath"><div class="orb" id="orb"></div><svg viewBox="0 0 240 240" width="240" height="240" aria-hidden="true"><circle cx="120" cy="120" r="112" fill="none" stroke="#262D30" stroke-width="4"/><circle id="ciRing" cx="120" cy="120" r="112" fill="none" stroke="#CB9A45" stroke-width="4" stroke-linecap="round" stroke-dasharray="703.7" stroke-dashoffset="703.7"/></svg>' +
        '<div class="cue" aria-live="polite"><b id="cue">' + (ci.running ? 'Breathe in' : 'Ready') + '</b><span id="left">' + fmt(ci.left) + '</span></div></div>';
      if (!ci.running) {
        h += '<div class="seg" role="group" aria-label="Length"><button type="button" data-secs="60" class="' + (ci.secs === 60 ? 'on' : '') + '">1 minute</button><button type="button" data-secs="120" class="' + (ci.secs === 120 ? 'on' : '') + '">2 minutes</button></div>';
        h += '<button type="button" class="btn solid" id="ciStart">Begin</button><button type="button" class="btn ghost" id="ciSkip">Skip to reflection</button>';
      } else {
        h += '<button type="button" class="btn ghost" id="ciSkip">Finish early</button>';
      }
    } else {
      h += '<div><h1>What pulled you away?</h1><p class="muted" style="margin:6px 0 0">No judgement. Noticing is the practice.</p></div>';
      h += '<div class="stack" style="gap:10px"><span style="font-size:14px;color:var(--bone2)">Just before the ping, how present were you?</span><div class="scale" role="group" aria-label="Presence from 1 to 5">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-pres="' + n + '" aria-pressed="' + (ci.presence === n) + '">' + n + '</button>'; }).join('') +
        '</div><div class="row between muted" style="font-size:12px"><span>Lost in thought</span><span>Fully here</span></div></div>';
      h += '<div class="stack" style="gap:10px"><span style="font-size:14px;color:var(--bone2)">What was on your mind? Pick any.</span><div class="dchips">' +
        DISTRACTIONS.map(function (d, i) { return '<button type="button" class="dchip" data-pick="' + i + '" aria-pressed="' + (ci.picks.indexOf(i) >= 0) + '">' + d + '</button>'; }).join('') + '</div></div>';
      h += '<div class="stack" style="gap:8px"><label for="ciNote" style="font-size:14px;color:var(--bone2)">Anything else? <span class="muted">(optional)</span></label><textarea class="text" id="ciNote" placeholder="e.g. kept checking email for a reply">' + esc(ci.note) + '</textarea></div>';
      h += '<button type="button" class="btn solid" id="ciSave">Save check-in · +5 XP</button>';
    }
    h += '</div>';
    o.innerHTML = h;
    o.querySelector('#ciClose').onclick = closeCheckin;
    o.querySelectorAll('[data-secs]').forEach(function (b) { b.onclick = function () { ci.secs = +b.dataset.secs; ci.left = ci.secs; drawCheckin(); }; });
    var st = o.querySelector('#ciStart'); if (st) st.onclick = startBreath;
    var sk = o.querySelector('#ciSkip'); if (sk) sk.onclick = function () { if (ci.iv) clearInterval(ci.iv); clearTimeout(ci.bt); ci.stage = 'reflect'; drawCheckin(); };
    o.querySelectorAll('[data-pres]').forEach(function (b) { b.onclick = function () { ci.presence = +b.dataset.pres; saveNote(); drawCheckin(); }; });
    o.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () { var i = +b.dataset.pick, at = ci.picks.indexOf(i); if (at >= 0) ci.picks.splice(at, 1); else ci.picks.push(i); saveNote(); drawCheckin(); };
    });
    var sv = o.querySelector('#ciSave');
    if (sv) sv.onclick = function () {
      saveNote();
      var entry = { t: new Date().toISOString(), secs: ci.done || 0, presence: ci.presence || null, distractions: ci.picks.map(function (i) { return DISTRACTIONS[i]; }), note: ci.note.trim() };
      closeCheckin();
      mutate(function () { state.checkins.push(entry); });
    };
  }
  function saveNote() { var n = document.getElementById('ciNote'); if (n) ci.note = n.value; }
  function fmt(s) { return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function startBreath() {
    ci.running = true; ci.left = ci.secs; ci.done = 0; drawCheckin();
    var ring = document.getElementById('ciRing'), orb = document.getElementById('orb'), cue = document.getElementById('cue');
    function breathe(inhale) {
      if (!ci || ci.stage !== 'breathe') return;
      orb.className = 'orb ' + (inhale ? 'in' : 'out');
      cue.textContent = inhale ? 'Breathe in' : 'Breathe out';
      ci.bt = setTimeout(function () { breathe(!inhale); }, inhale ? 4000 : 6000);
    }
    requestAnimationFrame(function () { breathe(true); });
    ci.iv = setInterval(function () {
      ci.left--; ci.done++;
      var l = document.getElementById('left'); if (l) l.textContent = fmt(Math.max(ci.left, 0));
      if (ring) ring.setAttribute('stroke-dashoffset', (703.7 * (ci.left / ci.secs)).toFixed(1));
      if (ci.left <= 0) {
        clearInterval(ci.iv); clearTimeout(ci.bt);
        if (navigator.vibrate) navigator.vibrate(150);
        ci.stage = 'reflect'; drawCheckin();
      }
    }, 1000);
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
    top.forEach(function (d) { h += '<div class="hbar"><span>' + esc(d) + '</span><span class="b"><i style="width:' + Math.round(counts[d] / max * 100) + '%"></i></span><span style="text-align:right">' + counts[d] + '</span></div>'; });
    h += '</section><section class="card"><h2 style="margin-bottom:6px">Recent check-ins</h2>';
    if (!list.length) h += '<p class="muted" style="margin:0;font-size:14px">Tap <b style="color:var(--ember)">Check in</b> below, or wait for your next ping.</p>';
    list.slice(0, 40).forEach(function (c) {
      var t = new Date(c.t);
      h += '<div class="entry"><div class="row between"><span style="font-size:13px;color:var(--bone2)">' + t.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) + '</span>' +
        (c.presence ? '<span class="xp">' + c.presence + '/5</span>' : '') + '</div>' +
        (c.distractions.length ? '<span style="font-size:14px">' + esc(c.distractions.join(', ')) + '</span>' : '') +
        (c.note ? '<span class="muted" style="font-size:13px">“' + esc(c.note) + '”</span>' : '') + '</div>';
    });
    h += '</section></div>';
    return h;
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
      h += '<label for="code" style="font-size:13px;color:var(--bone2)">Your private setup code</label><textarea class="code" id="code" readonly>' + esc(state.code) + '</textarea><button type="button" class="btn" id="copyBtn">Copy code</button>' +
        '<p class="muted" style="margin:0;font-size:13px">Paste it only into GitHub: your <b>attention</b> project → <b>Settings</b> → <b>Secrets and variables</b> → <b>Actions</b> → <b>New repository secret</b>. Name: <b>PUSH_SETUP</b>. Don’t share it anywhere else.</p>';
    }
    h += '</section>';
    if (supported && perm === 'granted') h += '<section class="card stack" style="gap:10px"><h2>Test on this phone</h2><p class="muted" style="margin:0;font-size:14px">Shows a sample reminder right now, to check that notifications appear. Tap it to open a check-in.</p><button type="button" class="btn" id="testBtn">Show a sample reminder</button></section>';
    h += '<section class="card stack" style="gap:10px"><h2>Your data</h2><p class="muted" style="margin:0;font-size:14px">Everything you log stays on this phone. Save a backup now and then.</p><div class="row"><button type="button" class="btn" id="expBtn">Save backup</button><button type="button" class="btn ghost" id="resetBtn">Start over</button></div></section></div>';
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
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      a.download = 'attention-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    };
    view.querySelector('#resetBtn').onclick = function () {
      if (!confirm('Erase all progress and check-ins, and start the 30 days from today?')) return;
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
    else if (ui.tab === 'log') { view.innerHTML = renderLog(); }
    else { view.innerHTML = renderSettings(); bindSettings(view); }
    document.querySelectorAll('.tab[data-tab]').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); t.setAttribute('aria-current', t.dataset.tab === ui.tab ? 'page' : 'false'); });
  }
  document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
    t.addEventListener('click', function () { ui.tab = t.dataset.tab; render(); window.scrollTo(0, 0); });
  });
  document.getElementById('checkinBtn').addEventListener('click', openCheckin);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'checkin' && !ci) openCheckin(); });
  }
  var lastDay = todayNum();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && todayNum() !== lastDay) { lastDay = todayNum(); ui.sel = null; render(); } });

  render();
  if (/[?&]checkin=1/.test(location.search)) openCheckin();
})();
