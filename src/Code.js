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
    'Open questions', 'Populi updated', 'Updated'],
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
    var ctx = load_();
    var r = reportForWeek_(ctx, termWeek(today_(), ctx.cfg.termStart) || 1, weekBounds(today_()).start);
    deliver_(ctx, 'Weekly report', ctx.cfg.reportTo || ctx.cfg.replyTo, r, { send: true });
    refreshSummary_(ctx);
    refreshGrids_(ctx);
  });
}

/** Monday of week N of the term ("Term start" in Config is week 1). */
function weekStartOf_(ctx, week) {
  var t = ctx.cfg.termStart || today_();
  return numToDate(dayNum(weekBounds(t).start) + 7 * (week - 1));
}

/** The report for a week of the term (Monday to Sunday), with totals as of the end of that week. */
function reportForWeek_(ctx, week, start) {
  start = start || weekStartOf_(ctx, week);
  var end = numToDate(dayNum(start) + 6);
  var r = buildWeeklyReport({
    classes: ctx.classes.filter(function (c) { return c.active; }),
    students: ctx.students.filter(function (s) { return s.active; }),
    records: records_(ctx),
    weekStart: start, weekEnd: end, today: today_(), week: week, cfg: ctx.cfg
  });
  r.week = week; r.start = start; r.end = end;
  return r;
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
  // Published as a web app → open it in its own full-size tab. Otherwise show it over the sheet.
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (url) {
    var go = HtmlService.createHtmlOutput('<p style="font-family:Arial;font-size:14px">Opening the dashboard… ' +
      '<a href="' + url + '" target="_blank">click here</a> if it doesn\'t open.</p>' +
      '<script>window.open(' + JSON.stringify(url) + ', "_blank"); setTimeout(function () { google.script.host.close(); }, 1500);</script>')
      .setWidth(360).setHeight(90);
    SpreadsheetApp.getUi().showModalDialog(go, 'TA Attendance');
    return;
  }
  var html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(1600).setHeight(1000);
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
    today: today_(), week: termWeek(today_(), ctx.cfg.termStart), mode: mode_(ctx.cfg), classes: classes, tasks: tasks_(ctx),
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
  var counts = {};
  recs.forEach(function (r) {
    var k = /^accepted$/i.test(r.excuse) ? 'E' : (r.status || '').charAt(0);
    var c = counts[r.date] || (counts[r.date] = { P: 0, T: 0, A: 0, E: 0 });
    if (k in c) c[k]++;
  });
  return {
    cls: classInfo_(cls),
    schedule: classDates_(ctx, cls).map(function (d) {
      var srow = sessionRow_(ctx, cls, d.date, false);
      return { week: d.week, date: d.date, counts: counts[d.date] || null, over: classOver_(ctx, cls, d.date),
        questions: openQuestions_(ctx, cls.id, d.date), populi: srow ? ctx.sessT.get(srow, 'Populi updated') : '' };
    }),
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
        source: att.get(r, 'Source'), notes: att.get(r, 'Notes'), notified: att.get(r, 'Notified'),
        noId: yes_(att.get(r, 'No ID')), excuse: att.get(r, 'Excuse') };
    }
  });
  var roster = roster_(ctx, cls.id), srow = sessionRow_(ctx, cls, date, false), st = ctx.sessT;
  var out = {
    cls: classInfo_(cls), date: date, label: longDate(date), scheduled: minToLabel(cls.start),
    start: minToLabel(sessionStart_(ctx, cls, date)), source: srow ? st.get(srow, 'Source') : '',
    populi: srow ? st.get(srow, 'Populi updated') : '', zoom: /zoom/i.test(cls.mode), over: classOver_(ctx, cls, date),
    week: termWeek(date, ctx.cfg.termStart),
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

/** Pending follow-ups; each says if a student's status changed after it was written (don't send it as is). */
function apiFollowups() {
  var ctx = load_(), y = yearOf_(ctx);
  return rowsOf_(table_('Follow-ups')).filter(function (f) { return !f.Done; }).map(function (f) {
    var classId = String(f.Class || '').split(' · ')[0], date = parseDateCell(f['Class date'], y);
    var want = /Tardy/.test(f.Type) ? STATUS.T : /Absent|LeftEarly/.test(f.Type) ? STATUS.A : '';
    f.changed = [];
    if (want && classId && date) {
      var roster = roster_(ctx, classId);
      String(f.Students || '').split(', ').forEach(function (name) {
        var s = roster.filter(function (x) { return x.name === name; })[0];
        if (!s) return;
        var r = attRow_(ctx, classId, date, s.id);
        var now = r ? (/^accepted$/i.test(ctx.att.get(r, 'Excuse')) ? STATUS.E : normalizeStatus(ctx.att.get(r, 'Status'))) : '';
        if (now !== want) f.changed.push({ name: name, now: now || 'no status' });
      });
    }
    return f;
  });
}

function apiFollowupDone(row) {
  var t = table_('Follow-ups'), r = t.rows[row];
  if (!r) throw new Error('Follow-up not found');
  t.set(r, 'Done', 'Yes · ' + nowStr_());
  save_(t);
  return true;
}

/** Weeks of the term for the report picker. */
function apiReportWeeks() {
  var ctx = load_(), today = today_(), out = [];
  var now = termWeek(today, ctx.cfg.termStart) || 1;
  for (var w = 1; w <= rulesConfig_(ctx.cfg).totalSessions; w++) {
    var start = weekStartOf_(ctx, w);
    out.push({ week: w, start: start, end: numToDate(dayNum(start) + 6), current: w === now, future: start > today });
  }
  return { weeks: out, current: Math.min(Math.max(now, 1), out.length), reportTo: ctx.cfg.reportTo || ctx.cfg.replyTo };
}

function apiWeeklyReport(week) {
  var r = reportForWeek_(load_(), +week);
  return { week: r.week, start: r.start, end: r.end, subject: r.subject, html: r.html };
}

/** Email the report of a week to "Weekly report to" in Config. */
function apiSendWeeklyReport(week) {
  var ctx = load_(), r = reportForWeek_(ctx, +week), to = ctx.cfg.reportTo || ctx.cfg.replyTo;
  deliver_(ctx, 'Weekly report', to, r, { send: true });
  return { to: to };
}

/** Save the report of a week as a PDF in Drive ("TA Reports" next to TA Inbox). Returns its link. */
function apiSaveWeeklyReportPdf(week) {
  var ctx = load_(), r = reportForWeek_(ctx, +week);
  var name = 'Attendance report – Week ' + r.week + ' (' + r.start + ' to ' + r.end + ').pdf';
  var page = '<html><head><meta charset="utf-8"></head><body>' + r.html + '</body></html>';
  var pdf = Utilities.newBlob(page, 'text/html', 'report.html').getAs('application/pdf').setName(name);
  var folder = reportsFolder_(ctx);
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true); // keep one PDF per week
  var file = folder.createFile(pdf);
  return { name: name, url: file.getUrl() };
}

function reportsFolder_(ctx) {
  var parent = null;
  try { parent = DriveApp.getFolderById(ctx.cfg.inboxFolderId).getParents(); } catch (e) { parent = null; }
  var root = parent && parent.hasNext() ? parent.next() : DriveApp.getRootFolder();
  return subfolder_(root, 'TA Reports');
}

/* ---------- to-do list, quick editing, student history ---------- */

/** Date of the class in week N (its weekday inside that Monday–Sunday week). */
function classDate_(ctx, cls, week) {
  return numToDate(dayNum(weekStartOf_(ctx, week)) + ((dayIndex(cls.day) + 6) % 7));
}

function classDates_(ctx, cls) {
  var out = [];
  for (var w = 1; w <= rulesConfig_(ctx.cfg).totalSessions; w++) out.push({ week: w, date: classDate_(ctx, cls, w) });
  return out;
}

/** Has this class on this date already ended (with 30 minutes of margin)? */
function classOver_(ctx, cls, date) {
  var today = today_();
  if (date < today) return true;
  if (date > today) return false;
  var now = Utilities.formatDate(new Date(), tz_(), 'HH:mm');
  return hmToMin(now) >= cls.end + 30;
}

function attRow_(ctx, classId, date, studentId) {
  var t = ctx.att, y = yearOf_(ctx);
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (t.get(r, 'Class ID') === classId && t.get(r, 'Student ID') === studentId && parseDateCell(t.get(r, 'Date'), y) === date) return r;
  }
  return null;
}

/** Everything that still needs Diego, most urgent first. */
function tasks_(ctx) {
  var out = [], y = yearOf_(ctx), today = today_(), recs = records_(ctx);
  var c = rulesConfig_(ctx.cfg), have = {};
  recs.forEach(function (r) { have[r.classId + '|' + r.date] = (have[r.classId + '|' + r.date] || 0) + 1; });
  ctx.classes.filter(function (cls) { return cls.active; }).forEach(function (cls) {
    var label = cls.course.split(':')[0];
    classDates_(ctx, cls).forEach(function (d) {
      if (d.date < (ctx.cfg.termStart || '') || !classOver_(ctx, cls, d.date) || have[cls.id + '|' + d.date]) return;
      var zoom = /zoom/i.test(cls.mode);
      out.push({ type: 'load', text: 'Load attendance · ' + label + ' · Week ' + d.week + ' (' + longDate(d.date).replace(/, \d{4}$/, '') + ')',
        sub: zoom ? 'Drop the screenshot folder in TA Inbox, or mark it here.' : 'Mark it here in a minute, or drop the Populi export in TA Inbox.',
        go: { view: 'session', classId: cls.id, date: d.date } });
    });
  });
  var q = {};
  ctx.revT.rows.forEach(function (r) {
    if (ctx.revT.get(r, 'Done')) return;
    var k = ctx.revT.get(r, 'Class ID') + '|' + parseDateCell(ctx.revT.get(r, 'Date'), y);
    q[k] = (q[k] || 0) + 1;
  });
  Object.keys(q).forEach(function (k) {
    var p = k.split('|'), cls = classById_(ctx, p[0]);
    out.push({ type: 'question', text: 'Confirm ' + q[k] + ' name' + (q[k] === 1 ? '' : 's') + ' · ' + (cls ? cls.course.split(':')[0] : p[0]) + ' · ' + longDate(p[1]).replace(/, \d{4}$/, ''),
      sub: 'Its follow-ups wait until you answer.', go: { view: 'session', classId: p[0], date: p[1] } });
  });
  var fu = table_('Follow-ups'), pend = fu.rows.filter(function (r) { return !fu.get(r, 'Done'); }).length;
  if (pend) out.push({ type: 'followup', text: 'Send ' + pend + ' follow-up' + (pend === 1 ? '' : 's') + ' in Populi', sub: 'Copy, paste, check the 6 visibility boxes, send.', go: { view: 'followups' } });
  ctx.att.rows.forEach(function (r) {
    if (!/^received$/i.test(ctx.att.get(r, 'Excuse'))) return;
    var got = parseDateCell(ctx.att.get(r, 'Excuse date'), y);
    if (!got || dayNum(today) - dayNum(got) <= c.excuseReviewDays) return;
    var cls = classById_(ctx, ctx.att.get(r, 'Class ID'));
    out.push({ type: 'excuse', text: 'Ask the office about ' + ctx.att.get(r, 'Name') + '\'s medical excuse',
      sub: (cls ? cls.course.split(':')[0] : '') + ' · class of ' + parseDateCell(ctx.att.get(r, 'Date'), y) + ' · received ' + got + ' (more than ' + c.excuseReviewDays + ' days)',
      go: { view: 'student', classId: ctx.att.get(r, 'Class ID'), studentId: ctx.att.get(r, 'Student ID') } });
  });
  ctx.sessT.rows.forEach(function (r) {
    var t = ctx.sessT, cls = classById_(ctx, t.get(r, 'Class ID'));
    if (!cls || !/zoom/i.test(cls.mode) || t.get(r, 'Populi updated') || +t.get(r, 'Open questions')) return;
    var date = parseDateCell(t.get(r, 'Date'), y);
    if (!have[cls.id + '|' + date]) return;
    out.push({ type: 'populi', text: 'Tick the participation boxes in Populi · ' + cls.course.split(':')[0] + ' · ' + longDate(date).replace(/, \d{4}$/, ''),
      sub: 'Open the class in the dashboard: same order as Populi. Then press "Done in Populi".', go: { view: 'session', classId: cls.id, date: date } });
  });
  var order = { question: 0, load: 1, followup: 2, excuse: 3, populi: 4 };
  return out.sort(function (a, b) { return order[a.type] - order[b.type]; });
}

/** Change one student's record for one class (quick editing from the dashboard). */
function apiSetRecord(classId, date, studentId, change) {
  var out;
  withLock_(function () {
    var ctx = load_(), t = ctx.att, cls = classById_(ctx, classId);
    var s = ctx.students.filter(function (x) { return x.classId === classId && x.id === studentId; })[0];
    if (!cls || !s) throw new Error('Student or class not found');
    change = change || {};
    var r = attRow_(ctx, classId, date, studentId), stamp = nowStr_(), day = today_();
    if (!r) {
      r = blankRow_(t); t.rows.push(r);
      t.set(r, 'Date', date); t.set(r, 'Class ID', classId); t.set(r, 'Student ID', studentId);
    }
    t.set(r, 'Name', s.name);
    var note = function (txt) { var n = t.get(r, 'Notes'); t.set(r, 'Notes', (n ? n + ' · ' : '') + txt); };
    if (change.status !== undefined) {
      t.set(r, 'Status', change.status);
      if (change.status !== STATUS.A) t.set(r, 'Left early', '');
      t.set(r, 'Source', 'Manual');
    }
    if (change.leftEarly !== undefined) {
      t.set(r, 'Left early', change.leftEarly ? 'Yes' : '');
      if (change.leftEarly) t.set(r, 'Status', STATUS.A);
      t.set(r, 'Source', 'Manual');
    }
    if (change.noId !== undefined) t.set(r, 'No ID', change.noId ? 'Yes' : '');
    if (change.excuse !== undefined) {
      t.set(r, 'Excuse', change.excuse);
      if (change.excuse === 'Received' && !t.get(r, 'Excuse date')) t.set(r, 'Excuse date', day);
      if (change.excuse === 'Accepted') note('Office accepted the medical excuse (' + day + ')');
      if (change.excuse === 'Rejected') note('Office rejected the medical excuse (' + day + ')');
      if (!change.excuse) t.set(r, 'Excuse date', '');
    }
    if (change.office === 'Present') {
      t.set(r, 'Status', STATUS.P); t.set(r, 'Left early', ''); t.set(r, 'Source', 'Manual');
      note('Changed to Present by the office (' + day + ')');
    }
    if (change.note) note(change.note);
    t.set(r, 'Updated', stamp);
    save_(t);
    var tl = tally(records_(ctx), ctx.cfg)[classId + '|' + studentId] || emptyTally(ctx.cfg);
    out = { status: t.get(r, 'Status'), left: yes_(t.get(r, 'Left early')), noId: yes_(t.get(r, 'No ID')), excuse: t.get(r, 'Excuse'),
      notes: t.get(r, 'Notes'), effective: tl.effective, remaining: Math.max(0, tl.remaining), pct: tl.pct, stateLabel: STATE_LABEL[tl.state], state: tl.state };
  });
  return out;
}

/** Give every student of the class who has no status yet on that date the same status (e.g. everyone else Present). */
function apiBulkStatus(classId, date, status) {
  var n = 0;
  withLock_(function () {
    var ctx = load_(), t = ctx.att;
    roster_(ctx, classId).forEach(function (s) {
      var r = attRow_(ctx, classId, date, s.id);
      if (r && normalizeStatus(t.get(r, 'Status'))) return;
      if (!r) { r = blankRow_(t); t.rows.push(r); t.set(r, 'Date', date); t.set(r, 'Class ID', classId); t.set(r, 'Student ID', s.id); }
      t.set(r, 'Name', s.name); t.set(r, 'Status', status); t.set(r, 'Source', 'Manual'); t.set(r, 'Updated', nowStr_());
      n++;
    });
    save_(t);
  });
  return { changed: n };
}

/** "Done with this class": prepare its follow-ups now (instead of waiting for the 15-minute job). */
function apiFinishSession(classId, date) {
  var res;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId);
    sessionRow_(ctx, cls, date, true);
    save_(ctx.sessT);
    res = runAll_(ctx);
  });
  return res || { busy: true };
}

function apiPopuliDone(classId, date, done) {
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId), row = sessionRow_(ctx, cls, date, true);
    ctx.sessT.set(row, 'Populi updated', done ? nowStr_() : '');
    save_(ctx.sessT);
  });
  return true;
}

/** One student in one class, week by week. */
function apiStudent(classId, studentId) {
  var ctx = load_(), cls = classById_(ctx, classId), y = yearOf_(ctx), t = ctx.att;
  var s = ctx.students.filter(function (x) { return x.classId === classId && x.id === studentId; })[0];
  if (!cls || !s) throw new Error('Student not found');
  var tl = tally(records_(ctx), ctx.cfg)[classId + '|' + studentId] || emptyTally(ctx.cfg);
  return {
    cls: classInfo_(cls), student: { id: s.id, name: s.name, email: s.email, order: s.order, aliases: s.aliases },
    tally: { absences: tl.absences, tardies: tl.tardies, excused: tl.excused, effective: tl.effective, remaining: Math.max(0, tl.remaining),
      pct: tl.pct, state: tl.state, stateLabel: STATE_LABEL[tl.state] },
    weeks: classDates_(ctx, cls).map(function (d) {
      var r = attRow_(ctx, classId, d.date, studentId);
      return { week: d.week, date: d.date, future: !classOver_(ctx, cls, d.date),
        rec: r ? { status: t.get(r, 'Status'), left: yes_(t.get(r, 'Left early')), noId: yes_(t.get(r, 'No ID')), excuse: t.get(r, 'Excuse'),
          excuseDate: parseDateCell(t.get(r, 'Excuse date'), y), notes: t.get(r, 'Notes'), notified: t.get(r, 'Notified'), source: t.get(r, 'Source') } : null };
    })
  };
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
  var header = vals[0] || [];
  // After an update, new columns appear on their own (no need to run Set up again).
  var missing = (SHEETS[name] || []).filter(function (h) { return header.indexOf(h) < 0; });
  if (missing.length && header.some(String)) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header = header.concat(missing);
  }
  vals = vals.map(function (r) { while (r.length < header.length) r.push(''); return r; });
  var col = {};
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
