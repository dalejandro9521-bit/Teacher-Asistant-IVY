// Unit tests for the pure rules, parsers and messages. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./gas-mock');

const g = makeEnv().gas;
// Objects made inside the VM have other prototypes; compare them as plain JSON.
const plain = x => JSON.parse(JSON.stringify(x));
const cls = { id: 'C3', course: 'BIO 101', section: '01', day: 'Monday', start: 18 * 60, end: 19 * 60, mode: 'Zoom' };
const roster = [
  { id: '1001', name: 'Ana Maria Lopez', email: 'ana@ivy.edu', classId: 'C3' },
  { id: '1002', name: 'Brian Smith', email: 'brian@ivy.edu', classId: 'C3' },
  { id: '1003', name: 'Carla Pérez', email: 'carla@ivy.edu', classId: 'C3' },
  { id: '1004', name: 'David Kim', email: 'david@ivy.edu', classId: 'C3' }
];

test('15 / 30 minute rule', () => {
  assert.equal(g.classify(-5), 'Present');
  assert.equal(g.classify(0), 'Present');
  assert.equal(g.classify(15.9), 'Present'); // 9:15:54 is still minute 15
  assert.equal(g.classify(16), 'Tardy');
  assert.equal(g.classify(30.5), 'Tardy');
  assert.equal(g.classify(31), 'Absent');
  assert.equal(g.classify(200), 'Absent');
});

test('time parsing', () => {
  assert.equal(g.hmToMin('9:00 AM'), 540);
  assert.equal(g.hmToMin('1:30 PM'), 810);
  assert.equal(g.hmToMin('12:10 AM'), 10);
  assert.equal(g.hmToMin('18:02:30'), 18 * 60 + 2.5);
  assert.equal(g.hmToMin('10/06/2026 06:31:00 PM'), 18 * 60 + 31);
  assert.equal(g.minToLabel(810), '1:30 PM');
  assert.equal(g.longDate('2026-10-05'), 'Monday, October 5, 2026');
  assert.deepEqual(plain(g.weekBounds('2026-10-09')), { start: '2026-10-05', end: '2026-10-11' });
  assert.equal(g.termWeek('2026-10-08', '2026-09-28'), 2);
});

test('3 tardies = 1 absence, max 2, each absence 10%', () => {
  const rec = (st, d) => ({ classId: 'C1', studentId: 'x', date: d, status: st });
  let t = g.tally([rec('Tardy'), rec('Tardy')])['C1|x'];
  assert.equal(t.effective, 0); assert.equal(t.remaining, 2); assert.equal(t.state, 'ok'); assert.equal(t.pct, 100);
  t = g.tally([rec('Tardy'), rec('Tardy'), rec('Tardy')])['C1|x'];
  assert.equal(t.effective, 1); assert.equal(t.remaining, 1); assert.equal(t.state, 'warning'); assert.equal(t.pct, 90);
  t = g.tally([rec('Absent'), rec('Absent')])['C1|x'];
  assert.equal(t.state, 'at-limit'); assert.equal(t.pct, 80);
  t = g.tally([rec('Absent'), rec('Absent'), rec('Tardy'), rec('Tardy'), rec('Tardy')])['C1|x'];
  assert.equal(t.effective, 3); assert.equal(t.state, 'failing'); assert.equal(t.pct, 70);
  // An accepted medical excuse does not count.
  t = g.tally([rec('Absent'), { ...rec('Absent'), excuse: 'Accepted' }])['C1|x'];
  assert.equal(t.absences, 1); assert.equal(t.excused, 1);
});

test('status words from Populi', () => {
  assert.equal(g.normalizeStatus('P'), 'Present');
  assert.equal(g.normalizeStatus('late'), 'Tardy');
  assert.equal(g.normalizeStatus('ABSENT'), 'Absent');
  assert.equal(g.normalizeStatus('Excused'), 'Excused');
  assert.equal(g.normalizeStatus('??'), '');
});

test('matching Zoom / Populi names to the roster', () => {
  assert.equal(g.matchStudent({ name: 'ana maria lopez' }, roster).id, '1001');
  assert.equal(g.matchStudent({ name: 'Ana Lopez' }, roster).id, '1001');
  assert.equal(g.matchStudent({ name: 'iPhone (Brian Smith)' }, roster).id, '1002');
  assert.equal(g.matchStudent({ name: 'Perez, Carla' }, roster).id, '1003');
  assert.equal(g.matchStudent({ name: 'Dave', email: 'DAVID@ivy.edu' }, roster).id, '1004');
  assert.equal(g.matchStudent({ name: 'Someone Else' }, roster), null);
  assert.equal(g.matchStudent({ id: '1003', name: 'whatever' }, roster).id, '1003');
});

const zoomCsv = [
  'Meeting ID,Topic,Start Time,End Time,User Email,Duration (Minutes),Participants',
  '"812 3456 7890",BIO 101 Evening,10/05/2026 05:55:00 PM,10/05/2026 07:00:00 PM,ta@ivy.edu,65,6',
  '',
  'Name (Original Name),User Email,Join Time,Leave Time,Duration (Minutes),Guest',
  'Diego Gomez (TA),dgomez230@ivy.edu,10/05/2026 05:55:00 PM,10/05/2026 07:00:00 PM,65,No',
  'Ana Maria Lopez,,10/05/2026 06:10:00 PM,10/05/2026 06:40:00 PM,30,Yes',
  'Ana Maria Lopez,,10/05/2026 06:42:00 PM,10/05/2026 07:00:00 PM,18,Yes',
  'iPhone (Brian Smith),,10/05/2026 06:20:00 PM,10/05/2026 07:00:00 PM,40,Yes',
  'Carla Perez,,10/05/2026 06:01:00 PM,10/05/2026 06:35:00 PM,34,Yes',
  'Mystery Person,,10/05/2026 06:05:00 PM,10/05/2026 07:00:00 PM,55,Yes'
].join('\n');

test('Zoom report → Present / Tardy / left early / not seen', () => {
  const rows = g.parseCSV(zoomCsv);
  assert.equal(g.detectKind(rows), 'zoom');
  const z = g.parseZoom(rows);
  assert.equal(z.topic, 'BIO 101 Evening');
  assert.equal(z.meetingId, '81234567890');
  assert.equal(z.date, '2026-10-05');
  const r = g.zoomStatuses(z, roster, cls, {});
  const by = Object.fromEntries(r.results.map(x => [x.student.id, x]));
  assert.equal(by['1001'].status, 'Present');          // rejoined after a drop: first join counts, stayed to the end
  assert.equal(by['1002'].status, 'Tardy');
  assert.equal(by['1002'].minutesLate, 20);
  assert.equal(by['1003'].status, 'Absent');           // left at 6:35
  assert.equal(by['1003'].leftEarly, true);
  assert.deepEqual(plain(r.notSeen.map(s => s.id)), ['1004']);
  assert.deepEqual(plain(r.unmatched), ['Diego Gomez (TA)', 'Mystery Person']);
});

test('host ending the meeting a few minutes early is not "left early"', () => {
  const z = g.parseZoom(g.parseCSV([
    'Name (Original Name),User Email,Join Time,Leave Time',
    'Ana Maria Lopez,,10/05/2026 06:00:00 PM,10/05/2026 06:50:00 PM',
    'Brian Smith,,10/05/2026 06:00:00 PM,10/05/2026 06:50:00 PM'
  ].join('\n')));
  const r = g.zoomStatuses(z, roster, cls, {});
  assert.ok(r.results.every(x => x.status === 'Present'));
});

test('Populi export, long shape with check-in times', () => {
  const rows = g.parseCSV([
    'Student ID,Last Name,First Name,Email,Date,Status,Check-in Time',
    '1001,Lopez,Ana Maria,ana@ivy.edu,10/5/2026,Present,9:05 AM',
    '1002,Smith,Brian,brian@ivy.edu,10/5/2026,Present,9:22 AM',
    '1003,Pérez,Carla,carla@ivy.edu,10/5/2026,Absent,'
  ].join('\n'));
  assert.equal(g.detectKind(rows), 'populi');
  const p = g.parsePopuli(rows, 2026);
  assert.equal(p.shape, 'long');
  assert.equal(p.records.length, 3);
  assert.deepEqual(plain(p.records[1]), { name: 'Brian Smith', id: '1002', email: 'brian@ivy.edu', date: '2026-10-05', status: 'Present', time: 562 });
});

test('Populi export, wide shape (one column per class date)', () => {
  const rows = g.parseCSV([
    'Student attendance – BIO 101-01',
    'Student,Student ID,9/28/2026,10/5/2026',
    '"Lopez, Ana Maria",1001,P,T',
    '"Smith, Brian",1002,A,'
  ].join('\n'));
  const p = g.parsePopuli(rows, 2026);
  assert.equal(p.shape, 'wide');
  assert.match(p.course, /BIO 101-01/); // the title line is not taken as the header
  assert.deepEqual(plain(p.records.map(r => [r.id, r.date, r.status])),
    [['1001', '2026-09-28', 'Present'], ['1001', '2026-10-05', 'Tardy'], ['1002', '2026-09-28', 'Absent']]);
});

test('which class a file belongs to', () => {
  const classes = [{ id: 'C1', course: 'ENG 111', section: '' }, { id: 'C3', course: 'BIO 101', section: '', zoomId: '812 3456 7890' }];
  const rbc = { C1: [{ id: '9', name: 'Zed Zero' }], C3: roster };
  assert.equal(g.pickClass({ fileName: 'export [c1].csv' }, classes, rbc, []).cls.id, 'C1');
  assert.equal(g.pickClass({ fileName: 'x.csv', meetingId: '81234567890' }, classes, rbc, []).cls.id, 'C3');
  assert.equal(g.pickClass({ fileName: 'x.csv', course: 'ENG 111 - Attendance' }, classes, rbc, []).cls.id, 'C1');
  assert.equal(g.pickClass({ fileName: 'x.csv' }, classes, rbc, [{ name: 'Brian Smith' }, { name: 'Ana Lopez' }]).cls.id, 'C3');
  assert.equal(g.pickClass({ fileName: 'x.csv' }, classes, rbc, [{ name: 'Nobody' }]).cls, null);
});

test('assignment reminders fire once per reminder day', () => {
  const a = { classId: 'C1', title: 'Essay', due: '2026-10-10', remindDays: '3,1', reminded: '' };
  assert.equal(g.dueReminders([a], '2026-10-06').length, 0);
  const d = g.dueReminders([a], '2026-10-07');
  assert.equal(d.length, 1); assert.equal(d[0].reminderKey, 3);
  assert.equal(g.dueReminders([{ ...a, reminded: '3' }], '2026-10-08').length, 0);
  assert.equal(g.dueReminders([{ ...a, reminded: '3' }], '2026-10-09')[0].reminderKey, 1);
  assert.equal(g.dueReminders([{ ...a, reminded: '3,1' }], '2026-10-10').length, 0);
  assert.equal(g.dueReminders([a], '2026-10-11').length, 0); // past due
});

test('student notice says class, time, absences, remaining and the medical excuse rules', () => {
  const t = g.tally([{ classId: 'C3', studentId: '1001', status: 'Absent' }])['C3|1001'];
  const m = g.buildStudentNotice({ kind: 'Absent', student: roster[0], cls, date: '2026-10-05', tally: t,
    cfg: { taName: 'Diego Gomez', replyTo: 'dgomez230@ivy.edu' } });
  assert.match(m.subject, /BIO 101 \(01\).*Absence on Monday, October 5, 2026/);
  for (const s of ['marked ABSENT', '6:00 PM – 7:00 PM', 'Current absences: 1 of 2', 'Absences remaining: 1', '90%',
    'at least 80%', 'Do not send it to your professor', 'phone number for the doctor or hospital', 'guardian or companion',
    'within one week', 'leave before class ends', 'dgomez230@ivy.edu']) {
    assert.ok(m.text.includes(s), 'missing: ' + s);
  }
  const tt = g.tally([1, 2, 3, 4].map(() => ({ classId: 'C3', studentId: '1002', status: 'Tardy' })))['C3|1002'];
  const m2 = g.buildStudentNotice({ kind: 'Tardy', student: roster[1], cls, date: '2026-10-05', tally: tt, cfg: {}, minutesLate: 20 });
  assert.ok(m2.text.includes('marked TARDY'));
  assert.ok(m2.text.includes('arrived 20 minutes'));
  assert.ok(m2.text.includes('Current absences: 1 of 2 allowed (0 absences + 1 from tardies)'));
  assert.ok(m2.text.includes('Tardies: 4'));
  assert.ok(!/<script/i.test(m2.html));
});

test('weekly report lists this week\'s absences and who is losing the course', () => {
  const recs = [
    { classId: 'C3', studentId: '1001', date: '2026-09-28', status: 'Absent' },
    { classId: 'C3', studentId: '1001', date: '2026-10-05', status: 'Absent' },
    { classId: 'C3', studentId: '1001', date: '2026-10-05', status: 'Absent' },
    { classId: 'C3', studentId: '1002', date: '2026-10-05', status: 'Tardy' },
    { classId: 'C3', studentId: '1003', date: '2026-10-05', status: 'Absent', excuse: 'Received', excuseDate: '2026-09-25' }
  ];
  const r = g.buildWeeklyReport({ classes: [cls], students: roster, records: recs, weekStart: '2026-10-05', weekEnd: '2026-10-11', today: '2026-10-09', cfg: {} });
  assert.match(r.text, /Ana Maria Lopez — 2026-10-05 — Absent/);
  assert.match(r.text, /Ana Maria Lopez — 3 counted absences .* Below 80%/);
  assert.match(r.text, /Carla Pérez — class of 2026-10-05, received 2026-09-25 \(OVERDUE\)/);
  assert.ok(!r.text.includes('Ana Maria Lopez — 2026-09-28'));
  assert.match(r.subject, /3 absences, 1 losing the course/);
});

test('screenshot folders and OCR text of the Zoom participant list', () => {
  assert.equal(g.screenshotPhase('1. Present'), 'present');
  assert.equal(g.screenshotPhase('2. Tardy'), 'tardy');
  assert.equal(g.screenshotPhase('3. Absent'), 'end');
  assert.equal(g.screenshotPhase('Attendance'), '');
  assert.equal(g.dateFromName_('1. HA 105 - Week 01 - 10.05.26'), '2026-10-05');
  assert.equal(g.dateFromName_('HA 105 10-12-2026'), '2026-10-12');
  const shot = names => ['Participants (' + names.length + ')', 'Find a participant', ...names, 'Invite  Mute All  More'].join('\n');
  const r = g.screenshotStatuses({
    present: [shot(['Diego Gomez (Host, me)', 'Ana Maria Lopez', 'Carla Perez (Guest)']), shot(['David Kim'])],
    tardy: [shot(['Ana Maria Lopez', 'Carla Perez', 'Brian Smith', 'Mystery Guy'])],
    end: [shot(['Ana Maria Lopez', 'Brian Smith', 'Carla Perez'])]
  }, roster, ['Diego Gomez']);
  const by = Object.fromEntries(r.results.map(x => [x.student.id, x.status + (x.leftEarly ? ' (left)' : '')]));
  assert.deepEqual(plain(by), { 1001: 'Present', 1002: 'Tardy', 1003: 'Present', 1004: 'Absent (left)' });
  assert.deepEqual(plain(r.review.map(q => [q.name, q.seenIn, q.candidates.length])), [['Mystery Guy', ['tardy'], 0]]);
  // no "end" screenshots → nobody is marked as leaving early
  const r2 = g.screenshotStatuses({ present: [shot(['David Kim'])] }, roster, []);
  assert.equal(r2.results[0].status, 'Present');
  assert.equal(r2.notSeen.length, 3);
});

test('Diego\'s online rules: 15 min, 31 min and the 1-hour screenshot', () => {
  const r6 = [
    { id: 'a', name: 'Ana Uno' }, { id: 'b', name: 'Beto Dos' }, { id: 'c', name: 'Caro Tres' },
    { id: 'd', name: 'Dani Cuatro' }, { id: 'e', name: 'Eva Cinco' }, { id: 'f', name: 'Fede Seis' }, { id: 'g', name: 'Gabi Siete' }
  ];
  const r = g.screenshotStatuses({
    present: ['Ana Uno\nBeto Dos\nCaro Tres\nGabi Siete'],
    tardy: ['Ana Uno\nCaro Tres\nDani Cuatro'],          // Beto's connection dropped at 6:31
    end: ['Ana Uno\nBeto Dos\nDani Cuatro\nEva Cinco']    // Caro and Gabi gone; Eva joined late
  }, r6, []);
  const by = Object.fromEntries(r.results.map(x => [x.student.id, [x.status, x.note]]));
  assert.deepEqual(plain(by.a), ['Present', '']);
  assert.deepEqual(plain(by.b), ['Present', 'Not in the 31 minute screenshot; confirmed in the last one']);
  assert.equal(by.c[0], 'Absent'); assert.match(by.c[1], /In the 15 and 31 minute screenshots, not in the last/);
  assert.deepEqual(plain(by.d), ['Tardy', '']);
  assert.deepEqual(plain(by.e), ['Absent', 'Joined after minute 30 (only in the last screenshot)']);
  assert.equal(by.g[0], 'Absent'); assert.match(by.g[1], /Only in the 15 minute screenshot/);
  assert.deepEqual(plain(r.notSeen.map(s => s.id)), ['f']);
});

test('names as Zoom shows them (partial, joined, first name only)', () => {
  const ro = [
    { id: '1', name: 'Lina Mora Bastidas' }, { id: '2', name: 'Suda Kaew-ngam' }, { id: '3', name: 'Lara Ivanova' },
    { id: '4', name: 'Omar Ali Khan' }, { id: '5', name: 'Omar Saad Khan' }, { id: '6', name: 'Mina Aksoy' }
  ];
  assert.equal(g.matchStudent({ name: 'Lina Mora' }, ro).id, '1');
  assert.equal(g.matchStudent({ name: 'Suda Kaewngam' }, ro).id, '2');
  assert.equal(g.matchStudent({ name: 'Lara' }, ro).id, '3');
  assert.equal(g.matchStudent({ name: 'Mina Deniz Aksoy' }, ro).id, '6');
  assert.equal(g.matchStudent({ name: 'Omar Khan' }, ro), null);   // two of them: never guess
  assert.equal(g.matchStudent({ name: 'Omar' }, ro), null);
  const r = g.screenshotStatuses({ present: ['Lara\nProfessor Smith\nLulu'] }, ro, []);
  assert.deepEqual(plain(r.results.map(x => x.student.id)), ['3']);
  assert.deepEqual(plain(r.review.map(q => q.name)), ['Lulu']);
});

test('Populi roster export: real column layout, professors and the TA skipped, Populi order kept', () => {
  const rows = g.parseCSV([
    '"Student ID","Populi Name","Academic Term","Course Abbrv","Course Name","Course Section",Email,Street,City,State,ZIP,Country,Phone,Type,"Receives Mail"',
    ',"Pat Teacher","2026-2027: 2026 Fall Quarter","HA 105","Introduction to Ethics",1,pteacher@ivy.edu,,,,,,,faculty,Yes',
    '2020000001,"Tom Assistant","2026-2027: 2026 Fall Quarter","HA 105","Introduction to Ethics",1,ta@ivy.edu,"1 Main St",X,MD,1,US,,faculty,Yes',
    '2026000002,"Zoe Zeta","2026-2027: 2026 Fall Quarter","HA 105","Introduction to Ethics",1,zz26@ivy.edu,"2 Long Rd',
    'Apt 5",Arlington,VA,22204,US,"(000) 000-0000",student,Yes',
    '2026000003,"Al Alpha","2026-2027: 2026 Fall Quarter","HA 105","Introduction to Ethics",1,aa26@ivy.edu,,,,,,,student,Yes'
  ].join('\n'));
  assert.equal(g.parsePopuli(rows, 2026).records.length, 0);
  assert.equal(g.parsePopuli(rows, 2026).course, 'HA 105');
  assert.deepEqual(plain(g.parseRoster(rows).map(s => [s.id, s.name, s.email])),
    [['2026000002', 'Zoe Zeta', 'zz26@ivy.edu'], ['2026000003', 'Al Alpha', 'aa26@ivy.edu']]);
});

test('similar names: second names, Z/S, typos, written together; two possible students → a question', () => {
  const ro = [
    { id: '1', name: 'Angie Naomy Ferreira Beltran', order: 1 }, { id: '2', name: 'Ikhtiyar Gurbanov', order: 2 },
    { id: '3', name: 'Valentina Cisneros Cruces', order: 3 }, { id: '4', name: 'Diego Marquez Alvarado', order: 4 },
    { id: '5', name: 'Muhammed Sharjeel Arshad', order: 5 }, { id: '6', name: 'Malek Abu', order: 6 }, { id: '7', name: 'Malek Bay', order: 7 },
    { id: '8', name: 'Jessica Da Silva', order: 8 }
  ];
  const who = n => { const r = g.resolveName(n, ro); return r ? (r.student ? r.student.id : 'doubt:' + r.doubt.map(s => s.id).join(',')) : null; };
  assert.equal(who('Naomi Ferreira'), '1');          // second name + i/y
  assert.equal(who('Ixtiyar Qurbanov'), '2');        // typo in both words
  assert.equal(who('Valentina Sisneros'), '3');      // S instead of C
  assert.equal(who('Diego Marques'), '4');           // S instead of Z
  assert.equal(who('muhammadsharjeelarshad'), '5');  // all together, a instead of e
  assert.equal(who('Jesica Da Silba'), '8');
  assert.equal(who('Malek'), 'doubt:6,7');           // two Maleks → ask Diego
  assert.equal(who('Naomy'), 'doubt:1');             // one word only → ask
  assert.equal(who('Lulu'), null);
  assert.equal(who('Mute'), null);
});

test('chat: the message time decides, from the real start of class', () => {
  const ro = [{ id: 'a', name: 'Ana Uno' }, { id: 'b', name: 'Beto Dos' }, { id: 'c', name: 'Caro Tres' }, { id: 'd', name: 'Dani Cuatro' }];
  const chat = ['Everyone', 'Ana 7:05 PM', 'Ana Uno', 'Beto 7:20 PM', 'Beto Dos', 'Caro 7:40 PM', 'Caro Tres', 'Type message here...'].join('\n');
  const tiles = n => n.join('\n');
  // Class scheduled at 6:00 PM but the professor started at 7:00 PM
  const r = g.screenshotStatuses({ present: [chat], end: [tiles(['Ana Uno', 'Beto Dos', 'Caro Tres'])] }, ro, [], { start: 19 * 60 });
  const by = Object.fromEntries(r.results.map(x => [x.student.id, [x.status, x.note]]));
  assert.deepEqual(plain(by.a), ['Present', 'Name in chat (chat 7:05 PM)']);
  assert.deepEqual(plain(by.b), ['Tardy', 'Name in chat (chat 7:20 PM)']);
  assert.equal(by.c[0], 'Absent'); assert.match(by.c[1], /Joined after minute 30 \(chat 7:40 PM\)/);
  assert.deepEqual(plain(r.notSeen.map(s => s.id)), ['d']);
  // The chat stays on screen: it never proves someone is still there at the end
  const r2 = g.screenshotStatuses({ present: [chat], end: [chat] }, ro, [], { start: 19 * 60 });
  assert.ok(r2.results.filter(x => x.student.id !== 'c').every(x => x.status === 'Absent' && x.leftEarly));
  // "Malek" is not asked when every Malek was recognized anyway
  const ro2 = [{ id: 'm1', name: 'Malek Abu' }, { id: 'm2', name: 'Malek Bay' }];
  assert.equal(g.screenshotStatuses({ present: ['Malek Abu\nMalek Bay\nMalek'] }, ro2, []).review.length, 0);
  assert.equal(g.screenshotStatuses({ present: ['Malek Abu\nMalek'] }, ro2, []).review.length, 1);
});

test('dist/TA-Attendance.gs is up to date with src/ (run `npm run bundle`)', () => {
  const fs = require('fs'), path = require('path');
  const { bundle } = require('../tools/bundle');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'dist', 'TA-Attendance.gs'), 'utf8'), bundle());
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'dist', 'Dashboard.html'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src', 'Dashboard.html'), 'utf8'));
});

test('dashboard script has no syntax errors and only calls server functions that exist', () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Dashboard.html'), 'utf8');
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  new Function(js); // throws on a syntax error
  const called = [...js.matchAll(/call\('(\w+)'/g)].map(m => m[1]);
  assert.ok(called.length >= 7);
  called.forEach(fn => assert.equal(typeof g[fn], 'function', fn + ' is not defined in Code.js'));
  called.forEach(fn => assert.ok(!fn.endsWith('_'), fn + ': private functions cannot be called from the page'));
});
