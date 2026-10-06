// End-to-end: the real Code.js on a simulated spreadsheet, Drive inbox and Gmail. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./gas-mock');

function setupTerm(opts) {
  // Monday Oct 5 2026, 10:00 AM in Indiana (UTC-4)
  const env = makeEnv({ now: '2026-10-05T14:00:00Z', ...opts });
  const { gas } = env;
  gas.setup();
  const classes = env.sheet('Classes');
  const rows = [
    ['C1', 'ENG 111', '01', 'Prof. Adams', '', 'Monday', '9:00 AM', '1:00 PM', 'In person', '', 'Yes'],
    ['C2', 'MATH 123', '02', 'Prof. Baker', '', 'Monday', '1:30 PM', '2:30 PM', 'In person', '', 'Yes'],
    ['C3', 'BIO 101', '03', 'Prof. Cruz', '', 'Monday', '6:00 PM', '7:00 PM', 'Zoom', '812 3456 7890', 'Yes'],
    ['C4', 'PSY 201', '04', 'Prof. Diaz', '', 'Thursday', '9:00 AM', '10:00 AM', 'Zoom', '', 'Yes']
  ];
  classes.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  const students = [
    ['1001', 'Ana Maria Lopez', 'ana@ivy.edu', 'C3', 'Yes'],
    ['1002', 'Brian Smith', 'brian@ivy.edu', 'C3', 'Yes'],
    ['1003', 'Carla Pérez', 'carla@ivy.edu', 'C3', 'Yes'],
    ['1004', 'David Kim', 'david@ivy.edu', 'C3', 'Yes']
  ];
  env.sheet('Students').getRange(2, 1, students.length, 5).setValues(students);
  const cfgSheet = env.sheet('Config');
  env.setConfig = (label, value) => {
    const i = cfgSheet.data.findIndex(r => r[0] === label);
    assert.ok(i > 0, 'config label ' + label);
    cfgSheet.put(i + 1, 2, value);
  };
  // These tests check the Gmail path; the POPULI default has its own tests below.
  env.setConfig('Email mode', (opts && opts.mode) || 'DRAFT');
  env.inbox = () => env.rootFolders.find(f => f.name === 'TA Inbox');
  env.att = () => env.sheet('Attendance').objects();
  env.row = (date, cls, id) => env.att().find(r => r.Date === date && r['Class ID'] === cls && r['Student ID'] === id);
  return env;
}

const populiC1 = [
  'Student ID,Last Name,First Name,Email,Date,Status,Check-in Time',
  '2001,Ramos,Elena,elena@ivy.edu,10/5/2026,Present,8:58 AM',
  '2002,Nguyen,Tom,tom@ivy.edu,10/5/2026,Present,9:15 AM',
  '2003,Okafor,Grace,grace@ivy.edu,10/5/2026,Present,9:16 AM',
  '2004,Silva,Luis,luis@ivy.edu,10/5/2026,Present,9:45 AM',
  '2005,Brown,Mia,mia@ivy.edu,10/5/2026,Absent,'
].join('\n');

test('setup creates the sheets, the Drive inbox and the 4 classes', () => {
  const env = makeEnv();
  env.gas.setup();
  for (const n of ['Config', 'Classes', 'Students', 'Attendance', 'Assignments', 'Summary', 'Follow-ups', 'Outbox', 'Inbox log']) assert.ok(env.sheet(n), n);
  const inbox = env.rootFolders.find(f => f.name === 'TA Inbox');
  assert.ok(inbox);
  assert.deepEqual(inbox.folders.map(f => f.name).sort(), ['Needs attention', 'Processed']);
  assert.equal(env.sheet('Classes').objects().length, 4);
  const cfg = Object.fromEntries(env.sheet('Config').data.map(r => [r[0], r[1]]));
  assert.equal(cfg['Reply-To email'], 'dgomez230@ivy.edu');
  assert.equal(cfg['Email mode'], 'POPULI');
  assert.match(cfg['Populi visibility'], /Academic Admin, Account Admin, Admissions Admin, Staff, Academic Auditor, Admissions/);
  assert.equal(cfg['Send notices from'], '2026-10-05'); // the term start
  assert.equal(cfg['Inbox folder ID'], inbox.id);
  // running setup again keeps everything (no duplicates)
  env.gas.setup();
  assert.equal(env.sheet('Config').objects().filter(r => r.Setting === 'Reply-To email').length, 1);
  assert.equal(env.rootFolders.length, 1);
});

test('Populi export → roster, 15/30 rule, missing = absent, draft notices with Reply-To', () => {
  const env = setupTerm();
  env.inbox().addFile('ENG attendance [C1].csv', populiC1);
  env.gas.tick();
  // file moved to Processed and logged
  assert.equal(env.inbox().files.length, 0);
  assert.equal(env.inbox().folders.find(f => f.name === 'Processed').files.length, 1);
  assert.match(env.sheet('Inbox log').objects()[0].Result, /5 added.*file name tag.*5 new student/);
  // statuses by check-in time
  const st = id => env.row('2026-10-05', 'C1', id).Status;
  assert.equal(st('2001'), 'Present');
  assert.equal(st('2002'), 'Present');  // 9:15 → minute 15
  assert.equal(st('2003'), 'Tardy');    // 9:16
  assert.equal(st('2004'), 'Absent');   // 9:45
  assert.equal(st('2005'), 'Absent');
  assert.equal(env.row('2026-10-05', 'C1', '2003')['Minutes late'], '16');
  // 3 notices as Gmail drafts, Reply-To set
  assert.equal(env.mail.drafts.length, 3);
  assert.equal(env.mail.sent.length, 0);
  assert.ok(env.mail.drafts.every(d => d.replyTo === 'dgomez230@ivy.edu' && d.name === 'Diego Gomez' && d.htmlBody));
  const grace = env.mail.drafts.find(d => d.to === 'grace@ivy.edu');
  assert.match(grace.subject, /ENG 111 \(01\).*Tardy/);
  assert.match(grace.body, /9:00 AM – 1:00 PM/);
  assert.match(env.row('2026-10-05', 'C1', '2003').Notified, /^Tardy · 2026-10-05 10:00 · DRAFT$/);
  // Summary
  const sum = env.sheet('Summary').objects().filter(r => r['Class ID'] === 'C1');
  assert.equal(sum.length, 5);
  assert.equal(sum.find(r => r['Student ID'] === '2004')['Absences left'], '1');
  // nothing is sent twice
  env.gas.tick();
  assert.equal(env.mail.drafts.length, 3);
});

test('Zoom report: class by meeting ID, left early, not seen, unmatched names', () => {
  const env = setupTerm();
  env.inbox().addFile('participants_81234567890.csv', [
    'Meeting ID,Topic,Start Time',
    '81234567890,BIO 101,10/05/2026 05:55:00 PM',
    '',
    'Name (Original Name),User Email,Join Time,Leave Time,Duration (Minutes),Guest',
    'Ana Maria Lopez,,10/05/2026 06:03:00 PM,10/05/2026 07:00:00 PM,57,Yes',
    'Brian Smith,,10/05/2026 06:25:00 PM,10/05/2026 07:00:00 PM,35,Yes',
    'Carla Perez,,10/05/2026 06:00:00 PM,10/05/2026 06:30:00 PM,30,Yes',
    'Random Name,,10/05/2026 06:00:00 PM,10/05/2026 07:00:00 PM,60,Yes'
  ].join('\n'));
  env.setNow('2026-10-05T23:30:00Z');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C3', '1002').Status, 'Tardy');
  const carla = env.row('2026-10-05', 'C3', '1003');
  assert.equal(carla.Status, 'Absent');
  assert.equal(carla['Left early'], 'Yes');
  assert.match(carla.Notes, /6:00 PM–6:30 PM/);
  assert.equal(env.row('2026-10-05', 'C3', '1004').Status, 'Absent');
  assert.match(env.sheet('Inbox log').objects()[0].Result, /Zoom meeting ID.*Random Name/);
  const carlaMail = env.mail.drafts.find(d => d.to === 'carla@ivy.edu');
  assert.match(carlaMail.subject, /left early/);
  assert.match(carlaMail.body, /left before the end of class/);
  assert.equal(env.mail.drafts.length, 3);
});

test('manual edits win over re-imports; accepted excuses stop counting', () => {
  const env = setupTerm();
  env.inbox().addFile('a [C1].csv', populiC1);
  env.gas.tick();
  const sh = env.sheet('Attendance'), h = sh.data[0];
  const rowIdx = sh.data.findIndex(r => r[h.indexOf('Student ID')] === '2004');
  // Diego changes Luis to Present by hand (onEdit marks it Manual)
  sh.put(rowIdx + 1, h.indexOf('Status') + 1, 'Present');
  env.gas.onEdit({ range: sh.getRange(rowIdx + 1, h.indexOf('Status') + 1) });
  assert.equal(env.row('2026-10-05', 'C1', '2004').Source, 'Manual');
  env.inbox().addFile('b [C1].csv', populiC1);
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '2004').Status, 'Present');
  assert.match(env.sheet('Inbox log').objects()[1].Result, /1 kept/);
  // Mia's medical excuse accepted → not counted
  const mia = sh.data.findIndex(r => r[h.indexOf('Student ID')] === '2005');
  sh.put(mia + 1, h.indexOf('Excuse') + 1, 'Accepted');
  env.gas.tick();
  const s = env.sheet('Summary').objects().find(r => r['Student ID'] === '2005');
  assert.equal(s['Counted absences'], '0');
  assert.equal(s.Excused, '1');
});

test('left early typed by hand → Absent + a new notice', () => {
  const env = setupTerm();
  env.inbox().addFile('a [C1].csv', populiC1);
  env.gas.tick();
  const n = env.mail.drafts.length;
  const sh = env.sheet('Attendance'), h = sh.data[0];
  const i = sh.data.findIndex(r => r[h.indexOf('Student ID')] === '2001');
  sh.put(i + 1, h.indexOf('Left early') + 1, 'Yes');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '2001').Status, 'Absent');
  assert.equal(env.mail.drafts.length, n + 1);
  assert.match(env.mail.drafts.at(-1).subject, /left early/);
});

test('third time without ID → office notice (once)', () => {
  const env = setupTerm();
  env.setConfig('Office email', 'office@ivy.edu');
  const sh = env.sheet('Attendance');
  ['2026-09-21', '2026-09-28', '2026-10-05'].forEach(d => sh.appendRow([d, 'C3', '1001', 'Ana Maria Lopez', 'Present', '', 'Manual', 'Yes']));
  env.gas.tick();
  const office = env.mail.drafts.filter(d => d.to === 'office@ivy.edu');
  assert.equal(office.length, 1);
  assert.match(office[0].body, /time number 3/);
  assert.match(office[0].body, /2026-09-21, 2026-09-28, 2026-10-05/);
  env.gas.tick();
  assert.equal(env.mail.drafts.filter(d => d.to === 'office@ivy.edu').length, 1);
});

test('absences before "Send notices from" are not emailed', () => {
  const env = setupTerm();
  env.sheet('Attendance').appendRow(['2026-09-28', 'C3', '1001', 'Ana Maria Lopez', 'Absent', '', 'Populi']);
  env.gas.tick();
  assert.equal(env.mail.drafts.length, 0);
  assert.match(env.row('2026-09-28', 'C3', '1001').Notified, /not sent/);
});

test('SEND mode sends right away; LOG mode only writes Outbox', () => {
  const env = setupTerm();
  env.setConfig('Email mode', 'SEND');
  env.inbox().addFile('a [C1].csv', populiC1);
  env.gas.tick();
  assert.equal(env.mail.sent.length, 3);
  const env2 = setupTerm();
  env2.setConfig('Email mode', 'LOG');
  env2.inbox().addFile('a [C1].csv', populiC1);
  env2.gas.tick();
  assert.equal(env2.mail.sent.length + env2.mail.drafts.length, 0);
  assert.equal(env2.sheet('Outbox').objects().length, 3);
});

test('unknown file goes to "Needs attention"', () => {
  const env = setupTerm();
  env.inbox().addFile('random.csv', 'Student,Date,Status\nNobody Here,10/5/2026,Absent');
  env.inbox().addFile('photo.png', 'xx', 'image/png');
  env.gas.tick();
  const bad = env.inbox().folders.find(f => f.name === 'Needs attention');
  assert.equal(bad.files.length, 2);
  const log = env.sheet('Inbox log').objects();
  assert.match(log[0].Result, /Could not tell the class/);
  assert.match(log[1].Result, /Export it as CSV/);
});

test('Friday report is emailed; assignment reminders go to the class in BCC', () => {
  const env = setupTerm();
  env.inbox().addFile('a [C1].csv', populiC1);
  env.gas.tick();
  env.setNow('2026-10-09T12:00:00Z'); // Friday
  env.gas.weeklyReport();
  assert.equal(env.mail.sent.length, 1);
  const rep = env.mail.sent[0];
  assert.equal(rep.to, 'dgomez230@ivy.edu');
  assert.match(rep.body, /== ENG 111 \(01\)/);
  assert.match(rep.body, /Luis Silva — 2026-10-05 — Absent/);
  assert.match(rep.body, /== BIO 101 \(03\)[\s\S]*Not available: no attendance loaded this week/); // no data ≠ full attendance

  env.sheet('Assignments').appendRow(['C3', 'Lab report 2', '2026-10-12', '3,1', 'Upload it to Populi.']);
  env.gas.assignmentReminders();
  const rem = env.mail.drafts.filter(d => /Lab report 2/.test(d.subject));
  assert.equal(rem.length, 1);
  assert.equal(rem[0].to, 'dgomez230@ivy.edu');
  assert.equal(rem[0].bcc.split(',').length, 4);
  assert.match(rem[0].body, /due in 3 days/);
  env.gas.assignmentReminders();
  assert.equal(env.mail.drafts.filter(d => /Lab report 2/.test(d.subject)).length, 1);
});

test('automations: 3 triggers, reinstalling does not duplicate them', () => {
  const env = setupTerm();
  env.gas.installTriggers();
  env.gas.installTriggers();
  assert.deepEqual(env.triggers.map(t => t.handler).sort(), ['assignmentReminders', 'tick', 'weeklyReport']);
  assert.deepEqual(env.triggers.find(t => t.handler === 'weeklyReport').spec, [['timeBased'], ['onWeekDay', 'FRIDAY'], ['atHour', 8]]);
});

/* ---------- Populi workflow: roster order, follow-ups for Populi, weekly grid, screenshots ---------- */

// Roster → Actions → Export this section CSV (Populi's own order, not alphabetical)
const rosterHA103 = [
  'Student,Program,Status,Credits,Hours,Attendance',
  'Mara Alba,Biblical Studies,Enrolled,4.00,40.00,100%',
  'Teo Arce,Biblical Studies,Enrolled,4.00,40.00,100%',
  'Quinn Alder,Business Administration,Enrolled,4.00,40.00,0%',
  'Moe Allen,Business Administration,Enrolled,4.00,40.00,100%',
  'Zed Withdrawn,Business Administration,Withdrawn,4.00,40.00,0%'
].join('\n');

function populiTerm() {
  const env = setupTerm({ mode: 'POPULI' });
  env.sheet('Classes').put(4, 2, 'HA 103: History of World Religions'); // C3
  env.inbox().addFile('HA_103_roster.csv', rosterHA103);
  env.gas.tick();
  return env;
}

test('Populi roster export keeps Populi\'s order and is found by the course code', () => {
  const env = populiTerm();
  assert.match(env.sheet('Inbox log').objects()[0].Result, /Roster in Populi order: 5 students \(5 new, 5 inactive\). Class by course name/); // 1 withdrawn + the 4 old test students
  const c3 = env.sheet('Students').objects().filter(s => s['Class ID'] === 'C3' && s.Active === 'Yes');
  // the 4 test students from setupTerm are not in Populi's roster → inactive; the export defines the class
  assert.deepEqual(c3.map(s => [s.Order, s.Name]),
    [['1', 'Mara Alba'], ['2', 'Teo Arce'], ['3', 'Quinn Alder'], ['4', 'Moe Allen']]);
  // re-importing does not duplicate
  env.inbox().addFile('HA_103_roster.csv', rosterHA103);
  env.gas.tick();
  assert.equal(env.sheet('Students').objects().filter(s => s['Class ID'] === 'C3').length, 9);
});

test('screenshots list → attendance; POPULI follow-ups group students with the same numbers', () => {
  const env = populiTerm();
  // What Claude writes after reading the 6:15 / 6:31 / end-of-class screenshots
  env.inbox().addFile('Zoom screenshots 2026-10-05 [C3].csv', [
    'Student,Date,Status,Notes',
    'Mara Alba,2026-10-05,Present,in 6:15 screenshot',
    'Teo Arce,2026-10-05,Tardy,only in 6:31 screenshot',
    'Moe Allen,2026-10-05,Absent,left before the end'
  ].join('\n'));
  env.setNow('2026-10-06T00:30:00Z');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', 'Quinn Alder').Status, 'Absent');       // not in any screenshot
  assert.equal(env.row('2026-10-05', 'C3', 'Quinn Alder').Source, 'Zoom screenshots (not in file)');
  assert.equal(env.row('2026-10-05', 'C3', 'Teo Arce').Status, 'Tardy');
  // no Gmail at all in POPULI mode
  assert.equal(env.mail.drafts.length + env.mail.sent.length, 0);
  const fu = env.sheet('Follow-ups').objects();
  assert.equal(fu.length, 2);                       // 2 absents with the same numbers share one email + 1 tardy
  const abs = fu.find(f => f.Type === 'Student Absent');
  assert.equal(abs['Roster #'], '3, 4');
  assert.equal(abs.Students, 'Quinn Alder, Moe Allen');
  assert.equal(abs.Count, '2');
  assert.match(abs.Message, /^Dear student,/);
  assert.match(abs.Message, /HA 103: History of World Religions.*6:00 PM – 7:00 PM/);
  assert.match(abs.Message, /Absences remaining: 1/);
  assert.match(abs['Visibility (check in Populi)'], /Academic Auditor/);
  assert.equal(fu.find(f => f.Type === 'Student Tardy').Students, 'Teo Arce');
  assert.match(env.row('2026-10-05', 'C3', 'Quinn Alder').Notified, /POPULI$/);
  env.gas.tick();
  assert.equal(env.sheet('Follow-ups').objects().length, 2); // not repeated
});

test('weekly grid per class: Populi order, one column per week, totals', () => {
  const env = populiTerm();
  env.setConfig('Term start', '2026-09-28');
  const list = (d, rows) => ['Student,Date,Status', ...rows.map(r => r[0] + ',' + d + ',' + r[1])].join('\n');
  env.inbox().addFile('Zoom screenshots w1 [C3].csv', list('2026-09-28', [['Mara Alba', 'Present'], ['Teo Arce', 'Present'], ['Quinn Alder', 'Tardy'], ['Moe Allen', 'Present']]));
  env.inbox().addFile('Zoom screenshots w2 [C3].csv', list('2026-10-05', [['Mara Alba', 'Present'], ['Moe Allen', 'Present'], ['Quinn Alder', 'Tardy']]));
  env.gas.tick();
  const g = env.sheet('Grid C3').data;
  assert.deepEqual(g[0], ['#', 'Student', 'Week 1 · Sep 28', 'Week 2 · Oct 5', 'Absences', 'Tardies', 'Counted', 'Left', 'Attendance', 'Status']);
  assert.deepEqual(g.slice(1).map(r => r.slice(0, 4)), [
    ['1', 'Mara Alba', 'P', 'P'],
    ['2', 'Teo Arce', 'P', 'A'],
    ['3', 'Quinn Alder', 'T', 'T'],
    ['4', 'Moe Allen', 'P', 'P']
  ]);
  assert.deepEqual(g[2].slice(4), ['1', '0', '1', '1', '90%', '1 absence left']);
  assert.equal(env.sheet('Grid C3').backgrounds[1][3], '#f4cccc');
});

test('POPULI mode: office no-ID notice and assignment reminders become follow-ups too', () => {
  const env = populiTerm();
  env.setConfig('Office email', 'office@ivy.edu');
  const sh = env.sheet('Attendance');
  ['2026-09-21', '2026-09-28', '2026-10-05'].forEach(d => sh.appendRow([d, 'C3', 'Mara Alba', 'Mara Alba', 'Present', '', 'Manual', 'Yes']));
  env.sheet('Assignments').appendRow(['C3', 'Reflection paper', '2026-10-07', '2']);
  env.gas.tick();
  env.gas.assignmentReminders();
  const fu = env.sheet('Follow-ups').objects();
  assert.equal(fu.find(f => f.Type === 'Office: no ID').Students, 'Office: office@ivy.edu');
  assert.match(fu.find(f => f.Type === 'Assignment reminder').Students, /Email this section/);
  // the Friday report still comes to you by Gmail
  env.gas.weeklyReport();
  assert.equal(env.mail.sent.length, 1);
});

test('screenshot folder in TA Inbox → OCR → attendance, aliases remembered, folder moved to Processed', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.sheet('Classes').put(4, 2, 'HA 105: Introduction to Ethics'); // C3
  env.setConfig('Ignore in screenshots', 'Diego Gomez; Sam Prof');
  env.inbox().addFile('HA 105 roster.csv', rosterHA103.replace(',Withdrawn,', ',Enrolled,'));
  env.gas.tick();
  // "QA phone" is how Qais shows up in Zoom; Diego wrote it once under "Zoom names".
  const st = env.sheet('Students'), h = st.data[0];
  const qi = st.data.findIndex(r => r[h.indexOf('Name')] === 'Quinn Alder');
  st.put(qi + 1, h.indexOf('Zoom names') + 1, 'QA phone');

  const shot = names => ['Participants (' + (names.length + 2) + ')', 'Diego Gomez (Host, me)', 'Sam Prof (Co-host)', ...names, 'Invite  Mute All'].join('\n');
  const week = env.inbox().createFolder('1. HA 105 - Week 01 - 10.05.26');
  week.createFolder('1. Present').addImage('Screenshot 6.15.01 PM.png', shot(['Mara Alba', 'QA phone']));
  week.createFolder('2. Tardy').addImage('Screenshot 6.31.10 PM.png', shot(['Mara Alba', 'QA phone', 'Teo Arce (Guest)', 'Unknown Person']));
  week.createFolder('3. Absent').addImage('Screenshot 9.58.40 PM.png', shot(['Mara Alba', 'Teo Arce']));
  env.gas.tick();
  assert.ok(env.inbox().folders.some(f => f.name === '1. HA 105 - Week 01 - 10.05.26'), 'waits while the upload may still be running');
  env.setNow('2026-10-06T03:00:00Z');
  env.gas.tick();
  assert.equal(env.ocr.calls, 3);
  assert.ok(Object.values(env.docs).every(d => d.trashed), 'temporary OCR docs are deleted');
  assert.ok(env.inbox().folders.find(f => f.name === 'Processed').folders.some(f => f.name.startsWith('1. HA 105')));
  const status = n => env.row('2026-10-05', 'C3', n).Status + (env.row('2026-10-05', 'C3', n)['Left early'] ? ' (left)' : '');
  assert.equal(status('Mara Alba'), 'Present');
  assert.equal(status('Teo Arce'), 'Tardy');
  assert.equal(status('Quinn Alder'), 'Absent (left)');
  assert.equal(status('Moe Allen'), 'Absent');
  assert.equal(status('Zed Withdrawn'), 'Absent');
  const log = env.sheet('Inbox log').objects().at(-1);
  assert.equal(log.Kind, 'screenshots');
  assert.equal(log.Dates, '2026-10-05');
  assert.match(log.Result, /3 screenshot\(s\), start 6:00 PM: 1 present, 1 tardy, 3 absent of 5/);
  assert.match(log.Result, /1 name\(s\) to confirm in Review/);
  assert.equal(env.sheet('Review').objects()[0]['Name seen'], 'Unknown Person');
  assert.doesNotMatch(log.Result, /Sam Prof/);
  // Grid ready to tick Populi's participation boxes in the same order
  assert.deepEqual(env.sheet('Grid C3').data.slice(1).map(r => r.slice(0, 3)), [
    ['1', 'Mara Alba', 'P'], ['2', 'Teo Arce', 'T'], ['3', 'Quinn Alder', 'A (left)'],
    ['4', 'Moe Allen', 'A'], ['5', 'Zed Withdrawn', 'A']
  ]);
});

test('late start, a question in Review, notices on hold until answered, start edited in Sessions → re-run', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.sheet('Classes').put(4, 2, 'HA 105: Introduction to Ethics'); // C3, scheduled 6:00 PM
  env.inbox().addFile('HA 105 roster.csv', [
    'Student ID,Populi Name,Course Abbrv,Email,Type',
    ',Pat Prof,HA 105,p@ivy.edu,faculty',
    '11,Malek Abu,HA 105,m1@ivy.edu,student',
    '12,Malek Bay,HA 105,m2@ivy.edu,student',
    '13,Angie Naomy Ferreira Beltran,HA 105,an@ivy.edu,student',
    '14,Vale Cisneros,HA 105,vc@ivy.edu,student'
  ].join('\n'));
  env.gas.tick();
  const week = env.inbox().createFolder('2. HA 105 - Week 02 - 10.12.26 - start 7pm');
  const chat = ['Everyone', 'Naomi 7:04 PM', 'Naomi Ferreira', 'Malek 7:12 PM', 'Malek', 'Vale 7:22 PM', 'Vale Sisneros'].join('\n');
  week.createFolder('1. Present').addImage('a.png', 'Malek Abu\nPat Prof\n' + chat);
  week.createFolder('2. Tardy').addImage('b.png', 'Malek Abu\nNaomi Ferreira\n' + chat);
  week.createFolder('3. Absent').addImage('c.png', 'Malek Abu\nNaomi Ferreira\nVale Sisneros\nmalek b iphone');
  env.setNow('2026-10-13T01:00:00Z');
  env.gas.tick();
  const row = n => env.row('2026-10-12', 'C3', n);
  const sess = () => env.sheet('Sessions').objects().find(r => r['Class ID'] === 'C3' && r.Date === '2026-10-12');
  assert.equal(sess()['Actual start'], '7:00 PM');                 // from "start 7pm" in the folder name
  assert.equal(row('13').Status, 'Present');                       // chat 7:04 → minute 4 from 7:00
  assert.equal(row('14').Status, 'Tardy');                         // chat 7:22 → minute 22
  assert.equal(row('11').Status, 'Present');
  // "Malek" in chat and "malek b iphone" could be Malek Bay → asked, not guessed
  const q = env.sheet('Review').objects();
  assert.deepEqual(q.map(x => x['Name seen']).sort(), ['Malek', 'malek b iphone']);
  assert.match(q.find(x => x['Name seen'] === 'Malek').Suggestions, /#2 Malek Bay/);
  assert.equal(row('12').Status, 'Absent');
  assert.equal(sess()['Open questions'], '2');
  assert.equal(env.sheet('Follow-ups').objects().filter(f => f['Class date'] === '2026-10-12').length, 0, 'notices wait');

  // Diego answers: both are Malek Bay (#2)
  const rv = env.sheet('Review'), h = rv.data[0];
  const ansCol = h.indexOf('Student (# or name, or "ignore")') + 1;
  rv.data.forEach((r, i) => { if (i) rv.put(i + 1, ansCol, '#2'); });
  env.gas.tick();
  assert.equal(row('12').Status, 'Present');                       // re-run with the answers
  assert.match(env.sheet('Students').objects().find(s => s['Student ID'] === '12')['Zoom names'], /Malek; malek b iphone/);
  assert.ok(env.sheet('Review').objects().every(r => /^Linked to #2 Malek Bay/.test(r.Done)));
  assert.equal(sess()['Open questions'], '0');

  // The start was really 6:50 → Diego edits Actual start; Vale (7:22) is now minute 32 → Absent
  const ss = env.sheet('Sessions'), sh = ss.data[0];
  const si = ss.data.findIndex(r => r[sh.indexOf('Class ID')] === 'C3' && r[sh.indexOf('Date')] === '2026-10-12');
  ss.put(si + 1, sh.indexOf('Actual start') + 1, '6:50');
  env.gas.tick();
  assert.equal(sess()['Processed with start'], '6:50 PM');
  assert.equal(row('14').Status, 'Absent');
  assert.match(row('14').Notes, /Joined after minute 30 \(chat 7:22 PM\)/);
  assert.equal(env.ocr.calls, 3, 're-runs use the saved text, no new OCR');
  // follow-ups now exist for this class
  assert.ok(env.sheet('Follow-ups').objects().some(f => f['Class date'] === '2026-10-12' && /Vale Cisneros/.test(f.Students)));
});

test('in person: the real start time from Sessions moves the 15 / 30 minute cut-offs', () => {
  const env = setupTerm();
  env.sheet('Sessions').appendRow(['C1', '2026-10-05', '9:00 AM', '9:30 AM']); // class started 30 min late
  env.inbox().addFile('ENG [C1].csv', [
    'Student ID,Name,Email,Date,Status,Check-in Time',
    '1,Ana Uno,a@ivy.edu,10/5/2026,Present,9:40 AM',
    '2,Beto Dos,b@ivy.edu,10/5/2026,Present,9:50 AM',
    '3,Caro Tres,c@ivy.edu,10/5/2026,Present,10:05 AM'
  ].join('\n'));
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '1').Status, 'Present');  // minute 10
  assert.equal(env.row('2026-10-05', 'C1', '2').Status, 'Tardy');    // minute 20
  assert.equal(env.row('2026-10-05', 'C1', '3').Status, 'Absent');   // minute 35
});

test('dashboard API: overview, class, session with OCR diagnostics, answering a question, start time, follow-ups', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.sheet('Classes').put(4, 2, 'HA 105: Introduction to Ethics');
  env.inbox().addFile('HA 105 roster.csv', ['Student ID,Populi Name,Course Abbrv,Type', '11,Malek Abu,HA 105,student',
    '12,Malek Bay,HA 105,student', '13,Vale Cisneros,HA 105,student'].join('\n'));
  env.gas.tick();
  const week = env.inbox().createFolder('1. HA 105 - Week 01 - 10.05.26');
  week.createFolder('1. Present').addImage('a.png', 'Malek Abu\nVale Sisneros\nMalek\nMute');
  week.createFolder('3. Absent').addImage('c.png', 'Malek Abu\nVale Sisneros');
  env.setNow('2026-10-06T03:00:00Z');
  const o0 = env.gas.apiOverview();
  assert.equal(o0.classes.length, 4);
  const run = env.gas.apiProcessNow();
  assert.equal(run.files, 1);

  const o = JSON.parse(JSON.stringify(env.gas.apiOverview()));
  const c3 = o.classes.find(c => c.id === 'C3');
  assert.deepEqual(c3.lastCounts, { P: 2, T: 0, A: 1, E: 0 });
  assert.equal(c3.questions, 1);
  assert.equal(o.openQuestions, 1);
  assert.equal(o.week, 1);

  const cl = JSON.parse(JSON.stringify(env.gas.apiClass('C3')));
  assert.deepEqual(cl.students.map(s => [s.order, s.name, s.weeks[0].s]), [[1, 'Malek Abu', 'P'], [2, 'Malek Bay', 'A'], [3, 'Vale Cisneros', 'P']]);
  assert.equal(cl.sessions[0].questions, 1);

  const se = JSON.parse(JSON.stringify(env.gas.apiSession('C3', '2026-10-05')));
  const lines = se.ocr.phases.present[0];
  assert.deepEqual(lines.map(l => [l.text, l.result]), [['Malek Abu', 'match'], ['Vale Sisneros', 'match'], ['Malek', 'doubt'], ['Mute', 'noise']]);
  assert.equal(lines[1].how, 'similar');
  assert.match(lines[2].who, /#2 Malek Bay/);
  assert.equal(se.questions.length, 1);

  const qs = JSON.parse(JSON.stringify(env.gas.apiQuestions()));
  const ans = env.gas.apiAnswer(qs[0].row, '#2');
  assert.match(ans.note, /^Linked to #2 Malek Bay/);
  // "Malek" was at 15 min but not in the last screenshot → disconnected
  assert.equal(env.row('2026-10-05', 'C3', '12').Status, 'Absent');
  assert.equal(env.row('2026-10-05', 'C3', '12')['Left early'], 'Yes');

  env.gas.apiSetStart('C3', '2026-10-05', '6:30');
  assert.equal(JSON.parse(JSON.stringify(env.gas.apiSession('C3', '2026-10-05'))).start, '6:30 PM');

  // the question is answered, so the follow-up for this class is released; it can be marked as sent
  const f = JSON.parse(JSON.stringify(env.gas.apiFollowups()));
  assert.equal(f.length, 1);
  assert.equal(f[0].Students, 'Malek Bay');
  env.gas.apiFollowupDone(f[0].row);
  assert.equal(env.gas.apiFollowups().length, 0);
});

test('weekly reports for any week: picker, report with totals as of that week, email, PDF in Drive', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Term start', '2026-10-05');
  const sh = env.sheet('Attendance');
  sh.appendRow(['2026-10-05', 'C3', '1001', 'Ana Maria Lopez', 'Absent', '', 'Manual']);
  sh.appendRow(['2026-10-05', 'C3', '1002', 'Brian Smith', 'Present', '', 'Manual']);
  sh.appendRow(['2026-10-12', 'C3', '1001', 'Ana Maria Lopez', 'Absent', '', 'Manual']);
  sh.appendRow(['2026-10-12', 'C3', '1002', 'Brian Smith', 'Tardy', '', 'Manual']);
  env.setNow('2026-10-16T13:00:00Z'); // Friday of week 2

  const w = JSON.parse(JSON.stringify(env.gas.apiReportWeeks()));
  assert.equal(w.weeks.length, 10);
  assert.equal(w.current, 2);
  assert.deepEqual([w.weeks[0].start, w.weeks[0].end, w.weeks[9].start], ['2026-10-05', '2026-10-11', '2026-12-07']);
  assert.equal(w.weeks[2].future, true);

  const r1 = env.gas.apiWeeklyReport(1);
  assert.match(r1.subject, /October 5, 2026/);
  assert.match(r1.html, /Week 1 of 10/);
  assert.match(r1.html, /This week:<\/b> 1 present · 0 tardy · 1 absent/);
  assert.doesNotMatch(r1.html, /2026-10-12/);              // week 2 is not in week 1's report
  assert.match(r1.html, /Not available: no attendance was loaded for this class this week/); // C1, C2, C4 have no data
  assert.doesNotMatch(r1.html.split('BIO 101')[0], /Full attendance/);
  assert.doesNotMatch(r1.html, /At the limit/);           // as of week 1, Ana had 1 absence
  const r2 = env.gas.apiWeeklyReport(2);
  assert.match(r2.html, /At the limit/);                  // two absences by the end of week 2

  const sent = env.gas.apiSendWeeklyReport(2);
  assert.equal(sent.to, 'dgomez230@ivy.edu');
  assert.equal(env.mail.sent.length, 1);
  assert.match(env.mail.sent[0].subject, /October 12, 2026/);

  const pdf = env.gas.apiSaveWeeklyReportPdf(2);
  assert.match(pdf.name, /Week 2 \(2026-10-12 to 2026-10-18\)\.pdf$/);
  const reports = env.driveRoot.folders.find(f => f.name === 'TA Reports');
  assert.equal(reports.files.length, 1);
  assert.equal(reports.files[0].mime, 'application/pdf');
  env.gas.apiSaveWeeklyReportPdf(2);                      // saving again replaces it
  assert.equal(reports.files.length, 1);

  // the Friday trigger still sends this week's report
  env.gas.weeklyReport();
  assert.equal(env.mail.sent.length, 2);
  assert.match(env.mail.sent[1].body, /Week of Monday, October 12, 2026/);
});

test('to-do list, quick marking of an on-campus class, excuses, office changes, stale follow-ups, student history', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  // HA 103 (C1, Monday 9–1, in person) with 4 students
  env.sheet('Students').appendRow(['201', 'Ana Uno', 'a@ivy.edu', 'C1', 'Yes', '1']);
  env.sheet('Students').appendRow(['202', 'Beto Dos', 'b@ivy.edu', 'C1', 'Yes', '2']);
  env.sheet('Students').appendRow(['203', 'Caro Tres', 'c@ivy.edu', 'C1', 'Yes', '3']);
  env.sheet('Students').appendRow(['204', 'Dani Cuatro', 'd@ivy.edu', 'C1', 'Yes', '4']);
  env.setNow('2026-10-05T18:00:00Z'); // Monday 2 PM: HA 103 (9–1) is over

  // The class schedule: week 1 = Monday Oct 5, week 10 = Dec 7
  const cl = j(env.gas.apiClass('C1'));
  assert.deepEqual([cl.schedule[0].date, cl.schedule[9].date, cl.schedule[0].over, cl.schedule[1].over], ['2026-10-05', '2026-12-07', true, false]);
  const c4 = j(env.gas.apiClass('C4'));
  assert.equal(c4.schedule[0].date, '2026-10-08'); // Thursday class

  // Nothing loaded yet → it's on the to-do list
  let tasks = j(env.gas.apiOverview()).tasks;
  const load = tasks.find(t => t.type === 'load' && t.go.classId === 'C1');
  assert.ok(load, 'missing attendance is a task');
  assert.match(load.text, /Load attendance · ENG 111 · Week 1/);
  assert.ok(!tasks.some(t => t.type === 'load' && t.go.classId === 'C3'), 'the evening class is not over yet');

  // Quick marking: two exceptions, then everyone else Present
  env.gas.apiSetRecord('C1', '2026-10-05', '202', { status: 'Absent' });
  const r = env.gas.apiSetRecord('C1', '2026-10-05', '203', { status: 'Tardy' });
  assert.equal(r.status, 'Tardy');
  assert.equal(env.gas.apiBulkStatus('C1', '2026-10-05', 'Present').changed, 2);
  const sess = j(env.gas.apiSession('C1', '2026-10-05'));
  assert.deepEqual(sess.students.map(s => s.status), ['Present', 'Absent', 'Tardy', 'Present']);
  assert.ok(!j(env.gas.apiOverview()).tasks.some(t => t.type === 'load' && t.go.classId === 'C1'), 'loaded → off the list');

  // Done → follow-ups are prepared right away
  const fin = env.gas.apiFinishSession('C1', '2026-10-05');
  assert.equal(fin.sent, 2);
  assert.equal(j(env.gas.apiFollowups()).length, 2);
  assert.ok(j(env.gas.apiOverview()).tasks.some(t => t.type === 'followup'));

  // The office changes Beto to Present → the pending follow-up warns not to send it to him
  const o = env.gas.apiSetRecord('C1', '2026-10-05', '202', { office: 'Present' });
  assert.equal(o.status, 'Present');
  assert.match(o.notes, /Changed to Present by the office/);
  const fus = j(env.gas.apiFollowups());
  const abs = fus.find(f => f.Type === 'Student Absent');
  assert.deepEqual(abs.changed, [{ name: 'Beto Dos', now: 'Present' }]);

  // Medical excuse: received → after 7 days it's a task → accepted → counts as excused
  env.gas.apiSetRecord('C1', '2026-10-05', '203', { leftEarly: true });   // Caro left early → Absent
  const rec = env.gas.apiSetRecord('C1', '2026-10-05', '203', { excuse: 'Received' });
  assert.equal(rec.excuse, 'Received');
  assert.equal(env.row('2026-10-05', 'C1', '203')['Excuse date'], '2026-10-05');
  env.setNow('2026-10-14T15:00:00Z');
  tasks = j(env.gas.apiOverview()).tasks;
  const ex = tasks.find(t => t.type === 'excuse');
  assert.match(ex.text, /Ask the office about Caro Tres's medical excuse/);
  assert.equal(ex.go.view, 'student');
  const acc = env.gas.apiSetRecord('C1', '2026-10-05', '203', { excuse: 'Accepted' });
  assert.equal(acc.effective, 0);
  assert.match(acc.notes, /Office accepted the medical excuse/);
  assert.ok(!j(env.gas.apiOverview()).tasks.some(t => t.type === 'excuse'));

  // Student history, week by week
  const st = j(env.gas.apiStudent('C1', '203'));
  assert.equal(st.weeks.length, 10);
  assert.equal(st.weeks[0].rec.excuse, 'Accepted');
  assert.equal(st.weeks[0].rec.left, true);
  assert.equal(st.weeks[1].rec, null);
  assert.equal(st.tally.excused, 1);

  // No ID flag from the dashboard
  env.gas.apiSetRecord('C1', '2026-10-05', '201', { noId: true });
  assert.equal(env.row('2026-10-05', 'C1', '201')['No ID'], 'Yes');
});

test('Zoom class: "Done in Populi" task until ticked; old sheets get new columns on their own', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  // An older Sessions sheet without the "Populi updated" column
  const ss = env.sheet('Sessions');
  ss.data[0] = ss.data[0].filter(h => h !== 'Populi updated');
  env.sheet('Attendance').appendRow(['2026-10-05', 'C3', '1001', 'Ana Maria Lopez', 'Present', '', 'Zoom screenshots']);
  ss.appendRow(['C3', '2026-10-05', '6:00 PM', '', 'Zoom screenshots', 'x', '6:00 PM', '0']);
  env.setNow('2026-10-06T14:00:00Z');
  let tasks = j(env.gas.apiOverview()).tasks;
  assert.ok(ss.data[0].includes('Populi updated'), 'column added');
  assert.ok(tasks.some(t => t.type === 'populi' && t.go.classId === 'C3'));
  env.gas.apiPopuliDone('C3', '2026-10-05', true);
  tasks = j(env.gas.apiOverview()).tasks;
  assert.ok(!tasks.some(t => t.type === 'populi'));
  assert.ok(j(env.gas.apiSession('C3', '2026-10-05')).populi);
});

test('Open dashboard: over the sheet, or straight to the full-page web app once it is published', () => {
  const env = setupTerm();
  env.gas.openDashboard();
  assert.equal(env.dialogs.length, 1);
  env.service.url = 'https://script.google.com/macros/s/abc/exec';
  env.gas.openDashboard();
  assert.equal(env.dialogs.length, 2);
});
