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
  for (const n of ['Config', 'Classes', 'Students', 'Attendance', 'Assignments', 'Summary', 'Outbox', 'Inbox log']) assert.ok(env.sheet(n), n);
  const inbox = env.rootFolders.find(f => f.name === 'TA Inbox');
  assert.ok(inbox);
  assert.deepEqual(inbox.folders.map(f => f.name).sort(), ['Needs attention', 'Processed']);
  assert.equal(env.sheet('Classes').objects().length, 4);
  const cfg = Object.fromEntries(env.sheet('Config').data.map(r => [r[0], r[1]]));
  assert.equal(cfg['Reply-To email'], 'dgomez230@ivy.edu');
  assert.equal(cfg['Email mode'], 'DRAFT');
  assert.equal(cfg['Send notices from'], '2026-10-05');
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
  assert.match(rep.body, /== BIO 101 \(03\)[\s\S]*Nobody\./);

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
