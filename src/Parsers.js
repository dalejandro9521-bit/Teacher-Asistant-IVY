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
  var h = (rows[0] || []).map(function (c) { return String(c).trim().toLowerCase(); });
  if (h.indexOf('due') >= 0 && (h.indexOf('name') >= 0 || h.indexOf('title') >= 0) && (h.indexOf('group') >= 0 || h.indexOf('points') >= 0)) return 'assignments';
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some(function (c) { return /join\s*time/i.test(c); })) return 'zoom';
  }
  return 'populi';
}

/** Assignment list (Name, Group, Points, Due, Window) → [{title, group, points, due: "yyyy-mm-dd hh:mm", window}]. */
function parseAssignments(rows) {
  var h = rows[0] || [], col = function (re) { return findCol_(h, re); };
  var cT = col(/^(name|title)$/i), cG = col(/^group$/i), cP = col(/^points$/i), cD = col(/^due/i), cW = col(/^window$/i);
  return rows.slice(1).map(function (r) {
    var g = function (c) { return c >= 0 ? String(r[c] == null ? '' : r[c]).trim() : ''; };
    return { title: g(cT), group: g(cG), points: g(cP), due: g(cD), window: g(cW) };
  }).filter(function (a) { return a.title && a.due; });
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

  var ai = opts.ai || {};
  ['present', 'tardy', 'end'].forEach(function (ph) {
    (phases[ph] || []).forEach(function (text, i) {
      var aiRes = (ai[ph] || [])[i];
      if (aiRes) {
        // Claude read this screenshot: trust sure matches, ask about the rest.
        aiObservations(aiRes, roster).forEach(function (o) {
          if (o.ignored) return;
          var cph = ph;
          if (o.kind === 'chat') {
            var when = start != null && o.time != null ? classify(o.time - start, c) : (ph === 'end' ? '' : ph === 'present' ? STATUS.P : STATUS.T);
            cph = when === STATUS.P ? 'present' : when === STATUS.T ? 'tardy' : 'late';
          }
          if (o.sure) {
            seen[cph][o.student.id] = true;
            if (o.kind === 'chat' && o.time != null && !(o.student.id in chatAt)) chatAt[o.student.id] = o.time;
          } else if (o.candidates.length) {
            note(o.name, cph, { doubt: o.candidates });
          } else if (looksLikeName_(o.name) && !(skip.length && matchStudent({ name: o.name }, skip))) {
            note(o.name, cph, null);
          }
        });
        return;
      }
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
  var out = { phases: {} }, ai = opts.ai || {};
  ['present', 'tardy', 'end'].forEach(function (ph) {
    out.phases[ph] = (phases[ph] || []).map(function (text, i) {
      var aiRes = (ai[ph] || [])[i];
      if (aiRes) {
        return aiObservations(aiRes, roster).map(function (o) {
          var pct = ' (AI ' + Math.round((o.confidence || 0) * 100) + '%)';
          var res = o.ignored ? 'ignored' : o.sure ? 'match' : o.candidates.length ? 'doubt' : 'unknown';
          var who = o.ignored ? '' : o.sure ? '#' + (o.student.order || '?') + ' ' + o.student.name + pct
            : o.candidates.map(function (s) { return '#' + (s.order || '?') + ' ' + s.name; }).join(' / ') + (o.candidates.length ? pct : '');
          var late = o.kind === 'chat' && opts.start != null && o.time != null ? Math.floor(o.time - opts.start) : null;
          return { text: o.name, kind: o.kind, time: o.time != null ? minToLabel(o.time) : '', minute: late, result: res, who: who, how: o.sure ? 'ai' : '' };
        });
      }
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

/* ---------- AI reading of screenshots (results from Claude, see aiReadShot_ in Code.js) ---------- */

/** JSON schema Claude fills for one screenshot. roster_number: the # in Populi order; 0 = not on the roster; -1 = TA/professor. */
var AI_SHOT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['participants', 'chat', 'unreadable'],
  properties: {
    participants: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['shown_name', 'roster_number', 'confidence', 'alternatives', 'where'],
        properties: {
          shown_name: { type: 'string' }, roster_number: { type: 'integer' }, confidence: { type: 'number' },
          alternatives: { type: 'array', items: { type: 'integer' } },
          where: { type: 'string', enum: ['video', 'participants_list', 'other'] }
        }
      }
    },
    chat: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['sender', 'text', 'time', 'roster_number', 'confidence', 'alternatives'],
        properties: {
          sender: { type: 'string' }, text: { type: 'string' }, time: { type: 'string' }, roster_number: { type: 'integer' },
          confidence: { type: 'number' }, alternatives: { type: 'array', items: { type: 'integer' } }
        }
      }
    },
    unreadable: { type: 'integer' }
  }
};

var AI_SURE = 0.75; // below this, Diego is asked

/** The instructions + roster text sent with each screenshot. */
function aiShotPrompt(roster, ignore, phaseLabel) {
  return 'This is a screenshot of a Zoom class (' + phaseLabel + '). Identify every person you can see and every chat message.\n\n' +
    'CLASS ROSTER (number = order in Populi):\n' +
    roster.map(function (s) {
      return '#' + s.order + ' ' + s.name + (s.aliases && s.aliases.length ? '  (also shows as: ' + s.aliases.join('; ') + ')' : '');
    }).join('\n') +
    '\n\nNOT STUDENTS (use roster_number -1): ' + (ignore.length ? ignore.join('; ') : 'none') + ', anyone labeled Host, Co-host or Professor.\n\n' +
    'Rules:\n' +
    '- participants: one entry per name you can read on a video tile or in the participants list (not the chat). ' +
    'shown_name exactly as written. roster_number = the roster # of that student, 0 if nobody on the roster matches.\n' +
    '- Students often use only a first name, a second name, a nickname, a device name ("iPhone de Ana"), different spelling ' +
    '(Z/S, Y/I, missing letters) or the name written together. Match them when the evidence is clear.\n' +
    '- confidence: 0 to 1. Use 0.9+ only when you are sure. If two students could match (e.g. two with the same first name), ' +
    'put the best one in roster_number with low confidence and the others in alternatives. Never invent a match.\n' +
    '- chat: one entry per chat message: sender as shown, the message text (students type their full name), time exactly as shown ' +
    '(e.g. "6:44 PM"), and the roster match of the person (use the text they typed and the sender name).\n' +
    '- unreadable: how many video tiles have a name you cannot read.';
}

/**
 * One AI-read screenshot → observations in the same shape the OCR path uses:
 * [{kind:'tile'|'chat', name, time, student|null, sure, candidates:[students], ignored}]
 */
function aiObservations(result, roster) {
  var byOrder = {};
  roster.forEach(function (s) { if (s.order) byOrder[s.order] = s; });
  var out = [];
  function one(kind, name, time, num, conf, alts) {
    var s = num > 0 ? byOrder[num] || null : null;
    var cands = [];
    if (s) cands.push(s);
    (alts || []).forEach(function (n) { if (byOrder[n] && cands.indexOf(byOrder[n]) < 0) cands.push(byOrder[n]); });
    out.push({ kind: kind, name: name, time: time, student: s, sure: !!s && conf >= AI_SURE && cands.length <= 1 || (!!s && conf >= 0.9),
      candidates: cands, ignored: num === -1, confidence: conf });
  }
  (result.participants || []).forEach(function (p) { one('tile', p.shown_name, null, p.roster_number, p.confidence, p.alternatives); });
  (result.chat || []).forEach(function (m) { one('chat', m.text || m.sender, hmToMin(m.time), m.roster_number, m.confidence, m.alternatives); });
  return out;
}
