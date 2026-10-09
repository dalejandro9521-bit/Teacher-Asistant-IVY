// Attendance logic end to end, on the pure functions: screenshot names → students, attendance %,
// and who needs a follow-up (under 100%) or is losing the course (under 80%). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv } = require('./gas-mock');

const g = makeEnv().gas;
const plain = x => JSON.parse(JSON.stringify(x));

const roster = [
  { id: '1', name: 'Ana María López', email: 'ana@ivy.edu', order: 1 },
  { id: '2', name: 'Brian Smith', email: 'brian@ivy.edu', order: 2, aliases: ['B-Man iPhone'] },
  { id: '3', name: 'José Ramírez Ortiz', email: 'jose@ivy.edu', order: 3 },
  { id: '4', name: 'Kateryna Zelenska', email: 'kat@ivy.edu', order: 4 },
  { id: '5', name: 'Omar Ali Khan', email: 'omar1@ivy.edu', order: 5 },
  { id: '6', name: 'Omar Saad Khan', email: 'omar2@ivy.edu', order: 6 }
];
const who = n => { const r = g.resolveName(n, roster); return r ? (r.student ? r.student.id : 'doubt:' + r.doubt.map(s => s.id).join(',')) : null; };

/* ---------- screenshot names → roster students ---------- */

test('matching: accents, case, punctuation and "Last, First" are ignored', () => {
  assert.equal(g.matchStudent({ name: 'ana maria lopez' }, roster).id, '1');
  assert.equal(g.matchStudent({ name: 'LÓPEZ, Ana María' }, roster).id, '1');
  assert.equal(g.matchStudent({ name: 'Jose Ramirez-Ortiz' }, roster).id, '3');
  assert.equal(g.matchStudent({ name: '  Brian   Smith ' }, roster).id, '2');
});

test('matching: ID and email win over the name; Zoom "Display (Original)" tries both', () => {
  assert.equal(g.matchStudent({ id: '4', name: 'Somebody Else' }, roster).id, '4');
  assert.equal(g.matchStudent({ email: 'JOSE@ivy.edu' }, roster).id, '3');
  assert.equal(g.matchStudent({ name: 'Kat Z (Kateryna Zelenska)' }, roster).id, '4');
});

test('matching: an alias Diego saved links an odd Zoom name to the student', () => {
  assert.equal(g.matchStudent({ name: 'b-man iphone' }, roster).id, '2');
  assert.deepEqual(plain(g.resolveName('B-Man iPhone', roster)), { student: plain(roster[1]), how: 'exact' });
});

test('matching: misspellings resolve, two possible students become a question, unknowns stay unknown', () => {
  assert.equal(who('Katerina Selenska'), '4');   // y→i, Z→S
  assert.equal(who('Jose Ramires'), '3');        // Z→S, second surname missing
  assert.equal(who('Omar Khan'), 'doubt:5,6');   // never guess between two Omars
  assert.equal(who('Zzyzx Qwerty'), null);
  assert.equal(who(''), null);
});

test('screenshots: TA and professor ignored, each student matched once, unknown names asked about', () => {
  const r = g.screenshotStatuses({
    present: ['Diego Gomez (Host, me)\nProf. Pat Teacher\nAna Maria Lopez\nKaterina Selenska\nOmar Khan'],
    end: ['Ana Maria Lopez\nKaterina Selenska\nB-Man iPhone\nRandom Visitor']
  }, roster, ['Diego Gomez', 'Pat Teacher']);
  const by = Object.fromEntries(r.results.map(x => [x.student.id, x.status]));
  assert.deepEqual(plain(by), { 1: 'Present', 2: 'Absent', 4: 'Present' }); // Brian only at the end → joined late
  assert.deepEqual(plain(r.notSeen.map(s => s.id)), ['3', '5', '6']);
  const q = Object.fromEntries(r.review.map(x => [x.name, x.candidates.map(s => s.id)]));
  assert.deepEqual(plain(q), { 'Omar Khan': ['5', '6'], 'Random Visitor': [] });
  assert.ok(!r.review.some(x => /Diego|Teacher/.test(x.name)));
});

/* ---------- attendance percentage ---------- */

const rec = (studentId, status, extra) => ({ classId: 'C3', studentId, date: '2026-10-05', status, ...extra });
const t1 = (records, id, cfg) => g.tally(records, cfg)['C3|' + id];

test('percentage: 100% with no absences; each counted absence is 10%', () => {
  assert.equal(g.emptyTally().pct, 100);
  assert.equal(t1([rec('1', 'Present')], '1').pct, 100);
  for (let n = 1; n <= 10; n++) {
    assert.equal(t1(Array.from({ length: n }, () => rec('1', 'Absent')), '1').pct, 100 - n * 10);
  }
});

test('percentage: never below 0, short status words count, unknown words are ignored', () => {
  assert.equal(t1(Array.from({ length: 12 }, () => rec('1', 'A')), '1').pct, 0);
  assert.equal(t1([rec('1', 'a'), rec('1', 'late'), rec('1', 'L'), rec('1', 't')], '1').pct, 80);
  const t = t1([rec('1', '???'), rec('1', '')], '1');
  assert.equal(t.pct, 100); assert.equal(t.absences + t.tardies + t.present + t.excused, 0);
});

test('percentage: 1-2 tardies do not lower it, the 3rd does; accepted excuses never count', () => {
  assert.equal(t1([rec('1', 'Tardy'), rec('1', 'Tardy')], '1').pct, 100);
  assert.equal(t1([rec('1', 'Tardy'), rec('1', 'Tardy'), rec('1', 'Tardy')], '1').pct, 90);
  assert.equal(t1(Array.from({ length: 5 }, () => rec('1', 'Tardy')), '1').pct, 90);
  assert.equal(t1(Array.from({ length: 6 }, () => rec('1', 'Tardy')), '1').pct, 80);
  assert.equal(t1([rec('1', 'Absent', { excuse: 'Accepted' }), rec('1', 'Tardy', { excuse: 'accepted' })], '1').pct, 100);
  assert.equal(t1([rec('1', 'Absent', { excuse: 'Received' })], '1').pct, 90);  // pending excuse still counts
  assert.equal(t1([rec('1', 'Absent', { excuse: 'Rejected' })], '1').pct, 90);
});

test('percentage: kept per class and student, and follows the course length in Config', () => {
  const all = g.tally([rec('1', 'Absent'), { ...rec('1', 'Absent'), classId: 'C4' }, rec('2', 'Absent'), rec('2', 'Absent')]);
  assert.equal(all['C3|1'].pct, 90); assert.equal(all['C4|1'].pct, 90); assert.equal(all['C3|2'].pct, 80);
  assert.equal(t1([rec('1', 'Absent')], '1', { totalSessions: 8 }).pct, 88);   // 87.5 rounds to 88
});

/* ---------- follow-up flags: under 100% and under 80% ---------- */

const under100 = t => t.pct < 100;
const under80 = t => t.pct < 80;

test('flags: state matches the % (ok = 100, warning = 90, at-limit = 80, failing = under 80)', () => {
  const states = [0, 1, 2, 3, 4].map(n => t1([rec('1', 'Present'), ...Array.from({ length: n }, () => rec('1', 'Absent'))], '1'));
  assert.deepEqual(states.map(t => [t.pct, t.state, t.remaining]),
    [[100, 'ok', 2], [90, 'warning', 1], [80, 'at-limit', 0], [70, 'failing', -1], [60, 'failing', -2]]);
  states.forEach(t => {
    assert.equal(under100(t), t.state !== 'ok', 'under 100% ⇔ not "ok"');
    assert.equal(under80(t), t.state === 'failing', 'under 80% ⇔ "failing"');
  });
  assert.equal(g.STATE_LABEL.failing, 'Below 80% (losing the course)');
});

test('flags: exactly 80% is not losing the course; one more tardy after 2 absences + 2 tardies is', () => {
  const base = [rec('1', 'Absent'), rec('1', 'Absent'), rec('1', 'Tardy'), rec('1', 'Tardy')];
  assert.equal(t1(base, '1').state, 'at-limit');
  assert.equal(under80(t1(base, '1')), false);
  const t = t1([...base, rec('1', 'Tardy')], '1');
  assert.equal(t.pct, 70); assert.equal(t.state, 'failing');
});

test('flags: a class list splits into on track, under 100% and under 80%', () => {
  const records = [
    rec('1', 'Present'), rec('1', 'Tardy'),                                   // 100%
    rec('2', 'Absent'),                                                       // 90%
    rec('3', 'Absent'), rec('3', 'Absent'),                                   // 80%
    rec('4', 'Absent'), rec('4', 'Absent'), rec('4', 'Absent'),               // 70%
    rec('5', 'Absent', { excuse: 'Accepted' })                                // 100%
  ];
  const totals = g.tally(records);
  const t = s => totals['C3|' + s.id] || g.emptyTally();
  assert.deepEqual(roster.filter(s => under100(t(s))).map(s => s.id), ['2', '3', '4']);
  assert.deepEqual(roster.filter(s => under80(t(s))).map(s => s.id), ['4']);
});

test('flags: the Friday report lists everyone under 100% and counts only those under 80% as losing the course', () => {
  const cls = { id: 'C3', course: 'HA 105', section: '1', day: 'Monday', start: 18 * 60, end: 22 * 60, mode: 'Zoom' };
  const students = roster.map(s => ({ ...s, classId: 'C3' }));
  const records = [
    rec('2', 'Absent'),
    rec('3', 'Absent'), { ...rec('3', 'Absent'), date: '2026-09-28' },
    rec('4', 'Absent'), { ...rec('4', 'Absent'), date: '2026-09-28' }, { ...rec('4', 'Absent'), date: '2026-09-21' }
  ];
  const r = g.buildWeeklyReport({ classes: [cls], students, records, weekStart: '2026-10-05', weekEnd: '2026-10-11', today: '2026-10-09', cfg: {} });
  assert.match(r.text, /Brian Smith — 1 counted absences .*90% — 1 absence left/);
  assert.match(r.text, /José Ramírez Ortiz — 2 counted absences .*80% — At the limit/);
  assert.match(r.text, /Kateryna Zelenska — 3 counted absences .*70% — Below 80%/);
  assert.ok(!/Ana María López — \d+ counted/.test(r.text));
  assert.match(r.subject, /1 losing the course/);
});

/* ---------- screenshots → percentage, the whole chain ---------- */

test('chain: screenshots → statuses → % and flags', () => {
  const week = statuses => statuses.results.map(x => ({ classId: 'C3', studentId: x.student.id, status: x.status }))
    .concat(statuses.notSeen.map(s => ({ classId: 'C3', studentId: s.id, status: 'Absent' })));
  const everyone = roster.slice(0, 4).map(s => s.name).join('\n');
  const w1 = g.screenshotStatuses({ present: [everyone], end: [everyone] }, roster.slice(0, 4), []);
  const w2 = g.screenshotStatuses({ present: ['Ana Maria Lopez\nBrian Smith'], tardy: ['Jose Ramirez'], end: ['Ana Maria Lopez\nBrian Smith\nJose Ramirez'] }, roster.slice(0, 4), []);
  const w3 = g.screenshotStatuses({ present: ['Ana Maria Lopez\nKateryna Zelenska'], end: ['Ana Maria Lopez'] }, roster.slice(0, 4), []);
  const w4 = g.screenshotStatuses({ present: ['Ana Maria Lopez'], end: ['Ana Maria Lopez'] }, roster.slice(0, 4), []);
  const totals = g.tally([...week(w1), ...week(w2), ...week(w3), ...week(w4)]);
  const pct = id => totals['C3|' + id].pct;
  // Ana always there; Brian missed w3+w4; José tardy w2, missing w3+w4; Kateryna missing w2, left early w3, missing w4.
  assert.deepEqual([pct('1'), pct('2'), pct('3'), pct('4')], [100, 80, 80, 70]);
  assert.equal(totals['C3|4'].state, 'failing');
  assert.equal(w3.results.find(x => x.student.id === '4').leftEarly, true);
});
