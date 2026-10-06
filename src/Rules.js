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
