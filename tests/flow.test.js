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
  assert.equal(env.inbox().folders.find(f => f.name === 'Processed').files.filter(f => f.name !== 'dashboard-snapshot.json').length, 1);
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
  assert.equal(env.row('2026-10-05', 'C3', '1002').Status, 'Present');   // minute 25: online classes have no Tardy
  const carla = env.row('2026-10-05', 'C3', '1003');
  assert.equal(carla.Status, 'Absent');
  assert.equal(carla['Left early'], 'Yes');
  assert.match(carla.Notes, /6:00 PM–6:30 PM/);
  assert.equal(env.row('2026-10-05', 'C3', '1004').Status, 'Absent');
  assert.match(env.sheet('Inbox log').objects()[0].Result, /Zoom meeting ID.*Random Name/);
  const carlaMail = env.mail.drafts.find(d => d.to === 'carla@ivy.edu');
  assert.match(carlaMail.subject, /left early/);
  assert.match(carlaMail.body, /left before the end of class/);
  assert.equal(env.mail.drafts.length, 2);           // Brian (minute 25) is Present online: no tardy notice
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

test('automations: 4 triggers, reinstalling does not duplicate them', () => {
  const env = setupTerm();
  env.gas.installTriggers();
  env.gas.installTriggers();
  assert.deepEqual(env.triggers.map(t => t.handler).sort(), ['assignmentReminders', 'claudeCheck', 'tick', 'weeklyReport']);
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
  assert.equal(env.row('2026-10-05', 'C3', 'Teo Arce').Status, 'Present');  // online class: a Tardy in the list counts as Present
  // no Gmail at all in POPULI mode
  assert.equal(env.mail.drafts.length + env.mail.sent.length, 0);
  const fu = env.sheet('Follow-ups').objects();
  assert.equal(fu.length, 1);                       // 2 absents with the same numbers share one email; no tardy online
  const abs = fu.find(f => f.Type === 'Student Absent');
  assert.equal(abs['Roster #'], '3, 4');
  assert.equal(abs.Students, 'Quinn Alder, Moe Allen');
  assert.equal(abs.Count, '2');
  assert.match(abs.Message, /^Dear student,/);
  assert.match(abs.Message, /HA 103: History of World Religions.*6:00 PM – 7:00 PM/);
  assert.match(abs.Message, /Absences remaining: 1/);
  assert.match(abs['Visibility (check in Populi)'], /Academic Auditor/);
  assert.ok(!fu.some(f => f.Type === 'Student Tardy'));
  assert.match(env.row('2026-10-05', 'C3', 'Quinn Alder').Notified, /POPULI$/);
  env.gas.tick();
  assert.equal(env.sheet('Follow-ups').objects().length, 1); // not repeated
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
    ['3', 'Quinn Alder', 'P', 'P'],   // online class: no Tardy
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
  assert.equal(status('Teo Arce'), 'Present');   // first seen at 31 min: online classes have no Tardy
  assert.equal(status('Quinn Alder'), 'Absent (left)');
  assert.equal(status('Moe Allen'), 'Absent');
  assert.equal(status('Zed Withdrawn'), 'Absent');
  const log = env.sheet('Inbox log').objects().at(-1);
  assert.equal(log.Kind, 'screenshots');
  assert.equal(log.Dates, '2026-10-05');
  assert.match(log.Result, /3 screenshot\(s\), start 6:00 PM: 2 present, 3 absent of 5/);
  assert.match(log.Result, /1 name\(s\) to confirm in Review/);
  assert.equal(env.sheet('Review').objects()[0]['Name seen'], 'Unknown Person');
  assert.doesNotMatch(log.Result, /Sam Prof/);
  // Grid ready to tick Populi's participation boxes in the same order
  assert.deepEqual(env.sheet('Grid C3').data.slice(1).map(r => r.slice(0, 3)), [
    ['1', 'Mara Alba', 'P'], ['2', 'Teo Arce', 'P'], ['3', 'Quinn Alder', 'A (left)'],
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
  assert.equal(row('14').Status, 'Present');                       // chat 7:22 → minute 22 (online: no Tardy)
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

test('Friday overview: all classes in one page, follow-ups with sent status, assignment list from the inbox, what is left', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Term start', '2026-10-05');
  // an assignment list (Name, Group, Points, Due, Window) dropped in TA Inbox, class from the course code in the file name
  env.inbox().addFile('ENG111-assignments.csv', [
    'Name,Group,Points,Due,Window',
    'LRQ #4,Lecture Reading Quizzes,20,2026-10-26 23:59,Oct 26 9:00am-11:59pm only',
    'MV #4,Memory Verses,10,2026-10-26 23:59,',
    'LRQ #9,Lecture Reading Quizzes,20,2026-12-07 23:59,'
  ].join('\n'));
  env.gas.tick();
  const a = env.sheet('Assignments').objects();
  assert.equal(a.length, 3);
  assert.deepEqual([a[0]['Class ID'], a[0].Title, a[0]['Remind days before'], a[0].Window], ['C1', 'LRQ #4', 'none', 'Oct 26 9:00am-11:59pm only']);
  env.inbox().addFile('ENG111-assignments again.csv', 'Name,Group,Points,Due,Window\nMV #4,Memory Verses,10,2026-10-26 23:59,');
  env.gas.tick();
  assert.equal(env.sheet('Assignments').objects().length, 3); // same title + date = same row

  const sh = env.sheet('Attendance');
  ['2026-10-05', '2026-10-12'].forEach(d => {
    sh.appendRow([d, 'C3', '1001', 'Ana Maria Lopez', 'Absent', '', 'Manual']);
    sh.appendRow([d, 'C3', '1002', 'Brian Smith', 'Present', '', 'Manual']);
    sh.appendRow([d, 'C3', '1003', 'Carla Pérez', 'Present', '', 'Manual']);
    sh.appendRow([d, 'C3', '1004', 'David Kim', 'Present', '', 'Manual']);
  });
  sh.appendRow(['2026-10-19', 'C3', '1001', 'Ana Maria Lopez', 'Absent', '', 'Manual']);
  sh.appendRow(['2026-10-19', 'C3', '1002', 'Brian Smith', 'Absent', '', 'Manual']);
  sh.appendRow(['2026-10-19', 'C3', '1003', 'Carla Pérez', 'Present', '', 'Manual']);
  sh.appendRow(['2026-10-19', 'C3', '1004', 'David Kim', 'Present', '', 'Manual']);
  env.setNow('2026-10-23T12:00:00Z'); // Friday of week 3, 8 AM

  let r = env.gas.apiWeeklyReport(3);
  assert.match(r.html, /attendance this week, all classes/);
  assert.match(r.html, />50%</);                                   // 2 of 4 marked in C3 this week
  assert.match(r.html, /By class[\s\S]*BIO 101[\s\S]*2 follow-ups to send/);
  assert.match(r.html, /ENG 111[^<]*<\/b><\/td><td[^>]*>0<\/td>[\s\S]*?No attendance loaded/);
  assert.match(r.html, /Below 80%[\s\S]*Ana Maria Lopez<\/td><td[^>]*>3 counted absences \(3 A, 0 T\)[\s\S]*To send/);
  assert.match(r.html, /Below 100%[\s\S]*Brian Smith/);
  assert.match(r.html, /0 \/ 2/);
  assert.match(r.html, /Due next week[\s\S]*LRQ #4[\s\S]*Oct 26 9:00am-11:59pm only/);
  assert.doesNotMatch(r.html, /LRQ #9/);                           // not due next week
  assert.match(r.html, /No assignments loaded for MATH 123/);
  assert.match(r.html, /Before the weekend[\s\S]*Load attendance · ENG 111 · weeks 1, 2, 3/);
  assert.match(r.html, /Send 2 below 100% \/ 80% follow-up messages/);
  assert.match(r.html, /Details by class[\s\S]*Losing the course or at risk/); // the per-class detail stays
  env.gas.apiSendWeeklyReport(3);
  assert.match(env.mail.sent[0].body, /Below 80%: Ana Maria Lopez — 3 counted, 70% — To send/);

  env.gas.apiStandingSent('C3', ['1001']);
  r = env.gas.apiWeeklyReport(3);
  assert.match(r.html, /Ana Maria Lopez[\s\S]*?Sent 2026-10-23/);
  assert.match(r.html, /1 \/ 2/);
  assert.match(r.html, /1 follow-up to send/);
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
  // Take attendance's week picker: the taken week is marked done, the rest stay open
  const wk = j(env.gas.apiOverview()).classes.find(c => c.id === 'C1').weeks;
  assert.deepEqual([wk.length, wk[0].date, wk[0].done, wk[1].done], [10, '2026-10-05', true, false]);

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

test('screenshots dropped in the dashboard: upload → OCR → analysis, clear one moment, cache never stale', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  env.sheet('Classes').put(4, 2, 'HA 105: Introduction to Ethics'); // C3
  env.inbox().addFile('HA 105 roster.csv', ['Student ID,Populi Name,Course Abbrv,Type', '11,Ana Uno,HA 105,student',
    '12,Beto Dos,HA 105,student', '13,Caro Tres,HA 105,student'].join('\n'));
  env.gas.tick();
  const b64 = t => Buffer.from(t).toString('base64');
  const ov1 = j(env.gas.apiOverview());                     // cached now
  assert.equal(ov1.classes.find(c => c.id === 'C3').sessions, 0);

  // 15 min: Ana; 31 min: Beto; last: Ana + Beto (Caro never came)
  let r = env.gas.apiUploadShot('C3', '2026-10-05', 'present', 'shot1.jpg', 'image/jpeg', b64('Ana Uno\nProfessor X'));
  assert.deepEqual(j(r), { phase: 'present', names: 2, count: 1, ai: false, aiError: '' });
  assert.equal(env.ai.requests.length, 0, 'no API key → no AI call');
  env.gas.apiUploadShot('C3', '2026-10-05', 'tardy', 'shot2.jpg', 'image/jpeg', b64('Ana Uno\nBeto Dos'));
  env.gas.apiUploadShot('C3', '2026-10-05', 'end', 'shot3.jpg', 'image/jpeg', b64('Beto Dos'));
  assert.equal(env.ocr.calls, 3);
  const an = env.gas.apiAnalyzeSession('C3', '2026-10-05');
  assert.match(an.msg, /3 screenshot\(s\).*1 present, 2 absent/);
  assert.doesNotMatch(an.msg, /tardy/);
  assert.equal(env.row('2026-10-05', 'C3', '11').Status, 'Absent');        // not in the last screenshot
  assert.equal(env.row('2026-10-05', 'C3', '12').Status, 'Present');      // first seen at 31 min (online: no Tardy)
  assert.equal(env.row('2026-10-05', 'C3', '13').Status, 'Absent');
  const se = j(env.gas.apiSession('C3', '2026-10-05'));
  assert.deepEqual(se.shots, { present: 1, tardy: 1, end: 1, correction: 0 });
  // the files live in Drive under TA Inbox / Processed / HA 105 - Week 01 - 10.05.26
  const done = env.inbox().folders.find(f => f.name === 'Processed');
  const sf = done.folders.find(f => f.name === 'HA 105 - Week 01 - 10.05.26');
  assert.ok(sf);
  assert.equal(sf.folders.find(f => f.name === '1. Present').files.length, 1);

  // the overview was cached before; the writes made it fresh again
  assert.equal(j(env.gas.apiOverview()).classes.find(c => c.id === 'C3').sessions, 1);

  // wrong last screenshot → clear it, drop the right one, re-analyze: Ana stayed
  env.gas.apiClearShots('C3', '2026-10-05', 'end');
  assert.equal(sf.folders.find(f => f.name === '3. Absent').files.length, 0);
  env.gas.apiUploadShot('C3', '2026-10-05', 'end', 'shot4.jpg', 'image/jpeg', b64('Ana Uno\nBeto Dos'));
  env.gas.apiAnalyzeSession('C3', '2026-10-05');
  assert.equal(env.row('2026-10-05', 'C3', '11').Status, 'Present');
  assert.deepEqual(j(env.gas.apiSession('C3', '2026-10-05')).shots, { present: 1, tardy: 1, end: 1, correction: 0 });
});

test('A student added after the class started: asked about, "new" adds them from that date, logged, earlier classes not counted', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  [2, 3, 4, 5].forEach((row, i) => env.sheet('Students').put(row, 6, String(i + 1)));
  const b64 = t => Buffer.from(t).toString('base64');
  const p = (name, n) => ({ shown_name: name, roster_number: n, confidence: 0.95, alternatives: [] });
  const take = (date, people) => {
    env.gas.apiUploadShot('C3', date, 'present', 's.png', 'image/png', b64('x'));
    env.gas.apiUploadShot('C3', date, 'end', 'e.png', 'image/png', b64('x'));
    const sess = env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C3' && x.Date === date);
    env.gas.DriveApp.getFolderById(sess['Source ID']).createFile('claude-results.json', JSON.stringify({
      present: [{ participants: people, chat: [], unreadable: 0 }], end: [{ participants: people, chat: [], unreadable: 0 }] }), 'application/json');
    env.gas.tick();
  };
  env.setNow('2026-10-05T23:30:00Z');
  take('2026-10-05', [p('Ana Lopez', 1), p('Brian Smith', 2), p('Carla Perez', 3), p('David Kim', 4)]);
  env.setNow('2026-10-12T23:30:00Z');
  // week 2: an extra person nobody knows → asked, not guessed
  take('2026-10-12', [p('Ana Lopez', 1), p('Brian Smith', 2), p('Carla Perez', 3), p('David Kim', 4), p('Nora Vega', 0)]);
  const q = env.sheet('Review').objects();
  assert.equal(q.length, 1);
  assert.equal(q[0]['Name seen'], 'Nora Vega');
  assert.match(q[0].Suggestions, /answer "new"/);
  // Diego: she was just added to the class
  const rows = env.gas.apiQuestions();
  env.gas.apiAnswer(rows[0].row, 'new');
  const nora = env.sheet('Students').objects().find(s => s.Name === 'Nora Vega');
  assert.deepEqual([nora['Class ID'], nora.Order, nora['On roster since'], nora.Active], ['C3', '5', '2026-10-12', 'Yes']);
  assert.equal(env.row('2026-10-12', 'C3', nora['Student ID']).Status, 'Present');   // the class was re-run with her
  assert.equal(env.row('2026-10-05', 'C3', nora['Student ID']), undefined);          // week 1 is not counted against her
  const log = env.sheet('Roster changes').objects();
  assert.equal(log.length, 1);
  assert.match(log[0].Change, /Added to the roster \(#5, from 2026-10-12\)/);
  assert.match(log[0].How, /Seen in the 2026-10-12 screenshots as "Nora Vega"/);
  assert.equal(env.gas.apiClass('C3').students.find(s => s.name === 'Nora Vega').since, '2026-10-12');
  // re-running week 1 later (e.g. its start time changes) still does not mark her absent there
  env.gas.apiSetStart('C3', '2026-10-05', '6:05');
  assert.equal(env.row('2026-10-05', 'C3', nora['Student ID']), undefined);
});

test('In-person class: a Populi screenshot read by Claude is recorded exactly as marked (no 15/31 rule)', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  const S = env.sheet('Students');
  [['2001', 'Elena Ramos', 1], ['2002', 'Tom Nguyen', 2], ['2003', 'Grace Okafor', 3], ['2004', 'Luis Silva', 4]]
    .forEach(x => S.appendRow([x[0], x[1], '', 'C1', 'Yes', String(x[2])]));
  const b64 = t => Buffer.from(t).toString('base64');
  env.gas.apiUploadShot('C1', '2026-10-05', 'populi', 'populi.png', 'image/png', b64('pixels'));
  assert.equal(env.gas.apiAnalyzeSession('C1', '2026-10-05').waiting, true);
  const sess = env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C1');
  const f = env.gas.DriveApp.getFolderById(sess['Source ID']);
  const job = JSON.parse(f.getFilesByName('claude-job.json').next().content);
  assert.equal(job.kind, 'populi');
  assert.equal(job.shots.populi.length, 1);
  const row = (n, st, conf) => ({ shown_name: 'x', roster_number: n, status: st, confidence: conf == null ? 0.98 : conf });
  f.createFile('claude-results.json', JSON.stringify({ populi: [{ rows: [Object.assign(row(1, 'Present'), { note: 'NO ID' }), Object.assign(row(2, 'Tardy'), { note: 'Left at 3' }), row(3, 'Absent'), row(9, 'Present', 0.4)] }] }), 'application/json');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '2001').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Tardy');
  assert.equal(env.row('2026-10-05', 'C1', '2003').Status, 'Absent');
  assert.equal(env.row('2026-10-05', 'C1', '2003').Source, 'Populi screenshot');
  assert.equal(env.row('2026-10-05', 'C1', '2001')['No ID'], 'Yes');   // Populi note "NO ID" counts for the office notice
  assert.equal(env.row('2026-10-05', 'C1', '2002')['No ID'], '');
  assert.match(env.row('2026-10-05', 'C1', '2002').Notes, /As marked in Populi: Left at 3/);
  assert.equal(env.row('2026-10-05', 'C1', '2004'), undefined);          // not in the screenshot: not marked
  const log = env.sheet('Inbox log').objects().find(x => /read by Claude/.test(x.File));
  assert.match(log.Result, /1 present, 1 tardy, 1 absent \(as marked in Populi\)/);
  assert.match(log.Result, /Not in the screenshot \(not marked\): #4 Luis Silva/);
  assert.match(log.Result, /Could not match: x \(Present\)/);
  // OCR mode does not take Populi screenshots
  const env2 = setupTerm({ mode: 'POPULI' });
  assert.throws(() => env2.gas.apiUploadShot('C1', '2026-10-05', 'populi', 'p.png', 'image/png', b64('x')), /read by Claude/);
});

test('Screenshots read by CLAUDE: no OCR, nothing marked until Claude writes its results in the class folder', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  [2, 3, 4, 5].forEach((row, i) => env.sheet('Students').put(row, 6, String(i + 1))); // Populi order
  const b64 = t => Buffer.from(t).toString('base64');
  env.ocr.calls = 0;
  let r = env.gas.apiUploadShot('C3', '2026-10-05', 'present', 'Screenshot 1.png', 'image/png', b64('pixels'));
  assert.equal(r.claude, true);
  env.gas.apiUploadShot('C3', '2026-10-05', 'end', 'Screenshot 2.png', 'image/png', b64('pixels'));
  assert.equal(env.ocr.calls, 0, 'no OCR');
  const a = env.gas.apiAnalyzeSession('C3', '2026-10-05');
  assert.equal(a.waiting, true);
  assert.match(a.msg, /Waiting for Claude to read 2 screenshot/);
  assert.equal(env.att().filter(x => x['Class ID'] === 'C3').length, 0, 'nobody marked absent while unread');

  // the job Claude reads: roster in Populi order + the screenshots' Drive ids
  const sess = env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C3');
  const job = (() => { const f = env.gas.DriveApp.getFolderById(sess['Source ID']); const it = f.getFilesByName('claude-job.json'); return { f, j: JSON.parse(it.next().content) }; })();
  assert.equal(job.j.status, 'waiting');
  assert.equal(job.j.shots.present.length, 1);
  assert.equal(job.j.shots.end.length, 1);
  assert.deepEqual(job.j.roster.map(s => s.name), ['Ana Maria Lopez', 'Brian Smith', 'Carla Pérez', 'David Kim']);

  // Claude writes its results; the next run takes the attendance
  const order = n => job.j.roster.findIndex(s => s.name === n) + 1;
  const p = (name, n) => ({ shown_name: name, roster_number: n, confidence: 0.95, alternatives: [] });
  job.f.createFile('claude-results.json', JSON.stringify({
    present: [{ participants: [p('Ana Lopez', order('Ana Maria Lopez')), p('Brian S', order('Brian Smith'))], chat: [], unreadable: 0 }],
    end: [{ participants: [p('Ana Lopez', order('Ana Maria Lopez'))], chat: [], unreadable: 0 }]
  }), 'application/json');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C3', '1002').Status, 'Absent');   // left before the last screenshot
  assert.equal(env.row('2026-10-05', 'C3', '1002')['Left early'], 'Yes');
  assert.equal(env.row('2026-10-05', 'C3', '1003').Status, 'Absent');
  assert.ok(job.f.getFilesByName('claude-results applied.json').hasNext());
  assert.equal(JSON.parse(job.f.getFilesByName('claude-job.json').next().content).status, 'done');
  env.gas.tick(); // applied once only
  assert.equal(env.sheet('Inbox log').objects().filter(x => /read by Claude/.test(x.File)).length, 1);
});

test('with a Claude API key, screenshots are read by AI: sure matches count, doubts go to Review', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  env.props.ANTHROPIC_API_KEY = 'sk-ant-test';
  env.inbox().addFile('BIO 101 roster.csv', ['Student ID,Populi Name,Course Abbrv,Type', '11,Ana Uno,BIO 101,student',
    '12,Beto Dos,BIO 101,student', '13,Caro Tres,BIO 101,student', '14,Caro Tress,BIO 101,student'].join('\n'));
  env.gas.tick();
  const b64 = t => Buffer.from(t).toString('base64');
  const p = (shown, n, conf, alts) => ({ shown_name: shown, roster_number: n, confidence: conf, alternatives: alts || [], where: 'tile' });
  // The OCR text is garbage on purpose: the result must come from the AI reading.
  env.ai.reply = body => {
    const prompt = body.messages[0].content[1].text;
    assert.match(prompt, /Ana Uno/);
    assert.equal(body.messages[0].content[0].type, 'image');
    assert.equal(body.output_config.format.type, 'json_schema');
    if (/15 minutes/.test(prompt)) return { participants: [p('ana u.', 1, 0.95), p('Prof X', -1, 0.99), p('Caro T', 3, 0.5, [4])], chat: [], unreadable: false };
    return { participants: [p('ana u.', 1, 0.95), p('beto', 2, 0.92)], chat: [], unreadable: false };
  };
  let r = env.gas.apiUploadShot('C3', '2026-10-05', 'present', 's1.jpg', 'image/jpeg', b64('###'));
  assert.equal(r.ai, true);
  assert.equal(env.ai.requests[0].headers['x-api-key'], 'sk-ant-test');
  assert.equal(env.ai.requests[0].body.model, 'claude-opus-5-5');
  env.gas.apiUploadShot('C3', '2026-10-05', 'tardy', 's2.jpg', 'image/jpeg', b64('###'));
  env.gas.apiUploadShot('C3', '2026-10-05', 'end', 's3.jpg', 'image/jpeg', b64('###'));
  env.gas.apiAnalyzeSession('C3', '2026-10-05');
  assert.equal(env.row('2026-10-05', 'C3', '11').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C3', '12').Status, 'Present');
  const qs = j(env.gas.apiQuestions());
  assert.ok(JSON.stringify(qs).includes('Caro T'), 'the unsure name is asked about');

  // AI errors never block: the OCR reading is used instead
  env.ai.reply = () => { throw new Error('overloaded'); };
  r = env.gas.apiUploadShot('C3', '2026-10-05', 'end', 's4.jpg', 'image/jpeg', b64('Ana Uno'));
  assert.equal(r.ai, false);
  assert.match(r.aiError, /overloaded/);
  // and it can be read again later
  const files = j(env.gas.apiShotFiles('C3', '2026-10-05'));
  assert.equal(files.end.length, 2);
  assert.equal(files.end[1].done, false);
  env.ai.reply = () => ({ participants: [p('Ana Uno', 1, 0.99)], chat: [], unreadable: false });
  assert.equal(env.gas.apiAiReadFile('C3', '2026-10-05', 'end', 1, files.end[1].id).names, 1);
  assert.equal(j(env.gas.apiShotFiles('C3', '2026-10-05')).end[1].done, true);
});

test('student emails: sorted, excuse marks the absence, reply drafts, answered threads close, to-do shows waiting time', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  env.inbox().addFile('Zoom screenshots 2026-10-05 [C3].csv', ['Student,Date,Status', 'Ana Maria Lopez,2026-10-05,Absent',
    'Brian Smith,2026-10-05,Present', 'Carla Pérez,2026-10-05,Tardy', 'David Kim,2026-10-05,Present'].join('\n'));
  env.setNow('2026-10-06T00:30:00Z');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Absent');

  // Without AI: word rules + a template
  env.mail.receive({ from: 'Ana Lopez <ana@ivy.edu>', subject: 'Doctor note', body: 'Hi, I was sick on Monday. Attached is my doctor note.', attachments: ['note.pdf'], at: '2026-10-06T13:00:00Z' });
  env.mail.receive({ from: 'Someone <spam@x.com>', subject: 'Offer', body: 'Buy now' });
  const brian = env.mail.receive({ from: 'brian@ivy.edu', subject: 'Zoom link?', body: 'What is the zoom link for tonight?', at: '2026-10-06T13:00:00Z' });
  env.setNow('2026-10-07T15:00:00Z');
  env.gas.tick();
  let m = j(env.gas.apiMail());
  assert.equal(m.length, 2, 'only students');
  const ana = m.find(x => x.email === 'ana@ivy.edu');
  assert.equal(ana.category, 'Medical excuse');
  assert.equal(ana.status, 'Needs reply');
  assert.equal(ana.waiting, 26);
  assert.match(ana.draft, /^Hi Ana,[\s\S]*received it[\s\S]*Diego/);
  assert.match(ana.excuse, /Marked Received · BIO 101 · 2026-10-05/);
  assert.equal(env.row('2026-10-05', 'C3', '1001').Excuse, 'Received');
  assert.equal(ana.classes[0].effective, 1);
  assert.ok(env.mail.threads[0].labels.has('TA/Medical excuse') && env.mail.threads[0].labels.has('TA/Needs reply'));
  const tasks = j(env.gas.apiOverview()).tasks.filter(t => t.type === 'mail');
  assert.equal(tasks.length, 2);
  assert.match(tasks[0].text, /waiting 26 h/);

  // Nothing new → no rework; my reply closes the thread
  env.mail.receive({ thread: brian, from: 'Diego <dgomez230@ivy.edu>', body: 'Here it is.' });
  env.gas.tick();
  m = j(env.gas.apiMail());
  assert.equal(m.find(x => x.email === 'brian@ivy.edu').status, 'Answered');
  assert.ok(!brian.labels.has('TA/Needs reply'));

  // Put the reply in Gmail, forward the excuse to the office as a draft, close by hand
  env.gas.apiMailToGmail(ana.threadId, 'Hi Ana, thanks!');
  assert.equal(env.mail.replies[0].body, 'Hi Ana, thanks!');
  env.gas.apiMailForwardExcuse(ana.threadId);
  assert.match(env.mail.drafts.at(-1).subject, /Medical excuse – Ana Maria Lopez/);
  env.gas.apiMailStatus(ana.threadId, 'Done');
  assert.equal(j(env.gas.apiOverview()).tasks.filter(t => t.type === 'mail').length, 0);
});

test('student emails with AI: Claude gets the record and the rules, writes the reply; redraft on request; apiAll has everything', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  env.props.ANTHROPIC_API_KEY = 'sk-ant-test';
  env.inbox().addFile('Zoom screenshots 2026-10-05 [C3].csv', ['Student,Date,Status', 'Ana Maria Lopez,2026-10-05,Present',
    'Brian Smith,2026-10-05,Absent', 'Carla Pérez,2026-10-05,Present', 'David Kim,2026-10-05,Present'].join('\n'));
  env.setNow('2026-10-06T00:30:00Z');
  env.gas.tick();
  const reply = (over) => Object.assign({ category: 'absence_notice', needs_reply: true, urgency: 'normal', summary: 'Will miss next class',
    excuse: { is_excuse: false, class_date: '', has_doctor_phone: false, for_someone_else: false, missing: [] }, reply: 'Hi Brian, you have 1 absence left.' }, over);
  env.ai.reply = body => {
    const text = body.messages[0].content[0].text;
    assert.match(body.system, /at most 2 absences/);
    assert.match(body.system, /never .*professor|Do not send it to your professor/i);
    assert.match(text, /Student: Brian Smith/);
    assert.match(text, /2026-10-05 Absent/);
    assert.match(text, /absences left: 1/);
    return /shorter/.test(text) ? reply({ reply: 'Hi Brian, 1 left.' }) : reply();
  };
  env.mail.receive({ from: 'Brian <brian@ivy.edu>', subject: 'Next Monday', body: 'I will not be able to come next Monday.\n\nOn Mon, Oct 5 Diego wrote:\n> old text' });
  // out of time in this run: listed as waiting, drafted on the next run
  env.gas.scanMail_(env.gas.load_(), -1);
  assert.equal(env.ai.requests.length, 0);
  assert.equal(j(env.gas.apiMail())[0].status, 'Needs reply');
  env.gas.tick();
  const m = j(env.gas.apiMail())[0];
  assert.equal(m.category, 'Will miss / missed class');
  assert.equal(m.draft, 'Hi Brian, you have 1 absence left.');
  assert.equal(m.by, 'AI');
  assert.ok(!JSON.stringify(env.ai.requests[0].body).includes('old text'), 'quoted text removed');
  assert.equal(env.gas.apiMailRedraft(m.threadId, 'shorter').draft, 'Hi Brian, 1 left.');

  const all = j(env.gas.apiAll());
  assert.deepEqual(Object.keys(all.classes).sort(), ['C1', 'C2', 'C3', 'C4']);
  assert.equal(all.overview.mailWaiting, 1);
  assert.equal(all.overview.ai, true);
  assert.equal(all.mail[0].draft, 'Hi Brian, 1 left.');
  assert.ok(Array.isArray(all.questions) && Array.isArray(all.followups) && all.reportWeeks.weeks.length === 10);
});

test('speed: a 15-minute run with nothing new writes nothing; an edit writes one row', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.inbox().addFile('ENG attendance [C1].csv', populiC1);
  env.gas.tick();
  env.gas.tick(); // settles the derived sheets
  env.calls.reset();
  env.gas.tick();
  assert.equal(env.calls.write, 0, 'no sheet writes');
  assert.equal(env.calls.format, 0, 'no grid rebuilds');
  const before = env.sheet('Attendance').data.map(r => r.slice());
  env.calls.reset();
  env.gas.apiSetRecord('C1', '2026-10-05', '2001', { status: 'Tardy' });
  assert.equal(env.calls.write, 1);
  const after = env.sheet('Attendance').data;
  const diff = after.map((r, i) => r.join('|') !== (before[i] || []).join('|') ? i : -1).filter(i => i >= 0);
  assert.deepEqual(diff, [before.findIndex(r => r[2] === '2001')], 'only that student\'s row changed');
});

test('a dashboard edit made while the 15-minute job is working is not undone by it', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.inbox().addFile('ENG attendance [C1].csv', populiC1);
  env.gas.tick();
  const g = env.gas, job = g.load_();               // the job read the sheets…
  g.apiSetRecord('C1', '2026-10-05', '2001', { excuse: 'Received' }); // …Diego edits in the dashboard…
  const t = job.att, r = t.rows.find(x => t.get(x, 'Student ID') === '2001');
  t.set(r, 'Notes', 'from the job');                 // …the job changes another cell of the same row and saves
  g.save_(t);
  const row = env.row('2026-10-05', 'C1', '2001');
  assert.equal(row.Excuse, 'Received');
  assert.equal(row.Notes, 'from the job');
  // A row the job adds that someone else added meanwhile is not duplicated
  const job2 = g.load_(), a = job2.att, nr = a.header.map(() => '');
  a.set(nr, 'Date', '2026-10-12'); a.set(nr, 'Class ID', 'C1'); a.set(nr, 'Student ID', '2002'); a.set(nr, 'Status', 'Absent');
  a.rows.push(nr);
  g.apiSetRecord('C1', '2026-10-12', '2002', { status: 'Tardy' });
  g.save_(a);
  assert.equal(env.att().filter(x => x.Date === '2026-10-12' && x['Student ID'] === '2002').length, 1);
});

test('a second job does not start while one is running; the dashboard still saves', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.inbox().addFile('ENG attendance [C1].csv', populiC1);
  env.gas.tick();
  env.props.jobUntil = String(Date.now() + 60000 + Date.parse('2026-10-05T14:00:00Z')); // a job is running
  env.inbox().addFile('ENG attendance [C1] 2.csv', populiC1);
  env.gas.tick();
  assert.equal(env.inbox().files.length, 1, 'the second run waited');
  assert.equal(env.gas.apiProcessNow().busy, true);
  env.gas.apiSetRecord('C1', '2026-10-05', '2001', { status: 'Tardy' });
  assert.equal(env.row('2026-10-05', 'C1', '2001').Status, 'Tardy');
  env.props.jobUntil = '0';
  env.gas.tick();
  assert.equal(env.inbox().files.length, 0);
});

test('apiAll bigger than one cache entry is cached in pieces', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const rows = [];
  for (let i = 0; i < 600; i++) rows.push(['9' + i, 'Student number ' + i + ' with a long name', 's' + i + '@ivy.edu', 'C3', 'Yes', String(i + 1)]);
  env.sheet('Students').getRange(2, 1, rows.length, 6).setValues(rows);
  const first = JSON.stringify(env.gas.apiAll());
  assert.ok(first.length > 100000, 'big answer: ' + first.length);
  env.calls.reset();
  const again = env.gas.apiAll();
  assert.equal(env.calls.read, 0, 'served from the cache');
  assert.equal(JSON.stringify(again).replace(/"at":"[^"]*"/, ''), first.replace(/"at":"[^"]*"/, ''));
});

test('standing follow-ups: below 100% and below 80%, grouped by numbers, done when sent, back when numbers change', () => {
  const env = setupTerm({ mode: 'POPULI' });
  const j = x => JSON.parse(JSON.stringify(x));
  const S = env.sheet('Students');
  [['201', 'Ana Uno', 'C1', '1'], ['202', 'Beto Dos', 'C1', '2'], ['203', 'Caro Tres', 'C1', '3'], ['204', 'Dani Cuatro', 'C1', '4'], ['205', 'Eva Cinco', 'C1', '5']]
    .forEach(s => S.appendRow([s[0], s[1], s[0] + '@ivy.edu', s[2], 'Yes', s[3]]));
  const A = env.sheet('Attendance');
  const add = (d, id, st) => A.appendRow([d, 'C1', id, '', st, '', 'Populi']);
  ['2026-10-05', '2026-10-12', '2026-10-19'].forEach(d => { add(d, '201', 'Absent'); add(d, '205', 'Present'); }); // Ana: 3 absences → below 80%
  add('2026-10-05', '202', 'Absent'); add('2026-10-05', '203', 'Absent');   // Beto and Caro: 1 absence each → one message
  add('2026-10-05', '204', 'Tardy');                                         // Dani: 1 tardy → still 100%, not listed
  ['2026-10-05', '2026-10-12', '2026-10-19'].forEach(d => add(d, '206', 'Tardy')); // Fer: 3 tardies = 1 absence → own message (different numbers)
  S.appendRow(['206', 'Fer Seis', '206@ivy.edu', 'C1', 'Yes', '6']);
  env.setNow('2026-10-20T14:00:00Z');
  let st = j(env.gas.apiStanding()).classes.find(c => c.id === 'C1');
  assert.deepEqual(st.students.map(s => [s.name, s.level]), [['Ana Uno', 'below80'], ['Beto Dos', 'below100'], ['Caro Tres', 'below100'], ['Fer Seis', 'below100']]);
  assert.equal(st.messages.length, 3);
  const [m80, m1, mt] = st.messages;
  assert.equal(m80.level, 'below80');
  assert.match(m80.subject, /^Important: your attendance in /);
  assert.match(m80.text, /^Hi Ana,/);
  assert.match(m80.text, /missed 3 classes in .* attendance at 70%\. That is below the 80% attendance required, and more than 2 absences means failing the course/);
  assert.match(m80.text, /Could you reply by Tuesday, October 27\?/);
  assert.match(m80.text, /Classes missed or late: Monday, October 5, Monday, October 12, Monday, October 19/);
  assert.deepEqual(m1.roster, [2, 3]);
  assert.match(m1.text, /^Hi,/);
  assert.match(m1.text, /missed 1 class in .*attendance at 90%/);
  assert.match(m1.text, /You have 1 absence left/);
  assert.match(m1.text, /just reply to this email/);
  assert.deepEqual(mt.ids, ['206']);
  assert.match(mt.text, /^Hi Fer,/);
  assert.match(mt.text, /every 3 tardies count as 1 absence/);
  assert.match(mt.text, /1 absence \+ |Tardies: 3/);
  // Diego sends Beto + Caro's message in Populi
  st = j(env.gas.apiStandingSent('C1', ['202', '203'])).classes.find(c => c.id === 'C1');
  assert.equal(st.messages.length, 2);
  const beto = st.students.find(s => s.id === '202');
  assert.ok(beto.upToDate);
  assert.equal(beto.last.date, '2026-10-20');
  const fu = env.sheet('Follow-ups').objects().find(r => r.Type === 'Standing: below 100%');
  assert.match(fu.Done, /^Yes/);
  assert.equal(fu.Standing, '202@1/0; 203@1/0');
  assert.equal(j(env.gas.apiFollowups()).length, 0, 'not in the Populi to-send list: it was already sent');
  // Beto misses again → his numbers changed → pending again (now with no absences left)
  add('2026-10-19', '202', 'Absent');
  st = j(env.gas.apiStanding()).classes.find(c => c.id === 'C1');
  const again = st.messages.find(m => m.ids.includes('202'));
  assert.ok(again);
  assert.match(again.text, /no absences left/);
  assert.ok(st.students.find(s => s.id === '203').upToDate);
  // apiAll carries it for the dashboard
  assert.ok(j(env.gas.apiAll()).standing.classes.length);
});

test('Speed: batch upload without the lock, one job for all, results applied by the 5-minute check; dashboard snapshot', () => {
  const j = x => JSON.parse(JSON.stringify(x));
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  [2, 3, 4, 5].forEach((row, i) => env.sheet('Students').put(row, 6, String(i + 1)));
  const b64 = t => Buffer.from(t).toString('base64');
  const prep = env.gas.apiPrepareShots('C3', '2026-10-05');
  assert.ok(prep.subs.present && prep.subs.end && prep.subs.populi);
  const up = ['present', 'end'].map((ph, i) => env.gas.apiUploadShot('C3', '2026-10-05', ph, 's' + i + '.png', 'image/png', b64('px'), prep.subs[ph]));
  assert.ok(up.every(u => u.fileId && u.claude));
  const sess = env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C3');
  const f = env.gas.DriveApp.getFolderById(sess['Source ID']);
  assert.equal(f.getFilesByName('claude-job.json').hasNext(), false, 'no job per screenshot');
  const a = env.gas.apiAnalyzeSession('C3', '2026-10-05', up);
  assert.equal(a.waiting, true);
  const job = JSON.parse(f.getFilesByName('claude-job.json').next().content);
  assert.deepEqual([job.shots.present.length, job.shots.end.length], [1, 1]);
  assert.equal(j(env.gas.apiAll()).claudeWaiting, 1);
  // registering the same batch twice adds nothing
  env.gas.apiAnalyzeSession('C3', '2026-10-05', up);
  assert.equal(JSON.parse(f.getFilesByName('claude-job.json').next().content).shots.present.length, 1);

  const p = n => ({ shown_name: 'x', roster_number: n, confidence: 0.95, alternatives: [] });
  f.createFile('claude-results.json', JSON.stringify({ present: [{ participants: [p(1)], chat: [], unreadable: 0 }], end: [{ participants: [p(1)], chat: [], unreadable: 0 }] }), 'application/json');
  env.gas.claudeCheck();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Present');
  assert.equal(j(env.gas.apiAll()).claudeWaiting, 0);
  env.gas.claudeCheck(); // nothing waiting: returns at once
  assert.equal(env.sheet('Inbox log').objects().filter(x => /read by Claude/.test(x.File)).length, 1);

  // Snapshot: reused while nothing changed, rebuilt after an edit
  const s1 = j(env.gas.apiAll()), s2 = j(env.gas.apiAll());
  assert.equal(s1.builtAt, s2.builtAt);
  env.gas.apiSetRecord('C3', '2026-10-05', '1002', { status: 'Absent' });
  const s3 = j(env.gas.apiAll());
  assert.notEqual(s3.gen, s1.gen);
  assert.equal(s3.classes.C3.students.find(s => s.id === '1002').weeks[0].s, 'A');
  env.gas.tick(); // the 15-minute job leaves a ready snapshot in Drive too
  const proc = env.inbox().folders.find(x => x.name === 'Processed');
  assert.ok(proc.files.some(x => x.name === 'dashboard-snapshot.json'));
});

test('Populi screenshots: a re-upload while Claude reads never blocks the class; the newest screenshot wins', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  const S = env.sheet('Students');
  [['2001', 'Elena Ramos', 1], ['2002', 'Tom Nguyen', 2]].forEach(x => S.appendRow([x[0], x[1], '', 'C1', 'Yes', String(x[2])]));
  const b64 = t => Buffer.from(t).toString('base64');
  env.gas.apiUploadShot('C1', '2026-10-05', 'populi', 'a.png', 'image/png', b64('a'));
  const sess = env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C1');
  const f = env.gas.DriveApp.getFolderById(sess['Source ID']);
  const row = (n, st) => ({ shown_name: 'x', roster_number: n, status: st, confidence: 0.98 });
  f.createFile('claude-results.json', JSON.stringify({ populi: [{ rows: [row(1, 'Present'), row(2, 'Absent')] }] }), 'application/json');
  // Diego uploads the screenshot again before the results are applied
  env.gas.apiUploadShot('C1', '2026-10-05', 'populi', 'b.png', 'image/png', b64('b'));
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '2001').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Absent');
  // Claude reads the new one: Tom was fixed to Tardy in Populi → the newest wins
  f.createFile('claude-results.json', JSON.stringify({ populi: [null, { rows: [row(1, 'Present'), row(2, 'Tardy')] }] }), 'application/json');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Tardy');
});

test('Roster from the dashboard: Populi CSV or pasted names, wrong-class guard, add and remove by hand (all logged)', () => {
  const env = setupTerm();
  const S = env.sheet('Students');
  S.appendRow(['1005', 'Eva Green', 'eva@ivy.edu', 'C3', 'Yes']);
  S.appendRow(['1006', 'Frank Ocean', 'frank@ivy.edu', 'C3', 'Yes']);
  const csv = ['Student,Student ID,Email,Status', 'Brian Smith,1002,brian@ivy.edu,Enrolled', 'Ana Maria Lopez,1001,ana@ivy.edu,Enrolled',
    'Carla Pérez,1003,carla@ivy.edu,Enrolled', 'David Kim,1004,david@ivy.edu,Enrolled', 'Eva Green,1005,eva@ivy.edu,Enrolled',
    'Gina Hall,1007,gina@ivy.edu,Enrolled'].join('\n');
  const r = JSON.parse(JSON.stringify(env.gas.apiImportRoster('C3', csv, 'roster.csv')));
  assert.deepEqual([r.total, r.addedNames, r.removedNames], [6, ['Gina Hall'], ['Frank Ocean']]);
  const st = () => env.sheet('Students').objects().filter(x => x['Class ID'] === 'C3');
  assert.equal(st().find(x => x.Name === 'Brian Smith').Order, '1');            // Populi order
  assert.equal(st().find(x => x.Name === 'Gina Hall')['On roster since'], '2026-10-05');
  assert.equal(st().find(x => x.Name === 'Frank Ocean').Active, 'No');
  // another class's roster: asks first
  const other = ['Student', 'Zed One', 'Zed Two', 'Zed Three', 'Zed Four', 'Zed Five', 'Zed Six'].join('\n');
  assert.match(env.gas.apiImportRoster('C3', other, 'pasted').warning, /Only 0 of these 6 students/);
  assert.equal(st().filter(x => x.Active === 'Yes').length, 6, 'nothing changed');
  // one student by hand, then removed
  const a = env.gas.apiAddStudent('C3', 'Hugo Ruiz', '2026-10-12');
  assert.equal(a.order, 7);
  const hugo = st().find(x => x.Name === 'Hugo Ruiz');
  assert.equal(hugo['On roster since'], '2026-10-12');
  env.gas.apiRemoveStudent('C3', hugo['Student ID']);
  assert.equal(st().find(x => x.Name === 'Hugo Ruiz').Active, 'No');
  const log = env.sheet('Roster changes').objects().map(x => x.Name + ': ' + x.Change);
  assert.deepEqual(log, ['Gina Hall: Added to the roster', 'Frank Ocean: No longer on the roster (inactive)',
    'Hugo Ruiz: Added to the roster (#7, from 2026-10-12)', 'Hugo Ruiz: Removed from the roster (inactive)']);
});

test('online classes: an old Tardy becomes Present, Tardy cannot be set by hand, minute 31 in the Zoom report is Absent', () => {
  const env = setupTerm();
  env.inbox().addFile('participants_81234567890.csv', [
    'Meeting ID,Topic,Start Time',
    '81234567890,BIO 101,10/05/2026 05:55:00 PM',
    '',
    'Name (Original Name),User Email,Join Time,Leave Time,Duration (Minutes),Guest',
    'Ana Maria Lopez,,10/05/2026 06:30:00 PM,10/05/2026 07:00:00 PM,30,Yes',
    'Brian Smith,,10/05/2026 06:31:00 PM,10/05/2026 07:00:00 PM,29,Yes'
  ].join('\n'));
  env.setNow('2026-10-05T23:30:00Z');
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Present');   // minute 30
  assert.equal(env.row('2026-10-05', 'C3', '1002').Status, 'Absent');    // minute 31
  // A Tardy saved before the rule changed turns into Present on the next run
  const sh = env.sheet('Attendance'), h = sh.data[0];
  const i = sh.data.findIndex(r => r[h.indexOf('Class ID')] === 'C3' && r[h.indexOf('Student ID')] === '1001');
  sh.data[i][h.indexOf('Status')] = 'Tardy';
  env.gas.tick();
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Present');
  assert.match(env.row('2026-10-05', 'C3', '1001').Notes, /Online class: no Tardy/);
  assert.throws(() => env.gas.apiSetRecord('C3', '2026-10-05', '1001', { status: 'Tardy' }), /Online classes have no Tardy/);
  env.gas.apiSetRecord('C3', '2026-10-05', '1001', { status: 'Absent' });
  assert.equal(env.row('2026-10-05', 'C3', '1001').Status, 'Absent');
});

test('student names from the dashboard: new last name keeps the old one, Zoom names match, screenshots re-read', () => {
  const env = setupTerm();
  const j = x => JSON.parse(JSON.stringify(x));
  const b64 = s => Buffer.from(s).toString('base64');
  env.setNow('2026-10-06T03:00:00Z');
  // 15 min: Ana and "Brian New"; 31 min: same; last: both. Brian Smith is not recognized yet.
  env.gas.apiUploadShot('C3', '2026-10-05', 'present', 'a.jpg', 'image/jpeg', b64('Ana Maria Lopez\nBrian Newname'));
  env.gas.apiUploadShot('C3', '2026-10-05', 'tardy', 'b.jpg', 'image/jpeg', b64('Ana Maria Lopez\nBrian Newname'));
  env.gas.apiUploadShot('C3', '2026-10-05', 'end', 'c.jpg', 'image/jpeg', b64('Ana Maria Lopez\nBrian Newname'));
  env.gas.apiAnalyzeSession('C3', '2026-10-05');
  assert.notEqual(env.row('2026-10-05', 'C3', '1002') && env.row('2026-10-05', 'C3', '1002').Status, 'Present');
  // Diego changes Brian's last name: the old name becomes a Zoom name, the class is read again
  const r = j(env.gas.apiSetStudentNames('C3', '1002', { name: 'Brian Newname', aliases: ['Bri (iPad)'] }));
  assert.equal(r.name, 'Brian Newname');
  assert.deepEqual(r.aliases, ['Bri (iPad)', 'Brian Smith']);
  assert.ok(r.reruns >= 1);
  assert.equal(env.row('2026-10-05', 'C3', '1002').Status, 'Present');
  assert.equal(env.row('2026-10-05', 'C3', '1002').Name, 'Brian Newname');
  const st = env.sheet('Students').objects().find(x => x['Student ID'] === '1002' && x['Class ID'] === 'C3');
  assert.equal(st['Zoom names'], 'Bri (iPad); Brian Smith');
  assert.match(env.sheet('Roster changes').objects().at(-1).Change, /Name changed from "Brian Smith"/);
  assert.throws(() => env.gas.apiSetStudentNames('C3', '1002', { name: ' ' }), /cannot be empty/);
});

test('Populi correction after the class (any class): Populi wins over the screenshots and manual edits, re-runs keep it', () => {
  const env = setupTerm({ mode: 'POPULI' });
  env.setConfig('Screenshots read by', 'CLAUDE');
  const S = env.sheet('Students');
  [['2001', 'Elena Ramos', 1], ['2002', 'Tom Nguyen', 2], ['2003', 'Grace Okafor', 3]]
    .forEach(x => S.appendRow([x[0], x[1], '', 'C1', 'Yes', String(x[2])]));
  const b64 = t => Buffer.from(t).toString('base64');
  const row = (n, st) => ({ shown_name: 'x', roster_number: n, status: st, confidence: 0.98 });
  const folder = () => env.gas.DriveApp.getFolderById(env.sheet('Sessions').objects().find(x => x['Class ID'] === 'C1')['Source ID']);
  // Week taken from Populi in class: 2 absent
  env.gas.apiUploadShot('C1', '2026-10-05', 'populi', 'p.png', 'image/png', b64('pixels'));
  env.gas.apiAnalyzeSession('C1', '2026-10-05');
  folder().createFile('claude-results.json', JSON.stringify({ populi: [{ rows: [row(1, 'Present'), row(2, 'Absent'), row(3, 'Absent')] }] }), 'application/json');
  env.gas.claudeCheck();
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Absent');
  env.gas.apiSetRecord('C1', '2026-10-05', '2003', { status: 'Present' });   // Diego's manual edit
  // Later the office accepts a medical excuse (Tom) and marks Grace absent: Diego drops a Populi screenshot
  const p = env.gas.apiPrepareShots('C1', '2026-10-05');
  const up = env.gas.apiUploadShot('C1', '2026-10-05', 'correction', 'fix.png', 'image/png', b64('pixels'), p.subs.correction);
  const r = env.gas.apiAnalyzeSession('C1', '2026-10-05', [up]);
  assert.equal(r.waiting, true);
  const job = JSON.parse(folder().getFilesByName('claude-job.json').next().content);
  assert.equal(job.status, 'waiting');
  assert.equal(job.shots.correction.length, 1);
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Absent');        // nothing changes until it is read
  folder().createFile('claude-results.json', JSON.stringify({ correction: [{ rows: [row(2, 'Excused'), row(3, 'Absent')] }] }), 'application/json');
  env.gas.claudeCheck();
  assert.equal(env.row('2026-10-05', 'C1', '2001').Status, 'Present');       // not in the correction: unchanged
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Excused');
  assert.equal(env.row('2026-10-05', 'C1', '2002').Source, 'Populi correction');
  assert.equal(env.row('2026-10-05', 'C1', '2003').Status, 'Absent');        // Populi wins over the manual edit
  const log = env.sheet('Inbox log').objects().filter(x => /read by Claude/.test(x.File)).at(-1);
  assert.match(log.Result, /Populi correction: 2 changed \(#2 Tom Nguyen Absent → Excused; #3 Grace Okafor Present → Absent\)/);
  // A re-run of the class (start time changed) keeps the correction
  env.gas.apiSetStart('C1', '2026-10-05', '9:05');
  assert.equal(env.row('2026-10-05', 'C1', '2002').Status, 'Excused');
  assert.equal(JSON.parse(JSON.stringify(env.gas.apiSession("C1", "2026-10-05"))).shots.correction, 1);
});
