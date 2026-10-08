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
    setBackgrounds(b) { this.sheet.backgrounds = b; return this; }
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
    clear() { this.data = []; this.backgrounds = null; }
    setFrozenRows() {}
    // test helper: rows as objects keyed by header
    objects() {
      const [h, ...rows] = this.data;
      return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] || ''])));
    }
  }
  const sheets = {};
  const toasts = [];
  const cacheStore = new Map();
  const dialogs = [];
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
    getUi: () => ({ createMenu: () => chain(), showModalDialog: (h, title) => { dialogs.push(title); }, alert() {} }),
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
    constructor(name, parent) {
      this.id = 'fold' + nextId++; this.name = name; this.files = []; this.folders = []; this.parent = parent;
      this.created = new FakeDate(); drive.byId[this.id] = this;
    }
    getDateCreated() { return this.created; }
    getFolders() { return iter(this.folders.slice()); }
    moveTo(folder) {
      if (this.parent) this.parent.folders = this.parent.folders.filter(f => f !== this);
      folder.folders.push(this); this.parent = folder;
    }
    createFile(name, content, mime) {
      if (name && typeof name === 'object') return this.addFile(name.getName(), name.getDataAsString(), name.getContentType()); // a Blob
      return this.addFile(name, content, mime || 'text/plain');
    }
    getParents() { return iter(this.parent ? [this.parent] : [driveRoot]); }
    getFilesByName(n) { return iter(this.files.filter(f => f.name === n)); }
    // test helper: a screenshot whose "pixels" are the text Zoom shows
    addImage(name, text) { return this.addFile(name, text, 'image/png'); }
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
    getBlob() { const c = this.content, m = this.mime, n = this.name; return { getDataAsString: () => c, getBytes: () => Array.from(Buffer.from(String(c))), getContentType: () => m, getName: () => n }; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
    setContent(c) { this.content = c; return this; }
    setTrashed(v) { this.trashed = v; if (v) this.folder.files = this.folder.files.filter(f => f !== this); }
    moveTo(folder) { this.folder.files = this.folder.files.filter(f => f !== this); folder.files.push(this); this.folder = folder; }
  }
  const rootFolders = [];
  const driveRoot = new Folder('My Drive', null);
  const DriveApp = {
    createFolder: n => { const f = new Folder(n, null); rootFolders.push(f); return f; },
    getFolderById: id => { if (!drive.byId[id]) throw new Error('no folder ' + id); return drive.byId[id]; },
    getRootFolder: () => driveRoot,
    getFileById: id => drive.byId[id] || ({ setTrashed: () => { drive.docs[id].trashed = true; } })
  };
  // Advanced Drive service (v3): converting an image to a Google Doc runs OCR. Here the image content is its text.
  drive.docs = {};
  const ocr = { calls: 0 };
  const Drive = {
    Files: {
      create: (meta, blob) => {
        ocr.calls++;
        const id = 'doc' + nextId++;
        drive.docs[id] = { text: blob.getDataAsString(), trashed: false, meta };
        return { id };
      }
    }
  };
  const DocumentApp = { openById: id => ({ getBody: () => ({ getText: () => drive.docs[id].text }) }) };

  /* ---- Gmail etc. ---- */
  const mail = { sent: [], drafts: [], threads: [], labels: {}, replies: [] };
  let mailId = 1;
  class GThread {
    constructor(subject) { this.id = 'th' + mailId++; this.subject = subject; this.msgs = []; this.labels = new Set(); }
    getId() { return this.id; }
    getMessages() { return this.msgs.slice(); }
    getFirstMessageSubject() { return this.subject; }
    addLabel(l) { this.labels.add(l.name); return this; }
    removeLabel(l) { this.labels.delete(l.name); return this; }
    createDraftReply(body, o) { mail.replies.push({ thread: this.id, body, ...o }); }
  }
  // test helper: add an email to a thread (a new thread when none is given). Returns the thread.
  mail.receive = ({ thread, from, body, subject, attachments, at }) => {
    const th = thread || (mail.threads.push(new GThread(subject || '(no subject)')), mail.threads[mail.threads.length - 1]);
    const id = 'msg' + mailId++, date = new FakeDate(at ? new RealDate(at).getTime() : NOW);
    th.msgs.push({ getId: () => id, getFrom: () => from, getDate: () => date, getPlainBody: () => body, getSubject: () => th.subject,
      getAttachments: () => (attachments || []).map(n => ({ getName: () => n })) });
    return th;
  };
  const GmailApp = {
    sendEmail: (to, subject, body, o) => mail.sent.push({ to, subject, body, ...o }),
    createDraft: (to, subject, body, o) => mail.drafts.push({ to, subject, body, ...o }),
    search: () => mail.threads.slice(),
    getThreadById: id => mail.threads.find(t => t.id === id),
    getUserLabelByName: n => mail.labels[n] || null,
    createLabel: n => (mail.labels[n] = { name: n })
  };
  /* ---- Script properties and Claude API ---- */
  const props = {};
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) };
  // ai.reply(body) → the JSON object Claude would return (as structured output); ai.requests records each call.
  const ai = { requests: [], reply: () => ({}), status: 200 };
  const UrlFetchApp = {
    fetch: (url, o) => {
      const body = JSON.parse(o.payload);
      ai.requests.push({ url, headers: o.headers, body });
      let text, code = ai.status;
      try { text = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(ai.reply(body)) }] }); }
      catch (e) { code = 500; text = JSON.stringify({ error: { message: e.message } }); }
      return { getResponseCode: () => code, getContentText: () => text };
    }
  };
  const triggers = [];
  const service = { url: '' };
  const ScriptApp = {
    getService: () => ({ getUrl: () => service.url }),
    WeekDay: { FRIDAY: 'FRIDAY' },
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: h => {
      const t = { handler: h, spec: [], getHandlerFunction: () => h };
      const b = new Proxy({}, { get: (x, k) => (...a) => { if (k === 'create') { triggers.push(t); return t; } t.spec.push([k, ...a]); return b; } });
      return b;
    }
  };
  const blob = (data, type, name) => ({
    getDataAsString: () => data, getContentType: () => type, getName: () => name, getBytes: () => Array.from(Buffer.from(String(data))),
    getAs: t => blob(data, t, name), setName: n => blob(data, type, n)
  });
  const Utilities = {
    newBlob: (data, type, name) => blob(Array.isArray(data) ? Buffer.from(data).toString('utf8') : data, type, name),
    base64Decode: b => Array.from(Buffer.from(b, 'base64')),
    base64Encode: b => Buffer.from(Array.isArray(b) ? b : String(b)).toString('base64'),
    formatDate(d, tz, fmt) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new RealDate(d.getTime())).map(x => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
    }
  };
  const ctx = {
    Date: FakeDate, console, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt,
    SpreadsheetApp, DriveApp, GmailApp, ScriptApp, Utilities, Drive, DocumentApp, PropertiesService, UrlFetchApp,
    Session: { getScriptTimeZone: () => TZ, getEffectiveUser: () => ({ getEmail: () => 'ta@ivy.edu' }) },
    CacheService: { getScriptCache: () => ({ get: k => cacheStore.has(k) ? cacheStore.get(k) : null, put: (k, v) => { cacheStore.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    HtmlService: { createHtmlOutput: () => chain(), createHtmlOutputFromFile: () => chain() }
  };
  vm.createContext(ctx);
  const src = path.join(__dirname, '..', 'src');
  ['Rules.js', 'Parsers.js', 'Messages.js', 'Code.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
  });
  return {
    gas: ctx, sheets, mail, props, ai, triggers, toasts, rootFolders, ocr, docs: drive.docs, driveRoot, service, dialogs, cacheStore,
    setNow: iso => { NOW = new RealDate(iso).getTime(); },
    sheet: n => sheets[n]
  };
}

module.exports = { makeEnv };
