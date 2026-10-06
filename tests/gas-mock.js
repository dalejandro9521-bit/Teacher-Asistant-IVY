/**
 * Minimal in-memory Apps Script (SpreadsheetApp, DriveApp, GmailApp, ...) so the real src/*.js runs in Node.
 * Only the calls the project uses are implemented. Cells are stored as strings, like a plain-text sheet.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEnv(opts) {
  opts = opts || {};
  const TZ = opts.tz || 'America/Indiana/Indianapolis';
  let NOW = new Date(opts.now || '2026-10-05T14:00:00Z').getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
  }

  /* ---- Sheets ---- */
  class Range {
    constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
    getDisplayValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
          row.push(v == null ? '' : String(v));
        }
        out.push(row);
      }
      return out;
    }
    getValues() { return this.getDisplayValues(); }
    setValues(vals) {
      if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) {
        throw new Error(`setValues: data ${vals.length}x${vals[0] && vals[0].length} != range ${this.nr}x${this.nc}`);
      }
      vals.forEach((row, i) => row.forEach((v, j) => this.sheet.put(this.r + i, this.c + j, v)));
      return this;
    }
    setValue(v) { this.sheet.put(this.r, this.c, v); return this; }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
    setDataValidation() { return this; }
    getSheet() { return this.sheet; }
    getRow() { return this.r; }
    getColumn() { return this.c; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    put(r, c, v) {
      while (this.data.length < r) this.data.push([]);
      const row = this.data[r - 1];
      while (row.length < c) row.push('');
      row[c - 1] = v == null ? '' : String(v);
    }
    getLastRow() {
      for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some(v => v !== '')) return i;
      return 0;
    }
    getLastColumn() { return this.data.reduce((m, r) => { let n = 0; r.forEach((v, i) => { if (v !== '') n = i + 1; }); return Math.max(m, n); }, 0); }
    getMaxRows() { return Math.max(1000, this.data.length); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, j) => this.put(r, j + 1, v)); }
    clearContents() { this.data = []; }
    setFrozenRows() {}
    // test helper: rows as objects keyed by header
    objects() {
      const [h, ...rows] = this.data;
      return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] || ''])));
    }
  }
  const sheets = {};
  const toasts = [];
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n)),
    toast: m => toasts.push(m)
  };
  const chain = () => new Proxy({}, { get: (t, k) => k === 'build' ? () => ({}) : () => chain() });
  const SpreadsheetApp = {
    getActive: () => ss,
    getActiveSpreadsheet: () => ss,
    newDataValidation: () => chain(),
    getUi: () => ({ createMenu: () => chain(), showModalDialog() {}, alert() {} }),
    openById: id => {
      const f = drive.byId[id];
      return { getSheets: () => [{ getDataRange: () => ({ getDisplayValues: () => f.rows }) }] };
    }
  };

  /* ---- Drive ---- */
  let nextId = 1;
  const drive = { byId: {} };
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  class Folder {
    constructor(name, parent) { this.id = 'fold' + nextId++; this.name = name; this.files = []; this.folders = []; this.parent = parent; drive.byId[this.id] = this; }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    getFiles() { return iter(this.files.slice()); }
    getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); }
    createFolder(n) { const f = new Folder(n, this); this.folders.push(f); return f; }
    addFile(name, content, mime) {
      const f = new DFile(name, content, mime || 'text/csv', this);
      this.files.push(f);
      return f;
    }
  }
  class DFile {
    constructor(name, content, mime, folder) {
      this.id = 'file' + nextId++; Object.assign(this, { name, content, mime, folder });
      this.created = new FakeDate(); drive.byId[this.id] = this;
      if (Array.isArray(content)) this.rows = content;
    }
    getId() { return this.id; }
    getName() { return this.name; }
    getMimeType() { return this.mime; }
    getDateCreated() { return this.created; }
    getBlob() { return { getDataAsString: () => this.content }; }
    moveTo(folder) { this.folder.files = this.folder.files.filter(f => f !== this); folder.files.push(this); this.folder = folder; }
  }
  const rootFolders = [];
  const DriveApp = {
    createFolder: n => { const f = new Folder(n, null); rootFolders.push(f); return f; },
    getFolderById: id => { if (!drive.byId[id]) throw new Error('no folder ' + id); return drive.byId[id]; }
  };

  /* ---- Gmail etc. ---- */
  const mail = { sent: [], drafts: [] };
  const GmailApp = {
    sendEmail: (to, subject, body, o) => mail.sent.push({ to, subject, body, ...o }),
    createDraft: (to, subject, body, o) => mail.drafts.push({ to, subject, body, ...o })
  };
  const triggers = [];
  const ScriptApp = {
    WeekDay: { FRIDAY: 'FRIDAY' },
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: h => {
      const t = { handler: h, spec: [], getHandlerFunction: () => h };
      const b = new Proxy({}, { get: (x, k) => (...a) => { if (k === 'create') { triggers.push(t); return t; } t.spec.push([k, ...a]); return b; } });
      return b;
    }
  };
  const Utilities = {
    formatDate(d, tz, fmt) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new RealDate(d.getTime())).map(x => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
    }
  };
  const ctx = {
    Date: FakeDate, console, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt,
    SpreadsheetApp, DriveApp, GmailApp, ScriptApp, Utilities,
    Session: { getScriptTimeZone: () => TZ },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    HtmlService: { createHtmlOutput: () => chain() }
  };
  vm.createContext(ctx);
  const src = path.join(__dirname, '..', 'src');
  ['Rules.js', 'Parsers.js', 'Messages.js', 'Code.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
  });
  return {
    gas: ctx, sheets, mail, triggers, toasts, rootFolders,
    setNow: iso => { NOW = new RealDate(iso).getTime(); },
    sheet: n => sheets[n]
  };
}

module.exports = { makeEnv };
