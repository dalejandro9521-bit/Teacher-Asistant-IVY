/**
 * TA Attendance — paste this whole file into Apps Script as Code.gs.
 * Generated from src/ by `npm run bundle`. Do not edit here.
 */

/* ===== Rules.js ===== */

/**
 * Attendance rules. Pure functions only (no Apps Script services) so the tests can run them in Node.
 * In Apps Script every .gs file shares one global scope, so these are visible to Code.js.
 */

var DEFAULTS = {
  presentUntilMin: 15,     // arrives in minutes 0-15 → Present
  tardyUntilMin: 30,       // minutes 16-30 → Tardy; 31 or later → Absent
  tardiesPerAbsence: 3,    // 3 tardies = 1 absence
  maxAbsences: 2,          // more than this and the student is below 80%
  totalSessions: 10,       // 10-week course, one session a week → each absence = 10%
  minAttendancePct: 80,
  noIdLimit: 2,            // more than this many check-ins without ID → notify the office
  earlyLeaveGraceMin: 5,   // Zoom: leaving within this many minutes of the end is not "left early"
  excuseReviewDays: 7      // the office verifies medical excuses within one week
};

var STATUS = { P: 'Present', T: 'Tardy', A: 'Absent', E: 'Excused' };

function rulesConfig_(cfg) {
  var out = {};
  for (var k in DEFAULTS) out[k] = DEFAULTS[k];
  for (var j in (cfg || {})) if (cfg[j] !== '' && cfg[j] != null) out[j] = cfg[j];
  return out;
}

/** "09:00", "9:00 AM", "1:30 pm", "13:30:15" → minutes since midnight (with fraction for seconds). */
function hmToMin(v) {
  if (v == null || v === '') return null;
  var m = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?\s*[Mm]?\.?/);
  if (!m) return null;
  var h = +m[1], min = +m[2], s = +(m[3] || 0), ap = (m[4] || '').toUpperCase();
  if (ap === 'P' && h < 12) h += 12;
  if (ap === 'A' && h === 12) h = 0;
  return h * 60 + min + s / 60;
}

/** 810 → "1:30 PM" */
function minToLabel(min) {
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}

/** Status from how many minutes after the start the student arrived. 9:15:40 counts as minute 15 → Present. */
function classify(minutesAfterStart, cfg) {
  var c = rulesConfig_(cfg), m = Math.floor(minutesAfterStart);
  if (m <= c.presentUntilMin) return STATUS.P;
  if (m <= c.tardyUntilMin) return STATUS.T;
  return STATUS.A;
}

/** Accepts Present/P/Tardy/Late/T/Absent/A/Excused/E (any case) → canonical status, or '' if unknown. */
function normalizeStatus(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (/^(p|present|presente|attended|yes|y|✓|x)$/.test(s)) return STATUS.P;
  if (/^(t|tardy|tardío|tardio|late|tarde|l)$/.test(s)) return STATUS.T;
  if (/^(a|absent|ausente|no|n|missed)$/.test(s)) return STATUS.A;
  if (/^(e|excused|excusado|exc)$/.test(s)) return STATUS.E;
  return '';
}

/**
 * Totals per class + student.
 * records: [{classId, studentId, date, status, excuse}] — an accepted excuse turns an Absent/Tardy into Excused.
 * Returns { "<classId>|<studentId>": {absences, tardies, excused, present, effective, remaining, pct, state} }.
 */
function tally(records, cfg) {
  var c = rulesConfig_(cfg), out = {};
  (records || []).forEach(function (r) {
    var key = r.classId + '|' + r.studentId;
    var t = out[key] || (out[key] = { absences: 0, tardies: 0, excused: 0, present: 0 });
    var st = /^accepted$/i.test(String(r.excuse || '').trim()) ? STATUS.E : normalizeStatus(r.status);
    if (st === STATUS.A) t.absences++;
    else if (st === STATUS.T) t.tardies++;
    else if (st === STATUS.E) t.excused++;
    else if (st === STATUS.P) t.present++;
  });
  for (var k in out) finishTally_(out[k], c);
  return out;
}

function emptyTally(cfg) {
  return finishTally_({ absences: 0, tardies: 0, excused: 0, present: 0 }, rulesConfig_(cfg));
}

function finishTally_(t, c) {
  t.tardyAbsences = Math.floor(t.tardies / c.tardiesPerAbsence);
  t.effective = t.absences + t.tardyAbsences;
  t.remaining = c.maxAbsences - t.effective;
  t.pct = Math.max(0, Math.round(100 - t.effective * 100 / c.totalSessions));
  t.state = t.effective > c.maxAbsences ? 'failing'
    : t.effective === c.maxAbsences ? 'at-limit'
    : t.effective === c.maxAbsences - 1 ? 'warning' : 'ok';
  return t;
}

var STATE_LABEL = {
  ok: 'On track',
  warning: '1 absence left',
  'at-limit': 'At the limit (no absences left)',
  failing: 'Below 80% (losing the course)'
};

/** "2026-10-05" → day number, for date math without time zones. */
function dayNum(dateStr) {
  var p = String(dateStr).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

function numToDate(n) {
  var d = new Date(n * 86400000);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function weekday(dateStr) { return new Date(dayNum(dateStr) * 86400000).getUTCDay(); }

/** "2026-10-05" → "Monday, October 5, 2026" */
function longDate(dateStr) {
  var p = String(dateStr).split('-');
  return DAY_NAMES[weekday(dateStr)] + ', ' + MONTH_NAMES[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
}

/** "Monday" / "Mon" / "lunes" → 1 */
function dayIndex(v) {
  var s = String(v || '').trim().toLowerCase().slice(0, 3);
  var map = { sun: 0, dom: 0, mon: 1, lun: 1, tue: 2, mar: 2, wed: 3, mié: 3, mie: 3, thu: 4, jue: 4, fri: 5, vie: 5, sat: 6, sáb: 6, sab: 6 };
  return s in map ? map[s] : -1;
}

/** Monday..Sunday around a date. */
function weekBounds(dateStr) {
  var n = dayNum(dateStr), wd = weekday(dateStr), mon = n - ((wd + 6) % 7);
  return { start: numToDate(mon), end: numToDate(mon + 6) };
}

/** Week number of the term (1-based) for a date, given the first day of the term. */
function termWeek(dateStr, termStart) {
  if (!termStart) return null;
  return Math.floor((dayNum(weekBounds(dateStr).start) - dayNum(weekBounds(termStart).start)) / 7) + 1;
}

/** Lowercase, no accents, no punctuation. "Gómez, José (Joe)" → "gomez jose joe" */
function normalizeName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Finds the roster student for a name typed in Zoom or shown in a Populi export.
 * Tries: exact ID, exact email, full name or alias, "Last, First", every roster-name word present, then first + last word.
 * Returns the student or null (also null when two students match equally).
 */
function matchStudent(probe, roster) {
  probe = probe || {};
  var id = String(probe.id || '').trim().toLowerCase();
  var email = String(probe.email || '').trim().toLowerCase();
  if (id) {
    var byId = roster.filter(function (s) { return String(s.id).trim().toLowerCase() === id; });
    if (byId.length === 1) return byId[0];
  }
  if (email) {
    var byEmail = roster.filter(function (s) { return String(s.email || '').trim().toLowerCase() === email; });
    if (byEmail.length === 1) return byEmail[0];
  }
  var raw = String(probe.name || '');
  if (!raw.trim()) return null;
  // Zoom: "Display Name (Original Name)" → try both parts; Populi: "Last, First" → also "First Last".
  var variants = [];
  var paren = raw.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (paren) variants.push(paren[1], paren[2]); else variants.push(raw);
  variants.slice().forEach(function (v) {
    var comma = v.split(',');
    if (comma.length === 2) variants.push(comma[1] + ' ' + comma[0]);
  });
  var tests = [
    function (s, v) {
      // Zoom names Diego linked by hand ("Aliases" column), then the roster name itself.
      return normalizeName(s.name) === v || (s.aliases || []).some(function (a) { return normalizeName(a) === v; });
    },
    function (s, v) {
      var words = normalizeName(s.name).split(' '), have = ' ' + v + ' ';
      return words.length > 1 && words.every(function (w) { return have.indexOf(' ' + w + ' ') >= 0; });
    },
    function (s, v) {
      var words = normalizeName(s.name).split(' '), vw = v.split(' ');
      return words.length > 1 && vw.length > 1 && words[0] === vw[0] && words[words.length - 1] === vw[vw.length - 1];
    },
    // "Suda Kaewngam" = "Suda Kaew-ngam"; "johnsmith" written together
    function (s, v) { return v.length > 5 && normalizeName(s.name).replace(/ /g, '') === v.replace(/ /g, ''); },
    // Zoom shows part of the name: "Lina Mora" ⊂ "Lina Mora Bastidas", "Ana Ruiz" ⊂ "Ana Maria Ruiz Soto"
    function (s, v) {
      var words = ' ' + normalizeName(s.name) + ' ', vw = v.split(' ');
      return vw.length > 1 && vw.every(function (w) { return words.indexOf(' ' + w + ' ') >= 0; });
    },
    // Only a first name ("Lara"): fine when nobody else in the class has it.
    function (s, v) { return v.indexOf(' ') < 0 && v.length > 2 && normalizeName(s.name).split(' ')[0] === v; }
  ];
  for (var t = 0; t < tests.length; t++) {
    for (var i = 0; i < variants.length; i++) {
      var v = normalizeName(variants[i]);
      if (!v) continue;
      var hits = roster.filter(function (s) { return tests[t](s, v); });
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) return null;
    }
  }
  return null;
}

/**
 * Class running (or about to start / just ended) at a moment. classes: [{id, day, start, end}] with start/end in minutes.
 */
function classAt(classes, dateStr, nowMin, marginMin) {
  var wd = weekday(dateStr), m = marginMin == null ? 30 : marginMin;
  var hits = classes.filter(function (c) {
    return dayIndex(c.day) === wd && nowMin >= c.start - m && nowMin <= c.end + m;
  });
  hits.sort(function (a, b) { return Math.abs(a.start - nowMin) - Math.abs(b.start - nowMin); });
  return hits[0] || null;
}

/**
 * Assignment reminders due today.
 * assignments: [{classId, title, due:"yyyy-mm-dd", remindDays:"3,1", reminded:"3"}]
 * Returns [{assignment, daysLeft}] — one per assignment (the closest reminder not sent yet).
 */
function dueReminders(assignments, todayStr) {
  var today = dayNum(todayStr), out = [];
  (assignments || []).forEach(function (a) {
    if (!a.due || !a.title) return;
    var left = dayNum(a.due) - today;
    if (left < 0) return;
    var days = String(a.remindDays == null || a.remindDays === '' ? '2' : a.remindDays)
      .split(/[,; ]+/).filter(String).map(Number).filter(function (n) { return !isNaN(n); });
    var sent = String(a.reminded || '').split(/[,; ]+/).filter(String).map(Number);
    // Fire the reminder for the smallest "days before" that has been reached and not sent yet.
    var pending = days.filter(function (d) { return left <= d && sent.indexOf(d) < 0; });
    if (!pending.length) return;
    var d = Math.min.apply(null, pending);
    // Skip if a closer reminder was already sent (e.g. "3,1" and 1 already went out).
    if (sent.some(function (s) { return s <= d; })) return;
    out.push({ assignment: a, daysLeft: left, reminderKey: d });
  });
  return out;
}

/* ---------- fuzzy names: second names, Z/S, typos ---------- */

/** Spelling-insensitive form of a name word: z→s, y→i, v→b, ph→f, k/q→c, no h, no double letters. */
function soundKey(w) {
  return normalizeName(w).replace(/ph/g, 'f').replace(/z/g, 's').replace(/y/g, 'i').replace(/v/g, 'b')
    .replace(/[kq]/g, 'c').replace(/h/g, '').replace(/(.)\1+/g, '$1');
}

function editDistance(a, b) {
  if (a === b) return 0;
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = same word, 0.8 = same sound or one/two letters off, 0.6 = cut-off word ("Sharj…"), 0 = different. */
function wordScore(a, b) {
  if (a === b) return 1;
  var ka = soundKey(a), kb = soundKey(b);
  if (ka && ka === kb) return 0.8;
  var n = Math.min(ka.length, kb.length);
  if (n >= 4 && editDistance(ka, kb) <= (n >= 7 ? 2 : 1)) return 0.8;
  if (a.length >= 4 && b.indexOf(a) === 0) return 0.6;
  return 0;
}

var NAME_NOISE_ = /^(guest|host|co|cohost|me|iphone|ipad|android|galaxy|samsung|phone|laptop|pc|mac|macbook|zoom|user|de|del|la|el|y|the|of)$/;

/**
 * Who a Zoom/chat name could be, best first: [{student, score}].
 * The score adds up how well each word of the name matches a different word of the student's name, so a student
 * who uses only a second name ("Naomy Ferreira" for "Angie Naomy Ferreira Beltran") still scores high.
 */
function nameCandidates(probe, roster) {
  var words = normalizeName(String(probe || '').replace(/\(.*?\)/g, ' ')).split(' ')
    .filter(function (w) { return w.length >= 2 && !/^\d+$/.test(w) && !NAME_NOISE_.test(w); });
  if (!words.length) return [];
  var joined = words.join('');
  var out = [];
  roster.forEach(function (s) {
    var sw = normalizeName(s.name).split(' ').filter(String), used = {}, score = 0, hits = 0;
    words.forEach(function (w) {
      var best = 0, bi = -1;
      sw.forEach(function (x, i) {
        if (used[i]) return;
        var sc = wordScore(w, x);
        if (sc > best) { best = sc; bi = i; }
      });
      if (bi >= 0) { used[bi] = true; score += best; hits++; }
    });
    // Name written all together: "muhammadsharjeelarshad"
    if (words.length === 1 && joined.length >= 10) {
      var all = soundKey(sw.join(''));
      if (editDistance(soundKey(joined), all) <= 2) { score = Math.max(score, 1.8); hits = 2; }
    }
    if (score > 0) out.push({ student: s, score: Math.round(score * 10) / 10, hits: hits, words: words.length });
  });
  return out.sort(function (a, b) { return b.score - a.score; });
}

/**
 * A name from a screenshot → {student, how} when sure, {doubt:[students]} when it could be more than one or the match
 * is weak (Diego decides), or null when nobody is close.
 * Sure = the exact rules of matchStudent, or two words matching well and clearly ahead of anyone else.
 */
function resolveName(probe, roster) {
  var exact = matchStudent({ name: probe }, roster);
  if (exact) return { student: exact, how: 'exact' };
  var c = nameCandidates(probe, roster);
  if (!c.length) return null;
  var top = c[0], second = c[1];
  var strong = top.hits >= 2 && top.score >= 1.6;
  var clear = !second || second.score <= top.score - 0.8;
  if (strong && clear) return { student: top.student, how: 'similar' };
  var close = c.filter(function (x) { return x.score >= Math.max(0.6, top.score - 0.8); }).slice(0, 3);
  // A single cut-off or misspelt word is too little to suggest anyone.
  if (top.score < 0.8) return null;
  return { doubt: close.map(function (x) { return x.student; }) };
}

/* ===== Parsers.js ===== */

/**
 * Reading the files dropped in the Drive inbox: Populi attendance exports and Zoom participant reports.
 * Pure functions (no Apps Script services).
 */

/** CSV (or tab-separated text pasted from a spreadsheet) → array of rows. Handles quotes and a BOM. */
function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  var firstLine = text.split(/\r?\n/)[0] || '';
  var sep = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(function (r) { return r.map(function (c) { return String(c).trim(); }); })
    .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
}

/** Many date spellings → "yyyy-mm-dd" (or '' if it isn't a date). */
function parseDateCell(v, defaultYear) {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  m = s.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s|$)/);
  if (m) {
    var y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : defaultYear;
    if (!y || +m[1] > 12 || +m[2] > 31) return '';
    return y + '-' + pad2_(+m[1]) + '-' + pad2_(+m[2]);
  }
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if (m) {
    var mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()) + 1;
    var yr = m[3] ? +m[3] : defaultYear;
    if (!yr) return '';
    return yr + '-' + pad2_(mo) + '-' + pad2_(+m[2]);
  }
  return '';
}

function findCol_(header, re, not) {
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i]);
    if (re.test(h) && !(not && not.test(h))) return i;
  }
  return -1;
}

/** 'zoom' if it looks like a Zoom participants report, otherwise 'populi'. */
function detectKind(rows) {
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some(function (c) { return /join\s*time/i.test(c); })) return 'zoom';
  }
  return 'populi';
}

/**
 * Zoom participants report (Reports → Usage → Participants, or the meeting's participant export).
 * → {kind, topic, meetingId, date, participants:[{name, email, join, leave}]} — join/leave in minutes since midnight.
 */
function parseZoom(rows) {
  var out = { kind: 'zoom', topic: '', meetingId: '', date: '', participants: [] };
  var h = -1;
  for (var i = 0; i < rows.length; i++) {
    var ti = findCol_(rows[i], /^topic$/i), mi = findCol_(rows[i], /meeting\s*id/i);
    if ((ti >= 0 || mi >= 0) && rows[i + 1] && findCol_(rows[i], /join\s*time/i) < 0) {
      if (ti >= 0) out.topic = rows[i + 1][ti] || '';
      if (mi >= 0) out.meetingId = String(rows[i + 1][mi] || '').replace(/\D/g, '');
    }
    if (findCol_(rows[i], /join\s*time/i) >= 0) { h = i; break; }
  }
  if (h < 0) return out;
  var head = rows[h];
  var cName = findCol_(head, /^(name|participant|user name|display name)/i);
  var cEmail = findCol_(head, /email/i);
  var cJoin = findCol_(head, /join\s*time/i), cLeave = findCol_(head, /leave\s*time/i);
  var dates = {};
  for (var r = h + 1; r < rows.length; r++) {
    var row = rows[r];
    if (findCol_(row, /join\s*time/i) >= 0) continue; // repeated header
    var join = hmToMin(row[cJoin]), leave = cLeave >= 0 ? hmToMin(row[cLeave]) : null;
    if (join == null) continue;
    var d = parseDateCell(row[cJoin]);
    if (d) dates[d] = (dates[d] || 0) + 1;
    out.participants.push({
      name: cName >= 0 ? row[cName] : '',
      email: cEmail >= 0 ? row[cEmail] : '',
      join: join,
      leave: leave == null ? join : leave
    });
  }
  out.date = Object.keys(dates).sort(function (a, b) { return dates[b] - dates[a]; })[0] || '';
  return out;
}

/**
 * Zoom report → status per roster student.
 * cls: {start, end} in minutes. Returns {results:[{student, status, minutesLate, join, leave, leftEarly, names}], unmatched:[names], notSeen:[students]}
 * - First time the student joined decides Present / Tardy / Absent (same 15 / 30 minute rule).
 * - Leaving before the class ends (or before the host ended the meeting) by more than the grace minutes → Absent.
 */
function zoomStatuses(zoom, roster, cls, cfg) {
  var c = rulesConfig_(cfg), byStudent = {}, unmatched = [], seen = {};
  var meetingEnd = 0;
  zoom.participants.forEach(function (p) { if (p.leave > meetingEnd) meetingEnd = p.leave; });
  var endRef = Math.min(cls.end, meetingEnd || cls.end);
  zoom.participants.forEach(function (p) {
    var s = matchStudent({ name: p.name, email: p.email }, roster);
    if (!s) {
      if (unmatched.indexOf(p.name) < 0) unmatched.push(p.name);
      return;
    }
    var b = byStudent[s.id] || (byStudent[s.id] = { student: s, join: p.join, leave: p.leave, names: [] });
    b.join = Math.min(b.join, p.join);
    b.leave = Math.max(b.leave, p.leave);
    if (b.names.indexOf(p.name) < 0) b.names.push(p.name);
  });
  var results = [];
  for (var id in byStudent) {
    var b = byStudent[id];
    seen[id] = true;
    var late = b.join - cls.start;
    var st = classify(late, c), left = false;
    if (st !== STATUS.A && b.leave < endRef - c.earlyLeaveGraceMin) { st = STATUS.A; left = true; }
    results.push({ student: b.student, status: st, minutesLate: Math.max(0, Math.floor(late)), join: b.join, leave: b.leave, leftEarly: left, names: b.names });
  }
  var notSeen = roster.filter(function (s) { return !seen[s.id]; });
  return { results: results, unmatched: unmatched, notSeen: notSeen };
}

/**
 * Populi attendance export. Understands both shapes:
 *  - long: one row per student per meeting, with a Date column and a Status column (and maybe a check-in time);
 *  - wide: one row per student, one column per meeting date, cells like Present / P / Absent / Tardy / Excused.
 * → {kind:'populi', shape:'long'|'wide', course, records:[{name, id, email, date, status, time}], skipped}
 *   status may be '' when only a check-in time is given (Code.js classifies it with the class start time).
 */
function parsePopuli(rows, defaultYear) {
  var out = { kind: 'populi', shape: '', course: '', records: [], skipped: 0 };
  // Header = first row that has a name-ish column.
  var h = -1;
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    // A title line ("Student attendance report") has one cell; the header has several.
    if (rows[i].filter(String).length >= 2 && findCol_(rows[i], /(student|name|first|last)/i) >= 0) { h = i; break; }
  }
  if (h < 0) return out;
  // A course title above the header ("ENG 111-01 Attendance") helps pick the class.
  if (h > 0) out.course = rows.slice(0, h).map(function (r) { return r.join(' '); }).join(' ').trim();
  var head = rows[h];
  var cFirst = findCol_(head, /first/i), cLast = findCol_(head, /last/i, /last\s*(attend|update|date)/i);
  var cName = findCol_(head, /(student|name)/i, /(id|number|first|last|email)/i);
  var cId = findCol_(head, /(\bid\b|student\s*id|number|barcode|^id)/i, /email/i);
  var cEmail = findCol_(head, /email/i);
  var cCourse = findCol_(head, /(course|class|section)/i);
  var cDate = findCol_(head, /date/i, /(update|created|modified)/i);
  var cStatus = findCol_(head, /(status|attendance)/i, /date/i);
  var cTime = findCol_(head, /(check.?in|scan|arriv|time)/i, /(date|update)/i);

  function who(row) {
    var name = cName >= 0 ? row[cName] : '';
    if (cFirst >= 0 || cLast >= 0) {
      var full = ((cFirst >= 0 ? row[cFirst] : '') + ' ' + (cLast >= 0 ? row[cLast] : '')).trim();
      if (full) name = full;
    }
    return { name: name, id: cId >= 0 ? row[cId] : '', email: cEmail >= 0 ? row[cEmail] : '' };
  }

  // Wide format: columns whose header is a date.
  var dateCols = [];
  head.forEach(function (cell, idx) {
    if (idx === cDate) return;
    var d = parseDateCell(cell, defaultYear);
    if (d) dateCols.push({ idx: idx, date: d });
  });

  out.shape = (cDate >= 0 && (cStatus >= 0 || cTime >= 0)) ? 'long' : 'wide';
  for (var r = h + 1; r < rows.length; r++) {
    var row = rows[r], p = who(row);
    if (!p.name && !p.id && !p.email) continue;
    if (cCourse >= 0 && !out.course) out.course = row[cCourse];
    if (out.shape === 'long') {
      var date = parseDateCell(row[cDate], defaultYear);
      if (!date) { out.skipped++; continue; }
      // The check-in time may be in its own column or inside the date cell ("10/5/2026 9:12 AM").
      var tm = cTime >= 0 ? hmToMin(row[cTime]) : hmToMin(row[cDate]);
      var st = cStatus >= 0 ? normalizeStatus(row[cStatus]) : '';
      if (!st && tm == null) { out.skipped++; continue; }
      out.records.push({ name: p.name, id: p.id, email: p.email, date: date, status: st, time: tm });
    } else {
      dateCols.forEach(function (dc) {
        var st2 = normalizeStatus(row[dc.idx]);
        if (st2) out.records.push({ name: p.name, id: p.id, email: p.email, date: dc.date, status: st2, time: null });
        else if (String(row[dc.idx] || '').trim()) out.skipped++;
      });
    }
  }
  return out;
}

/**
 * Which class a file belongs to.
 * hints: {fileName, course, topic, meetingId}; classes: [{id, course, section, zoomId}]; rosterByClass: {classId:[students]}
 * people: [{name, id, email}] found in the file. Order: [C2] tag in the file name → Zoom meeting ID →
 * course code / name / section text → the roster that matches the most people.
 */
function pickClass(hints, classes, rosterByClass, people) {
  hints = hints || {};
  var name = String(hints.fileName || '');
  var tag = name.match(/\[([^\]]+)\]/);
  if (tag) {
    var t = classes.filter(function (c) { return String(c.id).toLowerCase() === tag[1].trim().toLowerCase(); });
    if (t.length) return { cls: t[0], how: 'file name tag' };
  }
  if (hints.meetingId) {
    var z = classes.filter(function (c) { return String(c.zoomId || '').replace(/\D/g, '') === hints.meetingId; });
    if (z.length === 1) return { cls: z[0], how: 'Zoom meeting ID' };
  }
  var text = normalizeName([hints.course, hints.topic, name].join(' ')), padded = ' ' + text + ' ';
  // Course code ("HA 105") first, then the full course name, then the section number (weakest: "01" is common).
  var tests = [
    function (c) { var code = courseCode(c.course); return code && (padded.indexOf(' ' + code + ' ') >= 0 || padded.indexOf(' ' + code.replace(' ', '') + ' ') >= 0); },
    function (c) { var crs = normalizeName(c.course); return crs && text.indexOf(crs) >= 0; },
    function (c) { var sec = normalizeName(c.section); return sec && padded.indexOf(' ' + sec + ' ') >= 0; }
  ];
  var byText = [];
  for (var k = 0; k < tests.length && byText.length !== 1; k++) {
    var hits = classes.filter(tests[k]);
    if (hits.length) byText = hits;
  }
  if (byText.length === 1) return { cls: byText[0], how: 'course name' };
  var best = null, bestN = 0, tie = false;
  (byText.length ? byText : classes).forEach(function (c) {
    var roster = rosterByClass[c.id] || [];
    var n = (people || []).filter(function (p) { return matchStudent(p, roster); }).length;
    if (n > bestN) { best = c; bestN = n; tie = false; } else if (n && n === bestN) tie = true;
  });
  if (best && !tie) return { cls: best, how: 'roster match (' + bestN + ' students)' };
  return { cls: null, how: tie ? 'two classes match the same students' : 'no class matched' };
}

/** "HA 103: History of World Religions" → "ha 103" (the course code alone identifies a class in file names). */
function courseCode(course) {
  var m = String(course || '').match(/^\s*([A-Za-z]{2,5})\s*-?\s*(\d{2,4}[A-Za-z]?)\b/);
  return m ? (m[1] + ' ' + m[2]).toLowerCase() : '';
}

/**
 * Populi class roster export (Roster → Actions → Export this section CSV), in Populi's own order.
 * → [{name, id, email, active}] — withdrawn / dropped students come back with active:false.
 */
function parseRoster(rows) {
  var h = -1;
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].filter(String).length >= 2 && findCol_(rows[i], /(student|name|first|last)/i) >= 0) { h = i; break; }
  }
  if (h < 0) return [];
  var head = rows[h];
  var cFirst = findCol_(head, /first/i), cLast = findCol_(head, /last/i, /last\s*(attend|update|date)/i);
  var cName = findCol_(head, /(student|name)/i, /(id|number|first|last|email)/i);
  var cId = findCol_(head, /(\bid\b|student\s*id|number|barcode|^id)/i, /email/i);
  var cEmail = findCol_(head, /email/i);
  var cStatus = findCol_(head, /^(status|enrollment)/i);
  var cType = findCol_(head, /^(type|role)$/i);
  var out = [];
  for (var r = h + 1; r < rows.length; r++) {
    var row = rows[r], name = cName >= 0 ? row[cName] : '';
    if (cFirst >= 0 || cLast >= 0) {
      var full = ((cFirst >= 0 ? row[cFirst] : '') + ' ' + (cLast >= 0 ? row[cLast] : '')).trim();
      if (full) name = full;
    }
    var id = cId >= 0 ? row[cId] : '', email = cEmail >= 0 ? row[cEmail] : '';
    if (!name && !id) continue;
    if (cType >= 0 && row[cType] && !/student/i.test(row[cType])) continue; // professors and the TA are listed too
    var st = cStatus >= 0 ? String(row[cStatus] || '') : '';
    out.push({ name: name, id: id, email: email, active: !/(withdr|drop|cancel|incomplete)/i.test(st) });
  }
  return out;
}

/**
 * Which moment a screenshot folder is, from its name. Diego's folders: "1. Present", "2. Tardy", "3. Absent"
 * (the last check before leaving). Also understands "6.15", "6.31", "End", "Final", "Salida".
 */
function screenshotPhase(folderName) {
  var n = String(folderName || '').toLowerCase();
  // The words win over the numbers: "Absent - min 31 to end" is the last check, not the 31-minute one.
  if (/present|presente/.test(n)) return 'present';
  if (/tard/.test(n)) return 'tardy';
  if (/absent|ausente|\bend\b|final|salida|leav|check/.test(n)) return 'end';
  if (/:15|\.15\b|\b15\b/.test(n)) return 'present';
  if (/:31|\.31\b|\b31\b/.test(n)) return 'tardy';
  return '';
}

var ZOOM_UI_WORDS_ = /\b(professor|prof|teacher|instructor|everyone|screen|type message|message|who can see|new chat|to|mute|unmute|participants?|invite|waiting room|chat|raise|lower|hand|reactions?|share|record|security|breakout|apps|whiteboard|leave|end|more|rename|search|in the meeting|host|co-host|guest|me|video|audio|view|speaker|gallery|zoom|meeting|minutes?)\b/;

/** Chat header as OCR reads it: "Maide 6:44 PM", "From Ana Lopez to Everyone 6:02 PM". */
var CHAT_HEADER_ = /^(?:from\s+)?(.{2,60}?)(?:\s+to\s+(?:everyone|me|all)\b.*?)?\s+(\d{1,2}:\d{2}\s*[AaPp]\.?\s*[Mm]\.?)\s*$/;

/**
 * One screenshot's OCR text → names on video tiles and chat messages.
 * A chat message is the header line (sender + time) and the line under it (what the student typed: their name).
 * → {tiles:[name], chat:[{names:[typed, sender], time}]}
 */
function readScreenshotText(text) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/[|•·]/g, ' ').trim(); })
    .filter(String);
  var out = { tiles: [], chat: [] };
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(CHAT_HEADER_);
    if (m) {
      var next = lines[i + 1] && !CHAT_HEADER_.test(lines[i + 1]) ? lines[++i] : '';
      out.chat.push({ names: [next, m[1]].filter(String), time: hmToMin(m[2]) });
    } else if (!/^\d{1,2}:\d{2}/.test(lines[i])) out.tiles.push(lines[i]);
  }
  return out;
}

/**
 * Text read (OCR) from the screenshots of each moment → status per roster student. Diego's rules for Zoom:
 * - "present" shots (minutes 0–15), "tardy" shots (16–30), "end" shot (before he leaves, about 1 hour in).
 * - In present → Present, even if missing from the tardy shot, as long as the end shot confirms them.
 * - First seen in tardy → Tardy (if still there at the end).
 * - Seen earlier but not in the end shot → Absent (disconnected), with a note.
 * - Only in the end shot (joined after minute 30) or never seen → Absent.
 * - Chat: what the student typed (their name) and the message time say when they joined, measured from the
 *   real start of class (opts.start, minutes). Chat never proves someone is still connected at the end.
 * Names: exact or clearly similar → that student; two possible students or a weak match → review (Diego decides).
 * Without end shots, nobody is marked as disconnected.
 * phases: {present:[text], tardy:[text], end:[text]} (one OCR text per screenshot); ignore: names that are not students;
 * opts: {start, cfg}.
 * Returns {results:[{student, status, leftEarly, note}], notSeen:[students], review:[{name, seenIn:[...], candidates:[students]}]}.
 */
function screenshotStatuses(phases, roster, ignore, opts) {
  opts = opts || {};
  var c = rulesConfig_(opts.cfg), start = opts.start;
  var seen = { present: {}, tardy: {}, end: {}, late: {} }, chatAt = {}, review = {}, order = [];
  var skip = (ignore || []).map(function (n) { return { id: n, name: n }; });

  function note(name, ph, r) {
    var key = normalizeName(name);
    if (!review[key]) { review[key] = { name: name, seenIn: [], candidates: r ? r.doubt : [] }; order.push(key); }
    if (review[key].seenIn.indexOf(ph) < 0) review[key].seenIn.push(ph);
  }
  function see(names, ph, time) {
    var doubt = null, unknown = null;
    for (var i = 0; i < names.length; i++) {
      var r = resolveName(names[i], roster);
      if (r && r.student) {
        seen[ph][r.student.id] = true;
        if (time != null && !(r.student.id in chatAt)) chatAt[r.student.id] = time;
        return;
      }
      if (skip.length && (matchStudent({ name: names[i] }, skip) || nameCandidates(names[i], skip).some(function (x) { return x.score >= 1; }))) return;
      if (r && r.doubt && !doubt) doubt = { name: names[i], r: r };
      else if (!r && !unknown && looksLikeName_(names[i])) unknown = names[i];
    }
    if (doubt) note(doubt.name, ph, doubt.r);
    else if (unknown) note(unknown, ph, null);
  }

  ['present', 'tardy', 'end'].forEach(function (ph) {
    (phases[ph] || []).forEach(function (text) {
      var shot = readScreenshotText(text);
      shot.tiles.forEach(function (t) { see([t], ph); });
      shot.chat.forEach(function (m) {
        // The message time decides; without a start time, the folder does (but chat never counts as "still there").
        var when = start != null && m.time != null ? classify(m.time - start, c) : (ph === 'end' ? '' : ph === 'present' ? STATUS.P : STATUS.T);
        var cph = when === STATUS.P ? 'present' : when === STATUS.T ? 'tardy' : 'late';
        see(m.names, cph, m.time);
      });
    });
  });

  var hasEnd = (phases.end || []).some(function (t) { return String(t || '').trim(); });
  var hasTardy = (phases.tardy || []).some(function (t) { return String(t || '').trim(); });
  var results = [], notSeen = [];
  roster.forEach(function (s) {
    var p = seen.present[s.id], t = seen.tardy[s.id], e = seen.end[s.id];
    var r = { student: s, status: '', leftEarly: false, note: '' };
    var chat = s.id in chatAt ? ' (chat ' + minToLabel(chatAt[s.id]) + ')' : '';
    if (p || t) {
      r.status = p ? STATUS.P : STATUS.T;
      if (hasEnd && !e) {
        r.status = STATUS.A; r.leftEarly = true;
        r.note = (p && t ? 'In the 15 and 31 minute screenshots' : p ? 'Only in the 15 minute screenshot' : 'Tardy (31 minute screenshot)') +
          chat + ', not in the last screenshot: disconnected before the 1-hour check';
      } else if (p && !t && e && hasTardy) r.note = 'Not in the 31 minute screenshot; confirmed in the last one' + chat;
      else if (chat) r.note = 'Name in chat' + chat;
    } else if (e || seen.late[s.id]) {
      r.status = STATUS.A;
      r.note = 'Joined after minute 30' + chat + (e && !chat ? ' (only in the last screenshot)' : '');
    } else { notSeen.push(s); return; }
    results.push(r);
  });
  // Don't ask about "Malek" if every possible Malek was already recognized in those screenshots.
  var questions = order.map(function (k) { return review[k]; }).filter(function (q) {
    return !q.candidates.length || !q.candidates.every(function (s) {
      return q.seenIn.every(function (ph) { return seen[ph][s.id]; });
    });
  });
  return { results: results, notSeen: notSeen, review: questions };
}

function looksLikeName_(line) {
  var n = normalizeName(String(line).replace(/\(.*?\)/g, ' '));
  var words = n.split(' ').filter(function (w) { return /[a-z]{2}/.test(w); });
  return words.length >= 1 && words.length <= 5 && n.length <= 45 && !ZOOM_UI_WORDS_.test(n);
}

/**
 * For the dashboard: every line the OCR read in each screenshot and what it became.
 * → {phases:{present:[shot], tardy:[shot], end:[shot]}} with shot = [{text, kind:'tile'|'chat', time, result, who}]
 *   result: 'match' (who = "#5 Name", how), 'doubt' (who = candidates), 'ignored', 'unknown', 'noise'.
 */
function screenshotDiagnostics(phases, roster, ignore, opts) {
  opts = opts || {};
  var skip = (ignore || []).map(function (n) { return { id: n, name: n }; });
  function judge(names) {
    var doubt = null;
    for (var i = 0; i < names.length; i++) {
      var r = resolveName(names[i], roster);
      if (r && r.student) return { result: 'match', how: r.how, who: '#' + (r.student.order || '?') + ' ' + r.student.name };
      if (skip.length && (matchStudent({ name: names[i] }, skip) || nameCandidates(names[i], skip).some(function (x) { return x.score >= 1; }))) {
        return { result: 'ignored', who: '' };
      }
      if (r && r.doubt && !doubt) doubt = r.doubt;
    }
    if (doubt) return { result: 'doubt', who: doubt.map(function (s) { return '#' + (s.order || '?') + ' ' + s.name; }).join(' / ') };
    return names.some(looksLikeName_) ? { result: 'unknown', who: '' } : { result: 'noise', who: '' };
  }
  var out = { phases: {} };
  ['present', 'tardy', 'end'].forEach(function (ph) {
    out.phases[ph] = (phases[ph] || []).map(function (text) {
      var shot = readScreenshotText(text), lines = [];
      shot.tiles.forEach(function (t) { lines.push(Object.assign({ text: t, kind: 'tile' }, judge([t]))); });
      shot.chat.forEach(function (m) {
        var late = opts.start != null && m.time != null ? Math.floor(m.time - opts.start) : null;
        lines.push(Object.assign({ text: m.names.join(' ← '), kind: 'chat', time: m.time != null ? minToLabel(m.time) : '',
          minute: late }, judge(m.names)));
      });
      return lines;
    });
  });
  return out;
}

/* ===== Messages.js ===== */

/**
 * Email texts: student notices, office notices, assignment reminders and the Friday report.
 * Pure functions (no Apps Script services). Every builder returns {subject, text, html}.
 */

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function textToHtml_(text) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">' +
    text.split(/\n{2,}/).map(function (p) {
      var lines = p.split('\n');
      if (lines.every(function (l) { return /^• /.test(l); })) {
        return '<ul style="margin:0 0 12px 18px;padding:0">' + lines.map(function (l) { return '<li>' + esc_(l.slice(2)) + '</li>'; }).join('') + '</ul>';
      }
      return '<p style="margin:0 0 12px">' + lines.map(esc_).join('<br>') + '</p>';
    }).join('') + '</div>';
}

/** "ENG 111 (Section 01) — Monday, October 5, 2026, 9:00 AM – 1:00 PM (in person)" pieces. */
function classLabel(cls) {
  return cls.course + (cls.section ? ' (' + cls.section + ')' : '');
}

function classTime(cls) {
  return minToLabel(cls.start) + ' – ' + minToLabel(cls.end);
}

function signature_(cfg) {
  return [cfg.taName || 'Teacher Assistant', cfg.taTitle || 'Teacher Assistant', cfg.replyTo || ''].filter(String).join('\n');
}

function medicalExcuseText_(cfg) {
  var office = cfg.officeName || 'the main office';
  return 'If you missed class for a medical reason, please send your medical excuse to me or to ' + office +
    '. Do not send it to your professor. The excuse must include:\n' +
    '• Your full name\n' +
    '• A phone number for the doctor or hospital, so our office can contact them and verify it\n' +
    '• If the appointment was for someone else who could not go on their own, the note must say that you were there as their guardian or companion\n\n' +
    'The office verifies the excuse and updates your attendance within one week.';
}

function summaryLines_(t, cfg) {
  var c = rulesConfig_(cfg);
  var lines = [
    '• Current absences: ' + t.effective + ' of ' + c.maxAbsences + ' allowed' +
      (t.tardyAbsences ? ' (' + t.absences + ' absence' + (t.absences === 1 ? '' : 's') + ' + ' + t.tardyAbsences + ' from tardies)' : ''),
    '• Absences remaining: ' + Math.max(0, t.remaining),
    '• Tardies: ' + t.tardies + ' (every ' + c.tardiesPerAbsence + ' tardies count as 1 absence)',
    '• Current attendance: ' + t.pct + '% (minimum required: ' + c.minAttendancePct + '%)'
  ];
  if (t.excused) lines.push('• Excused: ' + t.excused);
  return lines.join('\n');
}

function standingSentence_(t, cfg) {
  var c = rulesConfig_(cfg);
  if (t.state === 'failing') {
    return 'You now have more than ' + c.maxAbsences + ' absences, so your attendance is below the ' + c.minAttendancePct +
      '% required to pass this course. Please contact me or the office as soon as possible.';
  }
  if (t.state === 'at-limit') return 'You have no absences left. One more absence (or ' + (c.tardiesPerAbsence - t.tardies % c.tardiesPerAbsence) + ' more tard' + ((c.tardiesPerAbsence - t.tardies % c.tardiesPerAbsence) === 1 ? 'y' : 'ies') + ') will put you below ' + c.minAttendancePct + '%.';
  return 'You need at least ' + c.minAttendancePct + '% attendance to pass. Over the ' + c.totalSessions + '-week course, that means no more than ' + c.maxAbsences + ' absences.';
}

/**
 * Notice to a student after a class.
 * kind: 'Absent' | 'Tardy' | 'LeftEarly'
 * p: {kind, student:{name,email}, cls:{course,section,start,end,mode}, date, tally, cfg, minutesLate}
 */
function buildStudentNotice(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg), s = p.student, cls = p.cls, t = p.tally;
  var when = longDate(p.date) + ', ' + classTime(cls);
  var first = String(s.name || '').split(/\s+/)[0] || 'student';
  var what, subjectWord;
  if (p.kind === 'Tardy') {
    subjectWord = 'Tardy';
    what = 'You were marked TARDY for ' + classLabel(cls) + ' on ' + when + '.' +
      (p.minutesLate ? ' You arrived ' + p.minutesLate + ' minutes after the start of class.' : '') +
      '\n\nStudents who arrive in the first ' + c.presentUntilMin + ' minutes are present, from minute ' + (c.presentUntilMin + 1) +
      ' to ' + c.tardyUntilMin + ' they are tardy, and from minute ' + (c.tardyUntilMin + 1) + ' on they are absent. Every ' +
      c.tardiesPerAbsence + ' tardies count as 1 absence.';
  } else if (p.kind === 'LeftEarly') {
    subjectWord = 'Absence (left early)';
    what = 'You were marked ABSENT for ' + classLabel(cls) + ' on ' + when + '. You checked in, but you left before the end of class. ' +
      'Leaving before the time set by the professor changes your attendance from Present to Absent.';
  } else {
    subjectWord = 'Absence';
    what = 'You were marked ABSENT for ' + classLabel(cls) + ' on ' + when + '.';
  }
  var text = 'Dear ' + first + ',\n\n' + what + '\n\n' +
    'Your attendance in this course:\n' + summaryLines_(t, cfg) + '\n\n' +
    standingSentence_(t, cfg) + '\n\n' +
    medicalExcuseText_(cfg) + '\n\n' +
    'Remember: if you check in and then leave before class ends, you will be marked absent.\n\n' +
    'Best regards,\n' + signature_(cfg);
  return {
    subject: 'Attendance notice – ' + classLabel(cls) + ' – ' + subjectWord + ' on ' + longDate(p.date),
    text: text,
    html: textToHtml_(text)
  };
}

/** To the office when a student checks in without their ID more than the allowed times. */
function buildNoIdNotice(p) {
  var cfg = p.cfg || {}, s = p.student, cls = p.cls;
  var text = 'Hello,\n\n' + s.name + (s.id ? ' (ID ' + s.id + ')' : '') + ' came to ' + classLabel(cls) + ' on ' +
    longDate(p.date) + ', ' + classTime(cls) + ' without their student ID. Attendance was recorded manually.\n\n' +
    'This is time number ' + p.count + ' this term (the limit is ' + rulesConfig_(cfg).noIdLimit + ').\n\n' +
    'Dates without ID: ' + p.dates.join(', ') + '\n\n' +
    'Thank you,\n' + signature_(cfg);
  return { subject: 'Student without ID – ' + s.name + ' – ' + classLabel(cls), text: text, html: textToHtml_(text) };
}

/** Reminder to the students of a class about an assignment. */
function buildAssignmentReminder(p) {
  var cfg = p.cfg || {}, a = p.assignment, cls = p.cls;
  var whenLeft = p.daysLeft === 0 ? 'today' : p.daysLeft === 1 ? 'tomorrow' : 'in ' + p.daysLeft + ' days';
  var text = 'Hello everyone,\n\nThis is a reminder that "' + a.title + '" for ' + classLabel(cls) + ' is due ' + whenLeft +
    ' (' + longDate(a.due) + ').' + (a.notes ? '\n\n' + a.notes : '') +
    '\n\nIf you have questions, reply to this email.\n\nBest regards,\n' + signature_(cfg);
  return { subject: 'Reminder: ' + a.title + ' – due ' + longDate(a.due), text: text, html: textToHtml_(text) };
}

/**
 * Friday report.
 * p: {classes:[cls], students:[{id,name,email,classId}], records:[{classId,studentId,date,status,excuse,excuseDate,name}],
 *     weekStart, weekEnd, today, cfg}
 */
function buildWeeklyReport(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg);
  var totals = tally(p.records, cfg);
  var html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">',
    '<h2 style="margin:0 0 4px">Weekly attendance report</h2>',
    '<p style="margin:0 0 16px;color:#555">Week of ' + esc_(longDate(p.weekStart)) + ' – ' + esc_(longDate(p.weekEnd)) +
    (p.week ? ' · Week ' + p.week + ' of ' + c.totalSessions : '') + '</p>'];
  var text = ['WEEKLY ATTENDANCE REPORT', 'Week of ' + longDate(p.weekStart) + ' – ' + longDate(p.weekEnd), ''];
  var th = 'style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;background:#f4f4f4"';
  var td = 'style="padding:4px 8px;border-bottom:1px solid #eee"';
  var counts = { missed: 0, risk: 0 };

  p.classes.forEach(function (cls) {
    var roster = p.students.filter(function (s) { return s.classId === cls.id; });
    var nameOf = {};
    roster.forEach(function (s) { nameOf[s.id] = s.name; });
    var week = p.records.filter(function (r) {
      return r.classId === cls.id && r.date >= p.weekStart && r.date <= p.weekEnd &&
        /^(absent|tardy)$/i.test(r.status) && !/^accepted$/i.test(r.excuse || '');
    });
    var risk = roster.map(function (s) {
      return { s: s, t: totals[cls.id + '|' + s.id] || emptyTally(cfg) };
    }).filter(function (x) { return x.t.state !== 'ok'; })
      .sort(function (a, b) { return b.t.effective - a.t.effective || a.s.name.localeCompare(b.s.name); });
    var pending = p.records.filter(function (r) { return r.classId === cls.id && /^received$/i.test(r.excuse || ''); });
    counts.missed += week.filter(function (r) { return /^absent$/i.test(r.status); }).length;
    counts.risk += risk.filter(function (x) { return x.t.state === 'failing'; }).length;

    html.push('<h3 style="margin:20px 0 4px">' + esc_(classLabel(cls)) + '</h3>',
      '<p style="margin:0 0 8px;color:#555">' + esc_(DAY_NAMES[dayIndex(cls.day)] || cls.day) + ' ' + esc_(classTime(cls)) +
      ' · ' + esc_(cls.mode || '') + (cls.professor ? ' · Prof. ' + esc_(cls.professor) : '') + ' · ' + roster.length + ' students</p>');
    text.push('== ' + classLabel(cls) + ' — ' + (DAY_NAMES[dayIndex(cls.day)] || cls.day) + ' ' + classTime(cls) + ' ==');

    html.push('<p style="margin:8px 0 4px"><b>Absent or tardy this week</b></p>');
    text.push('Absent or tardy this week:');
    if (!week.length) { html.push('<p style="margin:0;color:#2e7d32">Nobody. Full attendance.</p>'); text.push('  Nobody.'); }
    else {
      html.push('<table style="border-collapse:collapse;font-size:13px"><tr><th ' + th + '>Student</th><th ' + th + '>Date</th><th ' + th + '>Status</th><th ' + th + '>Excuse</th></tr>');
      week.sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (r) {
        var nm = nameOf[r.studentId] || r.name || r.studentId;
        html.push('<tr><td ' + td + '>' + esc_(nm) + '</td><td ' + td + '>' + esc_(r.date) + '</td><td ' + td + '>' + esc_(r.status) + (r.leftEarly ? ' (left early)' : '') + '</td><td ' + td + '>' + esc_(r.excuse || '') + '</td></tr>');
        text.push('  ' + nm + ' — ' + r.date + ' — ' + r.status + (r.excuse ? ' (excuse: ' + r.excuse + ')' : ''));
      });
      html.push('</table>');
    }

    html.push('<p style="margin:12px 0 4px"><b>Losing the course or at risk</b></p>');
    text.push('Losing the course or at risk:');
    if (!risk.length) { html.push('<p style="margin:0;color:#2e7d32">Everyone is on track.</p>'); text.push('  Everyone is on track.'); }
    else {
      html.push('<table style="border-collapse:collapse;font-size:13px"><tr><th ' + th + '>Student</th><th ' + th + '>Absences</th><th ' + th + '>Tardies</th><th ' + th + '>Counted absences</th><th ' + th + '>Left</th><th ' + th + '>Attendance</th><th ' + th + '>Status</th></tr>');
      risk.forEach(function (x) {
        var color = x.t.state === 'failing' ? '#c62828' : x.t.state === 'at-limit' ? '#e65100' : '#8d6e00';
        html.push('<tr><td ' + td + '>' + esc_(x.s.name) + '</td><td ' + td + '>' + x.t.absences + '</td><td ' + td + '>' + x.t.tardies +
          '</td><td ' + td + '>' + x.t.effective + '</td><td ' + td + '>' + Math.max(0, x.t.remaining) + '</td><td ' + td + '>' + x.t.pct +
          '%</td><td ' + td + '><b style="color:' + color + '">' + esc_(STATE_LABEL[x.t.state]) + '</b></td></tr>');
        text.push('  ' + x.s.name + ' — ' + x.t.effective + ' counted absences (' + x.t.absences + ' A, ' + x.t.tardies + ' T), ' + x.t.pct + '% — ' + STATE_LABEL[x.t.state]);
      });
      html.push('</table>');
    }

    if (pending.length) {
      html.push('<p style="margin:12px 0 4px"><b>Medical excuses waiting for the office</b></p><ul style="margin:0 0 0 18px;padding:0">');
      text.push('Medical excuses waiting for the office:');
      pending.forEach(function (r) {
        var nm = nameOf[r.studentId] || r.name || r.studentId;
        var late = r.excuseDate && p.today && dayNum(p.today) - dayNum(r.excuseDate) > c.excuseReviewDays;
        html.push('<li>' + esc_(nm) + ' — class of ' + esc_(r.date) + (r.excuseDate ? ', received ' + esc_(r.excuseDate) : '') +
          (late ? ' <b style="color:#c62828">(more than ' + c.excuseReviewDays + ' days)</b>' : '') + '</li>');
        text.push('  ' + nm + ' — class of ' + r.date + (r.excuseDate ? ', received ' + r.excuseDate : '') + (late ? ' (OVERDUE)' : ''));
      });
      html.push('</ul>');
    }
    text.push('');
  });
  html.push('</div>');
  return {
    subject: 'Weekly attendance report – ' + longDate(p.weekStart).replace(/^\w+, /, '') + ' – ' + counts.missed + ' absences, ' + counts.risk + ' losing the course',
    text: text.join('\n'),
    html: html.join('')
  };
}

/* ===== Code.js ===== */

/**
 * Google Apps Script glue: the spreadsheet, the Drive inbox, Gmail and the time triggers.
 * The rules live in Rules.js, file reading in Parsers.js and email texts in Messages.js.
 */

var SHEETS = {
  Config: ['Setting', 'Value', 'Notes'],
  Classes: ['Class ID', 'Course', 'Section', 'Professor', 'Professor email', 'Day', 'Start', 'End', 'Mode', 'Zoom meeting ID', 'Active'],
  Students: ['Student ID', 'Name', 'Email', 'Class ID', 'Active', 'Order', 'Zoom names'],
  Attendance: ['Date', 'Class ID', 'Student ID', 'Name', 'Status', 'Minutes late', 'Source', 'No ID', 'Left early',
    'Excuse', 'Excuse date', 'Notified', 'Office notified', 'Notes', 'Updated'],
  Assignments: ['Class ID', 'Title', 'Due date', 'Remind days before', 'Notes', 'Reminded'],
  Summary: ['Class ID', 'Course', 'Student ID', 'Name', 'Email', 'Absences', 'Tardies', 'Excused', 'Counted absences',
    'Absences left', 'Attendance %', 'Status'],
  'Follow-ups': ['Created', 'Type', 'Class', 'Class date', 'Roster #', 'Students', 'Count', 'Subject', 'Message',
    'Visibility (check in Populi)', 'Done'],
  Sessions: ['Class ID', 'Date', 'Scheduled start', 'Actual start', 'Source', 'Source ID', 'Processed with start',
    'Open questions', 'Updated'],
  Review: ['Created', 'Class ID', 'Date', 'Name seen', 'Seen in', 'Suggestions', 'Student (# or name, or "ignore")', 'Done', 'Notes'],
  Outbox: ['Time', 'Type', 'To', 'Subject', 'Mode', 'Body'],
  'Inbox log': ['Time', 'File', 'Kind', 'Class', 'Dates', 'Result']
};

// [key, label in the Config sheet, default, note]
var CONFIG_FIELDS = [
  ['taName', 'TA name', 'Diego Gomez', 'Signature of every email.'],
  ['taTitle', 'TA title', 'Teacher Assistant', ''],
  ['replyTo', 'Reply-To email', 'dgomez230@ivy.edu', 'Every email goes out with this Reply-To.'],
  ['officeName', 'Office name', 'the main office', 'How emails refer to the office ("send your excuse to me or to ...").'],
  ['officeEmail', 'Office email', '', 'Gets the "student without ID" notices. Empty → they go to the Reply-To email.'],
  ['reportTo', 'Weekly report to', 'dgomez230@ivy.edu', 'Who gets the Friday report (comma-separated).'],
  ['emailMode', 'Email mode', 'POPULI', 'POPULI = write each email in Follow-ups to send from Populi (students with the same numbers share one email) · DRAFT = Gmail drafts · SEND = send from Gmail · LOG = only Outbox.'],
  ['populiVisibility', 'Populi visibility', 'Academic Admin, Account Admin, Admissions Admin, Staff, Academic Auditor, Admissions', 'Boxes to check under Visibility when you send a follow-up from Populi.'],
  ['bcc', 'BCC on student notices', '', 'Optional, e.g. the office, so they keep a copy.'],
  ['noticesFrom', 'Send notices from', '', 'Absences before this date are not emailed (so importing old weeks does not spam students).'],
  ['ignoreNames', 'Ignore in screenshots', 'Diego Gomez; Professor', 'Names that are not students (you, the professors), separated by ";".'],
  ['markMissing', 'Mark students missing from a file absent', 'Yes', 'Zoom report or Populi list of check-ins: whoever is not in it is Absent.'],
  ['termStart', 'Term start', '2026-10-05', 'First day of week 1 (yyyy-mm-dd). Used for "Week N" in the report.'],
  ['inboxFolderId', 'Inbox folder ID', '', 'Drive folder where you drop Populi exports and Zoom reports. Set up creates it.'],
  ['reportHour', 'Weekly report hour (Friday)', 8, '0–23, script time zone.'],
  ['reminderHour', 'Assignment reminder hour', 7, '0–23, every day.'],
  ['totalSessions', 'Course weeks', 10, 'Each absence is 100 / weeks percent.'],
  ['maxAbsences', 'Max absences', 2, ''],
  ['minAttendancePct', 'Minimum attendance %', 80, ''],
  ['presentUntilMin', 'Present until minute', 15, ''],
  ['tardyUntilMin', 'Tardy until minute', 30, 'After this minute → Absent.'],
  ['tardiesPerAbsence', 'Tardies per absence', 3, ''],
  ['noIdLimit', 'Times without ID before notifying the office', 2, ''],
  ['earlyLeaveGraceMin', 'Zoom: minutes of grace at the end', 5, 'Leaving earlier than this before the end → Absent.'],
  ['excuseReviewDays', 'Days for the office to verify an excuse', 7, '']
];

var NUMERIC_KEYS = ['reportHour', 'reminderHour', 'totalSessions', 'maxAbsences', 'minAttendancePct', 'presentUntilMin',
  'tardyUntilMin', 'tardiesPerAbsence', 'noIdLimit', 'earlyLeaveGraceMin', 'excuseReviewDays'];

var DEFAULT_CLASSES = [
  ['C1', 'HA 103: History of World Religions', '', '', '', 'Monday', '9:00 AM', '1:00 PM', 'In person (Vienna, Room 300)', '', 'Yes'],
  ['C2', 'OT 215: Minor Prophets', '', '', '', 'Monday', '1:30 PM', '5:30 PM', 'In person (Vienna, Room 304)', '', 'Yes'],
  ['C3', 'HA 105: Introduction to Ethics', '', '', '', 'Monday', '6:00 PM', '10:00 PM', 'Zoom', '', 'Yes'],
  ['C4', 'SB 100: Introduction to Business', '', '', '', 'Thursday', '9:00 AM', '1:00 PM', 'Zoom', '', 'Yes']
];

var TRIGGER_HANDLERS = ['tick', 'weeklyReport', 'assignmentReminders'];

/* ---------- menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('TA Attendance')
    .addItem('Open dashboard', 'openDashboard')
    .addItem('Process inbox + send notices now', 'tick')
    .addItem('Send weekly report now', 'weeklyReport')
    .addItem('Send assignment reminders now', 'assignmentReminders')
    .addSeparator()
    .addItem('Open the Drive inbox folder', 'showInbox')
    .addItem('Set up / repair sheets', 'setup')
    .addItem('Turn on automations', 'installTriggers')
    .addToUi();
}

/** Typing in Status / Left early / No ID marks the row as yours, so imports never overwrite it. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Attendance' || e.range.getRow() < 2) return;
  var h = SHEETS.Attendance, col = e.range.getColumn();
  var watched = ['Status', 'Left early', 'No ID'].map(function (n) { return h.indexOf(n) + 1; });
  if (watched.indexOf(col) < 0) return;
  sh.getRange(e.range.getRow(), h.indexOf('Source') + 1).setValue('Manual');
  sh.getRange(e.range.getRow(), h.indexOf('Updated') + 1).setValue(nowStr_());
}

/* ---------- setup ---------- */

function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var want = SHEETS[name];
    var have = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0] : [];
    if (!have.filter(String).length) have = [];
    var header = have.slice();
    want.forEach(function (h) { if (header.indexOf(h) < 0) header.push(h); });
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // plain text: no surprise date/time conversions
  });

  // Config rows
  var cfgSheet = ss.getSheetByName('Config');
  var rows = cfgSheet.getDataRange().getDisplayValues();
  var labels = rows.map(function (r) { return r[0]; });
  CONFIG_FIELDS.forEach(function (f) {
    if (labels.indexOf(f[1]) >= 0) return;
    // Notices start with the term (week 1), so the first classes are followed up too.
    var def = f[0] === 'noticesFrom' ? (CONFIG_FIELDS.filter(function (x) { return x[0] === 'termStart'; })[0][2] || today_()) : f[2];
    cfgSheet.appendRow([f[1], String(def), f[3]]);
  });
  setValidation_(cfgSheet, CONFIG_FIELDS.map(function (f) { return f[1]; }).indexOf('Email mode') + 2, 2, ['POPULI', 'DRAFT', 'SEND', 'LOG']);
  setValidation_(ss.getSheetByName('Follow-ups'), 2, SHEETS['Follow-ups'].indexOf('Done') + 1, ['Yes', ''], 2000);

  var classes = ss.getSheetByName('Classes');
  if (classes.getLastRow() < 2) classes.getRange(2, 1, DEFAULT_CLASSES.length, DEFAULT_CLASSES[0].length).setValues(DEFAULT_CLASSES);

  var att = ss.getSheetByName('Attendance'), A = SHEETS.Attendance;
  setValidation_(att, 2, A.indexOf('Status') + 1, ['Present', 'Tardy', 'Absent', 'Excused'], 2000);
  setValidation_(att, 2, A.indexOf('No ID') + 1, ['Yes', ''], 2000);
  setValidation_(att, 2, A.indexOf('Left early') + 1, ['Yes', ''], 2000);
  setValidation_(att, 2, A.indexOf('Excuse') + 1, ['Received', 'Accepted', 'Rejected'], 2000);

  // Drive inbox
  var cfg = config_();
  var folder = null;
  try { if (cfg.inboxFolderId) folder = DriveApp.getFolderById(cfg.inboxFolderId); } catch (err) { folder = null; }
  if (!folder) {
    folder = DriveApp.createFolder('TA Inbox');
    setConfig_('inboxFolderId', folder.getId());
  }
  subfolder_(folder, 'Processed');
  subfolder_(folder, 'Needs attention');
  toast_('Ready. Fill in Classes and Config, then use "Turn on automations".');
}

function setValidation_(sh, row, col, list, n) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  sh.getRange(row, col, n || 1, 1).setDataValidation(rule);
}

function installTriggers() {
  var cfg = config_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('weeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(cfg.reportHour).create();
  ScriptApp.newTrigger('assignmentReminders').timeBased().everyDays(1).atHour(cfg.reminderHour).create();
  toast_('Automations on: inbox + notices every 15 min, report Fridays at ' + cfg.reportHour + ':00, reminders daily at ' + cfg.reminderHour + ':00.');
}

function showInbox() {
  var cfg = config_();
  if (!cfg.inboxFolderId) { toast_('Run "Set up / repair sheets" first.'); return; }
  var url = DriveApp.getFolderById(cfg.inboxFolderId).getUrl();
  var html = HtmlService.createHtmlOutput('<p style="font-family:Arial">Drop Populi exports and Zoom participant reports here:</p>' +
    '<p style="font-family:Arial"><a href="' + url + '" target="_blank">Open TA Inbox</a></p>').setWidth(320).setHeight(120);
  SpreadsheetApp.getUi().showModalDialog(html, 'TA Inbox');
}

/* ---------- main jobs ---------- */

/** Every 15 minutes: read new files, apply manual flags, email notices, refresh the summary. */
function tick() {
  withLock_(function () {
    var r = runAll_(load_());
    if (r.files || r.sent || r.office) {
      toast_((r.files ? r.files + ' file(s) processed. ' : '') + r.sent + ' student notice(s), ' + r.office + ' office notice(s).');
    }
  });
}

/** Everything the 15-minute job does, on an already loaded context. */
function runAll_(ctx) {
  var log = processInbox_(ctx);
  var reruns = rerunSessions_(ctx, answerQuestions_(ctx));
  applyManualFlags_(ctx);
  save_(ctx.att);
  save_(ctx.studentsT);
  save_(ctx.sessT);
  save_(ctx.revT);
  var sent = sendPendingNotices_(ctx);
  var office = checkNoId_(ctx);
  save_(ctx.att);
  refreshSummary_(ctx);
  refreshGrids_(ctx);
  return { files: log.length, reruns: reruns, sent: sent, office: office, log: log };
}

function weeklyReport() {
  withLock_(function () {
    var ctx = load_(), today = today_(), wb = weekBounds(today);
    var r = buildWeeklyReport({
      classes: ctx.classes.filter(function (c) { return c.active; }),
      students: ctx.students.filter(function (s) { return s.active; }),
      records: records_(ctx),
      weekStart: wb.start, weekEnd: wb.end, today: today,
      week: termWeek(today, ctx.cfg.termStart),
      cfg: ctx.cfg
    });
    deliver_(ctx, 'Weekly report', ctx.cfg.reportTo || ctx.cfg.replyTo, r, { send: true });
    refreshSummary_(ctx);
    refreshGrids_(ctx);
  });
}

function assignmentReminders() {
  withLock_(function () {
    var ctx = load_(), t = table_('Assignments');
    var list = t.rows.map(function (r, i) {
      return { i: i, classId: t.get(r, 'Class ID'), title: t.get(r, 'Title'), due: parseDateCell(t.get(r, 'Due date'), yearOf_(ctx)),
        remindDays: t.get(r, 'Remind days before'), notes: t.get(r, 'Notes'), reminded: t.get(r, 'Reminded') };
    });
    dueReminders(list, today_()).forEach(function (d) {
      var a = d.assignment, cls = classById_(ctx, a.classId);
      if (!cls) return;
      var emails = ctx.students.filter(function (s) { return s.active && s.classId === cls.id && s.email; })
        .map(function (s) { return s.email; });
      var populi = mode_(ctx.cfg) === 'POPULI';
      if (!emails.length && !populi) return;
      var msg = buildAssignmentReminder({ assignment: a, cls: cls, daysLeft: d.daysLeft, cfg: ctx.cfg });
      deliver_(ctx, 'Assignment reminder', ctx.cfg.replyTo, msg, populi
        ? { cls: cls, date: a.due, audience: 'Whole class (Roster → Actions → Email this section)' }
        : { bcc: emails.join(',') });
      var row = t.rows[a.i];
      t.set(row, 'Reminded', (a.reminded ? a.reminded + ',' : '') + d.reminderKey);
    });
    save_(t);
  });
}

/* ---------- inbox ---------- */

function processInbox_(ctx) {
  var log = [];
  if (!ctx.cfg.inboxFolderId) return log;
  var folder = DriveApp.getFolderById(ctx.cfg.inboxFolderId);
  var done = subfolder_(folder, 'Processed'), bad = subfolder_(folder, 'Needs attention');
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next(), name = file.getName(), res;
    try {
      res = handleFile_(ctx, name, rowsFromFile_(file), file.getDateCreated(), file.getId());
      file.moveTo(res.ok ? done : bad);
    } catch (err) {
      res = { ok: false, kind: '?', cls: '', dates: '', msg: 'Error: ' + (err && err.message || err) };
      file.moveTo(bad);
    }
    appendRow_('Inbox log', [nowStr_(), name, res.kind, res.cls, res.dates, res.msg]);
    log.push(res);
  }
  // A folder = one Zoom class: subfolders "1. Present" / "2. Tardy" / "3. Absent" with the screenshots.
  var folders = folder.getFolders();
  while (folders.hasNext()) {
    var sub = folders.next(), fname = sub.getName(), fres;
    if (fname === 'Processed' || fname === 'Needs attention') continue;
    try {
      fres = handleScreenshotFolder_(ctx, sub);
    } catch (err) {
      fres = { ok: false, kind: 'screenshots', cls: '', dates: '', msg: 'Error: ' + (err && err.message || err) };
    }
    if (fres.wait) continue; // still uploading
    sub.moveTo(fres.ok ? done : bad);
    appendRow_('Inbox log', [nowStr_(), fname + '/', fres.kind, fres.cls, fres.dates, fres.msg]);
    log.push(fres);
  }
  return log;
}

/**
 * Zoom screenshots → attendance, with Google Drive's free OCR (no AI).
 * Folder name gives the class (course code like "HA 105" or [C3]) and the date ("10.05.26").
 */
function handleScreenshotFolder_(ctx, folder) {
  var name = folder.getName(), phases = { present: [], tardy: [], end: [] }, todo = [], newest = 0;
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sf = subs.next(), ph = screenshotPhase(sf.getName());
    if (!ph) continue;
    var files = sf.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (!/^image\//.test(f.getMimeType())) continue;
      todo.push({ phase: ph, file: f });
      newest = Math.max(newest, f.getDateCreated().getTime());
    }
  }
  if (!todo.length) {
    if (Date.now() - folder.getDateCreated().getTime() < 30 * 60000) return { wait: true };
    return { ok: false, kind: 'screenshots', cls: '', dates: '', msg: 'No screenshots found. Use subfolders "1. Present", "2. Tardy", "3. Absent".' };
  }
  if (Date.now() - newest < 2 * 60000) return { wait: true }; // give the upload a moment to finish (before any OCR)
  var pick = pickClass({ fileName: name }, ctx.classes, rosterByClass_(ctx), []);
  if (!pick.cls) return { ok: false, kind: 'screenshots', cls: '', dates: '', msg: 'Could not tell the class. Put the course code (HA 105) or [C3] in the folder name.' };
  var date = dateFromName_(name);
  if (!date) return { ok: false, kind: 'screenshots', cls: pick.cls.id, dates: '', msg: 'No date in the folder name (e.g. "HA 105 - 10.05.26").' };
  var hint = startFromName_(name, pick.cls);
  if (hint != null) setSessionStart_(ctx, pick.cls, date, hint, false);
  todo.sort(function (a, b) { return a.file.getName() < b.file.getName() ? -1 : 1; })
    .forEach(function (x) { phases[x.phase].push(ocrText_(x.file)); });
  // Keep the text so a new start time or Diego's answers can re-run this class without reading the images again.
  folder.createFile('ocr.json', JSON.stringify({ images: todo.length, phases: phases }), 'application/json');
  var msg = processScreenshotSession_(ctx, pick.cls, date, phases, folder.getId(), todo.length);
  return { ok: true, kind: 'screenshots', cls: pick.cls.id, dates: date, msg: msg };
}

/** Screenshot text of one class → attendance rows, questions for Diego in Review, and the Sessions row. */
function processScreenshotSession_(ctx, cls, date, phases, folderId, images) {
  var start = sessionStart_(ctx, cls, date);
  var roster = roster_(ctx, cls.id);
  var res = screenshotStatuses(phases, roster, String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String),
    { start: start, cfg: ctx.cfg });
  var entries = res.results.map(function (x) {
    return { student: x.student, status: x.status, leftEarly: x.leftEarly, source: 'Zoom screenshots', notes: x.note };
  });
  if (yes_(ctx.cfg.markMissing)) {
    res.notSeen.forEach(function (s) {
      entries.push({ student: s, status: STATUS.A, source: 'Zoom screenshots (not seen)', notes: 'Not in any screenshot' });
    });
  }
  var c = applyEntries_(ctx, cls, date, entries);
  var asked = addQuestions_(ctx, cls, date, res.review);
  touchSession_(ctx, cls, date, 'Zoom screenshots', folderId, start);
  var p = res.results.filter(function (x) { return x.status === STATUS.P; }).length;
  var t = res.results.filter(function (x) { return x.status === STATUS.T; }).length;
  var gone = res.results.filter(function (x) { return x.leftEarly; }).length;
  var msg = images + ' screenshot(s), start ' + minToLabel(start) + ': ' + p + ' present, ' + t + ' tardy, ' + (roster.length - p - t) +
    ' absent of ' + roster.length + ' (' + gone + ' disconnected before the last screenshot). ' + c.kept + ' kept (manual/excused).';
  if (asked) msg += ' ' + asked + ' name(s) to confirm in Review; notices for this class wait until you answer.';
  return msg;
}

/** Text in an image, using Google Drive's OCR (Advanced Drive service). The temporary Doc is deleted. */
function ocrText_(file) {
  var blob = file.getBlob(), doc;
  if (Drive.Files.create) {
    doc = Drive.Files.create({ name: 'ocr-' + file.getName(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'en' });
  } else {
    doc = Drive.Files.insert({ title: 'ocr-' + file.getName(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocr: true, ocrLanguage: 'en' });
  }
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    DriveApp.getFileById(doc.id).setTrashed(true);
  }
}

function rowsFromFile_(file) {
  var mime = file.getMimeType(), name = file.getName();
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    return SpreadsheetApp.openById(file.getId()).getSheets()[0].getDataRange().getDisplayValues();
  }
  if (/\.(csv|txt|tsv)$/i.test(name) || /^text\//.test(mime)) return parseCSV(file.getBlob().getDataAsString());
  throw new Error('Unsupported file type. Export it as CSV (or save it as a Google Sheet).');
}

/**
 * One file → attendance rows. Returns {ok, kind, cls, dates, msg}.
 */
function handleFile_(ctx, fileName, rows, created, fileId) {
  var kind = detectKind(rows), cfg = ctx.cfg;
  if (kind === 'zoom') {
    var z = parseZoom(rows);
    var people = z.participants.map(function (p) { return { name: p.name, email: p.email }; });
    var pick = pickClass({ fileName: fileName, topic: z.topic, meetingId: z.meetingId }, ctx.classes, rosterByClass_(ctx), people);
    if (!pick.cls) return { ok: false, kind: kind, cls: '', dates: '', msg: 'Could not tell the class (' + pick.how + '). Add [C3] (the Class ID) to the file name.' };
    var date = z.date || dateFromName_(fileName) || fmtDate_(created);
    var roster = roster_(ctx, pick.cls.id);
    var zstart = sessionStart_(ctx, pick.cls, date);
    var res = zoomStatuses(z, roster, { start: zstart, end: pick.cls.end }, cfg);
    var entries = res.results.map(function (x) {
      return { student: x.student, status: x.status, minutesLate: x.minutesLate, leftEarly: x.leftEarly, source: 'Zoom',
        notes: 'Zoom ' + minToLabel(x.join) + '–' + minToLabel(x.leave) + (x.names.length ? ' as "' + x.names.join('", "') + '"' : '') };
    });
    if (yes_(cfg.markMissing)) {
      res.notSeen.forEach(function (s) { entries.push({ student: s, status: STATUS.A, source: 'Zoom (not in report)' }); });
    }
    var c = applyEntries_(ctx, pick.cls, date, entries);
    touchSession_(ctx, pick.cls, date, 'Zoom report', fileId, zstart);
    var msg = c.added + ' added, ' + c.updated + ' updated, ' + c.kept + ' kept (manual/excused). Class by ' + pick.how + '.';
    if (res.unmatched.length) msg += ' Names not on the roster: ' + res.unmatched.join('; ') + '.';
    return { ok: true, kind: kind, cls: pick.cls.id, dates: date, msg: msg };
  }

  var p = parsePopuli(rows, yearOf_(ctx));
  if (!p.records.length) {
    var roster = parseRoster(rows);
    if (!roster.length) return { ok: false, kind: kind, cls: '', dates: '', msg: 'No students or attendance found. Is this a Populi export?' };
    var rk = pickClass({ fileName: fileName, course: p.course }, ctx.classes, rosterByClass_(ctx), roster);
    if (!rk.cls) return { ok: false, kind: 'roster', cls: '', dates: '', msg: 'Roster file: could not tell the class (' + rk.how + '). Add [C1] (the Class ID) to the file name.' };
    var rr = importRoster_(ctx, rk.cls, roster);
    return { ok: true, kind: 'roster', cls: rk.cls.id, dates: '',
      msg: 'Roster in Populi order: ' + rr.total + ' students (' + rr.added + ' new, ' + rr.inactive + ' inactive). Class by ' + rk.how + '.' };
  }
  var source = /screenshot/i.test(fileName) ? 'Zoom screenshots' : 'Populi';
  var pp = p.records.map(function (r) { return { name: r.name, id: r.id, email: r.email }; });
  var pk = pickClass({ fileName: fileName, course: p.course }, ctx.classes, rosterByClass_(ctx), pp);
  if (!pk.cls) return { ok: false, kind: kind, cls: '', dates: '', msg: 'Could not tell the class (' + pk.how + '). Add [C1] (the Class ID) to the file name.' };
  var cls = pk.cls;
  // When the class is certain (tag, course name), students not on the roster yet are added from the file.
  var added = 0;
  if (!/roster/.test(pk.how)) added = addToRoster_(ctx, cls, p.records);
  var rosterNow = roster_(ctx, cls.id), byDate = {}, unknown = [];
  p.records.forEach(function (r) {
    var s = matchStudent({ id: r.id, email: r.email, name: r.name }, rosterNow);
    if (!s) { if (unknown.indexOf(r.name || r.id) < 0) unknown.push(r.name || r.id); return; }
    var st0 = sessionStart_(ctx, cls, r.date);
    var st = r.status, late = r.time != null ? Math.max(0, Math.floor(r.time - st0)) : '';
    // Populi gives the scan time: our 15 / 30 minute rule (from the real start) decides Present vs Tardy vs Absent.
    if (r.time != null && st !== STATUS.A && st !== STATUS.E) st = classify(r.time - st0, cfg);
    (byDate[r.date] || (byDate[r.date] = [])).push({ student: s, status: st, minutesLate: late, source: source });
  });
  var tot = { added: 0, updated: 0, kept: 0 }, dates = Object.keys(byDate).sort();
  dates.forEach(function (d) {
    var entries = byDate[d];
    if (p.shape === 'long' && yes_(cfg.markMissing)) {
      var have = {};
      entries.forEach(function (e) { have[e.student.id] = true; });
      rosterNow.forEach(function (s) { if (!have[s.id]) entries.push({ student: s, status: STATUS.A, source: source + ' (not in file)' }); });
    }
    var c2 = applyEntries_(ctx, cls, d, entries);
    touchSession_(ctx, cls, d, source, fileId, sessionStart_(ctx, cls, d));
    tot.added += c2.added; tot.updated += c2.updated; tot.kept += c2.kept;
  });
  var m = tot.added + ' added, ' + tot.updated + ' updated, ' + tot.kept + ' kept (manual/excused). Class by ' + pk.how + '.';
  if (added) m += ' ' + added + ' new student(s) added to the roster.';
  if (unknown.length) m += ' Not on the roster: ' + unknown.join('; ') + '.';
  if (p.skipped) m += ' ' + p.skipped + ' cell(s) not understood.';
  return { ok: true, kind: kind, cls: cls.id, dates: dates.join(', '), msg: m };
}

function addToRoster_(ctx, cls, people) {
  var t = ctx.studentsT, n = 0;
  people.forEach(function (p) {
    var roster = roster_(ctx, cls.id);
    if (matchStudent({ id: p.id, email: p.email, name: p.name }, roster)) return;
    if (!p.name && !p.id) return;
    var row = blankRow_(t);
    t.set(row, 'Student ID', p.id || p.email || p.name);
    t.set(row, 'Name', p.name || p.id);
    t.set(row, 'Email', p.email || '');
    t.set(row, 'Class ID', cls.id);
    t.set(row, 'Active', 'Yes');
    t.set(row, 'Order', String(nextOrder_(ctx, cls.id)));
    t.rows.push(row);
    ctx.students.push(studentFrom_(t, row));
    n++;
  });
  return n;
}

function nextOrder_(ctx, classId) {
  return ctx.students.filter(function (s) { return s.classId === classId; })
    .reduce(function (m, s) { return Math.max(m, s.order || 0); }, 0) + 1;
}

/**
 * Populi roster export → Students for that class, numbered in Populi's order (the order of the participation
 * checkboxes). Students no longer in the export are set inactive; their attendance stays.
 */
function importRoster_(ctx, cls, people) {
  var t = ctx.studentsT, out = { total: people.length, added: 0, inactive: 0 }, seen = {};
  var mine = ctx.students.filter(function (s) { return s.classId === cls.id; });
  people.forEach(function (p, i) {
    var s = matchStudent({ id: p.id, email: p.email, name: p.name }, mine), row;
    if (s) row = t.rows[s.row];
    else {
      row = blankRow_(t);
      t.rows.push(row);
      t.set(row, 'Student ID', p.id || p.email || p.name);
      t.set(row, 'Class ID', cls.id);
      out.added++;
    }
    if (p.name) t.set(row, 'Name', p.name);
    if (p.email) t.set(row, 'Email', p.email);
    t.set(row, 'Active', p.active ? 'Yes' : 'No');
    if (!p.active) out.inactive++;
    t.set(row, 'Order', String(i + 1));
    seen[t.get(row, 'Student ID')] = true;
  });
  t.rows.forEach(function (r) {
    if (t.get(r, 'Class ID') === cls.id && !seen[t.get(r, 'Student ID')] && t.get(r, 'Active') !== 'No') {
      t.set(r, 'Active', 'No');
      out.inactive++;
    }
  });
  ctx.students = studentsFrom_(t);
  return out;
}

/** Upsert attendance rows for one class and date. Manual rows and excused absences are never overwritten. */
function applyEntries_(ctx, cls, date, entries) {
  var t = ctx.att, out = { added: 0, updated: 0, kept: 0 }, idx = {};
  t.rows.forEach(function (r, i) {
    idx[parseDateCell(t.get(r, 'Date'), yearOf_(ctx)) + '|' + t.get(r, 'Class ID') + '|' + t.get(r, 'Student ID')] = i;
  });
  entries.forEach(function (e) {
    var key = date + '|' + cls.id + '|' + e.student.id, row;
    if (key in idx) {
      row = t.rows[idx[key]];
      if (t.get(row, 'Source') === 'Manual' || normalizeStatus(t.get(row, 'Status')) === STATUS.E ||
          /^accepted$/i.test(t.get(row, 'Excuse'))) { out.kept++; return; }
      if (t.get(row, 'Status') === e.status && String(t.get(row, 'Left early') === 'Yes') === String(!!e.leftEarly)) return;
      out.updated++;
    } else {
      row = blankRow_(t);
      t.rows.push(row);
      idx[key] = t.rows.length - 1;
      t.set(row, 'Date', date);
      t.set(row, 'Class ID', cls.id);
      t.set(row, 'Student ID', e.student.id);
      out.added++;
    }
    t.set(row, 'Name', e.student.name);
    t.set(row, 'Status', e.status);
    t.set(row, 'Minutes late', e.minutesLate === '' || e.minutesLate == null ? '' : String(e.minutesLate));
    t.set(row, 'Source', e.source);
    t.set(row, 'Left early', e.leftEarly ? 'Yes' : '');
    if (e.notes) t.set(row, 'Notes', e.notes);
    t.set(row, 'Updated', nowStr_());
  });
  return out;
}

/** "Left early = Yes" always means Absent. */
function applyManualFlags_(ctx) {
  var t = ctx.att;
  t.rows.forEach(function (r) {
    if (yes_(t.get(r, 'Left early')) && normalizeStatus(t.get(r, 'Status')) !== STATUS.A &&
        normalizeStatus(t.get(r, 'Status')) !== STATUS.E) {
      t.set(r, 'Status', STATUS.A);
      t.set(r, 'Updated', nowStr_());
    }
  });
}

/* ---------- emails ---------- */

function sendPendingNotices_(ctx) {
  var t = ctx.att, cfg = ctx.cfg, totals = tally(records_(ctx), cfg), y = yearOf_(ctx);
  var since = parseDateCell(cfg.noticesFrom, y), populi = mode_(cfg) === 'POPULI', pending = [];
  t.rows.forEach(function (r) {
    var st = normalizeStatus(t.get(r, 'Status'));
    if ((st !== STATUS.A && st !== STATUS.T) || /^accepted$/i.test(t.get(r, 'Excuse'))) return;
    var kind = st === STATUS.A && yes_(t.get(r, 'Left early')) ? 'LeftEarly' : st;
    if (t.get(r, 'Notified').indexOf(kind) === 0) return;
    var date = parseDateCell(t.get(r, 'Date'), y);
    if (since && date < since) { t.set(r, 'Notified', kind + ' · not sent (before ' + since + ')'); return; }
    if (openQuestions_(ctx, t.get(r, 'Class ID'), date)) return; // wait for Diego's answers in Review
    var cls = classById_(ctx, t.get(r, 'Class ID'));
    var s = ctx.students.filter(function (x) { return x.classId === t.get(r, 'Class ID') && x.id === t.get(r, 'Student ID'); })[0];
    // Gmail needs an address; Populi doesn't. Rows without one are tried again on the next run.
    if (!cls || !s || (!populi && !s.email)) return;
    pending.push({ row: r, kind: kind, date: date, cls: cls, student: s, tally: totals[cls.id + '|' + s.id] || emptyTally(cfg),
      minutesLate: +t.get(r, 'Minutes late') || 0 });
  });
  if (!populi) {
    pending.forEach(function (p) {
      var msg = buildStudentNotice({ kind: p.kind, student: p.student, cls: p.cls, date: p.date, cfg: cfg, tally: p.tally, minutesLate: p.minutesLate });
      var mode = deliver_(ctx, 'Student ' + p.kind, p.student.email, msg, { bcc: cfg.bcc });
      t.set(p.row, 'Notified', p.kind + ' · ' + nowStr_() + ' · ' + mode);
    });
    return pending.length;
  }
  // Populi: students of the same class, date and kind with the same numbers get one email ("Email selected students").
  var groups = {}, order = [];
  pending.forEach(function (p) {
    var x = p.tally;
    var key = [p.cls.id, p.date, p.kind, x.absences, x.tardies, x.excused, x.effective, x.remaining, x.pct, x.state].join('|');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(p);
  });
  order.forEach(function (key) {
    var g = groups[key], p = g[0];
    var msg = buildStudentNotice({ kind: p.kind, student: { name: '' }, cls: p.cls, date: p.date, cfg: cfg, tally: p.tally });
    deliver_(ctx, 'Student ' + p.kind, '', msg, { cls: p.cls, date: p.date, students: g.map(function (x) { return x.student; }) });
    g.forEach(function (x) { t.set(x.row, 'Notified', x.kind + ' · ' + nowStr_() + ' · POPULI'); });
  });
  return order.length;
}

/** A student without ID more than the allowed times → the office gets a notice for each extra time. */
function checkNoId_(ctx) {
  var t = ctx.att, cfg = rulesConfig_(ctx.cfg), groups = {}, sent = 0;
  t.rows.forEach(function (r) {
    if (!yes_(t.get(r, 'No ID'))) return;
    var key = t.get(r, 'Class ID') + '|' + t.get(r, 'Student ID');
    (groups[key] || (groups[key] = [])).push(r);
  });
  Object.keys(groups).forEach(function (key) {
    var rows = groups[key].sort(function (a, b) {
      return parseDateCell(t.get(a, 'Date'), yearOf_(ctx)).localeCompare(parseDateCell(t.get(b, 'Date'), yearOf_(ctx)));
    });
    var dates = rows.map(function (r) { return parseDateCell(t.get(r, 'Date'), yearOf_(ctx)); });
    rows.forEach(function (r, i) {
      if (i + 1 <= cfg.noIdLimit || t.get(r, 'Office notified')) return;
      var cls = classById_(ctx, t.get(r, 'Class ID'));
      var s = ctx.students.filter(function (x) { return x.classId === t.get(r, 'Class ID') && x.id === t.get(r, 'Student ID'); })[0] ||
        { id: t.get(r, 'Student ID'), name: t.get(r, 'Name') };
      if (!cls) return;
      var msg = buildNoIdNotice({ student: s, cls: cls, date: dates[i], count: i + 1, dates: dates.slice(0, i + 1), cfg: ctx.cfg });
      var mode = deliver_(ctx, 'Office: no ID', ctx.cfg.officeEmail || ctx.cfg.replyTo, msg,
        { cls: cls, date: dates[i], audience: 'Office: ' + (ctx.cfg.officeEmail || '(set Office email in Config)') });
      t.set(r, 'Office notified', nowStr_() + ' · ' + mode);
      sent++;
    });
  });
  return sent;
}

function mode_(cfg) {
  var m = String(cfg.emailMode || 'POPULI').trim().toUpperCase();
  return ['POPULI', 'DRAFT', 'SEND', 'LOG'].indexOf(m) >= 0 ? m : 'POPULI';
}

/**
 * Delivers one email and writes it to Outbox. Returns the mode used.
 * POPULI → a row in Follow-ups (who to select in the Populi roster, subject, message, visibility boxes).
 * DRAFT / SEND → Gmail with Reply-To. LOG → Outbox only.
 * opts: {send: true (the Friday report to yourself always goes by Gmail), bcc, cls, date, students, audience}
 */
function deliver_(ctx, type, to, msg, opts) {
  opts = opts || {};
  var cfg = ctx.cfg, mode = mode_(cfg);
  if (opts.send && (mode === 'DRAFT' || mode === 'POPULI')) mode = 'SEND';
  if (mode === 'POPULI') {
    var studs = (opts.students || []).slice().sort(function (a, b) { return (a.order || 1e6) - (b.order || 1e6); });
    var who = studs.length ? studs.map(function (s) { return s.name; }).join(', ') : (opts.audience || to);
    appendRow_('Follow-ups', [nowStr_(), type, opts.cls ? opts.cls.id + ' · ' + classLabel(opts.cls) : '', opts.date || '',
      studs.map(function (s) { return s.order || '?'; }).join(', '), who, studs.length || '', msg.subject, msg.text,
      cfg.populiVisibility, '']);
  } else {
    var o = { htmlBody: msg.html, replyTo: cfg.replyTo, name: cfg.taName };
    if (opts.bcc) o.bcc = opts.bcc;
    if (mode === 'SEND') GmailApp.sendEmail(to, msg.subject, msg.text, o);
    else if (mode === 'DRAFT') GmailApp.createDraft(to, msg.subject, msg.text, o);
  }
  appendRow_('Outbox', [nowStr_(), type, (to || (opts.students || []).length + ' student(s)') + (opts.bcc ? ' (bcc ' + opts.bcc.split(',').length + ')' : ''),
    msg.subject, mode, msg.text]);
  return mode;
}

function refreshSummary_(ctx) {
  var totals = tally(records_(ctx), ctx.cfg), out = [];
  ctx.students.filter(function (s) { return s.active; }).forEach(function (s) {
    var cls = classById_(ctx, s.classId), t = totals[s.classId + '|' + s.id] || emptyTally(ctx.cfg);
    out.push([s.classId, cls ? classLabel(cls) : '', s.id, s.name, s.email, t.absences, t.tardies, t.excused, t.effective,
      Math.max(0, t.remaining), t.pct + '%', STATE_LABEL[t.state]].map(String).concat([s.order || 1e6]));
  });
  var order = { 'Below 80% (losing the course)': 0, 'At the limit (no absences left)': 1, '1 absence left': 2, 'On track': 3 };
  out.sort(function (a, b) { return a[0].localeCompare(b[0]) || order[a[11]] - order[b[11]] || a[12] - b[12]; });
  out = out.map(function (r) { return r.slice(0, 12); });
  var sh = ss_().getSheetByName('Summary');
  sh.clearContents();
  sh.getRange(1, 1, 1, SHEETS.Summary.length).setValues([SHEETS.Summary]);
  if (out.length) sh.getRange(2, 1, out.length, SHEETS.Summary.length).setValues(out);
}

var GRID_COLORS = { P: '#d9ead3', T: '#fff2cc', A: '#f4cccc', E: '#cfe2f3' };

/**
 * One sheet per class ("Grid C1"): students in Populi's order (same as the participation checkboxes), one column
 * per week with P / T / A / E, then the totals. Rebuilt on every run, so never type in it — edit Attendance instead.
 */
function refreshGrids_(ctx) {
  var recs = records_(ctx), totals = tally(recs, ctx.cfg), ss = ss_();
  ctx.classes.filter(function (c) { return c.active; }).forEach(function (cls) {
    var roster = roster_(ctx, cls.id), mine = recs.filter(function (r) { return r.classId === cls.id; });
    var dates = mine.map(function (r) { return r.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    var cell = {};
    mine.forEach(function (r) {
      var v = /^accepted$/i.test(r.excuse) ? 'E' : (r.status || '?').charAt(0);
      if (r.leftEarly && v === 'A') v = 'A (left)';
      if (/^received$/i.test(r.excuse) && v !== 'E') v += ' (excuse sent)';
      cell[r.studentId + '|' + r.date] = v;
    });
    var header = ['#', 'Student'].concat(dates.map(function (d, i) {
      var p = d.split('-'), wk = termWeek(d, ctx.cfg.termStart) || (i + 1);
      return 'Week ' + wk + ' · ' + MONTH_NAMES[+p[1] - 1].slice(0, 3) + ' ' + (+p[2]);
    }), ['Absences', 'Tardies', 'Counted', 'Left', 'Attendance', 'Status']);
    var rows = roster.map(function (s, i) {
      var t = totals[cls.id + '|' + s.id] || emptyTally(ctx.cfg);
      return [String(s.order || i + 1), s.name].concat(dates.map(function (d) { return cell[s.id + '|' + d] || ''; }),
        [t.absences, t.tardies, t.effective, Math.max(0, t.remaining), t.pct + '%', STATE_LABEL[t.state]].map(String));
    });
    var name = 'Grid ' + cls.id, sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (!rows.length) return;
    var range = sh.getRange(2, 1, rows.length, header.length);
    range.setNumberFormat('@').setValues(rows);
    range.setBackgrounds(rows.map(function (r) {
      return r.map(function (v, j) {
        if (j < 2 || j >= 2 + dates.length) return j === header.length - 1 && /Below|limit/.test(v) ? '#f4cccc' : null;
        return GRID_COLORS[String(v).charAt(0)] || null;
      });
    }));
  });
}

/* ---------- real start time, questions for Diego, re-runs ---------- */

/** "HA 105 - 10.05.26 - start 7pm" / "inicio 7:10" → minutes (afternoon assumed for afternoon/evening classes). */
function startFromName_(name, cls) {
  var m = String(name).match(/(?:start|starts|inicio|empez\w*|empieza)\s*(?:at|a las)?\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?)/i);
  return m ? startFromText_(m[1], cls) : null;
}

function startFromText_(text, cls) {
  var t = String(text || '').trim().replace('.', ':');
  if (!t) return null;
  if (!/:/.test(t)) t = t.replace(/^(\d{1,2})/, '$1:00');
  var min = hmToMin(t);
  if (min == null) return null;
  if (!/[ap]/i.test(t) && min < 12 * 60 && cls && cls.start >= 12 * 60) min += 12 * 60; // "7:00" for an evening class
  return min;
}

function sessionKey_(classId, date) { return classId + '|' + date; }

function sessionRow_(ctx, cls, date, create) {
  var t = ctx.sessT, y = yearOf_(ctx);
  for (var i = 0; i < t.rows.length; i++) {
    if (t.get(t.rows[i], 'Class ID') === cls.id && parseDateCell(t.get(t.rows[i], 'Date'), y) === date) return t.rows[i];
  }
  if (!create) return null;
  var row = blankRow_(t);
  t.set(row, 'Class ID', cls.id);
  t.set(row, 'Date', date);
  t.set(row, 'Scheduled start', minToLabel(cls.start));
  t.rows.push(row);
  return row;
}

/** The real start of a class on a date: "Actual start" in Sessions, or the scheduled one. */
function sessionStart_(ctx, cls, date) {
  var row = sessionRow_(ctx, cls, date, false);
  var v = row ? startFromText_(ctx.sessT.get(row, 'Actual start'), cls) : null;
  return v == null ? cls.start : v;
}

function setSessionStart_(ctx, cls, date, min, overwrite) {
  var row = sessionRow_(ctx, cls, date, true);
  if (overwrite || !ctx.sessT.get(row, 'Actual start')) ctx.sessT.set(row, 'Actual start', minToLabel(min));
}

function touchSession_(ctx, cls, date, source, sourceId, startUsed) {
  var t = ctx.sessT, row = sessionRow_(ctx, cls, date, true);
  t.set(row, 'Source', source);
  if (sourceId) t.set(row, 'Source ID', sourceId);
  t.set(row, 'Processed with start', minToLabel(startUsed));
  t.set(row, 'Updated', nowStr_());
}

/** Unanswered questions for a class and date (notices wait while there are any). */
function openQuestions_(ctx, classId, date) {
  var t = ctx.revT, y = yearOf_(ctx);
  return t.rows.filter(function (r) {
    return t.get(r, 'Class ID') === classId && parseDateCell(t.get(r, 'Date'), y) === date && !t.get(r, 'Done');
  }).length;
}

function addQuestions_(ctx, cls, date, review) {
  var t = ctx.revT, y = yearOf_(ctx), added = 0;
  var have = {};
  t.rows.forEach(function (r) {
    have[t.get(r, 'Class ID') + '|' + parseDateCell(t.get(r, 'Date'), y) + '|' + normalizeName(t.get(r, 'Name seen'))] = true;
  });
  review.forEach(function (q) {
    var key = cls.id + '|' + date + '|' + normalizeName(q.name);
    if (have[key]) return;
    have[key] = true;
    var row = blankRow_(t);
    t.set(row, 'Created', nowStr_());
    t.set(row, 'Class ID', cls.id);
    t.set(row, 'Date', date);
    t.set(row, 'Name seen', q.name);
    t.set(row, 'Seen in', q.seenIn.map(function (p) {
      return { present: '15 min', tardy: '31 min', end: 'last screenshot', late: 'chat after minute 30' }[p] || p;
    }).join(', '));
    t.set(row, 'Suggestions', q.candidates.length
      ? q.candidates.map(function (s) { return '#' + (s.order || '?') + ' ' + s.name; }).join(' / ')
      : 'No similar name in the roster');
    t.rows.push(row);
    added++;
  });
  var srow = sessionRow_(ctx, cls, date, true);
  ctx.sessT.set(srow, 'Open questions', String(openQuestions_(ctx, cls.id, date)));
  return added;
}

/**
 * Diego's answers in Review: "#12", a name, or "ignore". The Zoom name is saved on that student ("Zoom names")
 * so it is recognized from now on, and the class is re-run. Returns the sessions to re-run.
 */
function answerQuestions_(ctx) {
  var t = ctx.revT, y = yearOf_(ctx), rerun = {};
  t.rows.forEach(function (r) {
    var ans = t.get(r, 'Student (# or name, or "ignore")');
    if (!ans || t.get(r, 'Done')) return;
    var classId = t.get(r, 'Class ID'), date = parseDateCell(t.get(r, 'Date'), y), seenName = t.get(r, 'Name seen');
    if (/^(ignore|ignorar|no|none|-|not a student|no es estudiante)$/i.test(ans)) {
      var list = String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String);
      if (list.indexOf(seenName) < 0) { list.push(seenName); ctx.cfg.ignoreNames = list.join('; '); setConfig_('ignoreNames', ctx.cfg.ignoreNames); }
      t.set(r, 'Done', 'Ignored · ' + nowStr_());
      rerun[sessionKey_(classId, date)] = true;
      return;
    }
    var roster = roster_(ctx, classId), num = ans.match(/^#?\s*(\d{1,3})$/), s = null;
    if (num) s = roster.filter(function (x) { return x.order === +num[1]; })[0] || null;
    if (!s) s = matchStudent({ id: ans, name: ans }, roster);
    if (!s) { t.set(r, 'Notes', 'Not found in the ' + classId + ' roster. Use the # from the Grid or the full name.'); return; }
    addAlias_(ctx, s, seenName);
    t.set(r, 'Done', 'Linked to #' + (s.order || '?') + ' ' + s.name + ' · ' + nowStr_());
    t.set(r, 'Notes', '');
    rerun[sessionKey_(classId, date)] = true;
  });
  return rerun;
}

function addAlias_(ctx, student, alias) {
  var t = ctx.studentsT, row = t.rows[student.row];
  if (!row || normalizeName(alias) === normalizeName(student.name)) return;
  var list = t.get(row, 'Zoom names').split(/\s*;\s*/).filter(String);
  if (list.map(normalizeName).indexOf(normalizeName(alias)) < 0) list.push(alias);
  t.set(row, 'Zoom names', list.join('; '));
  ctx.students = studentsFrom_(t);
}

/** Re-run classes whose start time changed in Sessions, or whose questions Diego answered. */
function rerunSessions_(ctx, rerun) {
  var t = ctx.sessT, y = yearOf_(ctx), done = {}, n = 0;
  t.rows.slice().forEach(function (r) {
    var cls = classById_(ctx, t.get(r, 'Class ID')), date = parseDateCell(t.get(r, 'Date'), y);
    var id = t.get(r, 'Source ID');
    if (!cls || !id) return;
    var start = sessionStart_(ctx, cls, date);
    var changed = t.get(r, 'Processed with start') && startFromText_(t.get(r, 'Processed with start'), cls) !== start;
    if (!changed && !rerun[sessionKey_(cls.id, date)]) return;
    if (done[id]) return;
    done[id] = true;
    try {
      if (t.get(r, 'Source') === 'Zoom screenshots') {
        var folder = DriveApp.getFolderById(id), it = folder.getFilesByName('ocr.json');
        if (!it.hasNext()) return;
        var saved = JSON.parse(it.next().getBlob().getDataAsString());
        var msg = processScreenshotSession_(ctx, cls, date, saved.phases, id, saved.images);
        appendRow_('Inbox log', [nowStr_(), folder.getName() + '/ (re-run)', 'screenshots', cls.id, date, msg]);
      } else {
        var file = DriveApp.getFileById(id);
        var res = handleFile_(ctx, file.getName(), rowsFromFile_(file), file.getDateCreated(), id);
        appendRow_('Inbox log', [nowStr_(), file.getName() + ' (re-run)', res.kind, res.cls, res.dates, res.msg]);
      }
      n++;
    } catch (err) {
      appendRow_('Inbox log', [nowStr_(), id + ' (re-run)', '', cls.id, date, 'Error: ' + (err && err.message || err)]);
    }
  });
  // Refresh the open-question counts.
  t.rows.forEach(function (r) {
    t.set(r, 'Open questions', String(openQuestions_(ctx, t.get(r, 'Class ID'), parseDateCell(t.get(r, 'Date'), y))));
  });
  return n;
}

/* ---------- dashboard (Dashboard.html) ---------- */

function openDashboard() {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(1400).setHeight(860);
  SpreadsheetApp.getUi().showModalDialog(html, 'TA Attendance');
}

/** Same page as a web app (Deploy → Web app, execute as me, only myself) to open it in its own tab. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('TA Attendance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function classInfo_(cls) {
  return { id: cls.id, label: classLabel(cls), course: cls.course, day: DAY_NAMES[dayIndex(cls.day)] || cls.day,
    time: classTime(cls), mode: cls.mode, active: cls.active };
}

function rowsOf_(t) {
  return t.rows.map(function (r, i) {
    var o = { row: i };
    t.header.forEach(function (h) { if (h) o[h] = t.get(r, h); });
    return o;
  });
}

/** Home: one card per class + what needs attention. */
function apiOverview() {
  var ctx = load_(), recs = records_(ctx), totals = tally(recs, ctx.cfg), y = yearOf_(ctx);
  var classes = ctx.classes.filter(function (c) { return c.active; }).map(function (cls) {
    var roster = roster_(ctx, cls.id), mine = recs.filter(function (r) { return r.classId === cls.id; });
    var dates = mine.map(function (r) { return r.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    var last = dates[dates.length - 1] || '';
    var lastCounts = { P: 0, T: 0, A: 0, E: 0 };
    mine.filter(function (r) { return r.date === last; }).forEach(function (r) {
      var k = /^accepted$/i.test(r.excuse) ? 'E' : (r.status || '').charAt(0);
      if (k in lastCounts) lastCounts[k]++;
    });
    var states = { warning: 0, 'at-limit': 0, failing: 0 };
    roster.forEach(function (s) { var t = totals[cls.id + '|' + s.id]; if (t && t.state in states) states[t.state]++; });
    return Object.assign(classInfo_(cls), {
      students: roster.length, sessions: dates.length, last: last, lastCounts: lastCounts, states: states,
      questions: ctx.revT.rows.filter(function (r) { return ctx.revT.get(r, 'Class ID') === cls.id && !ctx.revT.get(r, 'Done'); }).length
    });
  });
  var fu = table_('Follow-ups');
  var log = table_('Inbox log');
  return {
    today: today_(), week: termWeek(today_(), ctx.cfg.termStart), mode: mode_(ctx.cfg), classes: classes,
    pendingFollowups: fu.rows.filter(function (r) { return !fu.get(r, 'Done'); }).length,
    openQuestions: ctx.revT.rows.filter(function (r) { return !ctx.revT.get(r, 'Done'); }).length,
    log: rowsOf_(log).slice(-15).reverse(),
    inboxUrl: ctx.cfg.inboxFolderId ? 'https://drive.google.com/drive/folders/' + ctx.cfg.inboxFolderId : ''
  };
}

/** One class: students in Populi order × weeks. */
function apiClass(classId) {
  var ctx = load_(), cls = classById_(ctx, classId);
  if (!cls) throw new Error('No class ' + classId);
  var recs = records_(ctx).filter(function (r) { return r.classId === cls.id; }), totals = tally(recs, ctx.cfg);
  var dates = recs.map(function (r) { return r.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
  var cell = {};
  recs.forEach(function (r) {
    cell[r.studentId + '|' + r.date] = { s: /^accepted$/i.test(r.excuse) ? 'E' : (r.status || '?').charAt(0), left: r.leftEarly, excuse: r.excuse };
  });
  var att = ctx.att, notes = {};
  att.rows.forEach(function (r) {
    if (att.get(r, 'Class ID') !== cls.id) return;
    notes[att.get(r, 'Student ID') + '|' + parseDateCell(att.get(r, 'Date'), yearOf_(ctx))] = att.get(r, 'Notes');
  });
  return {
    cls: classInfo_(cls),
    sessions: dates.map(function (d) {
      return { date: d, label: longDate(d), week: termWeek(d, ctx.cfg.termStart), start: minToLabel(sessionStart_(ctx, cls, d)),
        questions: openQuestions_(ctx, cls.id, d) };
    }),
    students: roster_(ctx, cls.id).map(function (s) {
      var t = totals[cls.id + '|' + s.id] || emptyTally(ctx.cfg);
      return { id: s.id, order: s.order, name: s.name, email: s.email, aliases: s.aliases,
        weeks: dates.map(function (d) { var c = cell[s.id + '|' + d]; return c ? Object.assign(c, { note: notes[s.id + '|' + d] || '' }) : null; }),
        absences: t.absences, tardies: t.tardies, effective: t.effective, remaining: Math.max(0, t.remaining), pct: t.pct,
        state: t.state, stateLabel: STATE_LABEL[t.state] };
    })
  };
}

/** One class on one date: every student's result and, for screenshots, what the OCR read and how each name was matched. */
function apiSession(classId, date) {
  var ctx = load_(), cls = classById_(ctx, classId);
  if (!cls) throw new Error('No class ' + classId);
  var y = yearOf_(ctx), att = ctx.att, byStudent = {};
  att.rows.forEach(function (r) {
    if (att.get(r, 'Class ID') === cls.id && parseDateCell(att.get(r, 'Date'), y) === date) {
      byStudent[att.get(r, 'Student ID')] = { status: att.get(r, 'Status'), left: yes_(att.get(r, 'Left early')),
        source: att.get(r, 'Source'), notes: att.get(r, 'Notes'), notified: att.get(r, 'Notified') };
    }
  });
  var roster = roster_(ctx, cls.id), srow = sessionRow_(ctx, cls, date, false), st = ctx.sessT;
  var out = {
    cls: classInfo_(cls), date: date, label: longDate(date), scheduled: minToLabel(cls.start),
    start: minToLabel(sessionStart_(ctx, cls, date)), source: srow ? st.get(srow, 'Source') : '',
    students: roster.map(function (s) { return Object.assign({ id: s.id, order: s.order, name: s.name }, byStudent[s.id] || { status: '' }); }),
    questions: rowsOf_(ctx.revT).filter(function (q) { return q['Class ID'] === cls.id && parseDateCell(q.Date, y) === date; }),
    ocr: null
  };
  if (srow && st.get(srow, 'Source') === 'Zoom screenshots' && st.get(srow, 'Source ID')) {
    try {
      var folder = DriveApp.getFolderById(st.get(srow, 'Source ID')), it = folder.getFilesByName('ocr.json');
      if (it.hasNext()) {
        var saved = JSON.parse(it.next().getBlob().getDataAsString());
        out.ocr = screenshotDiagnostics(saved.phases, roster, String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String),
          { start: sessionStart_(ctx, cls, date), cfg: ctx.cfg });
        out.folderUrl = folder.getUrl();
      }
    } catch (err) { out.ocrError = String(err && err.message || err); }
  }
  return out;
}

function apiQuestions() {
  var ctx = load_();
  return rowsOf_(ctx.revT).filter(function (q) { return !q.Done; }).map(function (q) {
    var cls = classById_(ctx, q['Class ID']);
    q.classLabel = cls ? classLabel(cls) : q['Class ID'];
    q.roster = roster_(ctx, q['Class ID']).map(function (s) { return { order: s.order, name: s.name }; });
    return q;
  });
}

/** Answer a Review question (# / name / "ignore") and re-run that class right away. */
function apiAnswer(row, answer) {
  var res;
  withLock_(function () {
    var ctx = load_(), t = ctx.revT, r = t.rows[row];
    if (!r) throw new Error('Question not found');
    t.set(r, 'Student (# or name, or "ignore")', String(answer || '').trim());
    res = runAll_(ctx);
    res.note = t.get(r, 'Done') || t.get(r, 'Notes');
  });
  return res;
}

/** Change the real start of a class on a date; the class is re-run. */
function apiSetStart(classId, date, text) {
  var res;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId), min = startFromText_(text, cls);
    if (min == null) throw new Error('Not a time: ' + text);
    setSessionStart_(ctx, cls, date, min, true);
    save_(ctx.sessT);
    res = runAll_(ctx);
  });
  return res;
}

function apiFollowups() {
  return rowsOf_(table_('Follow-ups')).filter(function (f) { return !f.Done; });
}

function apiFollowupDone(row) {
  var t = table_('Follow-ups'), r = t.rows[row];
  if (!r) throw new Error('Follow-up not found');
  t.set(r, 'Done', 'Yes · ' + nowStr_());
  save_(t);
  return true;
}

function apiProcessNow() {
  var res;
  withLock_(function () { res = runAll_(load_()); });
  return res || { busy: true };
}

/* ---------- data helpers ---------- */

function ss_() { return SpreadsheetApp.getActive(); }
function tz_() { return Session.getScriptTimeZone(); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function fmtDate_(d) { return d ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : ''; }
function yes_(v) { return /^(yes|y|true|si|sí|1|x)$/i.test(String(v || '').trim()); }
function yearOf_(ctx) { return +String(ctx.cfg.termStart || today_()).slice(0, 4) || +today_().slice(0, 4); }

function toast_(msg) {
  try { ss_().toast(msg, 'TA Attendance', 8); } catch (e) { /* no UI in triggers */ }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { fn(); } finally { lock.releaseLock(); }
}

function subfolder_(folder, name) {
  var it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : folder.createFolder(name);
}

function dateFromName_(name) {
  var m = String(name).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]);
  // "10.05.26", "10-05-2026", "10_5_26" (month first)
  m = String(name).match(/(?:^|[^\d])(\d{1,2})[-_.](\d{1,2})[-_.](\d{4}|\d{2})(?!\d)/);
  if (m && +m[1] <= 12 && +m[2] <= 31) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2_(+m[1]) + '-' + pad2_(+m[2]);
  return '';
}

/** A sheet as a header-addressable table of display strings. */
function table_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Run TA Attendance → Set up / repair sheets.');
  var vals = sh.getDataRange().getDisplayValues();
  var header = vals[0] || [], col = {};
  header.forEach(function (h, i) { if (h && !(h in col)) col[h] = i; });
  return {
    sheet: sh, header: header, col: col,
    rows: vals.slice(1).filter(function (r) { return r.some(String); }),
    get: function (r, k) { return k in col ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : ''; },
    set: function (r, k, v) { if (k in col) r[col[k]] = v; }
  };
}

function blankRow_(t) { return t.header.map(function () { return ''; }); }

function save_(t) {
  if (!t.rows.length) return;
  t.sheet.getRange(2, 1, t.rows.length, t.header.length).setValues(t.rows);
}

function appendRow_(name, row) {
  var sh = ss_().getSheetByName(name);
  if (sh) sh.appendRow(row.map(function (v) { return String(v).slice(0, 49000); }));
}

function config_() {
  var out = {}, labels = {};
  CONFIG_FIELDS.forEach(function (f) { labels[f[1]] = f[0]; out[f[0]] = f[2]; });
  var sh = ss_().getSheetByName('Config');
  if (sh) sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (r[0] in labels) out[labels[r[0]]] = String(r[1]).trim();
  });
  NUMERIC_KEYS.forEach(function (k) {
    var n = parseFloat(out[k]);
    out[k] = isNaN(n) ? CONFIG_FIELDS.filter(function (f) { return f[0] === k; })[0][2] : n;
  });
  if (out.termStart) out.termStart = parseDateCell(out.termStart, +today_().slice(0, 4));
  return out;
}

function setConfig_(key, value) {
  var label = CONFIG_FIELDS.filter(function (f) { return f[0] === key; })[0][1];
  var sh = ss_().getSheetByName('Config'), rows = sh.getDataRange().getDisplayValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === label) { sh.getRange(i + 1, 2).setValue(String(value)); return; }
  }
  sh.appendRow([label, String(value), '']);
}

function load_() {
  var ctx = { cfg: config_() };
  var ct = table_('Classes');
  ctx.classes = ct.rows.map(function (r) {
    return {
      id: ct.get(r, 'Class ID'), course: ct.get(r, 'Course'), section: ct.get(r, 'Section'),
      professor: ct.get(r, 'Professor'), professorEmail: ct.get(r, 'Professor email'),
      day: ct.get(r, 'Day'), start: hmToMin(ct.get(r, 'Start')), end: hmToMin(ct.get(r, 'End')),
      mode: ct.get(r, 'Mode'), zoomId: ct.get(r, 'Zoom meeting ID'), active: !/^(no|n|false|0)$/i.test(ct.get(r, 'Active'))
    };
  }).filter(function (c) { return c.id && c.start != null && c.end != null; });
  ctx.studentsT = table_('Students');
  ctx.students = studentsFrom_(ctx.studentsT);
  ctx.att = table_('Attendance');
  ctx.sessT = table_('Sessions');
  ctx.revT = table_('Review');
  return ctx;
}

function studentFrom_(t, r) {
  return { id: t.get(r, 'Student ID'), name: t.get(r, 'Name'), email: t.get(r, 'Email'), classId: t.get(r, 'Class ID'),
    active: !/^(no|n|false|0)$/i.test(t.get(r, 'Active')), order: parseInt(t.get(r, 'Order'), 10) || 0,
    aliases: t.get(r, 'Zoom names').split(/\s*;\s*/).filter(String),
    row: t.rows.indexOf(r) };
}

function studentsFrom_(t) {
  return t.rows.map(function (r) { return studentFrom_(t, r); }).filter(function (s) { return s.id && s.classId; });
}

function classById_(ctx, id) { return ctx.classes.filter(function (c) { return c.id === id; })[0] || null; }

/** Active students of a class in Populi's order (students without a number go last, in sheet order). */
function roster_(ctx, classId) {
  return ctx.students.filter(function (s) { return s.active && s.classId === classId; })
    .sort(function (a, b) { return (a.order || 1e6) - (b.order || 1e6) || a.row - b.row; });
}

function rosterByClass_(ctx) {
  var out = {};
  ctx.classes.forEach(function (c) { out[c.id] = roster_(ctx, c.id); });
  return out;
}

function records_(ctx) {
  var t = ctx.att, y = yearOf_(ctx);
  return t.rows.map(function (r) {
    return {
      date: parseDateCell(t.get(r, 'Date'), y), classId: t.get(r, 'Class ID'), studentId: t.get(r, 'Student ID'),
      name: t.get(r, 'Name'), status: normalizeStatus(t.get(r, 'Status')), excuse: t.get(r, 'Excuse'),
      excuseDate: parseDateCell(t.get(r, 'Excuse date'), y), leftEarly: yes_(t.get(r, 'Left early'))
    };
  }).filter(function (r) { return r.date && r.classId && r.studentId; });
}
