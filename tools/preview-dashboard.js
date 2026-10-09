// Renders src/Dashboard.html with made-up data (from the simulated Apps Script) and saves screenshots.
// Run: node tools/preview-dashboard.js <out-dir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { makeEnv } = require('../tests/gas-mock');

const out = process.argv[2] || 'preview';
fs.mkdirSync(out, { recursive: true });

// A made-up class of 18 with a week of Zoom screenshots
const env = makeEnv({ now: '2026-10-05T14:00:00Z' });
const g = env.gas;
g.setup();
const cfg = env.sheet('Config');
cfg.put(cfg.data.findIndex(r => r[0] === 'Office email') + 1, 2, 'office@ivy.edu');
const inbox = env.rootFolders.find(f => f.name === 'TA Inbox');
const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Farid', 'Gina', 'Hugo', 'Irene', 'Jamal', 'Karla', 'Luis', 'Mara', 'Nico', 'Olga', 'Pablo', 'Malek', 'Malek'];
const last = ['Alba', 'Brito', 'Cano', 'Duarte', 'Esposito', 'Faris', 'Gil', 'Hoyos', 'Ibarra', 'Jaber', 'Kemal', 'Lara', 'Mora', 'Navas', 'Orlova', 'Paz', 'Abu', 'Bay'];
const names = first.map((f, i) => f + ' ' + last[i]).sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1]));
inbox.addFile('HA 105 roster.csv', ['Student ID,Populi Name,Course Abbrv,Email,Type', ...names.map((n, i) => (100 + i) + ',' + n + ',HA 105,s' + i + '@ivy.edu,student')].join('\n'));
inbox.addFile('HA 103 roster.csv', ['Student ID,Populi Name,Course Abbrv,Email,Type', ...names.slice(0, 12).map((n, i) => (200 + i) + ',' + n + ',HA 103,t' + i + '@ivy.edu,student')].join('\n'));
g.tick();
const w = inbox.createFolder('1. HA 105 - Week 01 - 10.05.26 - start 6:30pm');
const present = names.slice(0, 11).map(n => n.replace('Carla Cano', 'Karla Kano iPhone')).concat(['Malek', 'Professor Smith', 'Everyone', '6:44 PM']);
w.createFolder('1. Present').addImage('p1.png', present.join('\n') + '\nAna 6:33 PM\nAna Alba\nJamal 6:50 PM\nJamal Jaber');
w.createFolder('2. Tardy').addImage('t1.png', names.slice(0, 13).join('\n'));
w.createFolder('3. Absent').addImage('e1.png', names.slice(0, 13).filter((n, i) => i !== 4).join('\n'));
env.setNow('2026-10-06T03:00:00Z');
g.tick();
env.sheet('Attendance').appendRow(['2026-10-05', 'C1', '200', names[0], 'Absent', '', 'Populi']);
env.sheet('Attendance').appendRow(['2026-10-05', 'C1', '201', names[1], 'Absent', '', 'Populi']);
// Two more weeks of HA 103 so some students are below 80% (in the preview only)
['2026-10-12', '2026-10-19'].forEach((d, w) => names.slice(0, 12).forEach((n, i) => {
  const st = i === 0 ? 'Absent' : (i === 3 && w === 1) ? 'Absent' : (i === 5 || i === 6) && w === 0 ? 'Tardy' : 'Present';
  env.sheet('Attendance').appendRow([d, 'C1', String(200 + i), n, st, '', 'Populi', '', '', '', '', st === 'Present' ? '' : st + ' · ' + d + ' 14:00 · POPULI']);
}));
g.tick(); // HA 103 has no open questions → its follow-up is ready

// Student emails, read by "Claude" (canned answers here)
env.props.ANTHROPIC_API_KEY = 'sk-ant-preview';
env.ai.reply = body => {
  const t = body.messages[0].content[0].text, excuse = /doctor/.test(t);
  return { category: excuse ? 'medical_excuse' : 'absence_notice', needs_reply: true, urgency: 'normal',
    summary: excuse ? 'Sends a doctor note for Monday\'s class.' : 'Will miss next Monday because of work.',
    excuse: { is_excuse: excuse, class_date: excuse ? '2026-10-05' : '', has_doctor_phone: false, for_someone_else: false, missing: excuse ? ['doctor or hospital phone number'] : [] },
    reply: excuse ? 'Hi Ana,\n\nThank you for sending your doctor\'s note. I received it and passed it to the main office, which verifies it within one week.\n\nCould you send me the phone number of the clinic? The office needs it to verify the note.\n\nBest regards,\nDiego Gomez\nTeacher Assistant\ndgomez230@ivy.edu'
      : 'Hi Bruno,\n\nThank you for letting me know. You have 0 of 2 absences so far, so you still have 2 left. Remember you need at least 80% attendance to pass.\n\nBest regards,\nDiego Gomez' };
};
const s0 = names.indexOf('Ana Alba'), s1 = names.indexOf('Bruno Brito');
env.mail.receive({ from: 'Ana Alba <s' + s0 + '@ivy.edu>', subject: 'Doctor note for Monday', body: 'Hello, I was at the doctor on Monday. Attached is the note.', attachments: ['note.pdf'], at: '2026-10-05T01:00:00Z' });
env.mail.receive({ from: 'Bruno <s' + s1 + '@ivy.edu>', subject: 'Next class', body: 'I will not be able to come next Monday because of work.', at: '2026-10-06T00:30:00Z' });
g.tick();

const api = {};
api.apiAll = JSON.parse(JSON.stringify(g.apiAll()));
['apiOverview', 'apiQuestions', 'apiFollowups', 'apiMail'].forEach(f => { api[f] = JSON.parse(JSON.stringify(g[f]())); });
api.apiClass = { C3: JSON.parse(JSON.stringify(g.apiClass('C3'))), C1: JSON.parse(JSON.stringify(g.apiClass('C1'))) };
api.apiSession = JSON.parse(JSON.stringify(g.apiSession('C3', '2026-10-05')));
api.apiReportWeeks = JSON.parse(JSON.stringify(g.apiReportWeeks()));
api.apiStudent = JSON.parse(JSON.stringify(g.apiStudent('C3', '104')));
api.apiSetRecord = { status: 'Absent', left: true, noId: false, excuse: 'Received', notes: '', effective: 1, remaining: 1, pct: 90, stateLabel: '1 absence left', state: 'warning' };
// What is due next Monday (like Diego's assignment lists in TA Inbox)
[['C1', 'LRQ #2', '2026-10-12 23:59', 'Lecture Reading Quizzes', 'Oct 12 9:00am-11:59pm only'], ['C1', 'MV #2', '2026-10-12 23:59', 'Memory Verses', ''],
  ['C2', 'LRQ #2', '2026-10-12 23:59', 'Lecture Reading Quizzes', 'Oct 12 4:00pm-11:59pm only'], ['C2', 'TRQ #2', '2026-10-12 23:59', 'Textbook Reading Questions', '']]
  .forEach(a => env.sheet('Assignments').appendRow([a[0], a[1], a[2], 'none', '', '', a[3], a[4]]));
api.apiWeeklyReport = JSON.parse(JSON.stringify(g.apiWeeklyReport(1)));
api.apiStanding = JSON.parse(JSON.stringify(g.apiStanding()));
api.apiStandingSent = api.apiStanding;

const stub = `window.__API = ${JSON.stringify(api)};
window.google = { script: { run: (function make(ok, fail) {
  const r = { withSuccessHandler: f => make(f, fail), withFailureHandler: f => make(ok, f) };
  ['apiOverview','apiQuestions','apiFollowups','apiClass','apiSession','apiProcessNow','apiAnswer','apiSetStart','apiFollowupDone','apiReportWeeks','apiWeeklyReport','apiSendWeeklyReport','apiSaveWeeklyReportPdf','apiStudent','apiSetRecord','apiBulkStatus','apiFinishSession','apiPopuliDone','apiUploadShot','apiAnalyzeSession','apiClearShots','apiAll','apiMail','apiMailStatus','apiMailToGmail','apiMailForwardExcuse','apiCheckMail','apiMailRedraft','apiStanding','apiStandingSent','apiShotFiles','apiAiReadFile','apiPrepareShots','apiClaudeResults','apiImportRoster','apiAddStudent','apiRemoveStudent','apiSetStudentNames'].forEach(n => {
    r[n] = (...a) => setTimeout(() => { let v = window.__API[n]; if (n === 'apiClass') v = v[a[0]] || v.C3; if (n === 'apiProcessNow') v = { files: 0, sent: 0 };
      if (n === 'apiAnswer') v = { note: 'Linked to #12 Malek Bay' };
      if (n === 'apiMailRedraft') v = { draft: 'Hi Ana,\\n\\nGot it, thanks! I sent it to the office.\\n\\nDiego' };
      if (n === 'apiMailForwardExcuse') v = { to: 'office@ivy.edu' };
      if (n === 'apiCheckMail') v = { changed: 0 };
      if (n === 'apiUploadShot') v = { names: 9, phase: a[2], fileId: 'f' + Math.random() };
      if (n === 'apiPrepareShots') v = { subs: { present: 'p', tardy: 't', end: 'e', populi: 'q' } };
      if (n === 'apiClaudeResults') v = { lines: [] };
      if (n === 'apiAnalyzeSession') v = { msg: '10 present, 2 tardy, 6 absent. 1 name to confirm' }; ok(v === undefined ? true : v); }, 50);
  });
  return r; })() } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 1400), height: 860 } });
  // The fake google.script.run goes in before the page's own script.
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Dashboard.html'), 'utf8')
    .replace('<script>', '<script>' + stub + '</script>\n<script>');
  fs.writeFileSync(path.join(out, 'dashboard.html'), html); // the page itself, with made-up data, to open in a browser
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.stack); });
  await page.route('**/fonts.googleapis.com/**', r => r.abort()); // no network here; the system font is the fallback
  await page.setContent(html, { waitUntil: 'load' });
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, name + '.png') }); };
  await shot('1-home');
  await page.click('.cls[data-class="C3"]'); await shot('2-class');
  await page.click('.wt.ok'); await shot('3-session');
  await page.click('[data-act="ocrTab"][data-p="end"]'); await shot('4-session-last-screenshot');
  // drop 4 screenshots in "15 min": folder prepared once, uploaded 4 at a time, then one analysis
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.evaluate(() => { const orig = window.google.script.run; window.__calls = [];
    window.google.script.run = new Proxy(orig, { get: (t, k) => k === 'withSuccessHandler' ? (f) => { const r = orig.withSuccessHandler(f);
      return new Proxy(r, { get: (t2, k2) => k2 === 'withFailureHandler' ? (g) => { const r2 = r.withFailureHandler(g);
        return new Proxy(r2, { get: (t3, k3) => (...a) => { window.__calls.push(k3); return r2[k3](...a); } }); } : t2[k2] }); } : t[k] }); });
  await page.setInputFiles('#shotInput', [1, 2, 3, 4].map(n => ({ name: 's' + n + '.png', mimeType: 'image/png', buffer: png })));
  await page.waitForTimeout(4000);
  const calls = await page.evaluate(() => window.__calls);
  if (calls.filter(c => c === 'apiUploadShot').length !== 4 || !calls.includes('apiAnalyzeSession')) { console.error('upload calls', calls); process.exit(1); }
  await page.click('[data-go="class"][data-class="C3"]'); await page.waitForTimeout(300); await page.click('.wt.ok'); await page.waitForTimeout(400);
  await page.locator('.more').first().click(); await shot('3b-session-menu');
  await page.click('[data-act="rec"][data-change*="excuse"]'); await shot('3c-session-after-edit');
  await page.click('.name-link'); await shot('3d-student');
  await page.click('[data-go="review"]'); await shot('5-questions');
  await page.click('[data-go="followups"]'); await shot('6-followups');
  await page.click('[data-go="reports"]'); await shot('7-weekly-report');
  await page.click('[data-go="mail"]'); await shot('8-student-emails');
  await page.click('[data-act="mailRewrite"][data-i="0"]'); await shot('8b-email-rewritten');
  // Below 100% / 80%
  await page.click('[data-go="standing"]'); await shot('9-standing');
  // Take attendance: Mac screenshots of the Monday evening class, dropped at once (made-up file times)
  await page.click('[data-go="take"]'); await shot('10-take-empty');
  const mac = (t, d) => ({ name: 'Screenshot 2026-10-05 at ' + t + '.png', mimeType: 'image/png', buffer: png });
  await page.setInputFiles('#takeInput', [mac('6.45.02 PM'), mac('6.45.40 PM'), mac('7.01.10 PM'), mac('7.01.44 PM'), mac('7.31.01 PM')]);
  await shot('11-take-sorted');
  // Class page → Update roster (Populi CSV / paste / one student by hand)
  await page.click('[data-go="class"][data-class="C3"]'); await page.waitForTimeout(300); await page.click('[data-act="rosterToggle"]'); await shot('12-roster');
  await browser.close();
  if (errors.length) { console.error('Page errors:', errors); process.exit(1); }
  console.log('Screenshots in', out);
})();
