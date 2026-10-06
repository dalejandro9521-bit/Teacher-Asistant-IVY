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
 * course/section text → the roster that matches the most people.
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
  var text = normalizeName([hints.course, hints.topic, name].join(' '));
  var byText = classes.filter(function (c) {
    var sec = normalizeName(c.section), crs = normalizeName(c.course);
    return (sec && (' ' + text + ' ').indexOf(' ' + sec + ' ') >= 0) || (crs && text.indexOf(crs) >= 0);
  });
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
