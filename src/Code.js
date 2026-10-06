/**
 * Google Apps Script glue: the spreadsheet, the Drive inbox, Gmail and the time triggers.
 * The rules live in Rules.js, file reading in Parsers.js and email texts in Messages.js.
 */

var SHEETS = {
  Config: ['Setting', 'Value', 'Notes'],
  Classes: ['Class ID', 'Course', 'Section', 'Professor', 'Professor email', 'Day', 'Start', 'End', 'Mode', 'Zoom meeting ID', 'Active'],
  Students: ['Student ID', 'Name', 'Email', 'Class ID', 'Active'],
  Attendance: ['Date', 'Class ID', 'Student ID', 'Name', 'Status', 'Minutes late', 'Source', 'No ID', 'Left early',
    'Excuse', 'Excuse date', 'Notified', 'Office notified', 'Notes', 'Updated'],
  Assignments: ['Class ID', 'Title', 'Due date', 'Remind days before', 'Notes', 'Reminded'],
  Summary: ['Class ID', 'Course', 'Student ID', 'Name', 'Email', 'Absences', 'Tardies', 'Excused', 'Counted absences',
    'Absences left', 'Attendance %', 'Status'],
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
  ['emailMode', 'Email mode', 'DRAFT', 'DRAFT = Gmail drafts you review and send · SEND = send automatically · LOG = only write them in Outbox.'],
  ['bcc', 'BCC on student notices', '', 'Optional, e.g. the office, so they keep a copy.'],
  ['noticesFrom', 'Send notices from', '', 'Absences before this date are not emailed (so importing old weeks does not spam students).'],
  ['markMissing', 'Mark students missing from a file absent', 'Yes', 'Zoom report or Populi list of check-ins: whoever is not in it is Absent.'],
  ['termStart', 'Term start', '', 'First day of week 1 (yyyy-mm-dd). Used for "Week N" in the report.'],
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
  ['C1', 'Course name', '', '', '', 'Monday', '9:00 AM', '1:00 PM', 'In person', '', 'Yes'],
  ['C2', 'Course name', '', '', '', 'Monday', '1:30 PM', '2:30 PM', 'In person', '', 'Yes'],
  ['C3', 'Course name', '', '', '', 'Monday', '6:00 PM', '7:00 PM', 'Zoom', '', 'Yes'],
  ['C4', 'Course name', '', '', '', 'Thursday', '9:00 AM', '10:00 AM', 'Zoom', '', 'Yes']
];

var TRIGGER_HANDLERS = ['tick', 'weeklyReport', 'assignmentReminders'];

/* ---------- menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('TA Attendance')
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
    var def = f[0] === 'noticesFrom' ? today_() : f[2];
    cfgSheet.appendRow([f[1], String(def), f[3]]);
  });
  setValidation_(cfgSheet, CONFIG_FIELDS.map(function (f) { return f[1]; }).indexOf('Email mode') + 2, 2, ['DRAFT', 'SEND', 'LOG']);

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
    var ctx = load_();
    var log = processInbox_(ctx);
    applyManualFlags_(ctx);
    save_(ctx.att);
    save_(ctx.studentsT);
    var sent = sendPendingNotices_(ctx);
    var office = checkNoId_(ctx);
    save_(ctx.att);
    refreshSummary_(ctx);
    if (log.length || sent || office) {
      toast_((log.length ? log.length + ' file(s) processed. ' : '') + sent + ' student notice(s), ' + office + ' office notice(s).');
    }
  });
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
      if (!emails.length) return;
      var msg = buildAssignmentReminder({ assignment: a, cls: cls, daysLeft: d.daysLeft, cfg: ctx.cfg });
      deliver_(ctx, 'Assignment reminder', ctx.cfg.replyTo, msg, { bcc: emails.join(',') });
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
      res = handleFile_(ctx, name, rowsFromFile_(file), file.getDateCreated());
      file.moveTo(res.ok ? done : bad);
    } catch (err) {
      res = { ok: false, kind: '?', cls: '', dates: '', msg: 'Error: ' + (err && err.message || err) };
      file.moveTo(bad);
    }
    appendRow_('Inbox log', [nowStr_(), name, res.kind, res.cls, res.dates, res.msg]);
    log.push(res);
  }
  return log;
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
function handleFile_(ctx, fileName, rows, created) {
  var kind = detectKind(rows), cfg = ctx.cfg;
  if (kind === 'zoom') {
    var z = parseZoom(rows);
    var people = z.participants.map(function (p) { return { name: p.name, email: p.email }; });
    var pick = pickClass({ fileName: fileName, topic: z.topic, meetingId: z.meetingId }, ctx.classes, rosterByClass_(ctx), people);
    if (!pick.cls) return { ok: false, kind: kind, cls: '', dates: '', msg: 'Could not tell the class (' + pick.how + '). Add [C3] (the Class ID) to the file name.' };
    var date = z.date || dateFromName_(fileName) || fmtDate_(created);
    var roster = roster_(ctx, pick.cls.id);
    var res = zoomStatuses(z, roster, pick.cls, cfg);
    var entries = res.results.map(function (x) {
      return { student: x.student, status: x.status, minutesLate: x.minutesLate, leftEarly: x.leftEarly, source: 'Zoom',
        notes: 'Zoom ' + minToLabel(x.join) + '–' + minToLabel(x.leave) + (x.names.length ? ' as "' + x.names.join('", "') + '"' : '') };
    });
    if (yes_(cfg.markMissing)) {
      res.notSeen.forEach(function (s) { entries.push({ student: s, status: STATUS.A, source: 'Zoom (not in report)' }); });
    }
    var c = applyEntries_(ctx, pick.cls, date, entries);
    var msg = c.added + ' added, ' + c.updated + ' updated, ' + c.kept + ' kept (manual/excused). Class by ' + pick.how + '.';
    if (res.unmatched.length) msg += ' Names not on the roster: ' + res.unmatched.join('; ') + '.';
    return { ok: true, kind: kind, cls: pick.cls.id, dates: date, msg: msg };
  }

  var p = parsePopuli(rows, yearOf_(ctx));
  if (!p.records.length) return { ok: false, kind: kind, cls: '', dates: '', msg: 'No attendance rows found. Is this a Populi attendance export?' };
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
    var st = r.status, late = r.time != null ? Math.max(0, Math.floor(r.time - cls.start)) : '';
    // Populi gives the scan time: our 15 / 30 minute rule decides Present vs Tardy vs Absent.
    if (r.time != null && st !== STATUS.A && st !== STATUS.E) st = classify(r.time - cls.start, cfg);
    (byDate[r.date] || (byDate[r.date] = [])).push({ student: s, status: st, minutesLate: late, source: 'Populi' });
  });
  var tot = { added: 0, updated: 0, kept: 0 }, dates = Object.keys(byDate).sort();
  dates.forEach(function (d) {
    var entries = byDate[d];
    if (p.shape === 'long' && yes_(cfg.markMissing)) {
      var have = {};
      entries.forEach(function (e) { have[e.student.id] = true; });
      rosterNow.forEach(function (s) { if (!have[s.id]) entries.push({ student: s, status: STATUS.A, source: 'Populi (not in file)' }); });
    }
    var c2 = applyEntries_(ctx, cls, d, entries);
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
    t.rows.push(row);
    ctx.students.push(studentFrom_(t, row));
    n++;
  });
  return n;
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
  var t = ctx.att, cfg = ctx.cfg, totals = tally(records_(ctx), cfg), sent = 0;
  var since = parseDateCell(cfg.noticesFrom, yearOf_(ctx));
  t.rows.forEach(function (r) {
    var st = normalizeStatus(t.get(r, 'Status'));
    if ((st !== STATUS.A && st !== STATUS.T) || /^accepted$/i.test(t.get(r, 'Excuse'))) return;
    var kind = st === STATUS.A && yes_(t.get(r, 'Left early')) ? 'LeftEarly' : st;
    var notified = t.get(r, 'Notified');
    if (notified.indexOf(kind) === 0) return;
    var date = parseDateCell(t.get(r, 'Date'), yearOf_(ctx));
    if (since && date < since) { t.set(r, 'Notified', kind + ' · not sent (before ' + since + ')'); return; }
    var cls = classById_(ctx, t.get(r, 'Class ID'));
    var s = ctx.students.filter(function (x) { return x.classId === t.get(r, 'Class ID') && x.id === t.get(r, 'Student ID'); })[0];
    if (!cls || !s || !s.email) return; // tried again on the next run (e.g. once the email is filled in)
    var msg = buildStudentNotice({
      kind: kind, student: s, cls: cls, date: date, cfg: cfg,
      tally: totals[cls.id + '|' + s.id] || emptyTally(cfg),
      minutesLate: +t.get(r, 'Minutes late') || 0
    });
    var mode = deliver_(ctx, 'Student ' + kind, s.email, msg, { bcc: cfg.bcc });
    t.set(r, 'Notified', kind + ' · ' + nowStr_() + ' · ' + mode);
    sent++;
  });
  return sent;
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
      var mode = deliver_(ctx, 'Office: no ID', ctx.cfg.officeEmail || ctx.cfg.replyTo, msg, {});
      t.set(r, 'Office notified', nowStr_() + ' · ' + mode);
      sent++;
    });
  });
  return sent;
}

/**
 * Sends (or drafts, or only logs) one email and writes it to Outbox. Returns the mode used.
 * opts.send = true sends even in DRAFT mode (used for the report that goes to the TA).
 */
function deliver_(ctx, type, to, msg, opts) {
  opts = opts || {};
  var cfg = ctx.cfg, mode = String(cfg.emailMode || 'DRAFT').toUpperCase();
  if (opts.send && mode === 'DRAFT') mode = 'SEND';
  var o = { htmlBody: msg.html, replyTo: cfg.replyTo, name: cfg.taName };
  if (opts.bcc) o.bcc = opts.bcc;
  if (mode === 'SEND') GmailApp.sendEmail(to, msg.subject, msg.text, o);
  else if (mode === 'DRAFT') GmailApp.createDraft(to, msg.subject, msg.text, o);
  else mode = 'LOG';
  appendRow_('Outbox', [nowStr_(), type, to + (opts.bcc ? ' (bcc ' + opts.bcc.split(',').length + ')' : ''), msg.subject, mode, msg.text]);
  return mode;
}

function refreshSummary_(ctx) {
  var totals = tally(records_(ctx), ctx.cfg), out = [];
  ctx.students.filter(function (s) { return s.active; }).forEach(function (s) {
    var cls = classById_(ctx, s.classId), t = totals[s.classId + '|' + s.id] || emptyTally(ctx.cfg);
    out.push([s.classId, cls ? classLabel(cls) : '', s.id, s.name, s.email, t.absences, t.tardies, t.excused, t.effective,
      Math.max(0, t.remaining), t.pct + '%', STATE_LABEL[t.state]].map(String));
  });
  var order = { 'Below 80% (losing the course)': 0, 'At the limit (no absences left)': 1, '1 absence left': 2, 'On track': 3 };
  out.sort(function (a, b) { return a[0].localeCompare(b[0]) || order[a[11]] - order[b[11]] || a[3].localeCompare(b[3]); });
  var sh = ss_().getSheetByName('Summary');
  sh.clearContents();
  sh.getRange(1, 1, 1, SHEETS.Summary.length).setValues([SHEETS.Summary]);
  if (out.length) sh.getRange(2, 1, out.length, SHEETS.Summary.length).setValues(out);
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
  m = String(name).match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/);
  if (m) return m[3] + '-' + pad2_(+m[1]) + '-' + pad2_(+m[2]);
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
  ctx.students = ctx.studentsT.rows.map(function (r) { return studentFrom_(ctx.studentsT, r); })
    .filter(function (s) { return s.id && s.classId; });
  ctx.att = table_('Attendance');
  return ctx;
}

function studentFrom_(t, r) {
  return { id: t.get(r, 'Student ID'), name: t.get(r, 'Name'), email: t.get(r, 'Email'), classId: t.get(r, 'Class ID'),
    active: !/^(no|n|false|0)$/i.test(t.get(r, 'Active')) };
}

function classById_(ctx, id) { return ctx.classes.filter(function (c) { return c.id === id; })[0] || null; }

function roster_(ctx, classId) {
  return ctx.students.filter(function (s) { return s.active && s.classId === classId; });
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
