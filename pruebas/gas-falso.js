// Entorno falso de Google Apps Script para probar Code.gs en Node.
const fs = require("fs"), vm = require("vm"), crypto = require("crypto");
function crear(codePath) {
  const sheets = []; const props = {}; const cache = {}; const files = new Map(); let nid = 1;
  const toSigned = buf => [...buf].map(b => b > 127 ? b - 256 : b);
  class Range {
    constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? "" : v); } o.push(row); } return o; }
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
    setValue(x) { this.sh.set(this.r, this.c, x); return this; }
    getValue() { return this.getValues()[0][0]; }
    getRow() { return this.r; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    set(r, c, x) { if (typeof x === "string" && x.startsWith("'")) x = x.slice(1); while (this.data.length < r) this.data.push([]); this.data[r - 1][c - 1] = x; }
    getName() { return this.name; }
    getLastRow() { let n = this.data.length; while (n > 0 && !(this.data[n - 1] || []).some(v => v !== "" && v !== undefined)) n--; return n; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => { let n = r.length; while (n > 0 && (r[n - 1] === "" || r[n - 1] === undefined)) n--; return n; })); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    appendRow(row) { const r = this.getLastRow() + 1; row.forEach((x, j) => this.set(r, j + 1, x)); }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    setFrozenRows() {} hideColumns() {} hideSheet() {}
    getActiveRange() { return new Range(this, 2, 1); }
  }
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets, deleteSheet: s => sheets.splice(sheets.indexOf(s), 1)
  };
  function folder(name) {
    const f = { id: "F" + nid++, name, kind: "folder", children: [], trashed: false,
      getId() { return this.id; }, getUrl() { return "https://drive.google.com/drive/folders/" + this.id; },
      createFolder(n) { const c = folder(n); this.children.push(c); return c; },
      getFoldersByName(n) { const l = this.children.filter(c => c.kind === "folder" && c.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
      createFile(blob) { const fi = { id: "D" + nid++, kind: "file", name: blob.name, mime: blob.mime, size: blob.bytes.length, trashed: false, parent: this,
        getId() { return this.id; }, getUrl() { return "https://drive.google.com/file/d/" + this.id; }, setTrashed(t) { this.trashed = t; } };
        this.children.push(fi); files.set(fi.id, fi); return fi; } };
    files.set(f.id, f); return f;
  }
  const ctx = {
    console, Date, JSON, Math, String, Number, Object, Array, Error, RegExp,
    SpreadsheetApp: { getActive: () => ss, getActiveSheet: () => sheets[0], getUi: () => ({ alert: m => { ctx.__alerts.push(m); }, createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (a, s) => toSigned(crypto.createHash("sha256").update(s, "utf8").digest()),
      base64Decode: s => toSigned(Buffer.from(s, "base64")),
      newBlob: (bytes, mime, name) => ({ bytes: typeof bytes === "string" ? Buffer.from(bytes) : bytes, mime, name }),
      formatDate: (d, tz, fmt) => { const z = new Date(d.getTime() - 5 * 3600000).toISOString(); return fmt === "yyyy" ? z.slice(0, 4) : z.slice(0, 10); }
    },
    DriveApp: { createFolder: n => folder(n), getFolderById: id => { const f = files.get(id); if (!f) throw new Error("no folder"); return f; }, getFileById: id => { const f = files.get(id); if (!f) throw new Error("no file"); return f; } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => "admin@carder.gov.co" }) },
    __alerts: []
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, "utf8"), ctx, { filename: "Code.gs" });
  return { ctx, sheets, props, files, ss,
    post(obj) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).s); },
    tabla(n) { const s = ss.getSheetByName(n); const [h, ...rows] = s.data; return rows.map(r => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ""]))); },
    hash: s => crypto.createHash("sha256").update(s, "utf8").digest("hex") };
}
module.exports = { crear };
