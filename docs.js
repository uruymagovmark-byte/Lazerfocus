/* Lazerfocus – Dokumente & Anhänge (docs.js)
   - Prozessbeschreibung je Schritt (Rich-Text-Editor in der Fokus-Karte)
   - Anhänge je Schritt (Dateien, Links, eigene Dokumente) als Kacheln im Seitenpanel
   - Schnellansicht (Lightbox), Export, Ablage der Dateien in IndexedDB (+ Supabase Storage, wenn angemeldet)
   Daten: step.process (bereinigtes HTML), step.attachments = [{ id, type, name, addedAt, updatedAt, mime?, size?, fileId?, url?, html? }]
   Bilder in Texten: <img data-file="fileId"> – die Datei liegt in IndexedDB, nicht im JSON. */
(() => {
'use strict';
if (!window.LF) { console.warn('docs.js: window.LF fehlt – Modul nicht gestartet'); return; }
const LF = window.LF;

/* ---------- Grundlagen ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (LF.uid ? LF.uid() : Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4));
const pad = n => String(n).padStart(2, '0');
const toast = (m, a) => { if (LF.toast) LF.toast(m, a); };
const haptic = k => { if (LF.haptic) LF.haptic(k); };
const touch = () => { if (LF.touch) LF.touch(); };
const isLocked = s => !!(s && LF.isLocked && LF.isLocked(s));
const labelOf = id => (LF.labelOf ? LF.labelOf(id) : '') || '';
const allSteps = () => (LF.allSteps ? LF.allSteps() : []) || [];
const focusId = () => (LF.focusId ? LF.focusId() : null);
const getStep = id => (id && LF.step ? LF.step(id) : null);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg';

const PH_PROC = 'Prozessbeschreibung: Ablauf, Bilder, Tabellen … ( / für Befehle)';
const PH_DOC = 'Schreib los … ( / für Befehle)';
const MM_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const fmtSize = b => {
  if (b == null || !isFinite(b)) return '';
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return (b < 10 ? b.toFixed(1).replace('.', ',') : Math.round(b)) + ' ' + u[i];
};
const fmtDate = ms => {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return 'Heute ' + hm;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Gestern ' + hm;
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + (d.getFullYear() !== now.getFullYear() ? d.getFullYear() : '');
};
const stamp = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + '.' + pad(d.getMinutes()); };
const fileName = s => (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Dokument');
const extOf = n => { const m = /\.([a-z0-9]{1,8})$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
const stripTags = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function safeHref(h) {
  h = String(h || '').trim();
  if (!h) return null;
  if (/^www\./i.test(h)) h = 'https://' + h;
  if (/^(https?:|mailto:|tel:)/i.test(h)) { try { return new URL(h).href; } catch (e) { return null; } }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(h)) { try { return new URL('https://' + h).href; } catch (e) { return null; } }
  return null;
}
function linkName(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return url;
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
    return u.hostname.replace(/^www\./, '') + (path ? path : '');
  } catch (e) { return url; }
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('Skript nicht ladbar: ' + src));
    document.head.appendChild(s);
  });
}

/* Datei-Arten */
function kindOf(a) {
  if (!a) return 'other';
  if (a.type === 'link') return 'link';
  if (a.type === 'doc') return 'doc';
  const m = String(a.mime || '').toLowerCase(), e = extOf(a.name);
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.startsWith('image/') || /^(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/.test(e)) return 'image';
  if (m.startsWith('video/') || /^(mp4|webm|mov|m4v|ogv)$/.test(e)) return 'video';
  if (m.startsWith('audio/') || /^(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(e)) return 'audio';
  if (/^(xlsx?|csv|tsv|ods|numbers)$/.test(e) || /spreadsheet|excel/.test(m)) return 'sheet';
  if (/^(docx?|odt|rtf|pages)$/.test(e) || /wordprocessing|msword/.test(m)) return 'word';
  if (/^(pptx?|odp|key)$/.test(e) || /presentation|powerpoint/.test(m)) return 'slides';
  if (/^(zip|rar|7z|tar|gz|tgz|bz2)$/.test(e) || /zip|compressed|x-tar/.test(m)) return 'archive';
  if (m.startsWith('text/') || /json|xml|javascript/.test(m) || /^(txt|md|markdown|json|xml|html?|css|js|ts|py|log|ya?ml|ini|sql|sh)$/.test(e)) return 'text';
  return 'other';
}
const KIND_LABEL = { link: 'Link', doc: 'Dokument', pdf: 'PDF', image: 'Bild', video: 'Video', audio: 'Audio', sheet: 'Tabelle', word: 'Word', slides: 'Folien', archive: 'Archiv', text: 'Text', other: 'Datei' };
const FILTER_TYPES = [['all', 'Alle'], ['image', 'Bilder'], ['pdf', 'PDF'], ['doc', 'Dokumente'], ['link', 'Links'], ['office', 'Office'], ['other', 'Andere']];
const typeGroup = k => (k === 'sheet' || k === 'word' || k === 'slides' ? 'office' : ['image', 'pdf', 'doc', 'link'].includes(k) ? k : 'other');
const badgeOf = a => { if (a.proc) return 'PROZ'; const k = kindOf(a); if (k === 'link') return 'LINK'; if (k === 'doc') return 'DOK'; const e = extOf(a.name); return (e || KIND_LABEL[k]).slice(0, 4).toUpperCase(); };

/* Symbole (16 px, Strichstärke wie im Rest der App) */
const svg = (p, w = 14) => `<svg width="${w}" height="${w}" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  plus: svg('<path d="M8 3v10M3 8h10"/>', 12),
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3 3"/>', 13),
  filter: svg('<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>'),
  dots: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="11" cy="7" r="1.2" fill="currentColor"/></svg>',
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 12),
  back: svg('<path d="M9.5 3.5 5 8l4.5 4.5"/>', 12),
  left: svg('<path d="M10 3 5 8l5 5"/>', 18),
  right: svg('<path d="M6 3l5 5-5 5"/>', 18),
  download: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  ext: svg('<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
  clip: svg('<path d="m13 7.5-5.2 5.2a3 3 0 0 1-4.3-4.2l5.6-5.7a2 2 0 0 1 2.9 2.9l-5.6 5.6a1 1 0 0 1-1.4-1.4L10 4.8"/>'),
  doc: svg('<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5M6 8h4.5M6 10.5h4.5"/>'),
  link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>'),
  upload: svg('<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>'),
  wide: svg('<path d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5"/>'),
  narrow: svg('<path d="M1.5 8h4.5M10 8h4.5M4 5.5 6.5 8 4 10.5M12 5.5 9.5 8 12 10.5"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.8" r="1.2"/><path d="m2.5 11.5 3.5-3 3 2.5 2-1.6 2.5 2"/>'),
  pdf: svg('<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/>'),
  table: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M2 10h12M6.5 3v10"/>'),
  diagram: svg('<rect x="2" y="2" width="5" height="4" rx="1"/><rect x="9" y="10" width="5" height="4" rx="1"/><path d="M4.5 6v3.5a1 1 0 0 0 1 1H9"/>'),
  trash: svg('<path d="M2.5 4h11M6 4V2.5h4V4M3.8 4l.7 9.5h7l.7-9.5"/>', 13),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>', 12),
  ul: svg('<circle cx="3" cy="4.5" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="11.5" r=".9" fill="currentColor" stroke="none"/><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5"/>'),
  ol: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><text x="1" y="6.6" font-size="5.6" font-family="ui-monospace,monospace" fill="currentColor">1</text><text x="1" y="13.6" font-size="5.6" font-family="ui-monospace,monospace" fill="currentColor">2</text><path d="M6 4.5h7.5M6 11.5h7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  todo: svg('<rect x="2" y="2.5" width="5" height="5" rx="1.2"/><path d="m2.9 11.3 1.3 1.3 2.4-2.8M9.5 5h4.5M9.5 11.5h4.5"/>'),
  quote: svg('<path d="M3 3.5v9M6.5 5h7M6.5 8h7M6.5 11h4.5"/>'),
  callout: svg('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5.5 6v.01M5.5 8.5v1.5M8 6.5h3.5M8 9.5h3.5"/>'),
  codeblk: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m6 6.5-1.8 1.5L6 9.5M10 6.5l1.8 1.5L10 9.5"/>'),
  hr: svg('<path d="M2 8h12M5 4.5h6M5 11.5h6" stroke-dasharray="0"/>'),
};

/* ---------- Ablage: IndexedDB + Supabase Storage ---------- */
let dbP = null;
function openDb(ver) {
  return new Promise((res, rej) => {
    let r;
    try { r = ver ? indexedDB.open('lazerfocus', ver) : indexedDB.open('lazerfocus'); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }); };
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) { const v = d.version + 1; d.close(); openDb(v).then(res, rej); return; }
      d.onversionchange = () => { d.close(); dbP = null; };
      res(d);
    };
    r.onerror = () => rej(r.error || new Error('IndexedDB nicht verfügbar'));
    r.onblocked = () => rej(new Error('Datenbank ist in einem anderen Tab blockiert'));
  });
}
function db() { if (!dbP) dbP = openDb().catch(e => { dbP = null; throw e; }); return dbP; }
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('files', mode);
    let out;
    const r = fn(t.objectStore('files'));
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Speichern abgebrochen'));
  });
}
const idbGet = id => idb('readonly', s => s.get(id));
const idbPut = rec => idb('readwrite', s => s.put(rec));
const idbAll = () => idb('readonly', s => s.getAll());

let upWarned = false;
const cloud = () => { const c = LF.cloud; return c && c.sb && c.user ? c : null; };
async function cloudUpload(rec, quiet) {
  const c = cloud();
  if (!c) return false;
  try {
    const { error } = await c.sb.storage.from('files').upload(`${c.user.id}/${rec.id}`, rec.blob, { upsert: true, contentType: rec.mime || 'application/octet-stream' });
    if (error) throw error;
    rec.up = 1;
    await idbPut(rec);
    return true;
  } catch (e) {
    // nur ein ruhiger Hinweis pro Sitzung; die Datei bleibt lokal in IndexedDB
    if (!quiet && !upWarned) { upWarned = true; toast('Cloud-Upload nicht möglich (' + (e && e.message ? e.message : e) + '). Dateien bleiben auf diesem Gerät.'); }
    return false;
  }
}
let retried = false;
async function retryUploads() {
  if (retried || !cloud()) return;
  retried = true;
  try {
    const all = await idbAll();
    let fail = 0, last = '';
    for (const rec of all) if (!rec.up && rec.blob) { if (!(await cloudUpload(rec, true))) fail++; }
    if (fail && !upWarned) { upWarned = true; last = fail === 1 ? '1 Datei' : fail + ' Dateien'; toast(last + ' konnte' + (fail === 1 ? '' : 'n') + ' nicht in die Cloud geladen werden. Sie bleiben auf diesem Gerät.'); }
  } catch (e) { /* IndexedDB nicht verfügbar */ }
}
async function storeFile(blob, name) {
  const rec = { id: uid(), blob, name: name || blob.name || 'Datei', mime: blob.type || '', size: blob.size, addedAt: Date.now() };
  await idbPut(rec);
  cloudUpload(rec);
  return rec;
}
async function getBlob(id) {
  let rec = null;
  try { rec = await idbGet(id); } catch (e) { /* kein IndexedDB */ }
  if (rec && rec.blob) return rec.blob;
  const c = cloud();
  if (!c) return null;
  try {
    const { data, error } = await c.sb.storage.from('files').download(`${c.user.id}/${id}`);
    if (error || !data) return null;
    try { await idbPut({ id, blob: data, name: '', mime: data.type || '', size: data.size, addedAt: Date.now(), up: 1 }); } catch (e) { /* nur Cache */ }
    return data;
  } catch (e) { return null; }
}
const urlCache = new Map(), urlPending = new Map();
function getUrl(id, mime) {
  if (!id) return Promise.resolve(null);
  if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
  if (!urlPending.has(id)) {
    urlPending.set(id, getBlob(id).then(b => {
      urlPending.delete(id);
      if (!b) return null;
      if (mime && b.type !== mime) b = new Blob([b], { type: mime });
      const u = URL.createObjectURL(b);
      urlCache.set(id, u);
      return u;
    }, () => { urlPending.delete(id); return null; }));
  }
  return urlPending.get(id);
}
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function dataUrlToBlob(u) { const r = await fetch(u); return r.blob(); }

function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
function pickFiles(accept, multiple) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; if (accept) inp.accept = accept; inp.multiple = !!multiple;
    inp.style.display = 'none';
    inp.addEventListener('change', () => { res([...(inp.files || [])]); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

/* ---------- Bereinigen (Allowlist) – für Einfügen und für alles, was gespeichert/angezeigt wird ---------- */
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'svg', 'math', 'button', 'select', 'textarea', 'canvas', 'video', 'audio', 'source', 'track', 'map', 'area', 'frame', 'frameset', 'applet', 'base', 'colgroup', 'col', 'option', 'datalist', 'dialog', 'input']);
const BLOCK_SEL = 'p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,table,pre,blockquote,hr,section,article,header,footer,figure,main,aside,nav,address,details,dl,dt,dd';
const CONTAINERS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'address', 'figure', 'details', 'summary', 'center', 'dl', 'dt', 'dd', 'form', 'fieldset', 'legend', 'figcaption', 'body', 'html']);
const INLINE_MAP = { i: 'em', em: 'em', cite: 'em', dfn: 'em', var: 'em', u: 'u', ins: 'u', s: 's', strike: 's', del: 's', code: 'code', kbd: 'code', samp: 'code', tt: 'code' };

function marksOf(st, tag) {
  const m = [];
  const fw = /font-weight\s*:\s*([a-z0-9]+)/.exec(st);
  if (fw && (fw[1] === 'bold' || fw[1] === 'bolder' || +fw[1] >= 600)) m.push('strong');
  if (/font-style\s*:\s*italic/.test(st)) m.push('em');
  if (/text-decoration[^;]*underline/.test(st)) m.push('u');
  if (/text-decoration[^;]*line-through/.test(st)) m.push('s');
  if (tag === 'span' && /font-family\s*:[^;]*(mono|courier|consolas|menlo)/.test(st)) m.push('code');
  return m;
}
function wrapMarks(dst, marks, d) {
  let c = dst;
  for (const t of marks) {
    let x = c, has = false;
    while (x) { if (x.localName === t || (t === 'strong' && /^h[1-3]$/.test(x.localName))) { has = true; break; } x = x.parentNode; }
    if (has) continue;
    const e = d.createElement(t); c.appendChild(e); c = e;
  }
  return c;
}
function hasContent(n) { return !!(n.textContent.trim() || (n.querySelector && n.querySelector('img'))); }
function lineBreak(dst, d) { if (hasContent(dst) && dst.lastChild && dst.lastChild.nodeName !== 'BR') dst.appendChild(d.createElement('br')); }
function preText(n) {
  const c = n.cloneNode(true);
  c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  c.querySelectorAll('div,p').forEach(x => x.append('\n'));
  return c.textContent.replace(/ /g, ' ');
}
function firstText(n) { const w = n.ownerDocument.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (t.data.trim()) return t; return null; }

function walk(src, dst, ctx) {
  for (const n of [...src.childNodes]) {
    if (n.nodeType === 3) {
      let t = n.data;
      if (!ctx.pre) t = t.replace(/[\r\n\t]+/g, ' ');
      if (t) dst.appendChild(ctx.doc.createTextNode(t));
    } else if (n.nodeType === 1) el(n, dst, ctx);
  }
}
function el(n, dst, ctx) {
  const tag = n.localName;
  if (DROP_TAGS.has(tag)) return;
  const cls = n.getAttribute('class') || '';
  if (/\bdx-ui\b/.test(cls)) return;
  const st = (n.getAttribute('style') || '').toLowerCase();
  if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(st)) return;
  const d = ctx.doc, mk = t => d.createElement(t);
  const sub = o => Object.assign({}, ctx, o);
  const blockDst = () => (ctx.inline ? ctx.host : dst);
  const hasBlocks = () => !!n.querySelector(BLOCK_SEL);

  if (tag === 'br') { dst.appendChild(mk('br')); return; }
  if (tag === 'hr') { if (ctx.flat || ctx.cell) lineBreak(dst, d); else blockDst().appendChild(mk('hr')); return; }
  if (/^h[1-6]$/.test(tag)) {
    if (ctx.flat || ctx.inline) { lineBreak(dst, d); walk(n, wrapMarks(dst, ['strong'], d), sub({ inline: true })); return; }
    const h = mk('h' + Math.min(3, +tag[1])); dst.appendChild(h);
    walk(n, h, sub({ inline: true, host: dst })); return;
  }
  if (tag === 'p') {
    if (ctx.flat || ctx.inline) { lineBreak(dst, d); walk(n, wrapMarks(dst, marksOf(st, tag), d), sub({ inline: true })); return; }
    const p = mk('p'); dst.appendChild(p);
    walk(n, wrapMarks(p, marksOf(st, tag), d), sub({ inline: true, host: dst })); return;
  }
  if (CONTAINERS.has(tag)) {
    if (tag === 'div' && /\bcallout\b/.test(cls) && !ctx.flat && !ctx.inline) {
      const c = mk('div'); c.className = 'callout'; dst.appendChild(c);
      walk(n, c, sub({ flat: true, inline: false, host: c })); return;
    }
    if (hasBlocks()) { walk(n, dst, ctx); return; }
    if (ctx.flat || ctx.inline) { lineBreak(dst, d); walk(n, wrapMarks(dst, marksOf(st, 'div'), d), sub({ inline: true })); return; }
    if (!hasContent(n) && !n.querySelector('br')) return;
    const p = mk('p'); dst.appendChild(p);
    walk(n, wrapMarks(p, marksOf(st, 'div'), d), sub({ inline: true, host: dst })); return;
  }
  if (tag === 'blockquote') {
    if (ctx.flat || ctx.inline) { lineBreak(dst, d); walk(n, dst, sub({ inline: true })); return; }
    const q = mk('blockquote'); dst.appendChild(q);
    walk(n, q, sub({ flat: true, inline: false, host: q })); return;
  }
  if (tag === 'pre') {
    const t = preText(n).replace(/\n$/, '');
    if (ctx.flat || ctx.inline) { const c = mk('code'); c.textContent = t; dst.appendChild(c); return; }
    const pr = mk('pre');
    if (/\bmermaid-src\b/.test(cls) || n.querySelector('code.language-mermaid')) pr.className = 'mermaid-src';
    pr.textContent = t; dst.appendChild(pr); return;
  }
  if (tag === 'ul' || tag === 'ol') {
    const check = tag === 'ul' && (/checklist|to-do|todo|task-list/.test(cls) || !!n.querySelector(':scope > li[role="checkbox"], :scope > li[aria-checked], :scope > li > input[type="checkbox"], :scope > li > label > input[type="checkbox"]'));
    let target = dst;
    if (dst.localName === 'ul' || dst.localName === 'ol') {
      target = dst.lastElementChild && dst.lastElementChild.localName === 'li' ? dst.lastElementChild : dst.appendChild(mk('li'));
    } else if (ctx.inline) target = ctx.host;
    const l = mk(tag); if (check) l.className = 'checklist';
    target.appendChild(l);
    walk(n, l, sub({ inline: false, flat: false, host: l })); return;
  }
  if (tag === 'li') {
    let list = dst;
    if (dst.localName !== 'ul' && dst.localName !== 'ol') { list = mk('ul'); blockDst().appendChild(list); }
    const li = mk('li'); list.appendChild(li);
    const box = n.querySelector(':scope > input[type="checkbox"], :scope > label > input[type="checkbox"], :scope > div input[type="checkbox"]');
    const isCheck = list.classList.contains('checklist') || n.getAttribute('role') === 'checkbox' || n.hasAttribute('aria-checked') || !!box || !!n.querySelector(':scope > .checkbox');
    if (isCheck) {
      list.classList.add('checklist');
      if (n.getAttribute('aria-checked') === 'true' || n.getAttribute('data-checked') === 'true' || (box && box.hasAttribute('checked')) || /\b(checked|checkbox-on|done)\b/.test(cls) || !!n.querySelector('.checkbox-on, .to-do-children-checked')) li.setAttribute('data-checked', 'true');
    }
    walk(n, wrapMarks(li, marksOf(st, 'li'), d), sub({ flat: true, inline: false, host: li }));
    const f = firstText(li);
    if (f) {
      const m = /^\s*\[( |x|X)?\]\s?/.exec(f.data);
      if (m && list.localName === 'ul') { list.classList.add('checklist'); if (m[1] && m[1].toLowerCase() === 'x') li.setAttribute('data-checked', 'true'); f.data = f.data.slice(m[0].length); }
    }
    return;
  }
  if (tag === 'table') {
    if (ctx.cell) { walk(n, dst, ctx); return; }
    const t = mk('table'), tb = mk('tbody');
    const rows = [...n.querySelectorAll('tr')].filter(r => r.closest('table') === n);
    for (const r of rows) {
      const inHead = r.parentElement && r.parentElement.localName === 'thead';
      const tr = mk('tr');
      for (const c of [...r.children]) {
        if (c.localName !== 'td' && c.localName !== 'th') continue;
        const cell = mk(c.localName === 'th' || inHead ? 'th' : 'td');
        for (const a of ['colspan', 'rowspan']) { const v = parseInt(c.getAttribute(a), 10); if (v > 1) cell.setAttribute(a, String(v)); }
        walk(c, wrapMarks(cell, marksOf((c.getAttribute('style') || '').toLowerCase(), 'td'), d), sub({ flat: true, inline: false, cell: true, host: cell }));
        tr.appendChild(cell);
      }
      if (tr.children.length) tb.appendChild(tr);
    }
    if (!tb.children.length) return;
    t.appendChild(tb);
    blockDst().appendChild(t); return;
  }
  if (tag === 'tr' || tag === 'td' || tag === 'th' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'caption') {
    if (tag === 'td' || tag === 'th') { if (hasContent(dst)) dst.appendChild(d.createTextNode(' ')); }
    walk(n, dst, ctx); return;
  }
  if (tag === 'img') {
    const img = mk('img');
    const fid = n.getAttribute('data-file'), s = (n.getAttribute('src') || '').trim();
    if (fid && /^[\w-]+$/.test(fid)) img.setAttribute('data-file', fid);
    else if (/^https?:\/\//i.test(s)) img.setAttribute('src', s);
    else if (/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,/i.test(s)) img.setAttribute('src', s);
    else return;
    const alt = n.getAttribute('alt'); if (alt) img.setAttribute('alt', alt.slice(0, 300));
    const w = n.getAttribute('data-w'); if (/^(s|m|l)$/.test(w || '')) img.setAttribute('data-w', w);
    dst.appendChild(img); return;
  }
  if (tag === 'a') {
    const fid = n.getAttribute('data-file');
    if (fid && /^[\w-]+$/.test(fid)) {
      const a = mk('a'); a.className = 'filecard'; a.setAttribute('data-file', fid);
      const m = n.getAttribute('data-mime'); if (m && /^[\w.+-]+\/[\w.+-]+$/.test(m)) a.setAttribute('data-mime', m);
      a.textContent = n.textContent.trim() || 'Datei'; dst.appendChild(a); return;
    }
    const h = safeHref(n.getAttribute('href'));
    if (!h || hasBlocks()) { walk(n, dst, ctx); return; }
    const a = mk('a'); a.setAttribute('href', h); dst.appendChild(a);
    walk(n, wrapMarks(a, marksOf(st, 'a'), d), sub({ inline: true })); return;
  }
  if (tag === 'b' || tag === 'strong') {
    if (hasBlocks()) { walk(n, dst, ctx); return; }
    const normal = /font-weight\s*:\s*(normal|[1-5]00)\b/.test(st);
    const marks = marksOf(st, tag).filter(m => m !== 'strong');
    if (!normal) marks.unshift('strong');
    walk(n, wrapMarks(dst, marks, d), sub({ inline: true })); return;
  }
  if (INLINE_MAP[tag]) {
    if (hasBlocks()) { walk(n, dst, ctx); return; }
    const base = INLINE_MAP[tag];
    walk(n, wrapMarks(dst, [base, ...marksOf(st, tag).filter(m => m !== base)], d), sub({ inline: true })); return;
  }
  // span, font, mark, small, sup, sub, label, unbekannt: auspacken, Stil-Auszeichnungen behalten
  if (hasBlocks()) { walk(n, dst, ctx); return; }
  walk(n, wrapMarks(dst, marksOf(st, tag), d), sub({ inline: true }));
}
const isBlockEl = n => n.nodeType === 1 && /^(p|h1|h2|h3|ul|ol|pre|blockquote|table|hr|div)$/.test(n.localName);
function wrapRuns(container) {
  const d = container.ownerDocument;
  let run = [];
  const flush = before => {
    if (!run.length) return;
    const meaningful = run.some(x => (x.nodeType === 3 && x.data.trim()) || (x.nodeType === 1 && x.nodeName !== 'BR'));
    if (meaningful) { const p = d.createElement('p'); container.insertBefore(p, before); run.forEach(x => p.appendChild(x)); }
    else run.forEach(x => x.remove());
    run = [];
  };
  for (const c of [...container.childNodes]) { if (isBlockEl(c)) flush(c); else run.push(c); }
  flush(null);
}
function tidy(root) {
  const d = root.ownerDocument;
  wrapRuns(root);
  root.querySelectorAll('ul,ol').forEach(l => {
    for (const c of [...l.childNodes]) {
      if (c.nodeType === 1 && c.localName === 'li') continue;
      if (c.nodeType === 3 && !c.data.trim()) { c.remove(); continue; }
      const prev = c.previousElementSibling;
      if (c.nodeType === 1 && (c.localName === 'ul' || c.localName === 'ol') && prev && prev.localName === 'li') { prev.appendChild(c); continue; }
      const li = d.createElement('li'); l.insertBefore(li, c); li.appendChild(c);
    }
  });
  root.querySelectorAll('strong,em,u,s,code,a:not(.filecard)').forEach(e => { if (!e.textContent && !e.querySelector('img,br')) e.remove(); });
  root.querySelectorAll('ul,ol').forEach(l => { if (!l.children.length) l.remove(); });
  root.querySelectorAll('p,h1,h2,h3,li,td,th,blockquote,div.callout').forEach(b => {
    while (b.firstChild && ((b.firstChild.nodeType === 3 && !b.firstChild.data.trim()) || (b.firstChild.nodeName === 'BR' && b.childNodes.length > 1))) b.firstChild.remove();
    while (b.lastChild && b.lastChild.nodeName === 'BR' && b.childNodes.length > 1 && b.lastChild.previousSibling && b.lastChild.previousSibling.nodeName !== 'BR') b.lastChild.remove();
    if (!b.childNodes.length || (!b.textContent.trim() && !b.querySelector('img,br,ul,ol,a.filecard'))) b.innerHTML = '<br>';
  });
}
function sanitize(html) {
  if (!html) return '';
  const src = new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html').body;
  const d = document.implementation.createHTMLDocument('');
  const root = d.createElement('div');
  walk(src, root, { doc: d, host: root, flat: false, inline: false, cell: false });
  tidy(root);
  return root.innerHTML;
}
function isEmptyHtml(h) {
  if (!h) return true;
  if (/<(img|table|hr|pre|a class="filecard")/i.test(h)) return false;
  return !stripTags(h);
}
function parseFrag(html) { const d = document.implementation.createHTMLDocument(''); const r = d.createElement('div'); r.innerHTML = html; return r; }

/* ---------- Markdown ⇄ HTML ---------- */
function mdInline(s) {
  let h = esc(s);
  const codes = [];
  h = h.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  h = h.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2">');
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => '<strong>' + (a || b) + '</strong>');
  h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  h = h.replace(/(^|[^\w])_([^_\s][^_]*?)_(?![\w])/g, '$1<em>$2</em>');
  h = h.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2">$2</a>');
  h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + codes[i] + '</code>');
  return h;
}
function mdList(lines, i) {
  let html = '';
  const stack = [];
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const m = re.exec(lines[i]);
    if (!m) {
      if (!lines[i].trim() && i + 1 < lines.length && re.test(lines[i + 1])) { i++; continue; }
      break;
    }
    const ind = m[1].replace(/\t/g, '  ').length, tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    let text = m[3];
    const chk = tag === 'ul' ? /^\[( |x|X)\]\s+/.exec(text) : null;
    if (chk) text = text.slice(chk[0].length);
    const open = `<${tag}${chk ? ' class="checklist"' : ''}>`;
    while (stack.length > 1 && ind < stack[stack.length - 1].indent) html += '</li></' + stack.pop().tag + '>';
    const top = stack[stack.length - 1];
    if (!top || ind > top.indent) { html += open; stack.push({ indent: ind, tag }); }
    else { html += '</li>'; if (top.tag !== tag) { html += `</${top.tag}>` + open; top.tag = tag; } }
    html += `<li${chk && chk[1].trim() ? ' data-checked="true"' : ''}>` + mdInline(text);
    i++;
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  return { html, next: i };
}
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let html = '', i = 0, para = [];
  const flush = () => { if (para.length) { html += '<p>' + para.map(mdInline).join('<br>') + '</p>'; para = []; } };
  const cells = s => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (/^\s*```/.test(l)) {
      flush();
      const lang = l.trim().slice(3).trim().toLowerCase(), buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre${lang === 'mermaid' ? ' class="mermaid-src"' : ''}>${esc(buf.join('\n'))}</pre>`;
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flush(); const n = Math.min(3, m[1].length); html += `<h${n}>${mdInline(m[2])}</h${n}>`; i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(l)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      if (/^\[!(NOTE|TIP|INFO|WARNING|IMPORTANT|CAUTION)\]/i.test(buf[0] || '')) { buf.shift(); html += '<div class="callout">' + buf.map(mdInline).join('<br>') + '</div>'; }
      else html += '<blockquote>' + buf.map(mdInline).join('<br>') + '</blockquote>';
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      let t = '<table><tbody><tr>' + cells(l).map(c => '<th>' + mdInline(c) + '</th>').join('') + '</tr>';
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += '<tr>' + cells(lines[i]).map(c => '<td>' + mdInline(c) + '</td>').join('') + '</tr>'; i++; }
      html += t + '</tbody></table>';
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) { flush(); const r = mdList(lines, i); html += r.html; i = r.next; continue; }
    para.push(l); i++;
  }
  flush();
  return html;
}
const looksLikeMd = t => /^(#{1,6}\s|\s*[-*+]\s+\S|\s*\d+[.)]\s+\S|>\s|```|\s*\|.*\|\s*$|\s*[-*_]{3,}\s*$)/m.test(t) || /\*\*[^*\n]+\*\*/.test(t) || /\[[^\]\n]+\]\(https?:[^)\s]+\)/.test(t);
function textToHtml(t) {
  t = String(t).replace(/\r\n?/g, '\n');
  const rows = t.split('\n').filter(x => x.length);
  if (rows.length > 1 && rows.every(r => r.includes('\t'))) {
    return '<table><tbody>' + rows.map(r => '<tr>' + r.split('\t').map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  }
  if (looksLikeMd(t)) return mdToHtml(t);
  return t.split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
}

function htmlToMd(html) {
  const root = parseFrag(html);
  const out = [];
  const inl = node => {
    let s = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) { s += c.data.replace(/([*_`\\])/g, '\\$1'); return; }
      if (c.nodeType !== 1) return;
      const t = c.localName, inner = () => inl(c);
      const wrapM = (m, x) => { const core = x.trim(); return core ? /^\s*/.exec(x)[0] + m + core + m + /\s*$/.exec(x)[0] : x; };
      if (t === 'strong') s += wrapM('**', inner());
      else if (t === 'em') s += wrapM('*', inner());
      else if (t === 's') s += wrapM('~~', inner());
      else if (t === 'u') s += '<u>' + inner() + '</u>';
      else if (t === 'code') s += '`' + c.textContent + '`';
      else if (t === 'a') s += c.classList.contains('filecard') ? '[' + c.textContent + '] (Datei)' : '[' + inner() + '](' + c.getAttribute('href') + ')';
      else if (t === 'br') s += '  \n';
      else if (t === 'img') s += '![' + (c.getAttribute('alt') || 'Bild') + '](' + (c.getAttribute('src') || '') + ')';
      else if (t === 'ul' || t === 'ol') { /* eigene Zeilen */ }
      else s += inner();
    });
    return s;
  };
  const list = (l, ind) => {
    let n = 0;
    for (const li of l.children) {
      if (li.localName !== 'li') continue;
      n++;
      const pre = l.localName === 'ol' ? n + '. ' : l.classList.contains('checklist') ? (li.getAttribute('data-checked') === 'true' ? '- [x] ' : '- [ ] ') : '- ';
      out.push(ind + pre + inl(li).trim().replace(/\n/g, '\n' + ind + '  '));
      for (const sub of li.children) if (sub.localName === 'ul' || sub.localName === 'ol') list(sub, ind + (l.localName === 'ol' ? '   ' : '  '));
    }
  };
  for (const c of root.children) {
    const t = c.localName;
    if (t === 'p') out.push(inl(c).trim(), '');
    else if (/^h[1-3]$/.test(t)) out.push('#'.repeat(+t[1]) + ' ' + inl(c).trim(), '');
    else if (t === 'ul' || t === 'ol') { list(c, ''); out.push(''); }
    else if (t === 'blockquote') out.push(inl(c).trim().split('\n').map(x => '> ' + x).join('\n'), '');
    else if (t === 'div' && c.classList.contains('callout')) out.push('> [!NOTE]\n' + inl(c).trim().split('\n').map(x => '> ' + x).join('\n'), '');
    else if (t === 'pre') out.push('```' + (c.classList.contains('mermaid-src') ? 'mermaid' : '') + '\n' + c.textContent + '\n```', '');
    else if (t === 'hr') out.push('---', '');
    else if (t === 'table') {
      const rows = [...c.querySelectorAll('tr')].map(r => [...r.children].map(x => inl(x).trim().replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>')));
      if (!rows.length) continue;
      const w = Math.max(...rows.map(r => r.length));
      const fill = r => { while (r.length < w) r.push(''); return '| ' + r.join(' | ') + ' |'; };
      out.push(fill(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(fill), '');
    } else out.push(inl(c).trim(), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function htmlToText(html) {
  const root = parseFrag(html);
  const out = [];
  const inl = node => {
    let s = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.data;
      else if (c.nodeType === 1) {
        if (c.localName === 'br') s += '\n';
        else if (c.localName === 'img') s += '[Bild' + (c.getAttribute('alt') ? ': ' + c.getAttribute('alt') : '') + ']';
        else if (c.localName === 'ul' || c.localName === 'ol') { /* eigene Zeilen */ }
        else if (c.localName === 'a' && !c.classList.contains('filecard') && c.getAttribute('href') !== c.textContent) s += inl(c) + ' (' + c.getAttribute('href') + ')';
        else s += inl(c);
      }
    });
    return s;
  };
  const list = (l, ind) => {
    let n = 0;
    for (const li of l.children) {
      if (li.localName !== 'li') continue;
      n++;
      const pre = l.localName === 'ol' ? n + '. ' : l.classList.contains('checklist') ? (li.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ') : '• ';
      out.push(ind + pre + inl(li).trim());
      for (const sub of li.children) if (sub.localName === 'ul' || sub.localName === 'ol') list(sub, ind + '   ');
    }
  };
  for (const c of root.children) {
    const t = c.localName;
    if (t === 'ul' || t === 'ol') { list(c, ''); out.push(''); }
    else if (t === 'pre') out.push(c.textContent, '');
    else if (t === 'hr') out.push('────────', '');
    else if (t === 'table') { [...c.querySelectorAll('tr')].forEach(r => out.push([...r.children].map(x => inl(x).trim()).join('\t'))); out.push(''); }
    else if (/^h[1-3]$/.test(t)) out.push(inl(c).trim().toUpperCase(), '');
    else out.push(inl(c).trim(), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- Mermaid (Diagramme) & pdf.js – nur bei Bedarf laden ---------- */
let mmP = null, mmFailed = false;
function loadMermaid() {
  if (!mmP) {
    mmP = (window.mermaid ? Promise.resolve() : loadScript(MM_URL)).then(() => {
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        themeVariables: {
          darkMode: true, background: '#121110', fontFamily: 'Geist, ui-sans-serif, sans-serif', fontSize: '13px',
          primaryColor: '#23211e', primaryTextColor: '#ede8e0', primaryBorderColor: '#3b3733',
          secondaryColor: '#191816', secondaryTextColor: '#ede8e0', secondaryBorderColor: '#3b3733',
          tertiaryColor: '#121110', tertiaryTextColor: '#bdb6ab', tertiaryBorderColor: '#2a2724',
          lineColor: '#8c867c', textColor: '#ede8e0', mainBkg: '#23211e', nodeBorder: '#3b3733',
          clusterBkg: '#191816', clusterBorder: '#3b3733', edgeLabelBackground: '#191816', titleColor: '#ede8e0',
          noteBkgColor: '#2a2724', noteTextColor: '#ede8e0', noteBorderColor: '#3b3733',
          actorBkg: '#23211e', actorBorder: '#3b3733', actorTextColor: '#ede8e0', signalColor: '#bdb6ab', signalTextColor: '#ede8e0',
        },
      });
      return window.mermaid;
    }).catch(e => { mmP = null; mmFailed = true; throw e; });
  }
  return mmP;
}
async function mermaidSvg(code) {
  const mm = await loadMermaid();
  await mm.parse(code);
  const id = 'dxmm' + uid();
  try { const r = await mm.render(id, code); return r.svg; }
  finally { const junk = document.getElementById('d' + id); if (junk) junk.remove(); }
}
let pdfP = null;
function loadPdf() {
  if (!pdfP) pdfP = (window.pdfjsLib ? Promise.resolve() : loadScript(PDF_URL)).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; return window.pdfjsLib; }).catch(e => { pdfP = null; throw e; });
  return pdfP;
}
const thumbCache = new Map();
let thumbQueue = Promise.resolve();
function pdfThumb(fileId, width) {
  if (thumbCache.has(fileId)) return Promise.resolve(thumbCache.get(fileId));
  const job = thumbQueue.then(async () => {
    if (thumbCache.has(fileId)) return thumbCache.get(fileId);
    const blob = await getBlob(fileId);
    if (!blob) return null;
    const lib = await loadPdf();
    const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
    try {
      const page = await doc.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const v = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / v1.width });
      const c = document.createElement('canvas');
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      const u = c.toDataURL('image/jpeg', 0.82);
      thumbCache.set(fileId, u);
      return u;
    } finally { doc.destroy(); }
  });
  thumbQueue = job.catch(() => null);
  return job;
}

/* ---------- Export ---------- */
async function inlineImages(html) {
  const root = parseFrag(html);
  for (const img of [...root.querySelectorAll('img[data-file]')]) {
    const b = await getBlob(img.getAttribute('data-file'));
    if (b) { img.setAttribute('src', await blobToDataUrl(b)); img.removeAttribute('data-file'); }
    else img.replaceWith(root.ownerDocument.createTextNode('[Bild fehlt]'));
  }
  root.querySelectorAll('a.filecard').forEach(a => a.replaceWith(root.ownerDocument.createTextNode('[Datei: ' + a.textContent + ']')));
  return root.innerHTML;
}
async function renderDiagrams(html) {
  const root = parseFrag(html);
  for (const pre of [...root.querySelectorAll('pre.mermaid-src')]) {
    try { const s = await mermaidSvg(pre.textContent); const d = root.ownerDocument.createElement('div'); d.className = 'diagram'; d.innerHTML = s; pre.replaceWith(d); } catch (e) { /* Code bleibt stehen */ }
  }
  return root.innerHTML;
}
const EXPORT_CSS = `body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1d1b19;max-width:760px;margin:40px auto;padding:0 20px}
h1{font-size:28px;line-height:1.2;margin:0 0 16px}h2{font-size:21px;margin:28px 0 8px}h3{font-size:17px;margin:22px 0 6px}
p{margin:0 0 10px}img{max-width:100%;height:auto;border-radius:6px}img[data-w="s"]{max-width:33%}img[data-w="m"]{max-width:60%}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #bbb;padding:6px 10px;vertical-align:top;text-align:left}th{background:#f1eee9}
blockquote{margin:12px 0;padding-left:14px;border-left:3px solid #ccc;color:#555}.callout{margin:12px 0;padding:10px 14px;background:#f6f2ea;border-radius:8px}
pre{background:#f4f2ef;padding:12px;border-radius:6px;white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}code{background:#f1eee9;padding:1px 4px;border-radius:4px;font:13px ui-monospace,Menlo,Consolas,monospace}pre code{background:none;padding:0}
ul.checklist{list-style:none;padding-left:4px}ul.checklist li::before{content:"☐ "}ul.checklist li[data-checked="true"]::before{content:"☑ "}ul.checklist li[data-checked="true"]{color:#888;text-decoration:line-through}
hr{border:0;border-top:1px solid #ccc;margin:20px 0}.diagram svg{max-width:100%;height:auto}`;
async function exportDoc(fmt, title, html) {
  const name = fileName(title);
  const clean = sanitize(html || '');
  try {
    if (fmt === 'txt') { download(name + '.txt', title + '\n\n' + htmlToText(clean), 'text/plain'); return; }
    const withImgs = await inlineImages(clean);
    if (fmt === 'md') { download(name + '.md', '# ' + title + '\n\n' + htmlToMd(withImgs), 'text/markdown'); return; }
    if (fmt === 'doc') {
      const body = `<h1>${esc(title)}</h1>` + withImgs.replace(/<li data-checked="true">/g, '<li>☑ ').replace(/<ul class="checklist">([\s\S]*?)<\/ul>/g, (m, inner) => '<ul class="checklist">' + inner.replace(/<li>(?!☑)/g, '<li>☐ ') + '</ul>');
      const doc = '﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + esc(title) + '</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>' + EXPORT_CSS.replace(/ul\.checklist li::before[^}]*}|ul\.checklist li\[data-checked="true"\]::before[^}]*}/g, '') + '</style></head><body>' + body + '</body></html>';
      download(name + '.doc', doc, 'application/msword'); return;
    }
    const withDia = await renderDiagrams(withImgs);
    if (fmt === 'html') { download(name + '.html', `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head><body><h1>${esc(title)}</h1>${withDia}</body></html>`, 'text/html'); return; }
    if (fmt === 'pdf') {
      if (!LF.print) { toast('PDF-Export ist hier nicht verfügbar.'); return; }
      LF.print(`<style>.dx-print ul.checklist{list-style:none;padding-left:4px}.dx-print ul.checklist li::before{content:"☐ "}.dx-print ul.checklist li[data-checked="true"]::before{content:"☑ "}.dx-print img{max-width:100%}.dx-print img[data-w="s"]{max-width:33%}.dx-print img[data-w="m"]{max-width:60%}.dx-print table{border-collapse:collapse;width:100%}.dx-print td,.dx-print th{border:1px solid #bbb;padding:4px 8px;vertical-align:top}.dx-print .callout{padding:8px 12px;border:1px solid #ccc;border-radius:6px}.dx-print pre{white-space:pre-wrap;border:1px solid #ccc;padding:8px;border-radius:6px}.dx-print blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px}.dx-print .diagram svg{max-width:100%;height:auto}</style><article class="dx-print"><h1>${esc(title)}</h1>${withDia}</article>`, title);
    }
  } catch (e) { toast('Export fehlgeschlagen: ' + (e && e.message ? e.message : e)); }
}
const EXPORTS = [['pdf', 'PDF (Drucken)'], ['doc', 'Word (.doc)'], ['md', 'Markdown (.md)'], ['html', 'Webseite (.html)'], ['txt', 'Text (.txt)']];
const exportItems = (title, getHtml) => EXPORTS.map(([k, l]) => ({ label: l, fn: () => exportDoc(k, typeof title === 'function' ? title() : title, getHtml()) }));

/* ---------- Editor (contenteditable) ---------- */
const EDS = new WeakMap();          // .dx-ed → api
let CUR = null;                     // aktiver Editor
let pointerDown = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => { pointerDown = false; }, true);
document.addEventListener('pointercancel', () => { pointerDown = false; }, true);
function afterPointer(fn) {
  if (!pointerDown) { setTimeout(fn, 0); return; }
  const h = () => { document.removeEventListener('pointerup', h, true); setTimeout(fn, 0); };
  document.addEventListener('pointerup', h, true);
}
const exec = (c, v) => { try { return document.execCommand(c, false, v); } catch (e) { return false; } };
const sel = () => window.getSelection();
function rangeIn(ed) { const s = sel(); if (!s || !s.rangeCount) return null; const r = s.getRangeAt(0); return ed.contains(r.commonAncestorContainer) ? r : null; }
function setRange(r) { if (!r) return; const s = sel(); s.removeAllRanges(); s.addRange(r); }
function caretAt(node, end) { const r = document.createRange(); r.selectNodeContents(node); r.collapse(!end); setRange(r); }
const elOf = n => (n && n.nodeType === 3 ? n.parentElement : n);
function closestIn(n, s, ed) { const e = elOf(n); const c = e && e.closest(s); return c && ed.contains(c) && c !== ed ? c : null; }
function blockOf(ed, n) {
  const li = closestIn(n, 'li, td, th', ed);
  if (li) return li;
  let e = elOf(n);
  while (e && e.parentElement !== ed) { if (e === ed) return null; e = e.parentElement; }
  return e && e.parentElement === ed ? e : null;
}
function textBefore(block) {
  const s = sel(); if (!s.rangeCount) return '';
  const r = document.createRange();
  r.setStart(block, 0);
  try { r.setEnd(s.anchorNode, s.anchorOffset); } catch (e) { return ''; }
  return r.toString();
}
function deleteBefore(block) {
  const s = sel(); if (!s.rangeCount) return;
  const r = document.createRange();
  r.setStart(block, 0); r.setEnd(s.anchorNode, s.anchorOffset);
  setRange(r); exec('delete');
}
const isEmptyBlock = b => !b.textContent.replace(/​/g, '').trim() && !b.querySelector('img, a.filecard, table, hr');
function tableHTML(r, c) { let h = '<table><tbody>'; for (let i = 0; i < r; i++) { h += '<tr>'; for (let j = 0; j < c; j++) h += '<td><br></td>'; h += '</tr>'; } return h + '</tbody></table>'; }

const CMDS = [
  { k: 'p', label: 'Text', icon: 'T', kw: 'text absatz normal paragraph' },
  { k: 'h1', label: 'Überschrift 1', icon: 'H1', kw: 'h1 titel heading gross' },
  { k: 'h2', label: 'Überschrift 2', icon: 'H2', kw: 'h2 heading mittel' },
  { k: 'h3', label: 'Überschrift 3', icon: 'H3', kw: 'h3 heading klein' },
  { k: 'ul', label: 'Liste', icon: '•', kw: 'liste aufzählung bullet punkte ul' },
  { k: 'ol', label: 'Nummerierte Liste', icon: '1.', kw: 'nummeriert zahlen ol liste' },
  { k: 'check', label: 'Checkliste', icon: '☐', kw: 'checkliste todo aufgabe haken' },
  { k: 'quote', label: 'Zitat', icon: '“', kw: 'zitat quote' },
  { k: 'callout', label: 'Hinweis-Box', icon: '!', kw: 'hinweis box callout info notiz' },
  { k: 'code', label: 'Code', icon: '</>', kw: 'code pre programm' },
  { k: 'hr', label: 'Trennlinie', icon: '—', kw: 'trennlinie linie divider strich hr' },
  { k: 'table', label: 'Tabelle', icon: I.table, kw: 'tabelle table raster' },
  { k: 'img', label: 'Bild', icon: I.image, kw: 'bild foto image grafik' },
  { k: 'mermaid', label: 'Diagramm (Mermaid)', icon: I.diagram, kw: 'diagramm mermaid flow ablauf grafik' },
  { k: 'file', label: 'PDF / Datei einbetten', icon: I.clip, kw: 'pdf datei einbetten anhang file' },
];
const BLOCK_CMDS = new Set(['p', 'h1', 'h2', 'h3', 'quote', 'code', 'callout']);

/* Laufzeit-Schmuck im Editor (wird beim Speichern wieder entfernt) */
function hydrate(ed, ro) {
  ed.querySelectorAll('img[data-file]').forEach(img => {
    if (img.getAttribute('src')) return;
    const id = img.getAttribute('data-file');
    getUrl(id).then(u => { if (u) img.src = u; else { img.classList.add('dx-missing'); img.alt = img.alt || 'Bild fehlt auf diesem Gerät'; } });
  });
  ed.querySelectorAll('a.filecard').forEach(a => { a.setAttribute('contenteditable', 'false'); a.setAttribute('title', 'Klicken: ansehen'); a.setAttribute('href', '#'); });
  ed.querySelectorAll('a[href]:not(.filecard)').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; if (!ro) a.title = MOD + ' + Klick: Link öffnen'; });
  ed.querySelectorAll('pre.mermaid-src').forEach(pre => {
    let box = pre.nextElementSibling;
    if (!box || !box.classList.contains('dx-mm')) { box = document.createElement('div'); box.className = 'dx-ui dx-mm'; box.setAttribute('contenteditable', 'false'); pre.after(box); }
    drawMermaid(pre, box);
  });
  ed.querySelectorAll('.dx-mm').forEach(b => { const p = b.previousElementSibling; if (!p || !p.matches('pre.mermaid-src')) b.remove(); });
  if (!ro) { const last = ed.lastElementChild; if (!last || !(last.localName === 'p' && !last.classList.contains('dx-ui'))) { const p = document.createElement('p'); p.innerHTML = '<br>'; ed.appendChild(p); } }
}
const mmTimers = new WeakMap();
function drawMermaid(pre, box, delay) {
  clearTimeout(mmTimers.get(pre));
  mmTimers.set(pre, setTimeout(async () => {
    const code = pre.textContent.trim();
    if (!code) { box.innerHTML = '<span class="dx-mm-note">Diagramm-Code oben eingeben</span>'; return; }
    try { box.innerHTML = await mermaidSvg(code); box.classList.remove('is-err'); }
    catch (e) {
      box.classList.add('is-err');
      box.innerHTML = '<span class="dx-mm-note">' + (mmFailed ? 'Vorschau nicht verfügbar (Mermaid konnte nicht geladen werden). Der Code bleibt erhalten.' : 'Diagramm-Code enthält einen Fehler: ' + esc(String(e && e.message ? e.message : e).split('\n')[0])) + '</span>';
    }
  }, delay || 0));
}

/* feste Formatleiste über dem Editor */
const TB_ITEMS = [
  { c: 'style' },
  { sep: 1 },
  { c: 'bold', t: 'Fett (' + MOD + ' B)', h: '<b>B</b>' },
  { c: 'italic', t: 'Kursiv (' + MOD + ' I)', h: '<i class="dx-tb-i">I</i>' },
  { c: 'underline', t: 'Unterstrichen (' + MOD + ' U)', h: '<u>U</u>' },
  { c: 'strikeThrough', t: 'Durchgestrichen', h: '<s>S</s>' },
  { c: 'code', t: 'Code im Text (' + MOD + ' E)', h: '<span class="dx-mono">&lt;/&gt;</span>' },
  { c: 'link', t: 'Link (' + MOD + ' K)', h: I.link },
  { sep: 1 },
  { c: 'ul', t: 'Liste', h: I.ul },
  { c: 'ol', t: 'Nummerierte Liste', h: I.ol },
  { c: 'check', t: 'Checkliste', h: I.todo },
  { c: 'quote', t: 'Zitat', h: I.quote },
  { c: 'callout', t: 'Hinweis-Box', h: I.callout },
  { c: 'codeblk', t: 'Code-Block', h: I.codeblk },
  { sep: 1 },
  { c: 'hr', t: 'Trennlinie', h: I.hr },
  { c: 'table', t: 'Tabelle', h: I.table },
  { c: 'img', t: 'Bild', h: I.image },
  { c: 'mermaid', t: 'Diagramm (Mermaid)', h: I.diagram },
  { c: 'file', t: 'PDF / Datei einbetten', h: I.clip },
];
const STYLES = [['p', 'Text'], ['h1', 'Überschrift 1'], ['h2', 'Überschrift 2'], ['h3', 'Überschrift 3']];
function buildToolbar(api) {
  const bar = document.createElement('div');
  bar.className = 'dx-tb';
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Formatieren');
  bar.innerHTML = '<div class="dx-tb-row">' + TB_ITEMS.map((it, i) => it.sep ? `<i class="dx-tb-sep" data-i="${i}"></i>`
    : it.c === 'style' ? `<button type="button" class="dx-tb-style" data-c="style" data-i="${i}" aria-haspopup="menu" title="Textart"><span>Text</span><svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>`
    : `<button type="button" data-c="${it.c}" data-i="${i}" title="${esc(it.t)}" aria-label="${esc(it.t)}">${it.h}</button>`).join('')
    + `</div><button type="button" class="dx-tb-more" data-c="more" aria-haspopup="menu" aria-label="Weitere Formate" title="Weitere Formate" hidden>${I.dots}</button>`;
  noBlur(bar);
  const run = c => {
    const ed = api.el;
    if (document.activeElement !== ed || !rangeIn(ed)) { ed.focus(); if (!rangeIn(ed)) caretAt(ed.lastElementChild || ed, true); }
    if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) { exec(c); api.changed(); }
    else if (c === 'code') toggleCode(api);
    else if (c === 'link') askLink(api);
    else applyCmd(api, c === 'codeblk' ? 'code' : c);
    updateToolbar(api);
  };
  const styleMenu = btn => { const ed = api.el; if (document.activeElement !== ed) { ed.focus(); if (!rangeIn(ed)) caretAt(ed.lastElementChild || ed, true); } openPop(btn, STYLES.map(([k, l]) => ({ label: l, fn: () => { api.el.focus(); applyCmd(api, k); updateToolbar(api); } })), { keepFocus: true }); };
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const c = b.dataset.c;
    if (c === 'style') { styleMenu(b); return; }
    if (c === 'more') {
      const hidden = [...bar.querySelectorAll('.dx-tb-row [data-c][hidden]')].map(x => TB_ITEMS[+x.dataset.i]);
      openPop(b, hidden.map(it => ({ label: it.t, fn: () => run(it.c) })), { keepFocus: true });
      return;
    }
    run(c);
  });
  api.tb = bar;
  const fit = () => {
    const row = bar.querySelector('.dx-tb-row'), more = bar.querySelector('.dx-tb-more');
    const all = [...row.children];
    all.forEach(x => { x.hidden = false; });
    more.hidden = true;
    if (!bar.clientWidth || row.scrollWidth <= row.clientWidth + 1) return;
    more.hidden = false;
    for (let i = all.length - 1; i > 0 && row.scrollWidth > row.clientWidth + 1; i--) all[i].hidden = true;
    for (let i = all.length - 1; i > 0 && all[i].classList.contains('dx-tb-sep'); i--) all[i].hidden = true;
    const visible = all.filter(x => !x.hidden); const lastV = visible[visible.length - 1]; if (lastV && lastV.classList.contains('dx-tb-sep')) lastV.hidden = true;
  };
  if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fit)).observe(bar);
  api.fitToolbar = fit;
  return bar;
}
function updateToolbar(api) {
  const bar = api && api.tb; if (!bar) return;
  const s = sel(), ed = api.el;
  const r = s.rangeCount && ed.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null;
  const n = r && r.startContainer;
  const blk = n ? blockOf(ed, n) : null;
  const tag = blk ? blk.localName : 'p';
  const list = n ? closestIn(n, 'ul, ol', ed) : null;
  const st = { h1: 'Überschrift 1', h2: 'Überschrift 2', h3: 'Überschrift 3' }[tag] || 'Text';
  const sb = bar.querySelector('.dx-tb-style span'); if (sb) sb.textContent = st;
  bar.querySelectorAll('.dx-tb-row [data-c]').forEach(b => {
    const c = b.dataset.c; let on = false;
    if (!r) { b.setAttribute('aria-pressed', 'false'); return; }
    if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) { try { on = document.queryCommandState(c); } catch (e) { /* alt */ } }
    else if (c === 'code') on = !!closestIn(n, 'code', ed);
    else if (c === 'link') on = !!closestIn(n, 'a[href]', ed);
    else if (c === 'ul') on = !!list && list.localName === 'ul' && !list.classList.contains('checklist');
    else if (c === 'ol') on = !!list && list.localName === 'ol';
    else if (c === 'check') on = !!list && list.classList.contains('checklist');
    else if (c === 'quote') on = !!closestIn(n, 'blockquote', ed);
    else if (c === 'callout') on = !!closestIn(n, '.callout', ed);
    else if (c === 'codeblk') on = !!closestIn(n, 'pre:not(.mermaid-src)', ed);
    if (c !== 'style') b.setAttribute('aria-pressed', String(on));
  });
}

function createEditor(host, o) {
  const ro = !!o.readOnly;
  const wrap = document.createElement('div');
  wrap.className = 'dx-edwrap' + (o.cls ? ' ' + o.cls : '');
  const ed = document.createElement('div');
  ed.className = 'dx-ed dx-prose';
  ed.setAttribute('contenteditable', ro ? 'false' : 'true');
  ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true');
  ed.setAttribute('aria-label', o.label || 'Dokument'); ed.setAttribute('data-ph', o.placeholder || PH_DOC);
  if (ro) ed.setAttribute('aria-readonly', 'true');
  ed.spellcheck = true;
  ed.innerHTML = sanitize(o.get() || '') || (ro ? '' : '<p><br></p>');
  wrap.appendChild(ed); host.appendChild(wrap);
  hydrate(ed, ro);


  let orig = null, timer = null, last = null;
  const api = {
    el: ed, wrap, ro, hold: false,
    html() {
      const c = ed.cloneNode(true);
      c.querySelectorAll('.dx-ui').forEach(x => x.remove());
      const h = sanitize(c.innerHTML);
      return isEmptyHtml(h) ? '' : h;
    },
    flush() { clearTimeout(timer); if (ro) return; const h = api.html(); if (h !== last) { last = h; o.set(h); touch(); if (o.onSaved) o.onSaved(); } },
    changed() { fixNesting(ed); refreshEmpty(); clearTimeout(timer); timer = setTimeout(api.flush, 600); },
    focus(end) { ed.focus({ preventScroll: false }); if (end !== undefined) caretAt(ed.lastElementChild || ed, true); },
  };
  last = sanitize(o.get() || ''); last = isEmptyHtml(last) ? '' : last;
  const refreshEmpty = () => ed.classList.toggle('is-empty', ed.children.length <= 1 && isEmptyHtml(ed.innerHTML) && !ed.querySelector('ul,ol,pre,blockquote,.callout,h1,h2,h3'));
  refreshEmpty();
  EDS.set(ed, api);
  if (!ro && o.toolbar) { wrap.classList.add('has-tb', 'tb-' + o.toolbar); wrap.insertBefore(buildToolbar(api), ed); requestAnimationFrame(() => api.fitToolbar && api.fitToolbar()); }
  if (ro) {
    ed.addEventListener('click', e => {
      const fc = e.target.closest('a.filecard'); if (fc) { e.preventDefault(); openEmbedded(fc); return; }
      const img = e.target.closest('img'); if (img) openImage(img);
    });
    return api;
  }

  ed.addEventListener('focus', () => {
    exec('defaultParagraphSeparator', 'p'); exec('styleWithCSS', false);
    if (!api.hold) orig = o.get() || '';
    api.hold = false; CUR = api;
    if (api.fitToolbar) requestAnimationFrame(api.fitToolbar);
  });
  ed.addEventListener('blur', () => {
    api.flush();
    closeSlash();
    if (api.hold) return;
    const before = orig, now = o.get() || '';
    orig = null;
    if (before === null || before === now) return;
    afterPointer(() => {
      if (document.activeElement === ed) { orig = before; return; }
      o.set(before);
      if (LF.mutate) LF.mutate(() => o.set(now)); else { o.set(now); touch(); }
    });
  });
  ed.addEventListener('input', e => {
    api.changed();
    const s = sel();
    if (SL.open && SL.api === api) updateSlash();
    else if (e.inputType === 'insertText' && s.anchorNode && s.anchorNode.nodeType === 3 && !closestIn(s.anchorNode, 'pre, td, th, code', ed)) {
      const t = s.anchorNode.data.slice(0, s.anchorOffset);
      const m = /(^|[\s\u00a0])\/([^\s\/]{0,20})$/.exec(t);
      if (m && (e.data || '').includes('/')) openSlash(api, s.anchorNode, t.length - m[2].length - 1);
      else if (mdOnInput(api)) return;
    }
    updateFloating();
    const pre = closestIn(s.anchorNode, 'pre.mermaid-src', ed);
    if (pre && pre.nextElementSibling && pre.nextElementSibling.classList.contains('dx-mm')) drawMermaid(pre, pre.nextElementSibling, 500);
  });
  ed.addEventListener('keydown', e => onKey(api, e));
  ed.addEventListener('paste', e => onPaste(api, e));
  ed.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; ed.classList.add('dx-dragin'); } });
  ed.addEventListener('dragleave', e => { if (!ed.contains(e.relatedTarget)) ed.classList.remove('dx-dragin'); });
  ed.addEventListener('drop', e => {
    ed.classList.remove('dx-dragin');
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    let r = null;
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    ed.focus();
    if (r && ed.contains(r.startContainer)) setRange(r);
    embedFiles(api, [...e.dataTransfer.files]);
  });
  ed.addEventListener('mousedown', e => {
    const li = e.target.closest('ul.checklist > li');
    if (li && ed.contains(li) && e.clientX - li.getBoundingClientRect().left < 24) {
      e.preventDefault();
      if (li.getAttribute('data-checked') === 'true') li.removeAttribute('data-checked'); else li.setAttribute('data-checked', 'true');
      haptic('tap'); api.changed();
    }
  });
  ed.addEventListener('click', e => {
    const fc = e.target.closest('a.filecard');
    if (fc) { e.preventDefault(); openEmbedded(fc); return; }
    const a = e.target.closest('a[href]');
    if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }
    if (a) e.preventDefault();
    const img = e.target.closest('img');
    if (img && ed.contains(img)) selectImage(api, img); else hideIbar();
  });
  ed.addEventListener('dblclick', e => { const img = e.target.closest('img'); if (img) openImage(img); });
  return api;
}

// execCommand erzeugt manchmal ungültige Verschachtelung (z. B. <p><ul>…</ul></p>) – reparieren, Cursor bleibt erhalten
function fixNesting(ed) {
  const bad = ed.querySelectorAll(':scope > p > :is(ul, ol, table, pre, h1, h2, h3, blockquote, p, div)');
  if (!bad.length) return;
  const s = sel(), r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  new Set([...bad].map(x => x.parentElement)).forEach(p => {
    const frag = document.createDocumentFragment();
    let run = null;
    [...p.childNodes].forEach(c => {
      if (c.nodeType === 1 && /^(ul|ol|table|pre|h1|h2|h3|blockquote|p|div)$/.test(c.localName)) { run = null; frag.appendChild(c); }
      else if (c.nodeType === 3 && !c.data.trim() && !run) { c.remove(); }
      else if (c.nodeName === 'BR' && !run) { c.remove(); }
      else { if (!run) { run = document.createElement('p'); frag.appendChild(run); } run.appendChild(c); }
    });
    p.replaceWith(frag);
  });
  if (r && ed.contains(r.startContainer)) setRange(r);
}

/* Tastatur: Markdown-Kürzel, Listen, Tabellen, Code */
function onKey(api, e) {
  const ed = api.el;
  if (SL.open && SL.api === api) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (SL.items.length) { SL.idx = (SL.idx + (e.key === 'ArrowDown' ? 1 : -1) + SL.items.length) % SL.items.length; markSlash(); } return; }
    if (e.key === 'Enter' || e.key === 'Tab') { if (SL.items.length) { e.preventDefault(); chooseSlash(SL.items[SL.idx]); return; } closeSlash(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); return; }
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); askLink(api); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleCode(api); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); exec('strikeThrough'); api.changed(); return; }
  if (e.key === 'Escape') { hideIbar(); return; }
  const s = sel(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const block = blockOf(ed, r.startContainer);
  const pre = closestIn(r.startContainer, 'pre', ed);
  const cell = closestIn(r.startContainer, 'td, th', ed);
  const li = closestIn(r.startContainer, 'li', ed);

  if (pre) {
    if (e.key === 'Enter' && mod) { e.preventDefault(); exitBlock(api, pre); return; }
    if (e.key === 'Enter') { e.preventDefault(); exec('insertText', '\n'); if (r.collapsed && !textAfter(pre)) { const s2 = sel(); if (s2.anchorNode && s2.anchorNode.nodeType === 3 && !/\n$/.test(pre.textContent)) exec('insertText', '\n'); } api.changed(); return; }
    if (e.key === 'Tab') { e.preventDefault(); exec('insertText', '  '); return; }
    if (e.key === 'ArrowDown' && r.collapsed && !textAfter(pre).trim()) { const nx = pre.nextElementSibling && pre.nextElementSibling.classList.contains('dx-mm') ? pre.nextElementSibling.nextElementSibling : pre.nextElementSibling; if (!nx) { e.preventDefault(); exitBlock(api, pre); } return; }
    if (e.key === 'Backspace' && r.collapsed && !pre.textContent.length) { e.preventDefault(); toBlock(api, 'p'); return; }
    return;
  }
  if (e.key === 'Tab') {
    if (cell) { e.preventDefault(); moveCell(api, cell, e.shiftKey ? -1 : 1); return; }
    if (li) { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); api.changed(); return; }
    return;
  }
  if (!block || cell) return;
  const tag = block.localName;
  if (e.key === ' ' && r.collapsed && (tag === 'p' || tag === 'li')) {
    const t = textBefore(block);
    const map = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '+': 'ul', '1.': 'ol', '1)': 'ol', '[]': 'check', '[ ]': 'check', '>': 'quote', '!': 'callout' };
    const k = map[t];
    if (k && (tag === 'p' || k === 'check')) { e.preventDefault(); deleteBefore(block); applyCmd(api, k); return; }
  }
  if (e.key === '`' && r.collapsed && tag === 'p' && textBefore(block) === '``') { e.preventDefault(); deleteBefore(block); applyCmd(api, 'code'); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    if (tag === 'p' && /^(-{3,}|\*{3,}|_{3,})$/.test(block.textContent.trim())) { e.preventDefault(); block.innerHTML = '<br>'; caretAt(block); applyCmd(api, 'hr'); return; }
    if (tag === 'p' && /^```(\w*)$/.test(block.textContent.trim())) { e.preventDefault(); const lang = block.textContent.trim().slice(3); block.innerHTML = '<br>'; caretAt(block); applyCmd(api, lang === 'mermaid' ? 'mermaid' : 'code'); return; }
    if ((tag === 'blockquote' || (tag === 'div' && block.classList.contains('callout'))) && isEmptyBlock(block)) { e.preventDefault(); toBlock(api, 'p'); return; }
    if ((tag === 'blockquote' || tag === 'div') && r.collapsed && !textAfter(block) && /\n?$/.test(block.innerText) && block.lastChild && block.lastChild.nodeName === 'BR' && block.lastChild.previousSibling && block.lastChild.previousSibling.nodeName === 'BR') {
      e.preventDefault(); block.lastChild.remove(); block.lastChild.remove(); exitBlock(api, block); return;
    }
    if (tag === 'blockquote' || tag === 'div') { e.preventDefault(); exec('insertLineBreak'); api.changed(); return; }
    if (tag === 'li' && block.parentElement.classList.contains('checklist')) setTimeout(() => { const s2 = sel(); const nli = s2.anchorNode && closestIn(s2.anchorNode, 'li', ed); if (nli && nli !== block && isEmptyBlock(nli)) nli.removeAttribute('data-checked'); }, 0);
  }
  if (e.key === 'Backspace' && r.collapsed && textBefore(block) === '' && /^(h1|h2|h3|blockquote|div)$/.test(tag)) { e.preventDefault(); toBlock(api, 'p'); return; }
  if (e.key === 'Backspace' && r.collapsed && tag === 'li' && textBefore(block) === '' && block.parentElement.classList.contains('checklist') && !block.previousElementSibling) { e.preventDefault(); exec('insertUnorderedList'); api.changed(); }
}
// Markdown-Kürzel auch dann, wenn Text ohne Tastendruck eingefügt wird (z. B. Autokorrektur, Diktat)
function mdOnInput(api) {
  const ed = api.el, s = sel(); if (!s.rangeCount || !s.isCollapsed) return false;
  const block = blockOf(ed, s.anchorNode);
  if (!block || !/^(p|li)$/.test(block.localName)) return false;
  const t = textBefore(block);
  if (t === '```' && block.localName === 'p') { deleteBefore(block); applyCmd(api, 'code'); return true; }
  const m = /^(#{1,3}|[-*+]|1[.)]|\[ ?\]|>|!)[ \u00a0]$/.exec(t);
  if (!m) return false;
  const k = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '+': 'ul', '1.': 'ol', '1)': 'ol', '[]': 'check', '[ ]': 'check', '>': 'quote', '!': 'callout' }[m[1]];
  if (block.localName === 'li' && k !== 'check') return false;
  deleteBefore(block); applyCmd(api, k); return true;
}
function textAfter(block) {
  const s = sel(); if (!s.rangeCount) return '';
  const r = document.createRange();
  try { r.setStart(s.focusNode, s.focusOffset); r.setEnd(block, block.childNodes.length); } catch (e) { return ''; }
  return r.toString();
}
function exitBlock(api, block) {
  let after = block.nextElementSibling && block.nextElementSibling.classList.contains('dx-mm') ? block.nextElementSibling : block;
  let p = after.nextElementSibling;
  if (!p || p.localName !== 'p' || !isEmptyBlock(p)) { p = document.createElement('p'); p.innerHTML = '<br>'; after.after(p); }
  caretAt(p); api.changed();
}
function moveCell(api, cell, dir) {
  const table = cell.closest('table');
  const cells = [...table.querySelectorAll('td, th')];
  let i = cells.indexOf(cell) + dir;
  if (i >= cells.length) { addRow(api, table, cells[cells.length - 1].parentElement); i = cells.length; }
  const all = [...table.querySelectorAll('td, th')];
  const t = all[Math.max(0, i)];
  if (t) { const r = document.createRange(); r.selectNodeContents(t); setRange(r); }
}

/* Block-Befehle (Slash-Menü, Markdown, Werkzeugleiste) */
function unlist(api) {
  const s = sel(); const li = s.rangeCount && closestIn(s.anchorNode, 'li', api.el);
  if (li) exec(li.parentElement.localName === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
}
function toBlock(api, tag) {
  const ed = api.el;
  const s = sel(); if (!s.rangeCount) return;
  let b = blockOf(ed, s.anchorNode);
  if (b && b.localName === 'div' && b.classList.contains('callout')) {
    const p = document.createElement(tag === 'callout' ? 'p' : tag === 'quote' ? 'blockquote' : tag === 'code' ? 'pre' : tag);
    while (b.firstChild) p.appendChild(b.firstChild);
    if (!p.firstChild) p.innerHTML = '<br>';
    b.replaceWith(p); caretAt(p, true); api.changed(); return;
  }
  unlist(api);
  if (tag === 'callout') {
    b = blockOf(ed, sel().anchorNode);
    if (!b) return;
    const d = document.createElement('div'); d.className = 'callout';
    while (b.firstChild) d.appendChild(b.firstChild);
    if (!d.firstChild) d.innerHTML = '<br>';
    b.replaceWith(d); caretAt(d, true); api.changed(); return;
  }
  const t = { quote: 'blockquote', code: 'pre' }[tag] || tag;
  b = blockOf(ed, sel().anchorNode);
  if (b && b.localName === t && t !== 'p') { exec('formatBlock', '<p>'); api.changed(); return; }
  exec('formatBlock', '<' + t + '>');
  api.changed();
}
// Block-Elemente (Tabelle, Linie, Diagramm) direkt einsetzen: leerer Absatz wird ersetzt, sonst kommt der Block danach
function insertBlockHTML(api, html) {
  const ed = api.el;
  fixNesting(ed);
  const s = sel();
  let top = s.rangeCount ? elOf(s.anchorNode) : null;
  while (top && top.parentElement !== ed) top = top.parentElement;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.childNodes];
  if (!top) ed.append(...nodes);
  else if (top.localName === 'p' && isEmptyBlock(top)) top.replaceWith(...nodes);
  else top.after(...nodes);
  hydrate(ed, false);
  api.changed();
  return nodes;
}
function applyCmd(api, k) {
  const ed = api.el;
  if (document.activeElement !== ed) ed.focus();
  if (BLOCK_CMDS.has(k)) { toBlock(api, k); return; }
  const s = sel();
  const curList = s.rangeCount ? closestIn(s.anchorNode, 'ul, ol', ed) : null;
  if (k === 'ul' || k === 'check') {
    if (!curList || curList.localName !== 'ul') exec('insertUnorderedList');
    const l = closestIn(sel().anchorNode, 'ul', ed);
    if (l) l.classList.toggle('checklist', k === 'check');
    fixNesting(ed); api.changed(); return;
  }
  if (k === 'ol') { if (!curList || curList.localName !== 'ol') exec('insertOrderedList'); fixNesting(ed); api.changed(); return; }
  if (k === 'hr') { const n = insertBlockHTML(api, '<hr><p><br></p>'); caretAt(n[1]); return; }
  if (k === 'table') {
    const n = insertBlockHTML(api, tableHTML(3, 3) + '<p><br></p>');
    caretAt(n[0].querySelector('td'));
    return;
  }
  if (k === 'mermaid') {
    const n = insertBlockHTML(api, '<pre class="mermaid-src">flowchart TD\n  A[Start] --&gt; B{Entscheidung}\n  B --&gt;|Ja| C[Weiter]\n  B --&gt;|Nein| D[Stopp]</pre><p><br></p>');
    caretAt(n[0], true);
    return;
  }
  if (k === 'img' || k === 'file') {
    const saved = rangeIn(ed); const keep = saved && saved.cloneRange();
    api.hold = true;
    pickFiles(k === 'img' ? 'image/*' : '', true).then(files => {
      ed.focus(); if (keep) setRange(keep);
      if (files.length) embedFiles(api, files, k === 'file');
    });
  }
}
async function embedFiles(api, files, asCards) {
  if (!files.length) return;
  const saved = rangeIn(api.el); const keep = saved && saved.cloneRange();
  let html = '';
  try {
    for (const f of files) {
      const rec = await storeFile(f, f.name || ('Bild ' + stamp() + '.png'));
      if (!asCards && (f.type || '').startsWith('image/')) html += `<img data-file="${rec.id}" alt="${esc(rec.name)}">`;
      else html += `<a class="filecard" data-file="${rec.id}" data-mime="${esc(rec.mime)}">${esc(rec.name)}</a>&nbsp;`;
    }
  } catch (e) { toast('Datei konnte nicht gespeichert werden: ' + (e && e.message ? e.message : e)); return; }
  api.el.focus(); if (keep) setRange(keep);
  exec('insertHTML', html);
  hydrate(api.el, false);
  api.changed();
}
function toggleCode(api) {
  const s = sel(); if (!s.rangeCount) return;
  const c = closestIn(s.anchorNode, 'code', api.el);
  if (c) { const t = document.createTextNode(c.textContent); c.replaceWith(t); const r = document.createRange(); r.selectNodeContents(t); setRange(r); api.changed(); return; }
  const txt = s.toString();
  if (!txt) return;
  exec('insertHTML', '<code>' + esc(txt) + '</code>&#8203;');
  api.changed();
}
function askLink(api) {
  const ed = api.el;
  const r0 = rangeIn(ed); if (!r0) return;
  const r = r0.cloneRange();
  const a = closestIn(r.startContainer, 'a[href]', ed);
  api.hold = true;
  hideFmt();
  LF.dialog({
    title: a ? 'Link ändern' : 'Link einfügen',
    body: `<input class="park-in" data-dx-in placeholder="https://…" autocomplete="off" inputmode="url" value="${esc(a ? a.getAttribute('href') : '')}">`,
    actions: [
      { label: 'Abbrechen', fn: () => { ed.focus(); setRange(r); } },
      ...(a ? [{ label: 'Entfernen', cls: 'danger', fn: () => { ed.focus(); const rr = document.createRange(); rr.selectNodeContents(a); setRange(rr); exec('unlink'); api.changed(); } }] : []),
      { label: 'Übernehmen', cls: 'primary', fn: v => {
        const h = safeHref(v);
        ed.focus(); setRange(r);
        if (!h) { if (v && v.trim()) toast('Das ist keine gültige Adresse (z. B. https://beispiel.de).'); return; }
        if (a) { a.setAttribute('href', h); }
        else if (r.collapsed) exec('insertHTML', `<a href="${esc(h)}">${esc(linkName(h))}</a>&nbsp;`);
        else exec('createLink', h);
        hydrate(ed, false); api.changed();
      } },
    ],
  });
  dlgInput();
}
function dlgInput() {
  setTimeout(() => {
    const inp = document.querySelector('.dlg [data-dx-in]');
    if (!inp) return;
    inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = document.querySelector('.dlg-actions .primary'); if (b) b.click(); } });
  }, 30);
}

/* Einfügen: Rich-Text (Notion, Google Docs, Word, Excel), Bilder, Dateien, Text/Markdown */
const hasFiles = e => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
async function onPaste(api, e) {
  const cd = e.clipboardData; if (!cd) return;
  const ed = api.el;
  const r0 = rangeIn(ed);
  const inPre = r0 && closestIn(r0.startContainer, 'pre, code', ed);
  const html = cd.getData('text/html'), text = cd.getData('text/plain');
  const files = [...(cd.files || [])];
  if (inPre) { e.preventDefault(); exec('insertText', text); api.changed(); return; }
  if (files.length && (!html || !stripTags(html))) { e.preventDefault(); embedFiles(api, files); return; }
  const url = /^\s*(https?:\/\/\S+)\s*$/.exec(text || '');
  if (url && r0 && !r0.collapsed && !html.includes('<table')) { e.preventDefault(); exec('createLink', url[1]); hydrate(ed, false); api.changed(); return; }
  e.preventDefault();
  const keep = r0 && r0.cloneRange();
  let clean = html ? sanitize(html) : sanitize(textToHtml(text || ''));
  if (!clean) return;
  clean = await storePastedImages(clean);
  ed.focus(); if (keep) setRange(keep);
  // ein einzelner Absatz wird als Text eingefügt, damit kein leerer Absatz entsteht
  const single = /^<p>([\s\S]*)<\/p>$/.exec(clean);
  exec('insertHTML', single && !single[1].includes('<p>') ? single[1] : clean);
  const cur = sel().rangeCount ? blockOf(ed, sel().anchorNode) : null;
  if (cur && cur.previousElementSibling && cur.previousElementSibling.localName === 'p' && isEmptyBlock(cur.previousElementSibling) && !single) cur.previousElementSibling.remove();
  ed.querySelectorAll('span[style], font').forEach(s => { s.replaceWith(...s.childNodes); });
  hydrate(ed, false);
  api.changed();
  fetchRemoteImages(api);
}
async function storePastedImages(html) {
  if (!/<img[^>]+src="data:/i.test(html)) return html;
  const root = parseFrag(html);
  for (const img of [...root.querySelectorAll('img[src^="data:"]')]) {
    try { const b = await dataUrlToBlob(img.getAttribute('src')); const rec = await storeFile(b, img.getAttribute('alt') || ('Bild ' + stamp() + '.' + ((b.type.split('/')[1] || 'png').replace('jpeg', 'jpg')))); img.removeAttribute('src'); img.setAttribute('data-file', rec.id); }
    catch (e) { img.remove(); }
  }
  return root.innerHTML;
}
// Fremde Bilder (z. B. aus Notion/Google Docs) möglichst lokal speichern; klappt nur, wenn der Server es erlaubt (CORS)
async function fetchRemoteImages(api) {
  for (const img of [...api.el.querySelectorAll('img[src^="http"]:not([data-file])')]) {
    if (img.dataset.dxTried) continue;
    img.dataset.dxTried = '1';
    try {
      const res = await fetch(img.getAttribute('src'), { mode: 'cors', credentials: 'omit' });
      if (!res.ok) continue;
      const b = await res.blob();
      if (!b.type.startsWith('image/')) continue;
      const rec = await storeFile(b, img.alt || ('Bild ' + stamp()));
      img.setAttribute('data-file', rec.id);
      api.changed();
    } catch (e) { /* bleibt als externe Adresse */ }
  }
}

/* ---------- schwebende Werkzeuge ---------- */
function floatEl(cls) { const d = document.createElement('div'); d.className = cls; d.hidden = true; document.body.appendChild(d); return d; }
function place(box, rect, prefer) {
  box.hidden = false;
  const w = box.offsetWidth, h = box.offsetHeight, m = 8;
  let top = prefer === 'below' ? rect.bottom + m : rect.top - h - m;
  if (top < m) top = rect.bottom + m;
  if (top + h > innerHeight - m) top = Math.max(m, rect.top - h - m);
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  box.style.top = Math.round(top) + 'px'; box.style.left = Math.round(left) + 'px';
}
const noBlur = el => el.addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); });

// Format-Leiste bei Markierung
let FMT = null;
function fmtBar() {
  if (FMT) return FMT;
  FMT = floatEl('dx-fmt');
  FMT.setAttribute('role', 'toolbar'); FMT.setAttribute('aria-label', 'Text formatieren');
  const b = (c, label, title) => `<button type="button" data-c="${c}" title="${title}" aria-label="${title}">${label}</button>`;
  FMT.innerHTML = b('bold', '<b>B</b>', 'Fett (' + MOD + ' B)') + b('italic', '<i>I</i>', 'Kursiv (' + MOD + ' I)') + b('underline', '<u>U</u>', 'Unterstrichen (' + MOD + ' U)') + b('strikeThrough', '<s>S</s>', 'Durchgestrichen') + b('code', '<span class="dx-mono">&lt;/&gt;</span>', 'Code (' + MOD + ' E)') + b('link', I.link, 'Link (' + MOD + ' K)') + '<i class="dx-fmt-sep"></i>' + b('h1', 'H1', 'Überschrift 1') + b('h2', 'H2', 'Überschrift 2') + b('check', '☐', 'Checkliste');
  noBlur(FMT);
  FMT.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn || !CUR) return;
    const c = btn.dataset.c;
    if (c === 'link') { askLink(CUR); return; }
    if (c === 'code') toggleCode(CUR);
    else if (c === 'h1' || c === 'h2' || c === 'check') applyCmd(CUR, c);
    else exec(c);
    CUR.changed(); updateFloating();
  });
  return FMT;
}
function hideFmt() { if (FMT) FMT.hidden = true; }

// Slash-Menü
const SL = { open: false, api: null, node: null, off: 0, items: [], idx: 0, el: null };
function openSlash(api, node, off) {
  if (!SL.el) {
    SL.el = floatEl('dx-slash'); SL.el.setAttribute('role', 'listbox'); SL.el.setAttribute('aria-label', 'Blöcke');
    noBlur(SL.el);
    SL.el.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) chooseSlash(CMDS.find(c => c.k === b.dataset.k)); });
    SL.el.addEventListener('mousemove', e => { const b = e.target.closest('[data-k]'); if (!b) return; const i = SL.items.findIndex(c => c.k === b.dataset.k); if (i >= 0 && i !== SL.idx) { SL.idx = i; SL.el.querySelectorAll('[data-k]').forEach((x, j) => x.classList.toggle('is-on', j === i)); } });
  }
  Object.assign(SL, { open: true, api, node, off, idx: 0 });
  updateSlash();
}
function slashQuery() {
  const s = sel();
  if (!s.rangeCount || s.anchorNode !== SL.node || s.anchorOffset <= SL.off || SL.node.data.charAt(SL.off) !== '/') return null;
  return SL.node.data.slice(SL.off + 1, s.anchorOffset);
}
function updateSlash() {
  const q = slashQuery();
  if (q === null || q.length > 24 || /\s{2}/.test(q)) { closeSlash(); return; }
  const n = q.trim().toLowerCase();
  SL.items = CMDS.filter(c => !n || c.label.toLowerCase().includes(n) || c.kw.includes(n));
  if (!SL.items.length && n.length > 3) { closeSlash(); return; }
  SL.idx = Math.min(SL.idx, Math.max(0, SL.items.length - 1));
  drawSlash();
}
function drawSlash() {
  SL.el.innerHTML = SL.items.length
    ? '<div class="dx-slash-h">Blöcke</div>' + SL.items.map((c, i) => `<button type="button" role="option" tabindex="-1" data-k="${c.k}" class="${i === SL.idx ? 'is-on' : ''}" aria-selected="${i === SL.idx}"><span class="dx-slash-ic">${c.icon}</span><span>${c.label}</span></button>`).join('')
    : '<div class="dx-slash-none">Kein Treffer</div>';
  SL.el.scrollTop = 0;
  placeSlash();
  slashActiveInView();
}
// nur die Markierung wechseln (kein Neuaufbau) und den Eintrag im Menü sichtbar halten
function markSlash() {
  SL.el.querySelectorAll('[data-k]').forEach((b, i) => { b.classList.toggle('is-on', i === SL.idx); b.setAttribute('aria-selected', String(i === SL.idx)); });
  slashActiveInView();
}
function slashActiveInView() {
  const on = SL.el.querySelector('.is-on'); if (!on) return;
  const top = on.offsetTop, bot = top + on.offsetHeight;
  if (top < SL.el.scrollTop + 4) SL.el.scrollTop = Math.max(0, top - 28);
  else if (bot > SL.el.scrollTop + SL.el.clientHeight - 4) SL.el.scrollTop = bot - SL.el.clientHeight + 4;
}
function placeSlash() {
  if (!SL.node || !SL.node.isConnected) { closeSlash(); return; }
  const s = sel();
  const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  let rect = r && r.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height && !rect.top)) rect = elOf(SL.node).getBoundingClientRect();
  SL.el.hidden = false;
  const m = 8, below = innerHeight - rect.bottom - m - 6, above = rect.top - m - 6;
  const flip = below < 200 && above > below;
  SL.el.style.maxHeight = Math.max(120, Math.min(340, flip ? above : below)) + 'px';
  const h = SL.el.offsetHeight;
  SL.el.style.left = Math.round(Math.max(m, Math.min(rect.left, innerWidth - SL.el.offsetWidth - m))) + 'px';
  SL.el.style.top = Math.round(flip ? Math.max(m, rect.top - h - 6) : rect.bottom + 6) + 'px';
}
function closeSlash() { SL.open = false; if (SL.el) SL.el.hidden = true; }
function chooseSlash(cmd) {
  if (!cmd || !SL.api) return;
  const api = SL.api, s = sel();
  const end = s.anchorNode === SL.node ? s.anchorOffset : SL.off + 1;
  closeSlash();
  const r = document.createRange();
  try { r.setStart(SL.node, SL.off); r.setEnd(SL.node, end); setRange(r); exec('delete'); } catch (e) { /* Knoten weg */ }
  applyCmd(api, cmd.k);
}

// Link-Blase, Tabellen-Leiste, Bild-Leiste
let LB_ = null, TB = null, IB = null;
function linkBubble(api, a) {
  if (!LB_) {
    LB_ = floatEl('dx-bub'); noBlur(LB_);
    LB_.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !LB_._a) return;
      const a2 = LB_._a, api2 = LB_._api;
      if (b.dataset.c === 'open') window.open(a2.href, '_blank', 'noopener');
      if (b.dataset.c === 'edit') { const r = document.createRange(); r.selectNodeContents(a2); setRange(r); askLink(api2); }
      if (b.dataset.c === 'del') { const r = document.createRange(); r.selectNodeContents(a2); setRange(r); exec('unlink'); api2.changed(); LB_.hidden = true; }
    });
  }
  LB_._a = a; LB_._api = api;
  LB_.innerHTML = `<span class="dx-bub-url" title="${esc(a.href)}">${esc(linkName(a.href))}</span><button type="button" data-c="open">Öffnen</button><button type="button" data-c="edit">Ändern</button><button type="button" data-c="del" aria-label="Link entfernen" title="Link entfernen">${I.close}</button>`;
  place(LB_, a.getBoundingClientRect(), 'below');
}
function hideLinkB() { if (LB_) LB_.hidden = true; }
function addRow(api, table, afterTr) {
  const tr = document.createElement('tr');
  const n = Math.max(...[...table.rows].map(r => r.cells.length));
  for (let i = 0; i < n; i++) { const td = document.createElement('td'); td.innerHTML = '<br>'; tr.appendChild(td); }
  afterTr.after(tr); api.changed(); return tr;
}
function tableBar(api, table, cell) {
  if (!TB) {
    TB = floatEl('dx-tbar'); noBlur(TB);
    TB.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const { _api: a, _table: t, _cell: c } = TB;
      if (!t || !t.isConnected) return;
      const tr = c.parentElement, ci = c.cellIndex;
      switch (b.dataset.c) {
        case 'row': { const n = addRow(a, t, tr); caretAt(n.cells[Math.min(ci, n.cells.length - 1)]); break; }
        case 'col': [...t.rows].forEach(r => { const ref = r.cells[Math.min(ci, r.cells.length - 1)]; const x = document.createElement(ref && ref.localName === 'th' ? 'th' : 'td'); x.innerHTML = '<br>'; if (ref) ref.after(x); else r.appendChild(x); }); caretAt(tr.cells[ci + 1]); a.changed(); break;
        case 'more': openPop(b, [
          { label: 'Zeile löschen', fn: () => { if (t.rows.length <= 1) { t.remove(); } else tr.remove(); a.changed(); } },
          { label: 'Spalte löschen', fn: () => { if (tr.cells.length <= 1) t.remove(); else [...t.rows].forEach(r => { if (r.cells[ci]) r.cells[ci].remove(); }); a.changed(); } },
          { label: 'Kopfzeile an / aus', fn: () => { const first = t.rows[0]; const toTh = [...first.cells].some(x => x.localName === 'td'); [...first.cells].forEach(x => { const y = document.createElement(toTh ? 'th' : 'td'); while (x.firstChild) y.appendChild(x.firstChild); [...x.attributes].forEach(at => y.setAttribute(at.name, at.value)); x.replaceWith(y); }); a.changed(); } },
          { sep: true },
          { label: 'Tabelle löschen', danger: true, fn: () => { const p = document.createElement('p'); p.innerHTML = '<br>'; t.replaceWith(p); caretAt(p); a.changed(); } },
        ]); return;
      }
      updateFloating();
    });
  }
  Object.assign(TB, { _api: api, _table: table, _cell: cell });
  TB.innerHTML = `<button type="button" data-c="row" title="Zeile darunter einfügen">${I.plus}<span>Zeile</span></button><button type="button" data-c="col" title="Spalte rechts einfügen">${I.plus}<span>Spalte</span></button><button type="button" data-c="more" aria-label="Weitere Tabellen-Aktionen" title="Mehr">${I.dots}</button>`;
  TB.hidden = false;
  const rc = table.getBoundingClientRect();
  const top = rc.top - TB.offsetHeight - 6;
  TB.style.top = Math.round(top < 8 ? rc.bottom + 6 : top) + 'px';
  TB.style.left = Math.round(Math.max(8, Math.min(rc.right - TB.offsetWidth, innerWidth - TB.offsetWidth - 8))) + 'px';
}
function hideTbar() { if (TB) TB.hidden = true; }
function selectImage(api, img) {
  api.el.querySelectorAll('.dx-img-sel').forEach(x => x.classList.remove('dx-img-sel'));
  img.classList.add('dx-img-sel');
  if (!IB) {
    IB = floatEl('dx-tbar dx-ibar'); noBlur(IB);
    IB.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const { _api: a, _img: im } = IB;
      if (!im || !im.isConnected) { hideIbar(); return; }
      const c = b.dataset.c;
      if (c === 's' || c === 'm' || c === 'l') { if (c === 'l') im.removeAttribute('data-w'); else im.setAttribute('data-w', c); a.changed(); }
      if (c === 'view') openImage(im);
      if (c === 'dl') { const id = im.getAttribute('data-file'); if (id) getBlob(id).then(bl => bl ? download(im.alt || 'Bild', bl) : toast('Bild fehlt auf diesem Gerät.')); else window.open(im.src, '_blank', 'noopener'); }
      if (c === 'del') { im.remove(); a.changed(); hideIbar(); return; }
      selectImage(a, im);
    });
  }
  Object.assign(IB, { _api: api, _img: img });
  const w = img.getAttribute('data-w') || 'l';
  IB.innerHTML = [['s', 'Klein'], ['m', 'Mittel'], ['l', 'Breit']].map(([k, l]) => `<button type="button" data-c="${k}" aria-pressed="${w === k}">${l}</button>`).join('') + `<i class="dx-fmt-sep"></i><button type="button" data-c="view" title="Groß ansehen" aria-label="Groß ansehen">${I.ext}</button><button type="button" data-c="dl" title="Herunterladen" aria-label="Herunterladen">${I.download}</button><button type="button" data-c="del" title="Bild entfernen" aria-label="Bild entfernen">${I.trash}</button>`;
  place(IB, img.getBoundingClientRect());
}
function hideIbar() { if (IB) { IB.hidden = true; if (IB._img) IB._img.classList.remove('dx-img-sel'); } }

let selRaf = 0;
document.addEventListener('selectionchange', () => { cancelAnimationFrame(selRaf); selRaf = requestAnimationFrame(updateFloating); });
const isFloatUi = t => !!(t && t.nodeType === 1 && t.closest && t.closest('.dx-slash, .dx-pop, .dx-fmt, .dx-tbar, .dx-bub'));
document.addEventListener('scroll', e => { if (isFloatUi(e.target)) return; if ((FMT && !FMT.hidden) || (TB && !TB.hidden) || (LB_ && !LB_.hidden) || (IB && !IB.hidden) || SL.open) { cancelAnimationFrame(selRaf); selRaf = requestAnimationFrame(() => { updateFloating(); if (IB && !IB.hidden && IB._img && IB._img.isConnected) place(IB, IB._img.getBoundingClientRect()); if (SL.open) placeSlash(); }); } }, true);
addEventListener('resize', () => { hideFmt(); hideTbar(); hideLinkB(); hideIbar(); closeSlash(); });
function updateFloating() {
  const s = sel();
  const node = s && s.rangeCount ? s.getRangeAt(0).commonAncestorContainer : null;
  const edEl = node && elOf(node) && elOf(node).closest('.dx-ed');
  const api = edEl && EDS.get(edEl);
  document.querySelectorAll('.dx-ed .dx-cur').forEach(x => x.classList.remove('dx-cur'));
  if (!api || api.ro || document.activeElement !== edEl) { hideFmt(); hideLinkB(); hideTbar(); return; }
  CUR = api;
  updateToolbar(api);
  const r = s.getRangeAt(0);
  const inPre = closestIn(r.startContainer, 'pre', edEl);
  if (!r.collapsed && r.toString().trim() && !inPre) {
    const bar = fmtBar();
    bar.querySelectorAll('[data-c]').forEach(b => {
      const c = b.dataset.c;
      let on = false;
      if (['bold', 'italic', 'underline', 'strikeThrough'].includes(c)) { try { on = document.queryCommandState(c); } catch (e) { /* alt */ } }
      if (c === 'code') on = !!closestIn(r.startContainer, 'code', edEl);
      if (c === 'link') on = !!closestIn(r.startContainer, 'a[href]', edEl);
      if (c === 'h1' || c === 'h2') on = !!closestIn(r.startContainer, c, edEl);
      b.setAttribute('aria-pressed', String(on));
    });
    place(bar, r.getBoundingClientRect());
  } else hideFmt();
  const a = r.collapsed && closestIn(r.startContainer, 'a[href]:not(.filecard)', edEl);
  if (a) linkBubble(api, a); else hideLinkB();
  const cell = closestIn(r.startContainer, 'td, th', edEl);
  if (cell && cell.closest('table')) tableBar(api, cell.closest('table'), cell); else hideTbar();
  const b = r.collapsed ? blockOf(edEl, r.startContainer) : null;
  if (b && b.localName === 'p' && isEmptyBlock(b) && !edEl.classList.contains('is-empty')) b.classList.add('dx-cur');
}

/* ---------- kleines Menü (Popover) ---------- */
const POP = { el: null, anchor: null };
function openPop(anchor, items, opt) {
  const again = POP.anchor === anchor && POP.el && !POP.el.hidden;
  closePop();
  if (again) return;
  if (!POP.el) {
    POP.el = floatEl('dx-pop'); POP.el.setAttribute('role', 'menu');
    POP.el.addEventListener('mousedown', e => e.preventDefault());
    POP.el.addEventListener('click', e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const it = POP.items[+b.dataset.i];
      if (!it || it.disabled) return;
      if (it.sub) { drawPop([{ label: '‹ Zurück', back: true }, { sep: true }, ...it.sub]); return; }
      if (it.back) { drawPop(POP.root); return; }
      closePop(); haptic('tap');
      if (it.fn) it.fn();
    });
  }
  POP.anchor = anchor; POP.root = items; POP.keepFocus = !!(opt && opt.keepFocus);
  if (anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
  drawPop(items);
}
function drawPop(items) {
  POP.items = items;
  POP.el.innerHTML = items.map((it, i) => it.sep ? '<div class="m-sep"></div>' : it.head ? `<span class="m-label">${esc(it.head)}</span>` : `<button type="button" role="menuitem" class="m-item${it.danger ? ' danger' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}><span class="m-name">${esc(it.label)}</span>${it.sub ? '<span class="m-sub">›</span>' : it.hint ? `<span class="m-sub">${esc(it.hint)}</span>` : ''}</button>`).join('');
  POP.el.hidden = false;
  const r = POP.anchor.getBoundingClientRect(), w = POP.el.offsetWidth, h = POP.el.offsetHeight;
  let left = r.right - w; if (left < 8) left = Math.min(r.left, innerWidth - w - 8);
  let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  POP.el.style.left = Math.round(Math.max(8, left)) + 'px'; POP.el.style.top = Math.round(top) + 'px';
  if (!POP.keepFocus) { const f = POP.el.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
}
function closePop() {
  if (!POP.el || POP.el.hidden) { POP.anchor = null; return; }
  POP.el.hidden = true;
  if (POP.anchor && POP.anchor.setAttribute) POP.anchor.setAttribute('aria-expanded', 'false');
  POP.anchor = null;
}
document.addEventListener('pointerdown', e => { if (POP.el && !POP.el.hidden && !POP.el.contains(e.target) && !(POP.anchor && POP.anchor.contains && POP.anchor.contains(e.target))) closePop(); }, true);
document.addEventListener('scroll', e => { if (POP.el && !POP.el.hidden && !POP.el.contains(e.target)) closePop(); }, true);
addEventListener('resize', closePop);

/* ---------- Daten ---------- */
function findAtt(id) {
  for (const s of allSteps()) { const a = (s.attachments || []).find(x => x.id === id); if (a) return { a, s }; }
  return null;
}
function allAtts() { return allSteps().flatMap(s => (s.attachments || []).map(a => ({ a, s }))); }
function mut(fn) { if (LF.mutate) LF.mutate(fn); else { fn(); touch(); } }
function addItems(stepId, items, msg) {
  const s0 = getStep(stepId);
  if (!s0) { toast('Schritt nicht gefunden.'); return; }
  if (isLocked(s0)) { toast('Dieser Schritt ist schreibgeschützt.'); return; }
  mut(() => { const s = getStep(stepId); if (!s) return; s.attachments = s.attachments || []; s.attachments.push(...items); });
  haptic('soft');
  if (msg) toast(msg, panelVisible() ? null : { label: 'Anzeigen', fn: () => openAttach(stepId) });
}
async function addFiles(stepId, files) {
  files = files.filter(Boolean);
  if (!files.length) return;
  const items = [];
  try {
    for (const f of files) {
      const name = f.name && f.name !== 'image.png' ? f.name : 'Bild ' + stamp() + '.' + (((f.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg'));
      const rec = await storeFile(f, name);
      const now = Date.now();
      items.push({ id: uid(), type: 'file', name, addedAt: now, updatedAt: now, mime: rec.mime, size: rec.size, fileId: rec.id });
    }
  } catch (e) { toast('Datei konnte nicht gespeichert werden: ' + (e && e.message ? e.message : e)); if (!items.length) return; }
  addItems(stepId, items, items.length === 1 ? `„${items[0].name}“ angehängt` : `${items.length} Dateien angehängt`);
}
function addLink(stepId, url, name) {
  const now = Date.now();
  addItems(stepId, [{ id: uid(), type: 'link', name: (name || '').trim() || linkName(url), url, addedAt: now, updatedAt: now }], 'Link angehängt');
}
function newDoc(stepId) {
  const s = getStep(stepId);
  if (!s || isLocked(s)) { toast('Dieser Schritt ist schreibgeschützt.'); return; }
  const now = Date.now(), a = { id: uid(), type: 'doc', name: 'Neues Dokument', html: '', addedAt: now, updatedAt: now };
  addItems(stepId, [a]);
  openDoc(a.id, true);
}
function renameAtt(id) {
  const f = findAtt(id); if (!f) return;
  LF.dialog({
    title: 'Umbenennen',
    body: `<input class="park-in" data-dx-in value="${esc(f.a.name)}" autocomplete="off" aria-label="Neuer Name">`,
    actions: [{ label: 'Abbrechen' }, { label: 'Speichern', cls: 'primary', fn: v => { v = (v || '').trim(); if (!v) return; mut(() => { const g = findAtt(id); if (g) { g.a.name = v; g.a.updatedAt = Date.now(); } }); } }],
  });
  dlgInput();
}
function duplicateAtt(id) {
  const f = findAtt(id); if (!f) return;
  const now = Date.now();
  const copy = Object.assign(JSON.parse(JSON.stringify(f.a)), { id: uid(), name: f.a.name.replace(/(\.[a-z0-9]{1,8})?$/i, ' (Kopie)$1'), addedAt: now, updatedAt: now });
  mut(() => { const g = findAtt(id); if (!g) return; const i = g.s.attachments.indexOf(g.a); g.s.attachments.splice(i + 1, 0, copy); });
  toast('Kopie angelegt');
}
function removeAtt(id) {
  const f = findAtt(id); if (!f) return;
  const sid = f.s.id, idx = f.s.attachments.indexOf(f.a), saved = JSON.parse(JSON.stringify(f.a));
  mut(() => { const g = findAtt(id); if (g) g.s.attachments.splice(g.s.attachments.indexOf(g.a), 1); });
  haptic('soft');
  if (P.view === 'editor' && P.docId === id) backToList();
  toast(`„${saved.name}“ gelöscht`, { label: 'Rückgängig', fn: () => { mut(() => { const s = getStep(sid); if (!s) return; s.attachments = s.attachments || []; s.attachments.splice(Math.min(idx, s.attachments.length), 0, saved); }); } });
}
function stepOptions(sel_) {
  return allSteps().map(s => `<option value="${esc(s.id)}"${s.id === sel_ ? ' selected' : ''}${isLocked(s) ? ' disabled' : ''}>${esc(labelOf(s.id))}  ${esc(s.title || 'Ohne Titel')}</option>`).join('');
}
function chooseStep(title, cur, cb, label) {
  const steps = allSteps().filter(s => !isLocked(s));
  if (!steps.length) { toast('Es gibt keinen bearbeitbaren Schritt.'); return; }
  let val = cur && steps.some(s => s.id === cur) ? cur : steps[0].id;
  LF.dialog({
    title,
    body: `<select class="dx-select dx-select-l" data-dx-step aria-label="Schritt">${stepOptions(val)}</select>`,
    actions: [{ label: 'Abbrechen' }, { label: label || 'Übernehmen', cls: 'primary', fn: () => cb(val) }],
  });
  setTimeout(() => { const s = document.querySelector('.dlg [data-dx-step]'); if (s) { s.focus(); s.addEventListener('change', () => { val = s.value; }); } }, 30);
}
function moveAtt(id, toStep) {
  const f = findAtt(id); if (!f) return;
  const go = target => {
    if (target === f.s.id) return;
    const t = getStep(target);
    if (!t || isLocked(t) || isLocked(f.s)) { toast('Verschieben hier nicht möglich (schreibgeschützt).'); return; }
    mut(() => { const g = findAtt(id), s = getStep(target); if (!g || !s) return; g.s.attachments.splice(g.s.attachments.indexOf(g.a), 1); s.attachments = s.attachments || []; s.attachments.push(g.a); });
    haptic('soft'); toast(`Verschoben zu Schritt ${labelOf(target)}`);
  };
  if (toStep) go(toStep); else chooseStep('Zu Schritt verschieben', f.s.id, go, 'Verschieben');
}
async function downloadAtt(a) {
  if (a.type === 'link') { window.open(a.url, '_blank', 'noopener'); return; }
  if (a.type === 'doc') return;
  const b = await getBlob(a.fileId);
  if (!b) { toast('Datei ist auf diesem Gerät nicht vorhanden' + (cloud() ? ' und nicht in der Cloud.' : '.')); return; }
  download(a.name || 'Datei', b);
}
function attMenu(anchor, id, from) {
  const f = findAtt(id); if (!f) return;
  const { a, s } = f, ro = isLocked(s), k = kindOf(a);
  const items = [{ label: 'Ansehen', fn: () => openLBFor(id) }];
  if (a.type === 'doc' && !ro) items.push({ label: 'Bearbeiten', fn: () => openDoc(id) });
  if (a.type === 'link') items.push({ label: 'Link öffnen', fn: () => window.open(a.url, '_blank', 'noopener') }, { label: 'Adresse kopieren', fn: () => copyText(a.url) });
  if (a.type === 'file') items.push({ label: 'Herunterladen', hint: fmtSize(a.size), fn: () => downloadAtt(a) });
  if (a.type === 'doc') items.push({ label: 'Exportieren', sub: exportItems(() => (findAtt(id) || f).a.name, () => (findAtt(id) || f).a.html) });
  if (!ro) {
    // Dialoge liegen unter der Schnellansicht: diese vorher schließen
    const lbFirst = fn => () => { if (LB.el && !LB.el.hidden) closeLB(); fn(); };
    items.push({ sep: true }, { label: 'Umbenennen', fn: lbFirst(() => renameAtt(id)) }, { label: 'Duplizieren', fn: () => duplicateAtt(id) }, { label: 'Zu Schritt verschieben …', fn: lbFirst(() => moveAtt(id)) });
    items.push({ sep: true }, { label: 'Löschen', danger: true, fn: lbFirst(() => removeAtt(id)) });
  }
  if (from === 'lb') items.shift();
  void k;
  openPop(anchor, items);
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast('Kopiert'), () => toast('Kopieren nicht möglich'));
  else toast('Kopieren nicht möglich');
}

/* ---------- Prozessbeschreibung in der Fokus-Karte ---------- */
function mountProcess(slot, stepId) {
  if (!slot) return;
  const s = getStep(stepId);
  slot.innerHTML = '';
  if (!s) return;
  const ro = isLocked(s);
  const box = document.createElement('div');
  box.className = 'dx-proc';
  box.dataset.step = stepId;
  slot.appendChild(box);
  if (!(ro && isEmptyHtml(s.process))) {
    const edBox = document.createElement('div');
    edBox.className = 'dx-proc-box' + (ro ? ' is-ro' : '');
    box.appendChild(edBox);
    const api = createEditor(edBox, {
      get: () => { const x = getStep(stepId); return x ? x.process || '' : ''; },
      set: h => { const x = getStep(stepId); if (x) x.process = h; },
      readOnly: ro, placeholder: PH_PROC, label: 'Prozessbeschreibung', cls: 'dx-edwrap-proc', toolbar: 'proc',
    });
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'dx-ibtn dx-proc-more';
    more.setAttribute('aria-label', 'Prozessbeschreibung: weitere Aktionen'); more.title = 'Exportieren …';
    more.innerHTML = I.dots;
    more.addEventListener('mousedown', e => e.preventDefault());
    more.addEventListener('click', e => {
      e.stopPropagation();
      api.flush();
      const t = () => { const x = getStep(stepId); return 'Prozessbeschreibung ' + labelOf(stepId) + (x && x.title ? ' ' + x.title : ''); };
      const items = [{ head: 'Exportieren' }, ...exportItems(t, () => { const x = getStep(stepId); return x ? x.process || '' : ''; })];
      if (!ro) items.push({ sep: true }, { label: 'Als Dokument in Anhänge kopieren', fn: () => { const x = getStep(stepId); if (!x || isEmptyHtml(x.process)) { toast('Die Prozessbeschreibung ist leer.'); return; } const now = Date.now(); addItems(stepId, [{ id: uid(), type: 'doc', name: 'Prozessbeschreibung ' + stamp().slice(0, 10), html: x.process, addedAt: now, updatedAt: now }], 'Als Dokument angehängt'); } });
      openPop(more, items);
    });
    edBox.appendChild(more);
  }
  if (!box.children.length) slot.innerHTML = '';
}
function addMenu(anchor, stepId) {
  const run = fn => () => { const id = stepId || targetStep(); if (id) fn(id); else chooseStep('An welchen Schritt anhängen?', focusId(), fn, 'Weiter'); };
  openPop(anchor, [
    { label: 'Datei hochladen', hint: 'PDF, Bild, …', fn: run(id => pickFiles('', true).then(fs => addFiles(id, fs))) },
    { label: 'Link hinzufügen', fn: run(linkDialog) },
    { label: 'Neues Dokument', fn: run(newDoc) },
  ]);
}
function linkDialog(stepId) {
  let nameVal = '';
  LF.dialog({
    title: 'Link hinzufügen',
    body: `<input class="park-in" data-dx-in placeholder="https://…" autocomplete="off" inputmode="url" aria-label="Adresse"><input class="park-in" data-dx-name placeholder="Name (freiwillig)" autocomplete="off" aria-label="Name">`,
    actions: [{ label: 'Abbrechen' }, { label: 'Hinzufügen', cls: 'primary', fn: v => { const u = safeHref(v); if (!u) { toast('Bitte eine gültige Adresse eingeben (z. B. https://beispiel.de).'); return; } addLink(stepId, u, nameVal); } }],
  });
  dlgInput();
  setTimeout(() => { const n = document.querySelector('.dlg [data-dx-name]'); if (n) { n.addEventListener('input', () => { nameVal = n.value; }); n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = document.querySelector('.dlg-actions .primary'); if (b) b.click(); } }); } }, 30);
}

/* ---------- Seitenpanel: Anhänge ---------- */
const P = { el: null, view: 'list', scope: null, userAll: false, q: '', type: 'all', when: 'all', sort: 'new', filtersOpen: false, docId: null, editor: null, wideByUs: false, list: [] };
const panelVisible = () => !!(P.el && P.el.isConnected && P.el.getClientRects().length);
function targetStep() { if (P.scope && getStep(P.scope)) return P.scope; const f = focusId(); return f && getStep(f) ? f : null; }
function setWide(on) {
  const side = LF.sideEl;
  if (!side) return;
  side.classList.toggle('side--wide', !!on);
  dispatchEvent(new Event('resize'));
}
function filtered() {
  let list = P.scope && getStep(P.scope) ? (getStep(P.scope).attachments || []).map(a => ({ a, s: getStep(P.scope) })) : allAtts();
  if (P.type !== 'all') list = list.filter(x => typeGroup(kindOf(x.a)) === P.type);
  if (P.when !== 'all') {
    const now = new Date();
    const from = P.when === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : Date.now() - (+P.when) * 864e5;
    list = list.filter(x => (x.a.updatedAt || x.a.addedAt || 0) >= from);
  }
  const q = P.q.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter(x => { const hay = (x.a.name + ' ' + (x.a.url || '') + ' ' + (x.a.type === 'doc' ? stripTags(x.a.html) : '') + ' ' + KIND_LABEL[kindOf(x.a)]).toLowerCase(); return words.every(w => hay.includes(w)); });
  }
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const by = {
    new: (x, y) => (y.a.addedAt || 0) - (x.a.addedAt || 0),
    old: (x, y) => (x.a.addedAt || 0) - (y.a.addedAt || 0),
    changed: (x, y) => (y.a.updatedAt || y.a.addedAt || 0) - (x.a.updatedAt || x.a.addedAt || 0),
    name: (x, y) => coll.compare(x.a.name, y.a.name),
    type: (x, y) => coll.compare(KIND_LABEL[kindOf(x.a)], KIND_LABEL[kindOf(y.a)]) || coll.compare(x.a.name, y.a.name),
    size: (x, y) => (y.a.size || 0) - (x.a.size || 0),
  }[P.sort];
  list = list.slice().sort(by);
  // Prozessbeschreibung(en) als angeheftete erste Kachel(n)
  if ((P.type === 'all' || P.type === 'doc') && P.when === 'all') {
    const steps = P.scope && getStep(P.scope) ? [getStep(P.scope)] : allSteps();
    const pins = steps.filter(st => !isEmptyHtml(st.process)).map(st => ({ a: { id: 'proc:' + st.id, type: 'doc', proc: true, name: 'Prozessbeschreibung', html: st.process, addedAt: 0 }, s: st }))
      .filter(x => !q || q.split(/\s+/).every(w => ('prozessbeschreibung ' + stripTags(x.a.html)).toLowerCase().includes(w)));
    list = pins.concat(list);
  }
  return list;
}
const nFilters = () => (P.type !== 'all') + (P.when !== 'all') + (P.sort !== 'new');
function renderPanel() {
  if (!P.el) return;
  if (P.view === 'editor') { renderDoc(); return; }
  P.editor = null;
  const fid = focusId();
  const scopeStep = (P.scope && getStep(P.scope)) || (fid && getStep(fid)) || null;
  const t = targetStep(), canAdd = !(t && isLocked(getStep(t))) && allSteps().some(s => !isLocked(s));
  const hadFocus = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-dx="q"]');
  const chip = (g, k, l, cur) => `<button type="button" class="dx-chip" data-dx="${g}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`;
  P.el.innerHTML = `<div class="dx-panel" data-dx-panel>
  <div class="dx-bar">
    <label class="dx-search">${I.search}<input type="search" data-dx="q" placeholder="Suchen" value="${esc(P.q)}" aria-label="Anhänge durchsuchen" autocomplete="off"></label>
    <button type="button" class="pill icon dx-fbtn" data-dx="filters" aria-expanded="${P.filtersOpen}" aria-label="Filter und Sortierung" title="Filter und Sortierung">${I.filter}${nFilters() ? `<i class="dx-dot">${nFilters()}</i>` : ''}</button>
    <button type="button" class="pill primary dx-addbtn" data-dx="add" aria-haspopup="menu"${canAdd ? '' : ' disabled'}>${I.plus}<span>Hinzufügen</span></button>
  </div>
  ${scopeStep ? `<div class="seg dx-scope" role="group" aria-label="Welche Anhänge zeigen"><button type="button" data-dx="scope-step" aria-pressed="${!!P.scope}" title="${esc(scopeStep.title || 'Ohne Titel')}"><span class="dx-mono">${esc(labelOf(scopeStep.id))}</span> <span class="dx-scope-t">${esc(scopeStep.title || 'Dieser Schritt')}</span></button><button type="button" data-dx="scope-all" aria-pressed="${!P.scope}">Alle Schritte</button></div>` : ''}
  <div class="dx-filters"${P.filtersOpen ? '' : ' hidden'}>
    <div class="dx-frow"><span class="dx-flbl">Typ</span><div class="dx-chips">${FILTER_TYPES.map(([k, l]) => chip('type', k, l, P.type)).join('')}</div></div>
    <div class="dx-frow"><span class="dx-flbl">Zeitraum</span><div class="dx-chips">${[['all', 'Immer'], ['today', 'Heute'], ['7', '7 Tage'], ['30', '30 Tage']].map(([k, l]) => chip('when', k, l, P.when)).join('')}</div></div>
    <div class="dx-frow"><span class="dx-flbl">Schritt</span><select class="dx-select" data-dx="step" aria-label="Schritt"><option value="">Alle Schritte</option>${allSteps().map(s => `<option value="${esc(s.id)}"${s.id === P.scope ? ' selected' : ''}>${esc(labelOf(s.id))}  ${esc(s.title || 'Ohne Titel')}</option>`).join('')}</select></div>
    <div class="dx-frow"><span class="dx-flbl">Sortieren</span><select class="dx-select" data-dx="sort" aria-label="Sortieren">${[['new', 'Neueste zuerst'], ['old', 'Älteste zuerst'], ['changed', 'Zuletzt geändert'], ['name', 'Name A–Z'], ['type', 'Typ'], ['size', 'Größe']].map(([k, l]) => `<option value="${k}"${P.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    ${nFilters() ? '<button type="button" class="dx-textbtn" data-dx="reset">Filter zurücksetzen</button>' : ''}
  </div>
  <div class="dx-count" aria-live="polite"></div>
  <div class="dx-grid" role="list"></div>
  <div class="dx-drop" hidden><div>${I.upload}<b>Loslassen zum Anhängen</b><span class="dx-drop-t"></span></div></div>
</div>`;
  if (hadFocus) { const q = P.el.querySelector('[data-dx="q"]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  renderGrid();
}
function renderGrid() {
  const grid = P.el && P.el.querySelector('.dx-grid');
  if (!grid) return;
  const all = P.scope && getStep(P.scope) ? (getStep(P.scope).attachments || []).length : allAtts().length;
  const list = filtered();
  P.list = list;
  const real = list.filter(x => !x.a.proc).length;
  const cnt = P.el.querySelector('.dx-count');
  cnt.textContent = all ? (real === all ? `${all} ${all === 1 ? 'Anhang' : 'Anhänge'}` : `${real} von ${all}`) : '';
  if (!list.length) {
    grid.innerHTML = all
      ? `<div class="dx-empty"><b>Nichts gefunden</b><span>Andere Suche oder Filter probieren.</span><button type="button" class="pill" data-dx="reset-all">Suche und Filter zurücksetzen</button></div>`
      : `<div class="dx-empty"><span class="dx-empty-ic">${I.clip}</span><b>Noch keine Anhänge${P.scope ? ' in diesem Schritt' : ''}</b><span>Dateien hierher ziehen, mit ${MOD}+V einfügen oder über „Hinzufügen“.</span></div>`;
    return;
  }
  const showStep = !P.scope;
  grid.innerHTML = list.map(({ a, s }) => {
    const k = kindOf(a);
    const sub = a.proc ? 'in der Schritt-Karte' : [a.type === 'link' ? hostOf(a.url) : fmtSize(a.size), fmtDate(a.updatedAt || a.addedAt)].filter(Boolean).join(' · ');
    return `<div class="dx-tile dx-k-${k}${a.proc ? ' dx-pinned' : ''}" role="listitem" data-id="${esc(a.id)}" draggable="${!a.proc}">
  <button type="button" class="dx-tile-hit" data-dx="open" aria-label="${esc(a.name)} ansehen">
    <span class="dx-thumb">${thumbInner(a, k)}</span>
    <span class="dx-tile-meta"><span class="dx-name">${esc(a.name)}</span><span class="dx-sub"><b class="dx-badge">${esc(badgeOf(a))}</b>${esc(sub)}${showStep ? `<span class="dx-steplbl" title="${esc(s.title || '')}">${esc(labelOf(s.id))}</span>` : ''}</span></span>
  </button>
  <button type="button" class="dx-tile-more" data-dx="more" aria-label="Aktionen für ${esc(a.name)}" aria-haspopup="menu">${I.dots}</button>
</div>`;
  }).join('');
  list.forEach(({ a }) => fillThumb(grid.querySelector(`.dx-tile[data-id="${CSS.escape(a.id)}"] .dx-thumb`), a));
}
function thumbInner(a, k) {
  if (k === 'doc') return `<span class="dx-docprev dx-prose">${a.html ? sanitize(a.html).replace(/<img[^>]*>/g, '') : '<p class="dx-faint">Leeres Dokument</p>'}</span>`;
  if (k === 'link') return `<span class="dx-linkprev">${I.link}<b>${esc(hostOf(a.url))}</b><span>${esc((() => { try { const u = new URL(a.url); return decodeURIComponent(u.pathname + u.search).replace(/^\/$/, ''); } catch (e) { return ''; } })())}</span></span>`;
  return `<span class="dx-ext">${esc(badgeOf(a))}</span>`;
}
function fillThumb(box, a) {
  if (!box) return;
  const k = kindOf(a);
  if (a.type !== 'file') return;
  const setImg = u => { if (!u || !box.isConnected) return; box.innerHTML = `<img alt="" src="${esc(u)}" draggable="false">`; box.classList.add('has-img'); };
  if (k === 'image') getUrl(a.fileId, a.mime).then(u => { if (u) setImg(u); else box.insertAdjacentHTML('beforeend', '<span class="dx-missing-t">fehlt</span>'); });
  else if (k === 'pdf') pdfThumb(a.fileId, 280).then(setImg, () => {});
  else if (k === 'video') getUrl(a.fileId, a.mime).then(u => { if (u && box.isConnected) { box.innerHTML = `<video src="${esc(u)}#t=0.5" muted preload="metadata" playsinline></video>`; box.classList.add('has-img'); } });
  else if (k === 'text') getBlob(a.fileId).then(b => b && b.slice(0, 800).text()).then(t => { if (t && box.isConnected) { box.innerHTML = `<span class="dx-textprev">${esc(t)}</span>`; } }).catch(() => {});
}

/* Dokument-Ansicht im Panel */
function openDoc(id, fresh) {
  const f = findAtt(id); if (!f) return;
  P.view = 'editor'; P.docId = id;
  if (LF.openSide && !panelVisible()) LF.openSide('docs');
  if (LF.sideEl && !LF.sideEl.classList.contains('side--wide') && innerWidth > 900) { setWide(true); P.wideByUs = true; }
  if (!(P.editor && P.editor.docId === id && P.editor.el.isConnected)) renderPanel();
  if (fresh && !isLocked(f.s)) setTimeout(() => { const t = P.el && P.el.querySelector('[data-dx="title"]'); if (t) { t.focus(); t.select(); } }, 60);
}
function backToList() {
  if (P.editor) P.editor.flush();
  P.view = 'list'; P.docId = null; P.editor = null;
  if (P.wideByUs) { setWide(false); P.wideByUs = false; }
  renderPanel();
}
function renderDoc() {
  const f = findAtt(P.docId);
  if (!f) { P.view = 'list'; renderPanel(); return; }
  const { a, s } = f, ro = isLocked(s), id = a.id;
  const wide = LF.sideEl && LF.sideEl.classList.contains('side--wide');
  P.el.innerHTML = `<div class="dx-doc" data-dx-panel>
  <div class="dx-dochead">
    <button type="button" class="pill dx-back" data-dx="back">${I.back}<span>Anhänge</span></button>
    <span class="dx-saved" aria-live="polite"></span>
    <button type="button" class="pill icon dx-widebtn" data-dx="wide" aria-pressed="${!!wide}" aria-label="${wide ? 'Schmaler' : 'Breiter'}" title="${wide ? 'Schmaler' : 'Breiter'}">${wide ? I.narrow : I.wide}</button>
    <button type="button" class="pill icon" data-dx="docmore" aria-haspopup="menu" aria-label="Weitere Aktionen" title="Exportieren und mehr">${I.dots}</button>
  </div>
  <div class="dx-docscroll">
    <input class="dx-doctitle" data-dx="title" value="${esc(a.name)}" placeholder="Ohne Titel" aria-label="Titel"${ro ? ' readonly' : ''} autocomplete="off">
    <div class="dx-docmeta"><span class="dx-mono">${esc(labelOf(s.id))}</span> ${esc(s.title || 'Ohne Titel')} · <span data-dx-upd>geändert ${esc(fmtDate(a.updatedAt || a.addedAt))}</span>${ro ? ' · nur lesen' : ''}</div>
    <div class="dx-docbody"></div>
  </div>
</div>`;
  const saved = P.el.querySelector('.dx-saved');
  let st;
  P.editor = createEditor(P.el.querySelector('.dx-docbody'), {
    get: () => { const g = findAtt(id); return g ? g.a.html || '' : ''; },
    set: h => { const g = findAtt(id); if (g) { g.a.html = h; g.a.updatedAt = Date.now(); } },
    onSaved: () => { saved.textContent = 'Gespeichert'; saved.classList.add('show'); clearTimeout(st); st = setTimeout(() => saved.classList.remove('show'), 1400); const u = P.el.querySelector('[data-dx-upd]'); if (u) u.textContent = 'geändert ' + fmtDate(Date.now()); },
    readOnly: ro, placeholder: PH_DOC, label: 'Dokument', toolbar: 'doc',
  });
  P.editor.docId = id;
  const title = P.el.querySelector('[data-dx="title"]');
  let tOrig = null;
  title.addEventListener('focus', () => { tOrig = (findAtt(id) || {}).a ? findAtt(id).a.name : null; });
  title.addEventListener('input', () => { const g = findAtt(id); if (g) { g.a.name = title.value; g.a.updatedAt = Date.now(); touch(); } });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); P.editor.focus(true); } });
  title.addEventListener('change', () => {
    const g = findAtt(id); if (!g || tOrig === null) return;
    const v = title.value.trim() || 'Ohne Titel', before = tOrig; tOrig = null;
    if (before === v) return;
    g.a.name = before;
    afterPointer(() => mut(() => { const h = findAtt(id); if (h) { h.a.name = v; h.a.updatedAt = Date.now(); } }));
  });
}

/* Panel-Ereignisse */
function bindPanel(el) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-dx]'); if (!b || !el.contains(b)) return;
    const tile = b.closest('.dx-tile'), id = tile && tile.dataset.id;
    switch (b.dataset.dx) {
      case 'open': openLB(P.list, P.list.findIndex(x => x.a.id === id)); break;
      case 'more': {
        if (id && id.startsWith('proc:')) { const sid = id.slice(5); openPop(b, [{ label: 'Ansehen', fn: () => openLB(P.list, P.list.findIndex(x => x.a.id === id)) }, { label: 'In der Karte bearbeiten', fn: () => { const slot = document.querySelector(`.step.is-focus .proc-slot[data-step="${CSS.escape(sid)}"] .dx-ed`); if (slot) slot.focus(); else toast('Öffne dazu den Schritt ' + labelOf(sid) + ' in der Zeitachse.'); } }, { label: 'Exportieren', sub: exportItems('Prozessbeschreibung ' + labelOf(sid), () => (getStep(sid) || {}).process || '') }]); break; }
        attMenu(b, id); break;
      }
      case 'add': addMenu(b); break;
      case 'filters': P.filtersOpen = !P.filtersOpen; renderPanel(); break;
      case 'scope-step': P.scope = (P.scope && getStep(P.scope)) ? P.scope : focusId(); P.userAll = false; renderPanel(); break;
      case 'scope-all': P.scope = null; P.userAll = true; renderPanel(); break;
      case 'type': P.type = b.dataset.v; renderPanel(); break;
      case 'when': P.when = b.dataset.v; renderPanel(); break;
      case 'reset': P.type = 'all'; P.when = 'all'; P.sort = 'new'; renderPanel(); break;
      case 'reset-all': P.type = 'all'; P.when = 'all'; P.q = ''; renderPanel(); break;
      case 'back': backToList(); break;
      case 'wide': { const on = !(LF.sideEl && LF.sideEl.classList.contains('side--wide')); setWide(on); P.wideByUs = on; b.setAttribute('aria-pressed', String(on)); b.innerHTML = on ? I.narrow : I.wide; b.title = on ? 'Schmaler' : 'Breiter'; break; }
      case 'docmore': {
        const f = findAtt(P.docId); if (!f) return;
        if (P.editor) P.editor.flush();
        const did = f.a.id, ro = isLocked(f.s);
        const items = [{ head: 'Exportieren' }, ...exportItems(() => (findAtt(did) || f).a.name, () => (findAtt(did) || f).a.html)];
        items.push({ sep: true }, { label: 'Groß ansehen', fn: () => openLBFor(did) });
        if (!ro) items.push({ label: 'Duplizieren', fn: () => duplicateAtt(did) }, { label: 'Zu Schritt verschieben …', fn: () => moveAtt(did) }, { sep: true }, { label: 'Löschen', danger: true, fn: () => removeAtt(did) });
        openPop(b, items);
        break;
      }
    }
  });
  el.addEventListener('input', e => { if (e.target.matches('[data-dx="q"]')) { P.q = e.target.value; renderGrid(); } });
  el.addEventListener('change', e => {
    if (e.target.matches('[data-dx="step"]')) { P.scope = e.target.value || null; P.userAll = !P.scope; renderPanel(); }
    if (e.target.matches('[data-dx="sort"]')) { P.sort = e.target.value; renderPanel(); }
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target.matches('[data-dx="q"]') && P.q) { e.stopPropagation(); P.q = ''; e.target.value = ''; renderGrid(); }
  });
  // Ziehen: Dateien hinein, Kacheln hinaus auf Schritte
  let depth = 0;
  const drop = el.querySelector.bind(el);
  el.addEventListener('dragstart', e => {
    const t = e.target.closest && e.target.closest('.dx-tile');
    if (!t) return;
    e.dataTransfer.setData('application/x-dx-att', t.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dx-dragging-att');
  });
  el.addEventListener('dragend', () => { document.body.classList.remove('dx-dragging-att'); clearStepMark(); });
  el.addEventListener('dragenter', e => { if (!hasFiles(e) || P.view !== 'list') return; depth++; const d = drop('.dx-drop'); if (d) { d.hidden = false; const t = targetStep(); d.querySelector('.dx-drop-t').textContent = t ? 'an Schritt ' + labelOf(t) : 'Schritt wird danach gewählt'; } });
  el.addEventListener('dragleave', () => { if (P.view !== 'list') return; depth = Math.max(0, depth - 1); if (!depth) { const d = drop('.dx-drop'); if (d) d.hidden = true; } });
  el.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = P.view === 'list' ? 'copy' : 'none'; } });
  el.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0;
    const d = drop('.dx-drop'); if (d) d.hidden = true;
    if (P.view !== 'list') return;
    const files = [...e.dataTransfer.files];
    const t = targetStep();
    if (t) addFiles(t, files); else chooseStep('An welchen Schritt anhängen?', null, id => addFiles(id, files), 'Anhängen');
  });
}

/* ---------- Schnellansicht (Lightbox) ---------- */
const LB = { el: null, list: [], i: 0, back: null };
function openLBFor(id) { const f = findAtt(id); if (!f) return; const inList = P.list.findIndex(x => x.a.id === id); if (inList >= 0) openLB(P.list, inList); else openLB([f], 0); }
function openEmbedded(fc) { openLB([{ a: { id: 'emb', type: 'file', name: fc.textContent.trim(), fileId: fc.getAttribute('data-file'), mime: fc.getAttribute('data-mime') || '' }, s: null }], 0); }
function openImage(img) {
  const id = img.getAttribute('data-file');
  if (id) openLB([{ a: { id: 'emb', type: 'file', name: img.alt || 'Bild', fileId: id, mime: 'image/*' }, s: null, url: img.src }], 0);
  else if (img.src) openLB([{ a: { id: 'emb', type: 'link', name: img.alt || 'Bild', url: img.src, img: true }, s: null }], 0);
}
function openLB(list, i) {
  if (!list || !list.length || i < 0) return;
  closePop();
  LB.list = list; LB.i = i;
  if (!LB.el) {
    LB.el = document.createElement('div');
    LB.el.className = 'dx-lb'; LB.el.hidden = true;
    LB.el.setAttribute('role', 'dialog'); LB.el.setAttribute('aria-modal', 'true'); LB.el.setAttribute('aria-label', 'Schnellansicht');
    document.body.appendChild(LB.el);
    LB.el.addEventListener('click', e => {
      const b = e.target.closest('[data-lb]');
      if (!b) { if (e.target === LB.el || e.target.classList.contains('dx-lb-stage')) closeLB(); return; }
      const cur = LB.list[LB.i];
      switch (b.dataset.lb) {
        case 'close': closeLB(); break;
        case 'prev': navLB(-1); break;
        case 'next': navLB(1); break;
        case 'dl': downloadAtt(cur.a); break;
        case 'tab': getUrl(cur.a.fileId, cur.a.mime).then(u => { if (u) window.open(u, '_blank', 'noopener'); }); break;
        case 'edit': closeLB(); openDoc(cur.a.id); break;
        case 'export': openPop(b, exportItems(cur.a.name, () => cur.a.html)); break;
        case 'more': attMenu(b, cur.a.id, 'lb'); break;
        case 'copy': copyText(cur.a.url); break;
      }
    });
  }
  if (LB.el.hidden) LB.back = document.activeElement;
  LB.el.hidden = false;
  document.body.classList.add('dx-lb-open');
  drawLB();
}
function closeLB() {
  if (!LB.el || LB.el.hidden) return;
  LB.el.hidden = true; LB.el.innerHTML = '';
  document.body.classList.remove('dx-lb-open');
  if (LB.back && LB.back.isConnected) LB.back.focus({ preventScroll: true });
}
function navLB(d) { if (LB.list.length < 2) return; LB.i = (LB.i + d + LB.list.length) % LB.list.length; haptic('tap'); drawLB(); }
function drawLB() {
  const { a, s } = LB.list[LB.i];
  const k = kindOf(a), n = LB.list.length, real = !!findAtt(a.id);
  const meta = [KIND_LABEL[k], a.type === 'file' ? fmtSize(a.size) : '', a.addedAt ? 'hinzugefügt ' + fmtDate(a.addedAt) : '', s ? 'Schritt ' + labelOf(s.id) : ''].filter(Boolean).join(' · ');
  const btn = (c, label, icon, cls) => `<button type="button" class="pill${cls ? ' ' + cls : ''}" data-lb="${c}"${icon && !label ? ` aria-label="${esc(c)}"` : ''}>${icon || ''}${label ? `<span>${label}</span>` : ''}</button>`;
  let acts = '';
  if (a.type === 'doc') { if (real && !isLocked(s)) acts += btn('edit', 'Bearbeiten'); acts += btn('export', 'Exportieren', I.download); }
  else if (a.type === 'link') { if (!a.img) acts += btn('copy', 'Kopieren'); acts += `<a class="pill primary" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${I.ext}<span>Öffnen</span></a>`; }
  else { if (k === 'pdf' || k === 'image' || k === 'text' || k === 'video' || k === 'audio') acts += `<button type="button" class="pill icon" data-lb="tab" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen">${I.ext}</button>`; acts += btn('dl', 'Herunterladen', I.download); }
  if (real) acts += `<button type="button" class="pill icon" data-lb="more" aria-haspopup="menu" aria-label="Weitere Aktionen" title="Mehr">${I.dots}</button>`;
  LB.el.innerHTML = `<div class="dx-lb-top">
    <div class="dx-lb-title"><b>${esc(a.name)}</b><span>${esc(meta)}${n > 1 ? ` · ${LB.i + 1} / ${n}` : ''}</span></div>
    <div class="dx-lb-acts">${acts}<button type="button" class="pill icon" data-lb="close" aria-label="Schließen (Esc)" title="Schließen (Esc)">${I.close}</button></div>
  </div>
  <div class="dx-lb-stage"><div class="dx-lb-body dx-lb-${k}"><div class="dx-lb-wait">Lädt …</div></div></div>
  ${n > 1 ? `<button type="button" class="dx-lb-nav prev" data-lb="prev" aria-label="Vorheriger Anhang (←)">${I.left}</button><button type="button" class="dx-lb-nav next" data-lb="next" aria-label="Nächster Anhang (→)">${I.right}</button>` : ''}`;
  const body = LB.el.querySelector('.dx-lb-body');
  const closeBtn = LB.el.querySelector('[data-lb="close"]');
  closeBtn.focus({ preventScroll: true });
  const token = {}; LB.token = token;
  const none = (msg) => { body.className = 'dx-lb-body dx-lb-none'; body.innerHTML = `<span class="dx-ext dx-ext-l">${esc(badgeOf(a))}</span><b>${esc(a.name)}</b><span>${msg}</span>${a.type === 'file' ? `<button type="button" class="pill primary" data-lb="dl">${I.download}<span>Herunterladen</span></button>` : ''}`; };
  if (a.type === 'link' && a.img) { body.innerHTML = `<img src="${esc(a.url)}" alt="${esc(a.name)}">`; return; }
  if (a.type === 'link') {
    body.className = 'dx-lb-body dx-lb-linkcard';
    body.innerHTML = `<span class="dx-lb-linkic">${I.link}</span><b>${esc(hostOf(a.url) || a.url)}</b><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" class="dx-lb-url">${esc(a.url)}</a><span class="dx-faint">Viele Seiten lassen sich nicht eingebettet anzeigen. „Öffnen“ zeigt sie in einem neuen Tab.</span>`;
    return;
  }
  if (a.type === 'doc') {
    body.className = 'dx-lb-body dx-lb-doc';
    body.innerHTML = `<article class="dx-prose dx-lb-article"><h1 class="dx-lb-doch">${esc(a.name)}</h1>${sanitize(a.html || '') || '<p class="dx-faint">Leeres Dokument</p>'}</article>`;
    const art = body.querySelector('article');
    hydrate(art, true);
    art.addEventListener('click', e => { const fc = e.target.closest('a.filecard'); if (fc) { e.preventDefault(); openEmbedded(fc); } });
    return;
  }
  getUrl(a.fileId, a.mime && a.mime !== 'image/*' ? a.mime : '').then(async u => {
    if (LB.token !== token) return;
    if (!u) { none('Die Datei ist auf diesem Gerät nicht vorhanden' + (cloud() ? ' und wurde in der Cloud nicht gefunden.' : '. Melde dich mit der Cloud an oder lade sie neu hoch.')); return; }
    if (k === 'image') body.innerHTML = `<img src="${esc(u)}" alt="${esc(a.name)}">`;
    else if (k === 'pdf') body.innerHTML = `<iframe src="${esc(u)}" title="${esc(a.name)}"></iframe>`;
    else if (k === 'video') body.innerHTML = `<video src="${esc(u)}" controls playsinline></video>`;
    else if (k === 'audio') body.innerHTML = `<audio src="${esc(u)}" controls></audio>`;
    else if (k === 'text') { const b = await getBlob(a.fileId); const t = b ? await b.text() : ''; if (LB.token !== token) return; if (/\.(md|markdown)$/i.test(a.name)) { body.className = 'dx-lb-body dx-lb-doc'; body.innerHTML = `<article class="dx-prose dx-lb-article">${sanitize(mdToHtml(t))}</article>`; } else body.innerHTML = `<pre class="dx-lb-pre">${esc(t)}</pre>`; }
    else none('Für diesen Dateityp gibt es keine Vorschau im Browser.');
  });
}

/* ---------- globale Ereignisse ---------- */
// Tastatur: Schnellansicht und Menüs zuerst (vor den Kürzeln der App)
addEventListener('keydown', e => {
  if (LB.el && !LB.el.hidden) {
    if (POP.el && !POP.el.hidden) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); closeLB(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navLB(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navLB(1); }
    else if (e.key === 'Tab') { const f = [...LB.el.querySelectorAll('button, a[href], iframe, video, audio')]; if (f.length) { const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } } return; }
    else if (e.key === 'Enter' || e.key === ' ') return;
    e.stopPropagation();
    return;
  }
  if (POP.el && !POP.el.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const bs = [...POP.el.querySelectorAll('button:not([disabled])')]; if (!bs.length) return;
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  }
}, true);

// Dateien auf die Fokus-Karte / auf Schritte ziehen; Kacheln auf Schritte ziehen (= verschieben)
let markRow = null;
function clearStepMark() { if (markRow) { markRow.classList.remove('dx-dropstep', 'dx-dropbad'); markRow = null; } }
function dropRow(e) {
  const row = e.target && e.target.closest && e.target.closest('.step');
  return row && row.dataset.id ? row : null;
}
document.addEventListener('dragover', e => {
  const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
  const files = types.includes('Files'), att = types.includes('application/x-dx-att');
  if (!files && !att) return;
  if (e.target.closest && e.target.closest('.dx-ed, [data-dx-panel]')) return;
  e.preventDefault();
  if (!att) { e.dataTransfer.dropEffect = 'none'; return; }   // Dateien nur im Seitenpanel anhängen
  const row = dropRow(e);
  if (row !== markRow) { clearStepMark(); if (row) { markRow = row; row.classList.add(isLocked(getStep(row.dataset.id)) ? 'dx-dropbad' : 'dx-dropstep'); } }
  e.dataTransfer.dropEffect = row && !isLocked(getStep(row.dataset.id)) ? (att ? 'move' : 'copy') : 'none';
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget || (markRow && !markRow.contains(e.relatedTarget))) clearStepMark(); });
document.addEventListener('drop', e => {
  const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
  const files = types.includes('Files'), att = types.includes('application/x-dx-att');
  if (!files && !att) return;
  if (e.target.closest && e.target.closest('.dx-ed, [data-dx-panel]')) return;
  e.preventDefault();
  clearStepMark();
  document.body.classList.remove('dx-dragging-att');
  if (!att) { toast('Dateien bitte im Seitenpanel „Unterlagen“ ablegen.', { label: 'Öffnen', fn: () => openAttach(focusId()) }); return; }
  const row = dropRow(e);
  if (!row) return;
  const sid = row.dataset.id;
  if (isLocked(getStep(sid))) { toast('Dieser Schritt ist schreibgeschützt.'); return; }
  moveAtt(e.dataTransfer.getData('application/x-dx-att'), sid);
});

// Einfügen außerhalb von Textfeldern: Dateien/Bilder → Anhang; Adresse im Panel → Link
document.addEventListener('paste', e => {
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, [contenteditable="true"], .dx-ed')) return;
  if ([...document.querySelectorAll('.overlay')].some(o => !o.hidden) || (LB.el && !LB.el.hidden)) return;
  const cd = e.clipboardData; if (!cd) return;
  const files = [...(cd.files || [])];
  const inPanel = panelVisible() && P.view === 'list';
  const sid = inPanel ? targetStep() : null;
  if (!files.length) {
    const txt = (cd.getData('text/plain') || '').trim();
    if (inPanel && /^https?:\/\/\S+$/.test(txt)) { e.preventDefault(); if (sid) addLink(sid, txt); else chooseStep('An welchen Schritt anhängen?', null, id => addLink(id, txt), 'Anhängen'); }
    return;
  }
  if (!inPanel) return;   // Anhänge nur im Seitenpanel
  e.preventDefault();
  if (sid) addFiles(sid, files); else chooseStep('An welchen Schritt anhängen?', null, id => addFiles(id, files), 'Anhängen');
});

/* ---------- Schnittstelle ---------- */
function openAttach(stepId) {
  if (stepId && getStep(stepId)) { P.scope = stepId; P.userAll = false; }
  if (P.view === 'editor') { if (P.editor) P.editor.flush(); P.view = 'list'; P.editor = null; if (P.wideByUs) { setWide(false); P.wideByUs = false; } }
  if (LF.openSide && !panelVisible()) LF.openSide('docs');
  renderPanel();
}
function onRender() {
  if (cloud()) retryUploads();
  if (!P.el) return;
  if (P.view === 'editor') {
    const f = findAtt(P.docId);
    if (!f) { backToList(); return; }
    const ed = P.editor && P.editor.el;
    if (ed && ed.isConnected) {
      const norm = x => { const h = sanitize(x || ''); return isEmptyHtml(h) ? '' : h; };
      if (document.activeElement !== ed && P.editor.html() !== norm(f.a.html)) { renderDoc(); return; }
      const ti = P.el.querySelector('[data-dx="title"]');
      if (ti && document.activeElement !== ti && ti.value !== f.a.name) ti.value = f.a.name;
      return;
    }
    renderDoc(); return;
  }
  if (P.el.contains(document.activeElement) && document.activeElement.matches('select')) return;
  renderPanel();
}
function processHTML(step) {
  if (!step || isEmptyHtml(step.process)) return '';
  const root = parseFrag(sanitize(step.process));
  root.querySelectorAll('img[data-file]').forEach(img => {
    const id = img.getAttribute('data-file');
    const u = urlCache.get(id);
    if (u) { img.setAttribute('src', u); img.removeAttribute('data-file'); }
    else { getUrl(id); img.remove(); }   // noch nicht geladen: für den nächsten Druck vormerken
  });
  root.querySelectorAll('a.filecard').forEach(a => a.replaceWith(root.ownerDocument.createTextNode('[Datei: ' + a.textContent + ']')));
  return root.innerHTML;
}
LF.docs = {
  mountPanel(el) { if (!el || P.el === el) return; P.el = el; bindPanel(el); renderPanel(); },
  mountProcess,
  onFocus(id) {
    if (id && !P.userAll && getStep(id)) P.scope = id;
    if (panelVisible() && P.view === 'list') renderPanel();
  },
  onRender,
  openAttach,
  newDoc(stepId) { const id = stepId || focusId() || targetStep(); if (id && getStep(id)) newDoc(id); else chooseStep('Dokument für welchen Schritt?', null, newDoc, 'Anlegen'); },
  attachCount: s => (s && Array.isArray(s.attachments) ? s.attachments.length : 0),
  processHTML,
  // für Tests/Fehlersuche
  _t: { sanitize, mdToHtml, htmlToMd, htmlToText, storeFile, getBlob, exportDoc, openLB, P },
};
// Bilder der Prozessbeschreibungen vorab laden, damit der Zeitachsen-PDF-Export sie sofort hat
setTimeout(() => { allSteps().forEach(s => { const m = String(s.process || '').match(/data-file="([\w-]+)"/g); if (m) m.forEach(x => getUrl(x.slice(11, -1))); }); }, 1500);


})();
