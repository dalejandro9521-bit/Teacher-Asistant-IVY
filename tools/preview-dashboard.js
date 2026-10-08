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
g.tick(); // HA 103 has no open questions → its follow-up is ready

const api = {};
['apiOverview', 'apiQuestions', 'apiFollowups'].forEach(f => { api[f] = JSON.parse(JSON.stringify(g[f]())); });
api.apiClass = { C3: JSON.parse(JSON.stringify(g.apiClass('C3'))), C1: JSON.parse(JSON.stringify(g.apiClass('C1'))) };
api.apiSession = JSON.parse(JSON.stringify(g.apiSession('C3', '2026-10-05')));
api.apiReportWeeks = JSON.parse(JSON.stringify(g.apiReportWeeks()));
api.apiStudent = JSON.parse(JSON.stringify(g.apiStudent('C3', '104')));
api.apiSetRecord = { status: 'Absent', left: true, noId: false, excuse: 'Received', notes: '', effective: 1, remaining: 1, pct: 90, stateLabel: '1 absence left', state: 'warning' };
api.apiWeeklyReport = JSON.parse(JSON.stringify(g.apiWeeklyReport(1)));

const stub = `window.__API = ${JSON.stringify(api)};
window.google = { script: { run: (function make(ok, fail) {
  const r = { withSuccessHandler: f => make(f, fail), withFailureHandler: f => make(ok, f) };
  ['apiOverview','apiQuestions','apiFollowups','apiClass','apiSession','apiProcessNow','apiAnswer','apiSetStart','apiFollowupDone','apiReportWeeks','apiWeeklyReport','apiSendWeeklyReport','apiSaveWeeklyReportPdf','apiStudent','apiSetRecord','apiBulkStatus','apiFinishSession','apiPopuliDone','apiUploadShot','apiAnalyzeSession','apiClearShots'].forEach(n => {
    r[n] = (...a) => setTimeout(() => { let v = window.__API[n]; if (n === 'apiClass') v = v[a[0]] || v.C3; if (n === 'apiProcessNow') v = { files: 0, sent: 0 };
      if (n === 'apiAnswer') v = { note: 'Linked to #12 Malek Bay' }; ok(v === undefined ? true : v); }, 50);
  });
  return r; })() } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 1400), height: 860 } });
  // The fake google.script.run goes in before the page's own script.
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Dashboard.html'), 'utf8')
    .replace('<script>', '<script>' + stub + '</script>\n<script>');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/fonts.googleapis.com/**', r => r.abort()); // no network here; the system font is the fallback
  await page.setContent(html, { waitUntil: 'load' });
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, name + '.png') }); };
  await shot('1-home');
  await page.click('.cls[data-class="C3"]'); await shot('2-class');
  await page.click('.wt.ok'); await shot('3-session');
  await page.click('[data-act="ocrTab"][data-p="end"]'); await shot('4-session-last-screenshot');
  await page.click('[data-go="class"][data-class="C3"]'); await page.waitForTimeout(300); await page.click('.wt.ok'); await page.waitForTimeout(400);
  await page.locator('.more').first().click(); await shot('3b-session-menu');
  await page.click('[data-act="rec"][data-change*="excuse"]'); await shot('3c-session-after-edit');
  await page.click('.name-link'); await shot('3d-student');
  await page.click('[data-go="review"]'); await shot('5-questions');
  await page.click('[data-go="followups"]'); await shot('6-followups');
  await page.click('[data-go="reports"]'); await shot('7-weekly-report');
  await browser.close();
  if (errors.length) { console.error('Page errors:', errors); process.exit(1); }
  console.log('Screenshots in', out);
})();
