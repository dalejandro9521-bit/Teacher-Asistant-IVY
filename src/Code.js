/**
 * Google Apps Script glue: the spreadsheet, the Drive inbox, Gmail and the time triggers.
 * The rules live in Rules.js, file reading in Parsers.js and email texts in Messages.js.
 */

var SHEETS = {
  Config: ['Setting', 'Value', 'Notes'],
  Classes: ['Class ID', 'Course', 'Section', 'Professor', 'Professor email', 'Day', 'Start', 'End', 'Mode', 'Zoom meeting ID', 'Active'],
  Students: ['Student ID', 'Name', 'Email', 'Class ID', 'Active', 'Order', 'Zoom names', 'On roster since'],
  'Roster changes': ['Time', 'Class ID', 'Student ID', 'Name', 'Change', 'How'],
  Attendance: ['Date', 'Class ID', 'Student ID', 'Name', 'Status', 'Minutes late', 'Source', 'No ID', 'Left early',
    'Excuse', 'Excuse date', 'Notified', 'Office notified', 'Notes', 'Updated'],
  Assignments: ['Class ID', 'Title', 'Due date', 'Remind days before', 'Notes', 'Reminded', 'Group', 'Window'],
  Summary: ['Class ID', 'Course', 'Student ID', 'Name', 'Email', 'Absences', 'Tardies', 'Excused', 'Counted absences',
    'Absences left', 'Attendance %', 'Status'],
  'Follow-ups': ['Created', 'Type', 'Class', 'Class date', 'Roster #', 'Students', 'Count', 'Subject', 'Message',
    'Visibility (check in Populi)', 'Done', 'Standing'],
  Sessions: ['Class ID', 'Date', 'Scheduled start', 'Actual start', 'Source', 'Source ID', 'Processed with start',
    'Open questions', 'Populi updated', 'Updated'],
  Review: ['Created', 'Class ID', 'Date', 'Name seen', 'Seen in', 'Suggestions', 'Student (# or name, or "ignore")', 'Done', 'Notes'],
  Outbox: ['Time', 'Type', 'To', 'Subject', 'Mode', 'Body'],
  'Inbox log': ['Time', 'File', 'Kind', 'Class', 'Dates', 'Result'],
  Mail: ['Thread ID', 'Received', 'Student ID', 'Student', 'Email', 'Class ID', 'Subject', 'Category', 'Summary', 'Status',
    'Waiting since', 'Draft', 'Excuse', 'Last message ID', 'Read by', 'Updated']
};

// [key, label in the Config sheet, default, note]
var CONFIG_FIELDS = [
  ['taName', 'TA name', 'Diego Gomez', 'Signature of every email.'],
  ['taTitle', 'TA title', 'Teacher Assistant', ''],
  ['replyTo', 'Reply-To email', 'dgomez230@ivy.edu', 'Every email goes out with this Reply-To.'],
  ['officeName', 'Office name', 'the main office', 'How emails refer to the office ("send your excuse to me or to ...").'],
  ['screenshotReader', 'Screenshots read by', 'OCR', 'OCR = free automatic reading right away · CLAUDE = Claude reads them from this Drive (Google Drive connected in Claude with this Ivy account), right after class.'],
  ['officeHours', 'Office hours', '', 'Used in the below 100% / 80% follow-ups ("stop by during ..."), e.g. "Mondays 5:30–6 PM in Room 300". Empty → "reply to this email".'],
  ['replyDays', 'Reply within (days)', '7', 'Below 80% follow-ups ask the student to reply within this many days.'],
  ['officeEmail', 'Office email', '', 'Gets the "student without ID" notices. Empty → they go to the Reply-To email.'],
  ['reportTo', 'Weekly report to', 'dgomez230@ivy.edu', 'Who gets the Friday report (comma-separated).'],
  ['emailMode', 'Email mode', 'POPULI', 'POPULI = write each email in Follow-ups to send from Populi (students with the same numbers share one email) · DRAFT = Gmail drafts · SEND = send from Gmail · LOG = only Outbox.'],
  ['populiVisibility', 'Populi visibility', 'Academic Admin, Account Admin, Admissions Admin, Staff, Academic Auditor, Admissions', 'Boxes to check under Visibility when you send a follow-up from Populi.'],
  ['bcc', 'BCC on student notices', '', 'Optional, e.g. the office, so they keep a copy.'],
  ['noticesFrom', 'Send notices from', '', 'Absences before this date are not emailed (so importing old weeks does not spam students).'],
  ['aiScreenshots', 'Read screenshots with AI', 'Yes', 'Claude reads each screenshot with the roster (most accurate). Needs the API key: TA Attendance → Set Claude API key.'],
  ['aiMail', 'AI reply drafts for student emails', 'Yes', 'Claude sorts student emails and writes a reply draft.'],
  ['aiModel', 'AI model', 'claude-opus-5-5', 'Most accurate Claude model.'],
  ['aiEffort', 'AI effort', 'medium', 'low / medium / high. Higher = more careful but slower.'],
  ['mailDays', 'Check student emails from the last (days)', 14, ''],
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

var NUMERIC_KEYS = ['mailDays', 'reportHour', 'reminderHour', 'totalSessions', 'maxAbsences', 'minAttendancePct', 'presentUntilMin',
  'tardyUntilMin', 'tardiesPerAbsence', 'noIdLimit', 'earlyLeaveGraceMin', 'excuseReviewDays'];

var DEFAULT_CLASSES = [
  ['C1', 'HA 103: History of World Religions', '', '', '', 'Monday', '9:00 AM', '1:00 PM', 'In person (Vienna, Room 300)', '', 'Yes'],
  ['C2', 'OT 215: Minor Prophets', '', '', '', 'Monday', '1:30 PM', '5:30 PM', 'In person (Vienna, Room 304)', '', 'Yes'],
  ['C3', 'HA 105: Introduction to Ethics', '', '', '', 'Monday', '6:00 PM', '10:00 PM', 'Zoom', '', 'Yes'],
  ['C4', 'SB 100: Introduction to Business', '', '', '', 'Thursday', '9:00 AM', '1:00 PM', 'Zoom', '', 'Yes']
];

var TRIGGER_HANDLERS = ['tick', 'weeklyReport', 'assignmentReminders', 'claudeCheck'];

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
    .addItem('Set Claude API key', 'setApiKey')
    .addItem('Turn on automations', 'installTriggers')
    .addToUi();
}

/** Typing in Status / Left early / No ID marks the row as yours, so imports never overwrite it. */
function onEdit(e) {
  bumpCache_(); // the dashboard must not show data older than an edit in the sheet
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
  ScriptApp.newTrigger('claudeCheck').timeBased().everyMinutes(5).create();
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

/** Every 15 minutes: read new files and emails, apply manual flags, write notices, refresh the summary. */
function tick() {
  var r = null;
  var ran = withJob_(function () { r = runAll_(load_()); });
  if (!ran) return; // the previous run is still going
  try { snapshotBuild_(); } catch (e) { /* the dashboard builds it itself */ }
  if (r.files || r.sent || r.office) {
    toast_((r.files ? r.files + ' file(s) processed. ' : '') + r.sent + ' student notice(s), ' + r.office + ' office notice(s).');
  }
}

/**
 * What a click in the dashboard needs: answers, re-runs, notices. Fast: no Drive inbox listing and no rewriting of the
 * Grid/Summary sheets (the 15-minute job refreshes those).
 */
function runLight_(ctx) {
  var reruns = rerunSessions_(ctx, answerQuestions_(ctx));
  applyManualFlags_(ctx);
  save_(ctx.att); save_(ctx.studentsT); save_(ctx.sessT); save_(ctx.revT);
  var sent = sendPendingNotices_(ctx);
  var office = checkNoId_(ctx);
  save_(ctx.att);
  return { files: 0, reruns: reruns, sent: sent, office: office, log: [] };
}

/**
 * Everything the 15-minute job does. The slow part (Drive inbox, OCR, Gmail) runs without the lock, so the dashboard
 * never waits for it; then the decisions (answers, notices) run on a fresh copy of the sheets, under the lock.
 */
function runAll_(ctx) {
  var log = processInbox_(ctx);
  save_(ctx.att); save_(ctx.studentsT); save_(ctx.sessT); save_(ctx.revT);
  var mail = 0;
  try { mail = scanMail_(ctx); } catch (e) { appendRow_('Inbox log', [nowStr_(), 'Gmail', 'error', '', '', String(e && e.message || e)]); }
  save_(ctx.att);
  var r = null;
  withLock_(function () { ctx = load_(); claudeApply_(ctx).forEach(function (x) { log.push(x); }); r = runLight_(ctx); });
  refreshSummary_(ctx);
  refreshGrids_(ctx);
  return { files: log.length, reruns: r.reruns, sent: r.sent, office: r.office, mail: mail, log: log };
}

function weeklyReport() {
  var ctx = load_();
  var r = reportForWeek_(ctx, termWeek(today_(), ctx.cfg.termStart) || 1, weekBounds(today_()).start);
  deliver_(ctx, 'Weekly report', ctx.cfg.reportTo || ctx.cfg.replyTo, r, { send: true });
  refreshSummary_(ctx);
  refreshGrids_(ctx);
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
  var y = yearOf_(ctx), questions = {}, at = table_('Assignments');
  ctx.revT.rows.forEach(function (r) {
    if (!ctx.revT.get(r, 'Done')) questions[ctx.revT.get(r, 'Class ID')] = (questions[ctx.revT.get(r, 'Class ID')] || 0) + 1;
  });
  var assignments = at.rows.map(function (r) {
    var due = at.get(r, 'Due date'), time = String(due).match(/\d{1,2}:\d{2}\s*([ap]\.?m\.?)?/i);
    return { classId: at.get(r, 'Class ID'), title: at.get(r, 'Title'), due: parseDateCell(due, y), time: time ? time[0] : '',
      group: at.get(r, 'Group'), window: at.get(r, 'Window') };
  }).filter(function (a) { return a.title && a.due; });
  // The to-do list, with missing attendance as one line per class ("weeks 1, 2, 3").
  var todo = [], loads = {};
  tasks_(ctx).forEach(function (x) {
    if (x.type !== 'load') return todo.push({ text: x.text, sub: x.sub });
    if (x.go.date > end) return;
    var k = x.go.classId;
    if (!loads[k]) { loads[k] = { text: x.text.split(' · Week ')[0], weeks: [], sub: x.sub }; todo.push(loads[k]); }
    loads[k].weeks.push(termWeek(x.go.date, ctx.cfg.termStart));
  });
  todo.forEach(function (x) { if (x.weeks) { x.text += ' · week' + (x.weeks.length > 1 ? 's ' : ' ') + x.weeks.join(', '); delete x.weeks; } });
  var toSend = standing_(ctx).classes.reduce(function (n, c) { return n + c.messages.length; }, 0);
  if (toSend) todo.push({ text: 'Send ' + toSend + ' below 100% / 80% follow-up message' + (toSend === 1 ? '' : 's') + ' in Populi', sub: 'Dashboard → Below 100% / 80%.' });
  var r = buildWeeklyReport({
    classes: ctx.classes.filter(function (c) { return c.active; }),
    students: ctx.students.filter(function (s) { return s.active; }),
    records: records_(ctx),
    weekStart: start, weekEnd: end, today: today_(), week: week, cfg: ctx.cfg,
    sent: standingSent_(), questions: questions, assignments: assignments, todo: todo
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

/**
 * Assignment list of a class into the Assignments sheet (same title + due date = same row). New rows get
 * "Remind days before" = none: the Friday reminders are drafted elsewhere, this list only feeds the report.
 */
function importAssignments_(ctx, cls, list) {
  var out = { added: 0, updated: 0 };
  withLock_(function () {
    var t = table_('Assignments'), y = yearOf_(ctx), idx = {};
    t.rows.forEach(function (r) { idx[t.get(r, 'Class ID') + '|' + t.get(r, 'Title') + '|' + parseDateCell(t.get(r, 'Due date'), y)] = r; });
    list.forEach(function (a) {
      var k = cls.id + '|' + a.title + '|' + parseDateCell(a.due, y), r = idx[k];
      if (!r) {
        r = blankRow_(t); t.rows.push(r); idx[k] = r; out.added++;
        t.set(r, 'Class ID', cls.id); t.set(r, 'Title', a.title); t.set(r, 'Remind days before', 'none');
      } else out.updated++;
      t.set(r, 'Due date', a.due); t.set(r, 'Group', a.group); t.set(r, 'Window', a.window);
      if (a.points && !t.get(r, 'Notes')) t.set(r, 'Notes', a.points + ' points');
    });
    save_(t);
  });
  return out;
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
function processScreenshotSession_(ctx, cls, date, phases, folderId, images, ai) {
  var start = sessionStart_(ctx, cls, date);
  var roster = roster_(ctx, cls.id);
  var res = screenshotStatuses(phases, roster, String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String),
    { start: start, cfg: cfgForClass(ctx.cfg, cls), ai: ai });
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
  var msg = images + ' screenshot(s), start ' + minToLabel(start) + ': ' + p + ' present, ' + (isOnlineClass(cls) ? '' : t + ' tardy, ') + (roster.length - p - t) +
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
  if (kind === 'assignments') {
    var ak = pickClass({ fileName: fileName }, ctx.classes, rosterByClass_(ctx), []);
    if (!ak.cls) return { ok: false, kind: kind, cls: '', dates: '', msg: 'Assignment list: could not tell the class. Add [C1] (the Class ID) to the file name.' };
    var ar = importAssignments_(ctx, ak.cls, parseAssignments(rows));
    return { ok: true, kind: kind, cls: ak.cls.id, dates: '', msg: 'Assignments: ' + ar.added + ' new, ' + ar.updated + ' updated (shown in the Friday report; no reminders are sent for them).' };
  }
  if (kind === 'zoom') {
    var z = parseZoom(rows);
    var people = z.participants.map(function (p) { return { name: p.name, email: p.email }; });
    var pick = pickClass({ fileName: fileName, topic: z.topic, meetingId: z.meetingId }, ctx.classes, rosterByClass_(ctx), people);
    if (!pick.cls) return { ok: false, kind: kind, cls: '', dates: '', msg: 'Could not tell the class (' + pick.how + '). Add [C3] (the Class ID) to the file name.' };
    var date = z.date || dateFromName_(fileName) || fmtDate_(created);
    var roster = roster_(ctx, pick.cls.id);
    var zstart = sessionStart_(ctx, pick.cls, date);
    var res = zoomStatuses(z, roster, { start: zstart, end: pick.cls.end }, cfgForClass(cfg, pick.cls));
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
    if (r.time != null && st !== STATUS.A && st !== STATUS.E) st = classify(r.time - st0, cfgForClass(cfg, cls));
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
  var t = ctx.studentsT, n = 0, hadRoster = roster_(ctx, cls.id).length > 0;
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
    if (hadRoster) rosterChange_(cls, p.id || p.email || p.name, p.name || p.id, 'Added to the roster', 'Populi attendance file');
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
  var t = ctx.studentsT, out = { total: people.length, added: 0, inactive: 0, addedNames: [], removedNames: [] }, seen = {};
  var mine = ctx.students.filter(function (s) { return s.classId === cls.id; }), first = !mine.length, day = today_();
  people.forEach(function (p, i) {
    var s = matchStudent({ id: p.id, email: p.email, name: p.name }, mine), row;
    if (s) row = t.rows[s.row];
    else {
      row = blankRow_(t);
      t.rows.push(row);
      t.set(row, 'Student ID', p.id || p.email || p.name);
      t.set(row, 'Class ID', cls.id);
      out.added++;
      out.addedNames.push(p.name || p.id);
      // Added after the class started: logged, and earlier classes are not counted against them.
      if (!first) { t.set(row, 'On roster since', day); rosterChange_(cls, p.id || p.email || p.name, p.name, 'Added to the roster', 'Populi roster file'); }
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
      out.removedNames.push(t.get(r, 'Name'));
      rosterChange_(cls, t.get(r, 'Student ID'), t.get(r, 'Name'), 'No longer on the roster (inactive)', 'Populi roster file');
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
  var online = isOnlineClass(cls);
  entries.forEach(function (e) {
    // Online classes have no Tardy (Populi online: P and T are both "ticked" = Present).
    if (online && e.status === STATUS.T) e.status = STATUS.P;
    // Not enrolled yet on that date: an absence is not counted (nothing to record).
    if (e.student.since && date < e.student.since && e.status === STATUS.A) return;
    var key = date + '|' + cls.id + '|' + e.student.id, row;
    if (key in idx) {
      row = t.rows[idx[key]];
      if (t.get(row, 'Source') === 'Manual' || normalizeStatus(t.get(row, 'Status')) === STATUS.E ||
          /^accepted$/i.test(t.get(row, 'Excuse'))) { out.kept++; return; }
      if (t.get(row, 'Status') === e.status && String(t.get(row, 'Left early') === 'Yes') === String(!!e.leftEarly) &&
          (!e.noId || yes_(t.get(row, 'No ID')))) return;
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
    if (e.noId) t.set(row, 'No ID', 'Yes');
    if (e.notes) t.set(row, 'Notes', e.notes);
    t.set(row, 'Updated', nowStr_());
  });
  return out;
}

/** "Left early = Yes" always means Absent. Online classes have no Tardy: an old Tardy there becomes Present. */
function applyManualFlags_(ctx) {
  var t = ctx.att, online = {};
  (ctx.classes || []).forEach(function (c) { if (isOnlineClass(c)) online[c.id] = true; });
  t.rows.forEach(function (r) {
    if (online[t.get(r, 'Class ID')] && normalizeStatus(t.get(r, 'Status')) === STATUS.T) {
      t.set(r, 'Status', STATUS.P);
      t.set(r, 'Notes', (t.get(r, 'Notes') ? t.get(r, 'Notes') + ' · ' : '') + 'Online class: no Tardy (arrived by minute 30 = Present)');
      t.set(r, 'Updated', nowStr_());
    }
    if (yes_(t.get(r, 'Left early')) && normalizeStatus(t.get(r, 'Status')) !== STATUS.A &&
        normalizeStatus(t.get(r, 'Status')) !== STATUS.E) {
      t.set(r, 'Status', STATUS.A);
      t.set(r, 'Updated', nowStr_());
    }
  });
}

/* ---------- emails ---------- */

function sendPendingNotices_(ctx) {
  var t = ctx.att, cfg = ctx.cfg, totals = totals_(ctx), y = yearOf_(ctx);
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
  var totals = totals_(ctx), out = [];
  ctx.students.filter(function (s) { return s.active; }).forEach(function (s) {
    var cls = classById_(ctx, s.classId), t = totals[s.classId + '|' + s.id] || emptyTally(ctx.cfg);
    out.push([s.classId, cls ? classLabel(cls) : '', s.id, s.name, s.email, t.absences, t.tardies, t.excused, t.effective,
      Math.max(0, t.remaining), t.pct + '%', STATE_LABEL[t.state]].map(String).concat([s.order || 1e6]));
  });
  var order = { 'Below 80% (losing the course)': 0, 'At the limit (no absences left)': 1, '1 absence left': 2, 'On track': 3 };
  out.sort(function (a, b) { return a[0].localeCompare(b[0]) || order[a[11]] - order[b[11]] || a[12] - b[12]; });
  out = out.map(function (r) { return r.slice(0, 12); });
  var sh = ss_().getSheetByName('Summary');
  if (unchanged_('Summary', out, sh)) return; // nothing new: leave the sheet alone
  sh.clearContents();
  sh.getRange(1, 1, 1, SHEETS.Summary.length).setValues([SHEETS.Summary]);
  if (out.length) sh.getRange(2, 1, out.length, SHEETS.Summary.length).setValues(out);
}

/** True when a derived sheet already shows exactly this content (remembered as a short fingerprint). */
function unchanged_(name, rows, sh) {
  var json = JSON.stringify(rows), h = 5381;
  for (var i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) | 0;
  var sig = json.length + ':' + h, props = PropertiesService.getScriptProperties(), key = 'sig:' + name;
  if (sh && sh.getLastRow() > 0 && props.getProperty(key) === sig) return true;
  props.setProperty(key, sig);
  return false;
}

var GRID_COLORS = { P: '#d9ead3', T: '#fff2cc', A: '#f4cccc', E: '#cfe2f3' };

/**
 * One sheet per class ("Grid C1"): students in Populi's order (same as the participation checkboxes), one column
 * per week with P / T / A / E, then the totals. Rebuilt on every run, so never type in it — edit Attendance instead.
 */
function refreshGrids_(ctx) {
  var recs = records_(ctx), totals = totals_(ctx), ss = ss_();
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
    var name = 'Grid ' + cls.id, sh = ss.getSheetByName(name);
    if (unchanged_(name, [header].concat(rows), sh)) return;
    sh = sh || ss.insertSheet(name);
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
      : 'No similar name in the roster (if they were just added to the class, answer "new")');
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
    var nw = ans.match(/^(?:new|nuevo|nueva|add|agregar)\b\s*:?\s*(.*)$/i);
    if (nw) {
      var cls = classById_(ctx, classId);
      if (!cls) return;
      var ns = addLateStudent_(ctx, cls, nw[1].trim() || seenName, date, 'Seen in the ' + date + ' screenshots as "' + seenName + '"');
      addAlias_(ctx, ns, seenName);
      t.set(r, 'Done', 'Added to the roster as #' + ns.order + ' ' + ns.name + ' · ' + nowStr_());
      t.set(r, 'Notes', '');
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

/**
 * A student added to the class after it started (Diego confirmed a name that was not on the roster). They go at the
 * end of the roster (the next Populi roster file puts them in Populi's order and keeps this row), with the date they
 * joined so earlier classes are not counted against them. Logged in "Roster changes".
 */
/* ---------- Roster from the dashboard ---------- */

/**
 * The class's Populi roster (CSV export, or the table copied from Populi and pasted) → the class roster in Populi order.
 * New students are added from today (earlier classes do not count), missing ones become inactive; all logged in
 * "Roster changes". A file that shares almost no one with the current roster is refused (probably another class).
 */
function apiImportRoster(classId, text, fileName, force) {
  var out;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId);
    if (!cls) throw new Error('No class ' + classId);
    var people = parseRoster(parseCSV(text));
    if (!people.length) {
      // just names, one per line (pasted from anywhere)
      people = String(text || '').split(/\r?\n/).map(function (x) { return x.replace(/^\s*#?\d+[.)\s-]+/, '').trim(); })
        .filter(function (x) { return x && !/^(student|name)s?$/i.test(x); }).map(function (n) { return { name: n, id: '', email: '', active: true }; });
    }
    if (!people.length) throw new Error('No students found. Use Populi\'s roster export (CSV) or paste the roster.');
    var mine = ctx.students.filter(function (s) { return s.classId === cls.id && s.active; });
    var same = people.filter(function (p) { return matchStudent({ id: p.id, email: p.email, name: p.name }, mine); }).length;
    if (!force && mine.length >= 5 && same < Math.min(mine.length, people.length) * 0.5) {
      out = { warning: 'Only ' + same + ' of these ' + people.length + ' students are on the ' + cls.course.split(':')[0] + ' roster now. Is this the right class?' };
      return;
    }
    var r = importRoster_(ctx, cls, people);
    save_(ctx.studentsT);
    runLight_(ctx);
    out = { total: r.total, added: r.added, inactive: r.inactive, addedNames: r.addedNames, removedNames: r.removedNames };
  });
  return out;
}

/** One student added by hand at the end of the roster (from a date: earlier classes do not count). */
function apiAddStudent(classId, name, since) {
  name = String(name || '').trim();
  if (!name) throw new Error('Write the student\'s name');
  var out;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId);
    if (!cls) throw new Error('No class ' + classId);
    var s = addLateStudent_(ctx, cls, name, since || today_(), 'Added by hand in the dashboard');
    save_(ctx.studentsT);
    out = { id: s.id, name: s.name, order: s.order };
  });
  return out;
}

/** Take a student off the roster (inactive: their records stay; they stop counting and getting notices). */
function apiRemoveStudent(classId, studentId) {
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId), t = ctx.studentsT;
    var s = ctx.students.filter(function (x) { return x.classId === classId && x.id === studentId; })[0];
    if (!cls || !s) throw new Error('Student not found');
    t.set(t.rows[s.row], 'Active', 'No');
    save_(t);
    rosterChange_(cls, s.id, s.name, 'Removed from the roster (inactive)', 'By hand in the dashboard');
  });
  return true;
}

function addLateStudent_(ctx, cls, name, since, how) {
  var t = ctx.studentsT, roster = ctx.students.filter(function (x) { return x.classId === cls.id; });
  var have = matchStudent({ name: name }, roster);
  if (have) {
    if (!have.active) { t.set(t.rows[have.row], 'Active', 'Yes'); ctx.students = studentsFrom_(t); rosterChange_(cls, have.id, have.name, 'Back on the roster', how); }
    return ctx.students.filter(function (x) { return x.classId === cls.id && x.id === have.id; })[0];
  }
  var order = roster.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0) + 1;
  var id = 'new-' + normalizeName(name).replace(/\s+/g, '-'), row = blankRow_(t);
  [['Student ID', id], ['Name', name], ['Class ID', cls.id], ['Active', 'Yes'], ['Order', String(order)], ['On roster since', since || today_()]]
    .forEach(function (kv) { t.set(row, kv[0], kv[1]); });
  t.rows.push(row);
  ctx.students = studentsFrom_(t);
  rosterChange_(cls, id, name, 'Added to the roster (#' + order + ', from ' + (since || today_()) + ')', how);
  return ctx.students.filter(function (x) { return x.classId === cls.id && x.id === id; })[0];
}

function rosterChange_(cls, id, name, change, how) {
  if (!ss_().getSheetByName('Roster changes')) table_('Roster changes'); // created on first use (older spreadsheets)
  appendRow_('Roster changes', [nowStr_(), cls.id, id, name, change, how]);
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
        var msg = processScreenshotSession_(ctx, cls, date, saved.phases, id, saved.images, saved.ai);
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
    dayIndex: dayIndex(cls.day), startMin: cls.start, endMin: cls.end, time: classTime(cls), mode: cls.mode, active: cls.active };
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
  var hit = cacheGet_('overview');
  if (hit) return hit;
  var out = overview_();
  cachePut_('overview', out, 120); // the to-do list depends on the clock, so keep it short
  return out;
}

function overview_(ctx) {
  ctx = ctx || load_();
  var recs = records_(ctx), totals = totals_(ctx), y = yearOf_(ctx);
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
      weeks: classDates_(ctx, cls).map(function (d) { return { week: d.week, date: d.date, done: dates.indexOf(d.date) >= 0 }; }),
      questions: ctx.revT.rows.filter(function (r) { return ctx.revT.get(r, 'Class ID') === cls.id && !ctx.revT.get(r, 'Done'); }).length
    });
  });
  var fu = table_('Follow-ups');
  var log = table_('Inbox log');
  return {
    today: today_(), week: termWeek(today_(), ctx.cfg.termStart), mode: mode_(ctx.cfg), classes: classes, tasks: tasks_(ctx),
    pendingFollowups: fu.rows.filter(function (r) { return !fu.get(r, 'Done'); }).length,
    mailWaiting: (function (mt) { return mt.rows.filter(function (r) { return mt.get(r, 'Status') === 'Needs reply'; }).length; })(table_('Mail')),
    ai: !!apiKey_(), replyTo: ctx.cfg.replyTo, mailDays: ctx.cfg.mailDays,
    openQuestions: ctx.revT.rows.filter(function (r) { return !ctx.revT.get(r, 'Done'); }).length,
    log: rowsOf_(log).slice(-15).reverse(),
    inboxUrl: ctx.cfg.inboxFolderId ? 'https://drive.google.com/drive/folders/' + ctx.cfg.inboxFolderId : ''
  };
}

/**
 * Speed: everything the dashboard shows, in one call (the sheets are read once). The page keeps it and draws every
 * screen from it; writes go in the background.
 */
function apiAll() {
  var gen = cacheGen_(), snap = snapshotGet_(gen);
  if (!snap) snap = snapshotPut_(allFrom_(load_()), gen, false);
  snap.claudeWaiting = (claudeWaitingList_() || []).length;
  return snap;
}

/**
 * Speed: the dashboard's data is kept ready ("snapshot"): in the script cache and, as a backup that survives the cache,
 * in dashboard-snapshot.json in TA Inbox/Processed (this account's Drive). The 15-minute job and Claude's results rebuild
 * it in the background, so opening the dashboard rarely reads the sheets. It is used only while no edit happened since it
 * was built (same generation) and for 20 minutes at most (the to-do list depends on the clock).
 */
var SNAP_MAX_MS_ = 20 * 60000;
function snapshotGet_(gen) {
  var ok = function (x) { return x && x.gen === gen && Date.now() - (x.builtAt || 0) < SNAP_MAX_MS_; };
  var hit = cacheGetKey_('snap');
  if (ok(hit)) return hit;
  var f = snapshotFile_(false);
  if (!f) return null;
  try { hit = JSON.parse(f.getBlob().getDataAsString()); } catch (e) { return null; }
  if (!ok(hit)) return null;
  cachePutKey_('snap', hit, 21600);
  return hit;
}
function snapshotPut_(all, gen, toDrive) {
  all.gen = gen; all.builtAt = Date.now();
  cachePutKey_('snap', all, 21600);
  if (toDrive) {
    try {
      var f = snapshotFile_(true);
      if (f) f.setContent(JSON.stringify(all));
    } catch (e) { /* only a shortcut */ }
  }
  return all;
}
function snapshotFile_(create) {
  var id = config_().inboxFolderId;
  if (!id) return null;
  try {
    var folder = subfolder_(DriveApp.getFolderById(id), 'Processed'), it = folder.getFilesByName('dashboard-snapshot.json');
    if (it.hasNext()) return it.next();
    return create ? folder.createFile('dashboard-snapshot.json', '{}', 'application/json') : null;
  } catch (e) { return null; }
}
/** Background (after the 15-minute job or Claude's results): rebuild the snapshot so the next open is instant. */
function snapshotBuild_() {
  var gen = cacheGen_();
  snapshotPut_(allFrom_(load_()), gen, true);
}

function allFrom_(ctx) {
  var out = { overview: overview_(ctx), classes: {}, questions: questions_(ctx), followups: followups_(ctx),
    reportWeeks: reportWeeks_(ctx), mail: mail_(ctx), standing: standing_(ctx), at: nowStr_() };
  ctx.classes.filter(function (c) { return c.active; }).forEach(function (c) { out.classes[c.id] = class_(c.id, ctx); });
  return out;
}

/** One class: students in Populi order × weeks. */
function apiClass(classId) {
  var hit = cacheGet_('class:' + classId);
  if (hit) return hit;
  var out = class_(classId);
  cachePut_('class:' + classId, out, 300);
  return out;
}

function class_(classId, ctx) {
  ctx = ctx || load_();
  var cls = classById_(ctx, classId);
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
      return { id: s.id, order: s.order, name: s.name, email: s.email, aliases: s.aliases, since: s.since,
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
    ocr: null, aiOn: aiOn_(ctx.cfg, 'aiScreenshots'), aiShots: 0
  };
  out.shots = { present: 0, tardy: 0, end: 0 };
  if (srow && st.get(srow, 'Source') === 'Zoom screenshots' && st.get(srow, 'Source ID')) {
    try {
      var folder = DriveApp.getFolderById(st.get(srow, 'Source ID')), it = folder.getFilesByName('ocr.json');
      if (it.hasNext()) {
        var saved = JSON.parse(it.next().getBlob().getDataAsString());
        ['present', 'tardy', 'end'].forEach(function (k) { out.shots[k] = ((saved.phases || {})[k] || []).length; });
        out.ocr = screenshotDiagnostics(saved.phases, roster, String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String),
          { start: sessionStart_(ctx, cls, date), cfg: ctx.cfg, ai: saved.ai });
        out.aiShots = ['present', 'tardy', 'end'].reduce(function (n, k) { return n + ((saved.ai || {})[k] || []).filter(Boolean).length; }, 0);
        out.folderUrl = folder.getUrl();
      }
    } catch (err) { out.ocrError = String(err && err.message || err); }
  }
  return out;
}

function apiQuestions() { return questions_(load_()); }

function questions_(ctx) {
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
    res = runLight_(ctx);
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
    res = runLight_(ctx);
  });
  return res;
}

/** Pending follow-ups; each says if a student's status changed after it was written (don't send it as is). */
function apiFollowups() { return followups_(load_()); }

function followups_(ctx) {
  var y = yearOf_(ctx);
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
function apiReportWeeks() { return reportWeeks_(load_()); }

function reportWeeks_(ctx) {
  var today = today_(), out = [];
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

/* ---------- standing follow-ups: below 100% and below 80% ---------- */

var STANDING_TYPES = { below80: 'Standing: below 80%', below100: 'Standing: below 100%' };

/** Level of a student in a course: below80 (losing it), below100 (has counted absences), or '' (100% so far). */
function standingLevel_(t) {
  if (t.state === 'failing') return 'below80';
  return t.effective > 0 ? 'below100' : '';
}

/** The last standing follow-up sent to each class|student: {level, date, at: "effective/tardies"}. */
function standingSent_() {
  var fu = table_('Follow-ups'), out = {};
  fu.rows.forEach(function (r) {
    var type = fu.get(r, 'Type'), level = type === STANDING_TYPES.below80 ? 'below80' : type === STANDING_TYPES.below100 ? 'below100' : '';
    if (!level || !fu.get(r, 'Done')) return;
    var classId = fu.get(r, 'Class').split(' · ')[0], date = fu.get(r, 'Created').slice(0, 10);
    fu.get(r, 'Standing').split(/\s*;\s*/).forEach(function (x) {
      var m = x.match(/^(.+)@(\d+)\/(\d+)$/);
      if (m) out[classId + '|' + m[1]] = { level: level, date: date, at: m[2] + '/' + m[3] };
    });
  });
  return out;
}

/**
 * Who needs a follow-up about their standing, per class, in Populi order. Students with the same numbers share one
 * message (select them together in Populi). A student is up to date when they were already told these exact numbers.
 */
function standing_(ctx) {
  var totals = totals_(ctx), recs = records_(ctx), sent = standingSent_(), vis = ctx.cfg.populiVisibility;
  var classes = ctx.classes.filter(function (c) { return c.active; }).map(function (cls) {
    var students = [];
    roster_(ctx, cls.id).forEach(function (s) {
      var t = totals[cls.id + '|' + s.id] || emptyTally(ctx.cfg), level = standingLevel_(t);
      if (!level) return;
      var dates = recs.filter(function (r) { return r.classId === cls.id && r.studentId === s.id && !/^accepted$/i.test(r.excuse) &&
        (r.status === STATUS.A || r.status === STATUS.T); }).map(function (r) { return r.date; }).sort();
      var last = sent[cls.id + '|' + s.id] || null;
      students.push({ id: s.id, order: s.order, name: s.name, level: level, absences: t.absences, tardies: t.tardies, effective: t.effective,
        remaining: Math.max(0, t.remaining), pct: t.pct, state: t.state, stateLabel: STATE_LABEL[t.state], dates: dates, last: last,
        upToDate: !!(last && last.level === level && last.at === t.effective + '/' + t.tardies) });
    });
    var groups = {}, order = [];
    students.filter(function (x) { return !x.upToDate; }).forEach(function (x) {
      var k = [x.level, x.absences, x.tardies, x.effective, x.remaining, x.pct].join('|');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(x);
    });
    return Object.assign(classInfo_(cls), {
      students: students,
      messages: order.map(function (k) {
        var g = groups[k], msg = standingMessage_(ctx, cls, g);
        return { level: g[0].level, ids: g.map(function (x) { return x.id; }), roster: g.map(function (x) { return x.order || '?'; }),
          names: g.map(function (x) { return x.name; }), subject: msg.subject, text: msg.text };
      }).sort(function (a, b) { return (a.level === 'below80' ? 0 : 1) - (b.level === 'below80' ? 0 : 1); })
    });
  });
  return { classes: classes, visibility: vis };
}

/** The message for students who share the same numbers (one student: their first name and the dates). */
function standingMessage_(ctx, cls, group) {
  var one = group.length === 1 ? group[0] : null;
  return buildStandingNotice({ level: group[0].level, student: { name: one ? one.name : '' }, cls: cls, cfg: ctx.cfg, today: today_(),
    tally: totals_(ctx)[cls.id + '|' + group[0].id] || emptyTally(ctx.cfg), dates: one ? one.dates : [] });
}

function apiStanding() { return standing_(load_()); }

/** Diego sent a standing follow-up from Populi: it is recorded (with the numbers it was about) in Follow-ups as done. */
function apiStandingSent(classId, ids) {
  var out;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId);
    if (!cls) throw new Error('No class ' + classId);
    var all = standing_(ctx).classes.filter(function (c) { return c.id === classId; })[0];
    var group = all.students.filter(function (x) { return ids.indexOf(x.id) >= 0; });
    if (!group.length) throw new Error('Those students have no follow-up pending');
    var levels = group.map(function (x) { return x.level; }).filter(function (l, i, a) { return a.indexOf(l) === i; });
    levels.forEach(function (level) {
      var g = group.filter(function (x) { return x.level === level; }), msg = standingMessage_(ctx, cls, g), now = nowStr_();
      var fu = table_('Follow-ups'), row = blankRow_(fu);
      [['Created', now], ['Type', STANDING_TYPES[level]], ['Class', cls.id + ' · ' + classLabel(cls)],
        ['Roster #', g.map(function (x) { return x.order || '?'; }).join(', ')], ['Students', g.map(function (x) { return x.name; }).join(', ')],
        ['Count', String(g.length)], ['Subject', msg.subject], ['Message', msg.text], ['Visibility (check in Populi)', ctx.cfg.populiVisibility],
        ['Done', 'Yes · ' + now], ['Standing', g.map(function (x) { return x.id + '@' + x.effective + '/' + x.tardies; }).join('; ')]
      ].forEach(function (kv) { fu.set(row, kv[0], kv[1]); });
      fu.rows.push(row);
      save_(fu);
    });
    out = standing_(ctx);
  });
  return out;
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
  // Index the Attendance rows once per request (rows added later are found by the fallback scan).
  if (!ctx._attIdx || ctx._attIdxN !== t.rows.length) {
    ctx._attIdx = {}; ctx._attIdxN = t.rows.length;
    t.rows.forEach(function (r) { ctx._attIdx[parseDateCell(t.get(r, 'Date'), y) + '|' + t.get(r, 'Class ID') + '|' + t.get(r, 'Student ID')] = r; });
  }
  return ctx._attIdx[date + '|' + classId + '|' + studentId] || null;
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
  var mt = table_('Mail');
  mt.rows.forEach(function (r) {
    if (mt.get(r, 'Status') !== 'Needs reply') return;
    var h = hoursSince_(mt.get(r, 'Waiting since'));
    out.push({ type: 'mail', text: 'Reply to ' + mt.get(r, 'Student') + ' · ' + (mt.get(r, 'Category') || 'email') + ' · waiting ' + (h < 1 ? 'less than 1 h' : h < 48 ? h + ' h' : Math.floor(h / 24) + ' days'),
      sub: mt.get(r, 'Summary') || mt.get(r, 'Subject'), late: h >= 24, go: { view: 'mail' } });
  });
  var order = { question: 0, mail: 1, load: 2, followup: 3, excuse: 4, populi: 5 };
  return out.sort(function (a, b) { return order[a.type] - order[b.type] || (b.late ? 1 : 0) - (a.late ? 1 : 0); });
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
    if (change.status === STATUS.T && isOnlineClass(cls)) throw new Error('Online classes have no Tardy: mark Present (by minute 30) or Absent (minute 31 or later).');
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
    res = runLight_(ctx);
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

/* ---------- Claude (AI) ---------- */

function apiKey_() { return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || ''; }

function aiOn_(cfg, key) { return yes_(cfg[key]) && !!apiKey_(); }

/** Menu: store the Anthropic API key in the script's private properties (never in the sheet). */
function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Claude API key', 'Paste your Anthropic API key (starts with sk-ant-). It is stored privately in this script, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim();
  if (!/^sk-ant-/.test(key)) { ui.alert('That does not look like an Anthropic API key.'); return; }
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  ui.alert('Saved. Screenshots and student emails will now be read with Claude.');
}

/**
 * One Claude request (Messages API over HTTPS; Apps Script has no SDK). Returns the parsed JSON that matches `schema`.
 * content: the user message content blocks. Uses structured outputs and the default refusal fallback.
 */
function aiJson_(cfg, system, content, schema, maxTokens) {
  var body = {
    model: cfg.aiModel || 'claude-opus-5-5',
    max_tokens: maxTokens || 8000,
    system: system,
    messages: [{ role: 'user', content: content }],
    output_config: { effort: cfg.aiEffort || 'medium', format: { type: 'json_schema', schema: schema } },
    fallbacks: 'default'
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey_(), 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(body)
  });
  var code = res.getResponseCode(), data = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + ((data.error && data.error.message) || 'error'));
  if (data.stop_reason === 'refusal') throw new Error('Claude declined this request');
  var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return JSON.parse(text);
}

/** Claude reads one screenshot with the class roster. → AI_SHOT_SCHEMA result */
function aiReadShot_(ctx, cls, phase, blob) {
  var st = table_('Students'), roster = st.rows.map(function (r) { return studentFrom_(st, r); })
    .filter(function (s) { return s.classId === cls.id && s.active; })
    .sort(function (a, b) { return (a.order || 1e6) - (b.order || 1e6); });
  var ignore = String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String);
  var label = { present: 'taken about 15 minutes after the start', tardy: 'taken about 31 minutes after the start',
    end: 'taken about one hour after the start, before the TA leaves' }[phase];
  var content = [
    { type: 'image', source: { type: 'base64', media_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } },
    { type: 'text', text: aiShotPrompt(roster, ignore, label) }
  ];
  return aiJson_(ctx.cfg, 'You take attendance for a college class from Zoom screenshots. You are careful: you only match a name to a ' +
    'student when the evidence is clear, and you report doubts instead of guessing.', content, AI_SHOT_SCHEMA, 16000);
}

/* ---------- student emails (Gmail) ---------- */

var MAIL_LABELS = { reply: 'TA/Needs reply', excuse: 'TA/Medical excuse' };

function myEmails_(cfg) {
  var out = [String(cfg.replyTo || '').toLowerCase()];
  try { out.push(String(Session.getEffectiveUser().getEmail() || '').toLowerCase()); } catch (e) { /* not available */ }
  return out.filter(String);
}

function emailOf_(from) {
  var m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

function gmailLabel_(name) {
  try { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); } catch (e) { return null; }
}

/** The student (by email) with each of their classes: records and totals, for the AI and the dashboard. */
function mailStudent_(ctx, email) {
  var mine = ctx.students.filter(function (s) { return s.active && String(s.email).toLowerCase() === email; });
  if (!mine.length) return null;
  var recs = records_(ctx), totals = totals_(ctx);
  return {
    id: mine[0].id, name: mine[0].name, email: email,
    classes: mine.map(function (s) {
      var cls = classById_(ctx, s.classId);
      if (!cls) return null;
      return {
        id: cls.id, label: classLabel(cls), code: cls.course.split(':')[0], when: cls.day + ' ' + classTime(cls),
        records: recs.filter(function (r) { return r.classId === cls.id && r.studentId === s.id; })
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
          .map(function (r) { return { date: r.date, status: r.status, excuse: r.excuse }; }),
        tally: totals[cls.id + '|' + s.id] || emptyTally(ctx.cfg)
      };
    }).filter(Boolean)
  };
}

function threadMessages_(thread, me) {
  return thread.getMessages().map(function (m) {
    var from = emailOf_(m.getFrom());
    return {
      id: m.getId(), from: from, mine: me.indexOf(from) >= 0, date: Utilities.formatDate(m.getDate(), tz_(), 'yyyy-MM-dd HH:mm'),
      body: cleanMailBody(m.getPlainBody()),
      attachments: (m.getAttachments ? m.getAttachments() : []).map(function (a) { return a.getName(); })
    };
  });
}

/** Ask Claude to sort the thread and write the reply. */
function aiMail_(ctx, who, msgs, instruction) {
  var prompt = mailUserPrompt({ cfg: ctx.cfg, today: today_(), student: who, classes: who.classes, messages: msgs.slice(-6), instruction: instruction });
  return aiJson_(ctx.cfg, mailSystemPrompt(ctx.cfg), [{ type: 'text', text: prompt }], MAIL_SCHEMA, 6000);
}

/** Without AI: same shape as MAIL_SCHEMA, from simple word rules and a template. */
function plainMail_(ctx, who, msgs) {
  var last = msgs.filter(function (m) { return !m.mine; }).slice(-1)[0] || msgs[msgs.length - 1];
  var g = mailCategoryGuess(last.body, last.attachments);
  return { category: g.category, needs_reply: g.category !== 'thanks_or_fyi', urgency: 'normal',
    summary: last.body.replace(/\s+/g, ' ').slice(0, 140),
    excuse: { is_excuse: g.isExcuse, class_date: '', has_doctor_phone: /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(last.body), for_someone_else: false, missing: [] },
    reply: mailTemplateReply({ cfg: ctx.cfg, student: who, classes: who.classes, category: g.category }) };
}

/** An excuse arrived by email: mark that absence (or the latest one without an excuse) as "Received". */
function markExcuseFromMail_(ctx, who, classDate) {
  var t = ctx.att, y = yearOf_(ctx), best = null;
  who.classes.forEach(function (k) {
    var s = ctx.students.filter(function (x) { return x.classId === k.id && String(x.email).toLowerCase() === who.email; })[0];
    t.rows.forEach(function (r) {
      if (t.get(r, 'Class ID') !== k.id || t.get(r, 'Student ID') !== s.id) return;
      var st = normalizeStatus(t.get(r, 'Status')), d = parseDateCell(t.get(r, 'Date'), y);
      if (st !== STATUS.A && st !== STATUS.T) return;
      if (classDate ? d !== classDate : t.get(r, 'Excuse')) return;
      if (!best || d > best.date) best = { row: r, date: d, cls: k };
    });
  });
  if (!best) return 'No absence found to attach it to';
  if (!t.get(best.row, 'Excuse')) {
    t.set(best.row, 'Excuse', 'Received');
    t.set(best.row, 'Excuse date', today_());
    var n = t.get(best.row, 'Notes');
    t.set(best.row, 'Notes', (n ? n + ' · ' : '') + 'Medical excuse received by email (' + today_() + ')');
    t.set(best.row, 'Updated', nowStr_());
  }
  return 'Marked Received · ' + best.cls.code + ' · ' + best.date;
}

/**
 * Student emails of the last days: one row per thread in "Mail". New student messages are sorted and get a reply draft
 * (Claude when on, otherwise a template). Answered threads (your reply is the last message) close on their own.
 */
function scanMail_(ctx, budgetMs, full) {
  var cfg = ctx.cfg, me = myEmails_(cfg), mt = table_('Mail'), byId = {}, n = 0, t0 = Date.now();
  budgetMs = budgetMs || 150000; // Apps Script stops a run at 6 minutes: what is left waits for the next run
  mt.rows.forEach(function (r) { byId[mt.get(r, 'Thread ID')] = r; });
  var useAi = aiOn_(cfg, 'aiMail'), labels = null, outOfTime = false;
  // Speed: between full looks (every 6 hours, or "Check now"), only threads with something new since the last look.
  var props = PropertiesService.getScriptProperties(), nowS = Math.floor(Date.now() / 1000);
  var last = +props.getProperty('mailScanAt') || 0, lastFull = +props.getProperty('mailFullAt') || 0;
  full = full || !last || nowS - lastFull > 6 * 3600;
  var q = 'in:inbox newer_than:' + (cfg.mailDays || 14) + 'd', threads;
  if (full) threads = GmailApp.search(q, 0, 100);
  else {
    var seen = {};
    threads = GmailApp.search(q + ' after:' + (last - 300), 0, 100).concat(GmailApp.search('in:sent after:' + (last - 300), 0, 50))
      .filter(function (th) { var id = th.getId(); if (seen[id]) return false; seen[id] = true; return true; });
  }
  threads.forEach(function (th) {
    var msgs = threadMessages_(th, me), students = msgs.filter(function (m) { return !m.mine; });
    if (!students.length) return;
    var who = null;
    for (var i = students.length - 1; i >= 0 && !who; i--) who = mailStudent_(ctx, students[i].from);
    if (!who) return;
    var id = th.getId(), r = byId[id], last = msgs[msgs.length - 1];
    if (!r) { r = blankRow_(mt); mt.rows.push(r); byId[id] = r; mt.set(r, 'Thread ID', id); }
    var lastMine = -1, lastStudent = -1;
    msgs.forEach(function (m, k) { if (m.mine) lastMine = k; else lastStudent = k; });
    mt.set(r, 'Student ID', who.id); mt.set(r, 'Student', who.name); mt.set(r, 'Email', who.email);
    mt.set(r, 'Class ID', who.classes.map(function (k) { return k.id; }).join(', '));
    mt.set(r, 'Subject', th.getFirstMessageSubject());
    mt.set(r, 'Received', msgs[lastStudent].date);
    labels = labels || { reply: gmailLabel_(MAIL_LABELS.reply), excuse: gmailLabel_(MAIL_LABELS.excuse) };
    if (lastMine > lastStudent) {
      if (mt.get(r, 'Status') !== 'Answered') { mt.set(r, 'Status', 'Answered'); mt.set(r, 'Updated', nowStr_()); n++; }
      if (labels.reply) try { th.removeLabel(labels.reply); } catch (e) { /* ignore */ }
      return;
    }
    if (mt.get(r, 'Last message ID') === last.id) return; // nothing new since the last look
    var res = null, by = 'rules';
    if (useAi && Date.now() - t0 > budgetMs) { outOfTime = true; if (!mt.get(r, 'Status')) mt.set(r, 'Status', 'Needs reply'); return; }
    if (useAi) {
      try { res = aiMail_(ctx, who, msgs); by = 'AI'; } catch (e) { by = 'rules (AI error: ' + String(e && e.message || e).slice(0, 80) + ')'; }
    }
    res = res || plainMail_(ctx, who, msgs);
    var firstWaiting = msgs[lastMine + 1] || last;
    mt.set(r, 'Category', MAIL_CATEGORY_LABEL[res.category] || res.category);
    mt.set(r, 'Summary', res.summary);
    mt.set(r, 'Status', res.needs_reply ? 'Needs reply' : 'No reply needed');
    mt.set(r, 'Waiting since', firstWaiting.date);
    mt.set(r, 'Draft', res.reply);
    mt.set(r, 'Read by', by);
    if (res.excuse && res.excuse.is_excuse && !mt.get(r, 'Excuse')) {
      var missing = (res.excuse.missing || []).length ? ' · missing: ' + res.excuse.missing.join(', ') : '';
      mt.set(r, 'Excuse', markExcuseFromMail_(ctx, who, res.excuse.class_date) + missing);
      if (labels.excuse) try { th.addLabel(labels.excuse); } catch (e) { /* ignore */ }
    }
    if (res.needs_reply && labels.reply) try { th.addLabel(labels.reply); } catch (e) { /* ignore */ }
    mt.set(r, 'Last message ID', last.id);
    mt.set(r, 'Updated', nowStr_());
    n++;
  });
  save_(mt);
  if (!outOfTime) { // what was left for later is looked at again next time
    props.setProperty('mailScanAt', String(nowS));
    if (full) props.setProperty('mailFullAt', String(nowS));
  }
  return n;
}

function hoursSince_(stamp) {
  var m = String(stamp || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return 0;
  var now = nowStr_(), nm = now.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
  return Math.max(0, Math.round(((dayNum(nm[1]) - dayNum(m[1])) * 1440 + (+nm[2] - +m[2]) * 60 + (+nm[3] - +m[3])) / 60));
}

function mail_(ctx) {
  var mt = table_('Mail'), order = { 'Needs reply': 0, 'No reply needed': 1, Answered: 2, Done: 3 };
  return mt.rows.map(function (r, i) {
    var who = mailStudent_(ctx, mt.get(r, 'Email'));
    return {
      row: i, threadId: mt.get(r, 'Thread ID'), student: mt.get(r, 'Student'), studentId: mt.get(r, 'Student ID'), email: mt.get(r, 'Email'),
      subject: mt.get(r, 'Subject'), category: mt.get(r, 'Category'), summary: mt.get(r, 'Summary'), status: mt.get(r, 'Status'),
      received: mt.get(r, 'Received'), waiting: mt.get(r, 'Status') === 'Needs reply' ? hoursSince_(mt.get(r, 'Waiting since')) : 0,
      draft: mt.get(r, 'Draft'), excuse: mt.get(r, 'Excuse'), by: mt.get(r, 'Read by'),
      classes: who ? who.classes.map(function (k) {
        return { id: k.id, code: k.code, effective: k.tally.effective, remaining: Math.max(0, k.tally.remaining), pct: k.tally.pct, state: k.tally.state };
      }) : []
    };
  }).sort(function (a, b) { return (order[a.status] || 0) - (order[b.status] || 0) || b.waiting - a.waiting || (a.received < b.received ? 1 : -1); });
}

function apiMail() { return mail_(load_()); }

/** Look for new student emails now (instead of waiting for the 15-minute job). */
function apiCheckMail() {
  var n = 0;
  var ran = withJob_(function () { var ctx = load_(); n = scanMail_(ctx, 0, true); save_(ctx.att); });
  if (!ran) return { changed: 0, busy: true };
  return { changed: n };
}

function mailRow_(threadId) {
  var mt = table_('Mail'), r = mt.rows.filter(function (x) { return mt.get(x, 'Thread ID') === threadId; })[0];
  if (!r) throw new Error('Email not found');
  return { t: mt, r: r };
}

/** Write the reply again, e.g. "shorter", "more formal", "ask for the doctor's phone". */
function apiMailRedraft(threadId, instruction) {
  var ctx = load_(), m = mailRow_(threadId), th = GmailApp.getThreadById(threadId);
  var who = mailStudent_(ctx, m.t.get(m.r, 'Email'));
  if (!who) throw new Error('Student not found');
  var msgs = threadMessages_(th, myEmails_(ctx.cfg)), res;
  if (aiOn_(ctx.cfg, 'aiMail')) res = aiMail_(ctx, who, msgs, instruction);
  else throw new Error('AI is off. Set the Claude API key (TA Attendance → Set Claude API key).');
  m.t.set(m.r, 'Draft', res.reply);
  m.t.set(m.r, 'Updated', nowStr_());
  save_(m.t);
  return { draft: res.reply };
}

/** Save the (edited) reply as a Gmail draft in the same thread. */
function apiMailToGmail(threadId, text) {
  var m = mailRow_(threadId), th = GmailApp.getThreadById(threadId), cfg = config_();
  th.createDraftReply(text, { replyTo: cfg.replyTo });
  m.t.set(m.r, 'Draft', text);
  save_(m.t);
  return { url: 'https://mail.google.com/mail/u/0/#drafts' };
}

/** Status by hand: Answered, No reply needed, Done, or back to Needs reply. */
function apiMailStatus(threadId, status) {
  var m = mailRow_(threadId);
  m.t.set(m.r, 'Status', status);
  m.t.set(m.r, 'Updated', nowStr_());
  save_(m.t);
  if (status !== 'Needs reply') {
    var l = GmailApp.getUserLabelByName(MAIL_LABELS.reply);
    if (l) try { GmailApp.getThreadById(threadId).removeLabel(l); } catch (e) { /* ignore */ }
  }
  return true;
}

/** A draft that forwards the student's excuse (with its attachments) to the office. */
function apiMailForwardExcuse(threadId) {
  var cfg = config_(), m = mailRow_(threadId), th = GmailApp.getThreadById(threadId), me = myEmails_(cfg);
  var msg = th.getMessages().filter(function (x) { return me.indexOf(emailOf_(x.getFrom())) < 0; }).slice(-1)[0];
  var to = cfg.officeEmail || cfg.replyTo;
  var body = 'Hello,\n\nPlease find below the medical excuse that ' + m.t.get(m.r, 'Student') + ' (' + m.t.get(m.r, 'Email') + ') sent me' +
    (m.t.get(m.r, 'Excuse') ? ' (' + m.t.get(m.r, 'Excuse').replace(/^Marked Received · /, 'class: ') + ')' : '') +
    '. Could you verify it and update the attendance?\n\nThank you,\n' + signature_(cfg) + '\n\n---------- Forwarded message ----------\n' +
    'From: ' + msg.getFrom() + '\nDate: ' + Utilities.formatDate(msg.getDate(), tz_(), 'yyyy-MM-dd HH:mm') + '\nSubject: ' + msg.getSubject() + '\n\n' + msg.getPlainBody();
  GmailApp.createDraft(to, 'Medical excuse – ' + m.t.get(m.r, 'Student'), body, { attachments: msg.getAttachments(), replyTo: cfg.replyTo });
  return { to: to, url: 'https://mail.google.com/mail/u/0/#drafts' };
}

/* ---------- screenshots dropped in the dashboard ---------- */

var PHASE_FOLDERS = { present: '1. Present', tardy: '2. Tardy', end: '3. Absent' };
/** Zoom moments + "populi": a screenshot of Populi's attendance for an in-person class, recorded exactly as marked. */
var SHOT_KINDS = ['present', 'tardy', 'end', 'populi'];

/** The Drive folder that holds this class's screenshots for that date (created under TA Inbox / Processed). */
function sessionFolder_(ctx, cls, date) {
  var row = sessionRow_(ctx, cls, date, true), t = ctx.sessT, id = t.get(row, 'Source ID');
  if (/screenshot/i.test(t.get(row, 'Source')) && id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ }
  }
  var inbox = DriveApp.getFolderById(ctx.cfg.inboxFolderId), done = subfolder_(inbox, 'Processed');
  var p = date.split('-'), week = termWeek(date, ctx.cfg.termStart) || '';
  var name = cls.course.split(':')[0] + ' - Week ' + (week < 10 ? '0' : '') + week + ' - ' + p[1] + '.' + p[2] + '.' + p[0].slice(2);
  var f = subfolder_(done, name);
  Object.keys(PHASE_FOLDERS).forEach(function (k) { subfolder_(f, PHASE_FOLDERS[k]); });
  t.set(row, 'Source', 'Zoom screenshots');
  t.set(row, 'Source ID', f.getId());
  return f;
}

function readOcrJson_(folder) {
  var it = folder.getFilesByName('ocr.json');
  var data = { images: 0 }, file = null;
  if (it.hasNext()) { file = it.next(); data = JSON.parse(file.getBlob().getDataAsString()); }
  ['phases', 'ai', 'files'].forEach(function (f) {
    data[f] = data[f] || {};
    SHOT_KINDS.forEach(function (k) { data[f][k] = data[f][k] || []; });
  });
  return { file: file, data: data };
}

function writeOcrJson_(folder, saved) {
  var json = JSON.stringify(saved.data);
  if (saved.file) saved.file.setContent(json); else saved.file = folder.createFile('ocr.json', json, 'application/json');
}

/** One screenshot from the dashboard: saved in Drive, read with OCR, added to that moment. Returns how much it read. */
/** Only what saving a screenshot needs (Config, Classes, Sessions): much faster than reading every sheet. */
function loadLite_() {
  var ctx = { cfg: config_() }, ct = table_('Classes');
  ctx.classes = ct.rows.map(function (r) {
    return { id: ct.get(r, 'Class ID'), course: ct.get(r, 'Course'), section: ct.get(r, 'Section'), day: ct.get(r, 'Day'),
      start: hmToMin(ct.get(r, 'Start')), end: hmToMin(ct.get(r, 'End')), mode: ct.get(r, 'Mode'), active: true };
  }).filter(function (c) { return c.id && c.start != null; });
  ctx.sessT = table_('Sessions');
  return ctx;
}

/**
 * Speed: before a batch of uploads, make the class folder once (locked) and hand its moment folders to the page, so each
 * screenshot is then saved without the lock and without reading the sheets (really in parallel).
 */
function apiPrepareShots(classId, date) {
  var out;
  withLock_(function () {
    var ctx = loadLite_(), cls = classById_(ctx, classId);
    if (!cls) throw new Error('No class ' + classId);
    var folder = sessionFolder_(ctx, cls, date);
    save_(ctx.sessT);
    var subs = { populi: claudeReads_(ctx.cfg) ? subfolder_(folder, 'Populi').getId() : '' };
    Object.keys(PHASE_FOLDERS).forEach(function (k) { subs[k] = subfolder_(folder, PHASE_FOLDERS[k]).getId(); });
    out = { folderId: folder.getId(), subs: subs, claude: claudeReads_(ctx.cfg) };
  });
  return out;
}

function apiUploadShot(classId, date, phase, name, mime, base64, subId) {
  if (!PHASE_FOLDERS[phase] && phase !== 'populi') throw new Error('Unknown moment: ' + phase);
  if (subId) return uploadFast_(classId, phase, name, mime, base64, subId);
  var ctx, cls, folder, file;
  // 1. Save the image (locked: the class folder must be created once).
  withLock_(function () {
    ctx = loadLite_(); cls = classById_(ctx, classId);
    if (!cls) throw new Error('No class ' + classId);
    folder = sessionFolder_(ctx, cls, date);
    save_(ctx.sessT);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', name || 'screenshot.jpg');
    if (phase === 'populi' && !claudeReads_(ctx.cfg)) throw new Error('Populi screenshots are read by Claude: set "Screenshots read by" to CLAUDE in Config.');
    file = subfolder_(folder, PHASE_FOLDERS[phase] || 'Populi').createFile(blob);
  });
  if (!file) throw new Error('Busy — try again in a few seconds.');
  // 2. Read it (slow, so not locked): free OCR always, and Claude when it is on. With CLAUDE, Claude reads it from Drive later.
  var claude = claudeReads_(ctx.cfg);
  var text = claude ? '' : ocrText_(file), ai = null, aiError = '';
  if (!claude && aiOn_(ctx.cfg, 'aiScreenshots')) {
    try { ai = aiReadShot_(ctx, cls, phase, file.getBlob()); } catch (e) { aiError = String(e && e.message || e); }
  }
  // 3. Add it to the class's saved readings.
  var out;
  withLock_(function () {
    var saved = readOcrJson_(folder);
    saved.data.phases[phase].push(text);
    saved.data.ai[phase].push(ai);
    saved.data.files[phase].push(file.getId());
    saved.data.images = (saved.data.images || 0) + 1;
    writeOcrJson_(folder, saved);
    if (claude) {
      claudeJob_(ctx, cls, date, folder, saved.data);
      out = { phase: phase, names: 0, count: saved.data.phases[phase].length, ai: false, claude: true };
      return;
    }
    var n = ai ? (ai.participants || []).length + (ai.chat || []).length : (function (x) { return x.tiles.length + x.chat.length; })(readScreenshotText(text));
    out = { phase: phase, names: n, count: saved.data.phases[phase].length, ai: !!ai, aiError: aiError };
  });
  if (!out) throw new Error('Busy — try again in a few seconds.');
  return out;
}

/** One screenshot into a folder from apiPrepareShots: no lock, no ocr.json; apiAnalyzeSession registers the batch. */
function uploadFast_(classId, phase, name, mime, base64, subId) {
  if (phase === 'populi' && !subId) throw new Error('Populi screenshots are read by Claude: set "Screenshots read by" to CLAUDE in Config.');
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', name || 'screenshot.jpg');
  var file = DriveApp.getFolderById(subId).createFile(blob), cfg = config_(), claude = claudeReads_(cfg);
  var text = claude ? '' : ocrText_(file), ai = null, aiError = '';
  if (!claude && aiOn_(cfg, 'aiScreenshots')) {
    var ctx = loadLite_(), cls = classById_(ctx, classId);
    try { ai = aiReadShot_(ctx, cls, phase, file.getBlob()); } catch (e) { aiError = String(e && e.message || e); }
  }
  var n = claude ? 0 : ai ? (ai.participants || []).length + (ai.chat || []).length : (function (x) { return x.tiles.length + x.chat.length; })(readScreenshotText(text));
  return { phase: phase, fileId: file.getId(), text: text, ai: ai, aiError: aiError, names: n, claude: claude };
}

/** Screenshots of a class saved before AI was on (or where AI failed): their Drive ids, to read them again with AI. */
function apiShotFiles(classId, date) {
  var ctx = loadLite_(), cls = classById_(ctx, classId), folder = sessionFolder_(ctx, cls, date), saved = readOcrJson_(folder);
  var out = {};
  ['present', 'tardy', 'end'].forEach(function (k) {
    var ids = saved.data.files[k];
    if (ids.length !== saved.data.phases[k].length) {
      // Older folders: same order as the OCR (by file name).
      var it = subfolder_(folder, PHASE_FOLDERS[k]).getFiles(), list = [];
      while (it.hasNext()) { var f = it.next(); if (/^image\//.test(f.getMimeType())) list.push(f); }
      ids = list.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; }).map(function (f) { return f.getId(); });
    }
    out[k] = ids.map(function (id, i) { return { id: id, index: i, done: !!saved.data.ai[k][i] }; });
  });
  return out;
}

/** Read one saved screenshot with AI and store the result in its slot. */
function apiAiReadFile(classId, date, phase, index, fileId) {
  var ctx = loadLite_(), cls = classById_(ctx, classId), folder = sessionFolder_(ctx, cls, date);
  var ai = aiReadShot_(ctx, cls, phase, DriveApp.getFileById(fileId).getBlob());
  withLock_(function () {
    var saved = readOcrJson_(folder);
    saved.data.ai[phase][index] = ai;
    saved.data.files[phase][index] = fileId;
    writeOcrJson_(folder, saved);
  });
  return { ok: true, names: (ai.participants || []).length + (ai.chat || []).length };
}

/** After the uploads: analyze the class with every screenshot read so far. */
function apiAnalyzeSession(classId, date, shots, registerOnly) {
  var msg, waiting = false;
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId);
    var folder = sessionFolder_(ctx, cls, date), saved = readOcrJson_(folder);
    // The batch saved by uploadFast_ (in the order it was dropped): one ocr.json write and one Claude job for all.
    if (shots && shots.length) {
      shots.forEach(function (x) {
        if (!x || !saved.data.phases[x.phase] || saved.data.files[x.phase].indexOf(x.fileId) >= 0) return;
        saved.data.phases[x.phase].push(x.text || '');
        saved.data.ai[x.phase].push(x.ai || null);
        saved.data.files[x.phase].push(x.fileId);
        saved.data.images = (saved.data.images || 0) + 1;
      });
      writeOcrJson_(folder, saved);
      if (claudeReads_(ctx.cfg)) claudeJob_(ctx, cls, date, folder, saved.data);
    }
    if (registerOnly) { msg = 'Saved ' + (shots || []).length + ' screenshot(s).'; return; }
    var unread = claudeUnread_(saved.data);
    if (claudeBlocks_(saved.data)) {
      // Nothing is marked from screenshots nobody has read yet (it would make everyone absent).
      msg = 'Saved. Waiting for Claude to read ' + unread + ' screenshot(s): it checks weekdays at 1:15, 3:15 and 7:15 PM (after your TA hours), or ask Claude in the chat to read them now. The attendance is taken a few minutes after Claude reads them.';
      waiting = true;
      return;
    }
    msg = takeFromShots_(ctx, cls, date, folder, saved.data);
    appendRow_('Inbox log', [nowStr_(), folder.getName() + '/ (dashboard)', 'screenshots', cls.id, date, msg]);
    runLight_(ctx);
  });
  return { msg: msg, waiting: waiting };
}

/** Remove the screenshots of one moment (e.g. you dropped the wrong ones). */
function apiClearShots(classId, date, phase) {
  withLock_(function () {
    var ctx = load_(), cls = classById_(ctx, classId), folder = sessionFolder_(ctx, cls, date);
    save_(ctx.sessT);
    var sub = subfolder_(folder, PHASE_FOLDERS[phase] || 'Populi'), files = sub.getFiles();
    while (files.hasNext()) files.next().setTrashed(true);
    var saved = readOcrJson_(folder);
    saved.data.images = Math.max(0, (saved.data.images || 0) - saved.data.phases[phase].length);
    saved.data.phases[phase] = []; saved.data.ai[phase] = []; saved.data.files[phase] = [];
    writeOcrJson_(folder, saved);
    if (claudeReads_(ctx.cfg)) claudeJob_(ctx, cls, date, folder, saved.data);
  });
  return true;
}

/* ---------- Claude reads the screenshots (from this account's Drive, no API key) ----------
 * With "Screenshots read by" = CLAUDE, each class folder (TA Inbox/Processed/<class - week - date>) gets claude-job.json:
 * the class, date, real start, roster in Populi order, names to ignore and the screenshots still to read (Drive file ids).
 * Claude (Google Drive connected with this account) writes claude-results.json next to it:
 * {present:[r], tardy:[r], end:[r]}, one r per screenshot (same index as the job) in the AI_SHOT_SCHEMA shape.
 * The next run (or "Check Claude's results") puts them in ocr.json and takes the attendance; the results file is then
 * renamed "claude-results applied.json" and the job is marked done.
 */
function claudeReads_(cfg) { return /^claude$/i.test(String(cfg.screenshotReader || '').trim()); }

/** Screenshots saved without any reading (no OCR text, no AI result). */
/**
 * Must the attendance wait for Claude? Zoom: yes while any screenshot is unread (a missing one would make people absent).
 * Populi (in person): only while none is read: each Populi screenshot stands on its own, so a re-upload never blocks.
 */
function claudeBlocks_(data) {
  var zoom = ['present', 'tardy', 'end'].some(function (k) { return data.phases[k].length; });
  if (zoom || !data.phases.populi.length) return claudeUnread_(data) > 0;
  return !data.ai.populi.some(Boolean);
}

function claudeUnread_(data) {
  return SHOT_KINDS.reduce(function (n, k) {
    return n + data.phases[k].filter(function (t, i) { return !t && !data.ai[k][i]; }).length;
  }, 0);
}

function claudeJob_(ctx, cls, date, folder, data) {
  var st = table_('Students'), shots = {};
  SHOT_KINDS.forEach(function (k) {
    shots[k] = data.files[k].map(function (id, i) { return { index: i, fileId: id, read: !!(data.phases[k][i] || data.ai[k][i]) }; });
  });
  var job = {
    status: claudeUnread_(data) ? 'waiting' : 'done', classId: cls.id, course: classLabel(cls), date: date,
    kind: data.phases.populi.length ? 'populi' : 'zoom',
    start: minToLabel(sessionStart_(ctx, cls, date)),
    ignore: String(ctx.cfg.ignoreNames || '').split(/\s*;\s*/).filter(String),
    roster: st.rows.map(function (r) { return studentFrom_(st, r); })
      .filter(function (s) { return s.classId === cls.id && s.active; })
      .sort(function (a, b) { return (a.order || 1e6) - (b.order || 1e6); })
      .map(function (s) { return { order: s.order, name: s.name, aliases: s.aliases || [] }; }),
    shots: shots
  };
  claudeWaiting_(folder.getId(), job.status === 'waiting');
  var it = folder.getFilesByName('claude-job.json'), json = JSON.stringify(job, null, 1);
  if (it.hasNext()) it.next().setContent(json); else folder.createFile('claude-job.json', json, 'application/json');
}

/** Results Claude left in the class folders → attendance. Returns one line per class taken. */
/**
 * Class folders whose screenshots wait for Claude (script property), so checking for results only opens those folders.
 * null = not known yet (made before this list existed): every screenshot folder is checked once.
 */
function claudeWaitingList_() {
  var v = PropertiesService.getScriptProperties().getProperty('claudeWaiting');
  try { return v == null ? null : JSON.parse(v); } catch (e) { return null; }
}
function claudeWaiting_(folderId, on) {
  var list = claudeWaitingList_() || [], i = list.indexOf(folderId);
  if (on && i < 0) list.push(folderId);
  if (!on && i >= 0) list.splice(i, 1);
  PropertiesService.getScriptProperties().setProperty('claudeWaiting', JSON.stringify(list));
}

/** Every 5 minutes (cheap when nothing waits): take the attendance as soon as Claude's results are in the folder. */
function claudeCheck() {
  var list = claudeWaitingList_();
  if (list && !list.length) return;
  var lines = [];
  withLock_(function () {
    var ctx = load_();
    lines = claudeApply_(ctx);
    if (lines.length) { save_(ctx.sessT); runLight_(ctx); }
  });
  if (lines.length) snapshotBuild_();
}

function claudeApply_(ctx) {
  if (!claudeReads_(ctx.cfg)) return [];
  var out = [], y = yearOf_(ctx), t = ctx.sessT, waiting = claudeWaitingList_();
  t.rows.forEach(function (row) {
    var id = t.get(row, 'Source ID');
    if (!/screenshot/i.test(t.get(row, 'Source')) || !id) return;
    if (waiting && waiting.indexOf(id) < 0) return;
    var folder;
    try { folder = DriveApp.getFolderById(id); } catch (e) { return; }
    var it = folder.getFilesByName('claude-results.json');
    if (!it.hasNext()) return;
    var rf = it.next(), cls = classById_(ctx, t.get(row, 'Class ID')), date = parseDateCell(t.get(row, 'Date'), y);
    if (!cls) return;
    var res;
    try { res = JSON.parse(rf.getBlob().getDataAsString()); } catch (e) { out.push(classLabel(cls) + ' ' + date + ': claude-results.json is not valid JSON'); return; }
    var saved = readOcrJson_(folder);
    SHOT_KINDS.forEach(function (k) {
      (res[k] || []).forEach(function (r, i) { if (r && i < saved.data.phases[k].length) saved.data.ai[k][i] = r; });
    });
    writeOcrJson_(folder, saved);
    rf.setName('claude-results applied.json');
    claudeJob_(ctx, cls, date, folder, saved.data);
    if (claudeBlocks_(saved.data)) { out.push(classLabel(cls) + ' ' + date + ': some screenshots are still waiting for Claude'); return; }
    var msg = takeFromShots_(ctx, cls, date, folder, saved.data);
    appendRow_('Inbox log', [nowStr_(), folder.getName() + '/ (read by Claude)', 'screenshots', cls.id, date, msg]);
    out.push(classLabel(cls) + ' ' + date + ': ' + msg);
  });
  return out;
}

/** Attendance from the screenshots of a class: Populi screenshots as marked, else the Zoom moments rule. */
function takeFromShots_(ctx, cls, date, folder, data) {
  if (data.phases.populi.length) return populiShots_(ctx, cls, date, folder, data);
  return processScreenshotSession_(ctx, cls, date, data.phases, folder.getId(), data.images || 0, data.ai);
}

var POPULI_STATUS = { present: STATUS.P, tardy: STATUS.T, absent: STATUS.A, excused: STATUS.E };

/**
 * In-person class: Claude read Populi's attendance list ({rows:[{shown_name, roster_number, status, note, no_id, confidence}]} per
 * screenshot). Each student gets exactly the status Populi shows; no 15/31-minute rule. Unsure or unmatched rows are listed.
 */
function populiShots_(ctx, cls, date, folder, data) {
  var roster = roster_(ctx, cls.id), byOrder = {}, got = {}, entries = [], unsure = [], review = [];
  roster.forEach(function (s) { if (s.order) byOrder[s.order] = s; });
  // The latest screenshot wins (re-taken after a fix in Populi): read them newest first.
  data.ai.populi.slice().reverse().forEach(function (r) {
    ((r || {}).rows || []).forEach(function (x) {
      var s = byOrder[x.roster_number], st = POPULI_STATUS[String(x.status || '').toLowerCase()];
      if (!s || !st || (x.confidence != null && x.confidence < AI_SURE)) {
        unsure.push((x.shown_name || '?') + (x.status ? ' (' + x.status + ')' : ''));
        if (x.shown_name && !s) review.push({ name: x.shown_name, seenIn: ['Populi screenshot'], candidates: [] });
        return;
      }
      if (got[s.id]) return;
      got[s.id] = true;
      // Populi's note column: "No ID" marks the check-in without ID (counted for the office notice), any note is kept
      var note = String(x.note || '').trim(), noId = x.no_id === true || /\bno\s*id\b|forgot (his|her|their) id/i.test(note);
      entries.push({ student: s, status: st, source: 'Populi screenshot', noId: noId, notes: 'As marked in Populi' + (note ? ': ' + note : '') });
    });
  });
  var c = applyEntries_(ctx, cls, date, entries);
  var asked = addQuestions_(ctx, cls, date, review);
  touchSession_(ctx, cls, date, 'Populi screenshot', folder.getId(), sessionStart_(ctx, cls, date));
  var n = function (st) { return entries.filter(function (e) { return e.status === st; }).length; };
  var missing = roster.filter(function (s) { return !got[s.id]; }).map(function (s) { return '#' + (s.order || '?') + ' ' + s.name; });
  var msg = 'Populi screenshot: ' + n(STATUS.P) + ' present, ' + n(STATUS.T) + ' tardy, ' + n(STATUS.A) + ' absent' +
    (n(STATUS.E) ? ', ' + n(STATUS.E) + ' excused' : '') + ' (as marked in Populi). ' + c.kept + ' kept (manual/excused).';
  if (missing.length) msg += ' Not in the screenshot (not marked): ' + missing.join(', ') + '.';
  if (unsure.length) msg += ' Could not match: ' + unsure.join('; ') + '.';
  if (asked) msg += ' ' + asked + ' name(s) not on the roster to confirm in Review (answer "new" to add them).';
  return msg;
}

/** Dashboard: take the attendance from whatever Claude has already read. */
function apiClaudeResults() {
  var lines = [];
  withLock_(function () {
    var ctx = load_();
    lines = claudeApply_(ctx);
    if (lines.length) { save_(ctx.sessT); runLight_(ctx); }
  });
  return { lines: lines };
}

function apiProcessNow() {
  var res = null;
  withJob_(function () { res = runAll_(load_()); });
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

/*
 * Locks. Sheet writes take the script lock only for a moment (save_ → locked_). Dashboard edits hold it while they
 * read, change and save (a second or two). The slow jobs (Drive inbox, OCR, Gmail) never hold it: withJob_ only keeps
 * two jobs from running at once.
 */
var LOCK_DEPTH_ = 0;
function locked_(fn) {
  if (LOCK_DEPTH_) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The sheet is busy. Try again in a few seconds.');
  LOCK_DEPTH_++;
  try { return fn(); } finally { LOCK_DEPTH_--; lock.releaseLock(); }
}

/** A dashboard edit: read, change and save under the lock. Errors reach the page (never a silent skip). */
function withLock_(fn) { return locked_(fn); }

/** A background job (inbox, emails). Returns false without running when another job is still going. */
function withJob_(fn) {
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var mine = locked_(function () {
    var until = +props.getProperty('jobUntil') || 0;
    if (until > now) return false;
    props.setProperty('jobUntil', String(now + 6 * 60000)); // Apps Script stops any run at 6 minutes
    return true;
  });
  if (!mine) return false;
  try { fn(); } finally { props.setProperty('jobUntil', '0'); }
  return true;
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

/** A sheet as a header-addressable table of display strings. Remembers each row as read, so save_ writes only changes. */
function table_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh && SHEETS[name] && name !== 'Config') {
    // A sheet added by an update: create it on its own.
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat('@');
  }
  if (!sh) throw new Error('Missing sheet "' + name + '". Run TA Attendance → Set up / repair sheets.');
  var vals = sh.getDataRange().getDisplayValues();
  var header = vals[0] || [];
  // After an update, new columns appear on their own (no need to run Set up again).
  var missing = (SHEETS[name] || []).filter(function (h) { return header.indexOf(h) < 0; });
  if (missing.length && header.some(String)) {
    sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header = header.concat(missing);
  }
  var col = {}, rows = [], at = [];
  header.forEach(function (h, i) { if (h && !(h in col)) col[h] = i; });
  vals.slice(1).forEach(function (r, i) {
    while (r.length < header.length) r.push('');
    if (r.some(String)) { rows.push(r); at.push(i + 2); }
  });
  var t = {
    name: name, sheet: sh, header: header, col: col, rows: rows, ver: 0,
    at: at, orig: rows.map(function (r) { return r.slice(); }), // sheet row number and values of each row as read
    get: function (r, k) { return k in col ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : ''; },
    set: function (r, k, v) { if (k in col && r[col[k]] !== v) { r[col[k]] = v; t.ver++; } }
  };
  return t;
}

/* Columns that identify a row, so a save lands on the right row even if the sheet moved under us. */
var TABLE_KEYS = {
  Attendance: ['Date', 'Class ID', 'Student ID'], Students: ['Student ID', 'Class ID'], Sessions: ['Class ID', 'Date'],
  Review: ['Created', 'Class ID', 'Date', 'Name seen'], Mail: ['Thread ID'], Assignments: ['Class ID', 'Title', 'Due date'],
  'Follow-ups': ['Created', 'Type', 'Class', 'Class date', 'Roster #']
};

function rowKey_(t, r) {
  var keys = TABLE_KEYS[t.name];
  if (!keys) return null;
  return keys.map(function (k) { return k in t.col ? String(r[t.col[k]] == null ? '' : r[t.col[k]]).trim() : ''; }).join('|');
}

function cellStr_(v) { return v == null ? '' : String(v); }

/**
 * Writes only what this run changed. Under the script lock, the rows are read again and only the cells this run
 * changed are put on top, so a dashboard click and the 15-minute job never undo each other. Returns the rows written.
 */
function save_(t) {
  var n = t.header.length, changed = [], added = [];
  t.rows.forEach(function (r, i) {
    if (i >= t.orig.length) { added.push(i); return; }
    for (var j = 0; j < n; j++) if (cellStr_(r[j]) !== cellStr_(t.orig[i][j])) { changed.push(i); return; }
  });
  if (!changed.length && !added.length) return 0;
  var written = 0;
  locked_(function () {
    var sh = t.sheet, last = sh.getLastRow();
    var cur = last >= 2 ? sh.getRange(2, 1, last - 1, n).getDisplayValues() : [];
    var byKey = null;
    var findKey = function (k) {
      if (!byKey) { byKey = {}; cur.forEach(function (r, i) { var kk = rowKey_(t, r); if (kk && !(kk in byKey)) byKey[kk] = i + 2; }); }
      return byKey[k] || 0;
    };
    var out = {}; // sheet row → values
    changed.forEach(function (i) {
      var r = t.rows[i], o = t.orig[i], at = t.at[i], key = rowKey_(t, o);
      if (key != null && (!cur[at - 2] || rowKey_(t, cur[at - 2]) !== key)) at = findKey(key); // rows moved: find it again
      if (!at || !cur[at - 2]) { added.push(i); return; }
      var merged = out[at] || cur[at - 2].slice();
      for (var j = 0; j < n; j++) if (cellStr_(r[j]) !== cellStr_(o[j])) merged[j] = cellStr_(r[j]);
      out[at] = merged; t.at[i] = at;
    });
    // A new row whose key is already in the sheet (added meanwhile by another run) updates that row instead.
    var append = [];
    added.forEach(function (i) {
      var r = t.rows[i], key = rowKey_(t, r), at = key != null ? findKey(key) : 0;
      if (at) {
        var merged = out[at] || cur[at - 2].slice();
        for (var j = 0; j < n; j++) if (cellStr_(r[j]) !== '') merged[j] = cellStr_(r[j]);
        out[at] = merged; t.at[i] = at;
      } else append.push(i);
    });
    var nums = Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
    if (nums.length) {
      var runs = [], run = [nums[0]];
      for (var k = 1; k < nums.length; k++) {
        if (nums[k] === run[run.length - 1] + 1) run.push(nums[k]); else { runs.push(run); run = [nums[k]]; }
      }
      runs.push(run);
      if (runs.length > 3) runs = [rangeOf_(nums[0], nums[nums.length - 1])]; // many scattered rows: one write is faster
      runs.forEach(function (rs) {
        sh.getRange(rs[0], 1, rs.length, n).setValues(rs.map(function (x) { return out[x] || cur[x - 2]; }));
      });
      written += nums.length;
    }
    if (append.length) {
      var start = Math.max(last, 1) + 1;
      sh.getRange(start, 1, append.length, n).setValues(append.map(function (i) { return t.rows[i].slice(0, n).map(cellStr_); }));
      append.forEach(function (i, k) { t.at[i] = start + k; });
      written += append.length;
    }
  });
  t.orig = t.rows.map(function (r) { return r.slice(); });
  while (t.at.length < t.rows.length) t.at.push(0);
  bumpCache_();
  return written;
}

function rangeOf_(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }

function blankRow_(t) { return t.header.map(function () { return ''; }); }

/* Short-lived cache of what the dashboard reads; any write starts a new generation, so it is never stale. */
function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
function cacheGen_() { return PropertiesService.getScriptProperties().getProperty('gen') || '0'; }
function bumpCache_() { PropertiesService.getScriptProperties().setProperty('gen', String(Date.now()) + String(Math.random()).slice(2, 6)); }
// CacheService keeps at most 100 KB per key: big answers (apiAll) are split in pieces.
var CACHE_PIECE_ = 40000;
function cacheGet_(key) { return cacheGetKey_(cacheGen_() + ':' + key); }
function cachePut_(key, obj, seconds) { cachePutKey_(cacheGen_() + ':' + key, obj, seconds); }
function cacheGetKey_(k) {
  var c = cache_(); if (!c) return null;
  var head = c.get(k);
  if (!head) return null;
  try {
    var m = head.match(/^pieces:(\d+)$/);
    if (!m) return JSON.parse(head);
    var names = []; for (var i = 0; i < +m[1]; i++) names.push(k + '#' + i);
    var got = c.getAll ? c.getAll(names) : names.reduce(function (o, n) { o[n] = c.get(n); return o; }, {});
    var text = names.map(function (n) { return got[n]; });
    if (text.some(function (x) { return x == null; })) return null;
    return JSON.parse(text.join(''));
  } catch (e) { return null; }
}
function cachePutKey_(k, obj, seconds) {
  var c = cache_(); if (!c) return;
  var text = JSON.stringify(obj);
  try {
    if (text.length <= CACHE_PIECE_) { c.put(k, text, seconds || 300); return; }
    var pieces = {}, n = Math.ceil(text.length / CACHE_PIECE_);
    for (var i = 0; i < n; i++) pieces[k + '#' + i] = text.slice(i * CACHE_PIECE_, (i + 1) * CACHE_PIECE_);
    if (c.putAll) c.putAll(pieces, seconds || 300); else Object.keys(pieces).forEach(function (p) { c.put(p, pieces[p], seconds || 300); });
    c.put(k, 'pieces:' + n, seconds || 300);
  } catch (e) { /* the cache is only a shortcut */ }
}

function appendRow_(name, row) {
  bumpCache_();
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
    since: parseDateCell(t.get(r, 'On roster since')) || '',
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

/** Attendance rows as records (parsed once per request, again only after a change). */
function records_(ctx) {
  var t = ctx.att, stamp = t.ver + ':' + t.rows.length;
  if (ctx._recs && ctx._recsAt === stamp) return ctx._recs;
  ctx._recsAt = stamp;
  return (ctx._recs = records0_(ctx));
}

/** Totals per class|student over all records (memoized like records_). */
function totals_(ctx) {
  var recs = records_(ctx);
  if (ctx._totals && ctx._totalsOf === recs) return ctx._totals;
  ctx._totalsOf = recs;
  return (ctx._totals = tally(recs, ctx.cfg));
}

function records0_(ctx) {
  var t = ctx.att, y = yearOf_(ctx);
  return t.rows.map(function (r) {
    return {
      date: parseDateCell(t.get(r, 'Date'), y), classId: t.get(r, 'Class ID'), studentId: t.get(r, 'Student ID'),
      name: t.get(r, 'Name'), status: normalizeStatus(t.get(r, 'Status')), excuse: t.get(r, 'Excuse'),
      excuseDate: parseDateCell(t.get(r, 'Excuse date'), y), leftEarly: yes_(t.get(r, 'Left early'))
    };
  }).filter(function (r) { return r.date && r.classId && r.studentId; });
}
