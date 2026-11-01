(() => {
'use strict';

/* ---------- Grundlagen ---------- */
const KEY = 'zeitachse.v1';
const MIN = 60000;
const STATUS = { open: 'Offen', doing: 'In Arbeit', done: 'Erledigt', paused: 'Unterbrochen' };
const SEG = ['open', 'doing', 'done'];  // Auswahl in der Fokus-Karte; „Unterbrochen“ entsteht über „Unterbrechen“
const NEXT = { open: 'doing', doing: 'done', done: 'open', paused: 'doing' };
// Schleifen: 1 Speedrun, 2 Fragen & Ideen nachgehen, 3 Qualitätscheck & Abgabe (Akzentfarbe je Schleife in styles.css)
const LOOPS = { 1: { name: 'Speedrun', hint: 'Einmal schnell durch. Ideen und Fragen nur notieren.' }, 2: { name: 'Fragen & Ideen', hint: 'Ideen und Fragen nachgehen, fehlende Schritte ergänzen.' }, 3: { name: 'Qualitätscheck & Abgabe', hint: 'Prüfen, abrunden, abgeben.' } };
// [Feld, Überschrift, Einzahl, Mehrzahl, Platzhalter]
const NOTES = [
  ['ideas', 'Ideen', 'Idee', 'Ideen', 'Was könnte man noch machen?'],
  ['questions', 'Fragen', 'Frage', 'Fragen', 'Was ist noch offen?'],
  ['learnings', 'Ergebnisse & Learnings', 'Learning', 'Learnings', 'Was kam raus, was hast du gelernt?'],
];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const str = v => (typeof v === 'string' ? v : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dayKey = ms => new Date(ms).toDateString();
const dayLabel = ms => {
  const d = new Date(ms);
  if (dayKey(ms) === dayKey(Date.now())) return 'Heute';
  if (dayKey(ms) === dayKey(Date.now() + 864e5)) return 'Morgen';
  if (dayKey(ms) === dayKey(Date.now() - 864e5)) return 'Gestern';
  return WD[d.getDay()] + ' ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
};
const toLocalInput = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const fromLocalInput = v => { if (!v) return null; const t = new Date(v).getTime(); return isNaN(t) ? null : t; };
const fmtDur = m => { m = Math.max(0, Math.round(m)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); };
const fmtWhen = ms => dayLabel(ms) + ' · ' + hm(ms);
const countLines = t => t.split('\n').filter(l => l.trim()).length;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const roundedNow = (offsetMin = 0) => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15 + offsetMin); return d; };

/* ---------- Datenmodell ---------- */
function curLoop() { try { return (typeof state !== 'undefined' && state && proj() && proj().loop) || 1; } catch (e) { return 1; } }
function newStep(p) {
  return Object.assign({ id: uid(), title: '', desc: '', at: null, dur: 30, status: 'open', startedAt: null, doneAt: null, prio: false, ideas: '', questions: '', learnings: '', process: '', attachments: [], worked: 0, pauses: [], log: [], loopAdded: curLoop(), children: [] }, p);
}
function newProject(title) {
  return normProject({ id: uid(), title: title || 'Neues Projekt', start: roundedNow(15).toISOString(), target: null, foldDone: true, inbox: [], created: Date.now(), steps: [newStep()] });
}
function normStep(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    id: str(s.id) || uid(),
    title: str(s.title), desc: str(s.desc),
    at: typeof s.at === 'string' && !isNaN(Date.parse(s.at)) ? s.at : null,
    dur: Number.isFinite(+s.dur) && +s.dur >= 0 ? Math.round(+s.dur) : 30,
    status: STATUS[s.status] ? s.status : 'open',
    startedAt: typeof s.startedAt === 'string' && !isNaN(Date.parse(s.startedAt)) ? s.startedAt : null,
    doneAt: typeof s.doneAt === 'string' && !isNaN(Date.parse(s.doneAt)) ? s.doneAt : null,
    prio: !!s.prio,
    ideas: str(s.ideas), questions: str(s.questions), learnings: str(s.learnings),
    process: str(s.process),
    attachments: Array.isArray(s.attachments) ? s.attachments.filter(a => a && typeof a === 'object' && a.id) : [],
    worked: Number.isFinite(+s.worked) && +s.worked > 0 ? +s.worked : 0,   // bereits gearbeitete Minuten (vor einer Unterbrechung)
    pauses: Array.isArray(s.pauses) ? s.pauses.filter(x => x && !isNaN(Date.parse(x.from))).map(x => ({ from: x.from, to: x.to && !isNaN(Date.parse(x.to)) ? x.to : null })) : [],
    log: Array.isArray(s.log) ? s.log.filter(x => x && typeof x.text === 'string').map(x => ({ at: str(x.at) || new Date().toISOString(), text: x.text, kind: str(x.kind) || 'zwischenstand' })) : [],
    loopAdded: [1, 2, 3].includes(+s.loopAdded) ? +s.loopAdded : 1,
    fromId: str(s.fromId) || null,
    children: Array.isArray(s.children) ? s.children.map(normStep) : [],
  };
}
function normProject(p) {
  p = p && typeof p === 'object' ? p : {};
  return {
    id: str(p.id) || uid(),
    title: str(p.title),
    start: typeof p.start === 'string' && !isNaN(Date.parse(p.start)) ? p.start : roundedNow().toISOString(),
    target: typeof p.target === 'string' && !isNaN(Date.parse(p.target)) ? p.target : null,
    foldDone: p.foldDone !== false,
    inbox: Array.isArray(p.inbox) ? p.inbox.filter(i => i && typeof i.text === 'string').map(i => ({ id: str(i.id) || uid(), text: i.text, at: str(i.at) || new Date().toISOString(), from: str(i.from) })) : [],
    loop: [1, 2, 3].includes(+p.loop) ? +p.loop : 1,
    loopStartedAt: str(p.loopStartedAt) || null,
    runs: Array.isArray(p.runs) ? p.runs.filter(r => r && typeof r === 'object') : [],   // archivierte Schleifen
    finished: str(p.finished) || null,
    folder: str(p.folder),            // Prozess-Schlüssel (mehrere Versionen gehören zusammen)
    folderId: str(p.folderId) || null, // Projektordner in der Projektverwaltung
    version: +p.version > 0 ? Math.round(+p.version) : 1,
    archived: !!p.archived,
    role: p.role === 'process' ? 'process' : 'run',   // Ausführung oder Prozess-Entwurf
    link: str(p.link) || null,        // Partner-Projekt (Ausführung ⇄ Prozess)
    created: +p.created || Date.now(),
    updatedAt: +p.updatedAt || 0,
    steps: Array.isArray(p.steps) ? p.steps.map(normStep) : [],
  };
}

function seed() {
  const p = {
    id: uid(), title: 'Erste Schritte', start: roundedNow(-30).toISOString(), target: null, foldDone: true, inbox: [], created: Date.now(), steps: [
      newStep({ title: 'Einen Schritt fokussieren', dur: 15, status: 'done',
        desc: 'Klicke auf einen Schritt. Er rückt nach vorn, die Schritte darüber und darunter werden unscharf. Esc oder ein Klick daneben beendet den Fokus.',
        learnings: 'Im Fokus sind alle Felder direkt bearbeitbar.' }),
      newStep({ title: 'Status setzen', dur: 30, status: 'doing', startedAt: roundedNow(-15).toISOString(),
        desc: 'Klick auf das Quadrat mit der Nummer wechselt den Status: Offen → In Arbeit → Erledigt.' }),
      newStep({ title: 'Zwischenschritte einfügen', dur: 20,
        desc: 'Fahre mit der Maus zwischen zwei Schritte und klicke auf das Plus. Beliebig viele. Nummern und Uhrzeiten rücken automatisch nach.' }),
      newStep({ title: 'In Teilschritte zerlegen', dur: 20,
        desc: 'Öffne die Teilschritte eines Schritts. Rechts erscheint eine eigene Zeitachse, die Übersicht über das ganze Projekt bleibt links stehen.',
        children: [
          newStep({ title: 'Teilschritte öffnen', dur: 10, desc: 'Im Fokus auf „Teilschritte“ klicken oder die Taste T drücken.' }),
          newStep({ title: 'Tiefer gehen', dur: 10, desc: 'Auch Teilschritte können eigene Teilschritte haben. Oben zeigt der Pfad, wo du gerade bist.' }),
        ] }),
      newStep({ title: 'Wichtiges hervorheben', dur: 15, prio: true,
        desc: '„Priorität“ lässt einen Schritt leuchten. So siehst du sofort, was zählt.' }),
      newStep({ title: 'Ideen, Fragen und Learnings notieren', dur: 20,
        desc: 'Jeder Schritt hat drei Notizfelder. Gefüllte Felder erscheinen als kleine Marken in der Übersicht.',
        ideas: 'Eine Zeile pro Idee', questions: 'Was ist noch nicht geklärt?' }),
      newStep({ title: 'Daten sichern', dur: 10,
        desc: 'Alles wird automatisch in diesem Browser gespeichert. Über ··· oben rechts speicherst du eine Sicherungsdatei.' }),
    ],
  };
  return { v: 1, projects: [normProject(p)], activeId: p.id, settings: { sound: true } };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.projects) && s.projects.length) {
      s.projects = s.projects.map(normProject);
      return s;
    }
  } catch (e) { /* leerer oder gesperrter Speicher */ }
  return null;
}

let state = load() || seed();
state.settings = Object.assign({ sound: true, remind: true, notify: false, coachMini: false }, state.settings);
if (!state.projects.some(p => p.id === state.activeId)) state.activeId = state.projects[0].id;
state.folders = Array.isArray(state.folders) ? state.folders.map(normFolder) : [];

let T = new Map();       // id → { start, end }
let LABELS = new Map();  // id → "3.2"
let STEPS = new Map();   // id → Schritt
const ui = { focus: null, path: [], trail: [], unfolded: new Set() };  // trail: zuletzt besuchte Tiefe (für „vor“)  // focus: { axis: 'main'|'sub', id }

const proj = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];

/* ---------- Speichern ---------- */
let saveTimer, savedTimer;
// Änderungsstempel je Projekt (für den Cloud-Abgleich): geändert → updatedAt = jetzt; gelöscht → Grabstein
const known = new Map();
const projJson = p => { const { updatedAt, ...rest } = p; return JSON.stringify(rest); };
function stamp() {
  const now = Date.now(), ids = new Set();
  state.tomb = state.tomb || {};
  for (const p of state.projects) {
    ids.add(p.id);
    const j = projJson(p);
    if (known.get(p.id) !== j) { known.set(p.id, j); p.updatedAt = now; delete state.tomb[p.id]; }
  }
  for (const id of [...known.keys()]) if (!ids.has(id)) { known.delete(id); state.tomb[id] = now; }
  const mj = JSON.stringify(state.folders || []);
  if (knownMeta !== mj) { if (knownMeta !== null) state.metaUpdatedAt = now; knownMeta = mj; }
}
let knownMeta = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.lastChange = Date.now();
    stamp();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      const el = $('#saved');
      el.textContent = 'Gespeichert';
      el.classList.add('show');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
      if (window.LF && LF.onSave) LF.onSave();
    } catch (e) {
      toast('Speichern im Browser nicht möglich. Bitte über ··· eine Sicherung exportieren.');
    }
  }, 250);
}

addEventListener('pagehide', () => { clearTimeout(saveTimer); try { stamp(); localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* gesperrt */ } });

/* ---------- Rückgängig ---------- */
let past = [], future = [], pendingSnap = null;
const snap = () => JSON.stringify({ projects: state.projects, activeId: state.activeId });
function pushHistory() { past.push(snap()); if (past.length > 120) past.shift(); future = []; }
function commitPending() { if (pendingSnap) { past.push(pendingSnap); if (past.length > 120) past.shift(); future = []; pendingSnap = null; } }
function restore(s) { const o = JSON.parse(s); state.projects = o.projects; state.activeId = o.activeId; save(); render(); }
function undo() {
  if (!past.length) { toast('Nichts zum Rückgängigmachen'); haptic('error'); return; }
  future.push(snap()); restore(past.pop()); haptic('soft'); toast('Rückgängig gemacht');
}
function redo() {
  if (!future.length) return;
  past.push(snap()); restore(future.pop()); haptic('soft'); toast('Wiederhergestellt');
}
function mutate(fn) {
  if (readOnly()) { toast('Archivierte Version: nur lesen.'); haptic('error'); return; }
  pushHistory(); fn(); save(); render();
}
// Rückgängig für genau diese Aktion (auch wenn danach noch etwas passiert ist)
function undoTo(before) { return () => { past.push(snap()); future = []; restore(before); haptic('soft'); toast('Wiederhergestellt'); }; }

/* ---------- Haptik ---------- */
let actx;
function haptic(kind = 'tap') {
  const vib = { tap: 8, soft: 5, strong: [10, 30, 14], done: [8, 40, 16], error: [20, 40, 20], warn: [30, 60, 30, 60, 30] }[kind];
  try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(vib); } catch (e) { /* Gerät ohne Vibration */ }
  if (!state.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const tones = { tap: [1500], soft: [1100], strong: [880, 1320], done: [990, 1480], error: [300, 240], warn: [740, 740, 560] }[kind];
    tones.forEach((f, i) => {
      const t = actx.currentTime + i * 0.07;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'soft' ? 0.035 : 0.06, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.08);
    });
  } catch (e) { /* kein Audio */ }
}
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/* ---------- Zeitplan ---------- */
const floorMin = ms => Math.floor(ms / MIN) * MIN;
const ceilMin = ms => Math.ceil(ms / MIN) * MIN;
// Plan folgt der Wirklichkeit: Laufende Schritte wachsen bis jetzt, Offenes beginnt frühestens jetzt,
// Erledigtes endet zum echten Zeitpunkt. Feste Startzeiten bleiben stehen.
// Pausen eines Schritts (Essenspause usw.) in ms, laufende Pause zählt bis jetzt
function pausedMs(s, now = Date.now()) {
  return (s.pauses || []).reduce((sum, x) => sum + Math.max(0, (x.to ? Date.parse(x.to) : now) - Date.parse(x.from)), 0);
}
// Restdauer in Minuten (nach Unterbrechung zählt nur, was noch fehlt)
const restDur = s => Math.max(0, (s.dur || 0) - (s.worked || 0));
let ACTIVE_END = 0;   // Ende der laufenden Aufgabe: offene Schritte reihen sich dahinter ein
function doingEnd(s) {
  const st = s.startedAt ? Date.parse(s.startedAt) : NaN;
  if (isNaN(st)) return 0;
  return Math.max(st + restDur(s) * MIN + pausedMs(s), ceilMin(Date.now()));
}
function schedule(steps, startMs) {
  const now = floorMin(Date.now());
  let cur = startMs;
  for (const s of steps) {
    const fixed = s.at ? Date.parse(s.at) : NaN;
    const planned = isNaN(fixed) ? cur : fixed;
    const overlap = !isNaN(fixed) && cur > fixed ? Math.round((cur - fixed) / MIN) : 0;
    let st, en, plan;
    if (s.children.length) {
      st = planned;
      en = schedule(s.children, st);
      st = Math.min(st, ...s.children.map(c => T.get(c.id).start));
      en = Math.max(st, en, ...s.children.map(c => T.get(c.id).end));
      plan = en;
    } else {
      const started = s.startedAt ? Date.parse(s.startedAt) : NaN;
      const dur = (s.dur || 0) * MIN;
      if (s.status === 'done') {
        const doneAt = s.doneAt ? Date.parse(s.doneAt) : NaN;
        if (isNaN(started)) {
          // ohne echten Start: Dauer laut Plan, endet beim Abhaken
          en = isNaN(doneAt) ? planned + dur : doneAt;
          st = Math.min(planned, en - dur);
        } else { st = started; en = isNaN(doneAt) ? st + dur : Math.max(st, doneAt); }
        plan = st + dur;
      } else if (s.status === 'doing') {
        st = isNaN(started) ? planned : started;
        plan = st + restDur(s) * MIN + pausedMs(s);
        en = Math.max(plan, ceilMin(Date.now()));
      } else {
        // offen oder unterbrochen: frühestens jetzt und erst nach der laufenden Aufgabe
        st = isNaN(fixed) ? Math.max(cur, now, ACTIVE_END) : fixed;
        en = plan = st + restDur(s) * MIN;
      }
    }
    T.set(s.id, { start: st, end: en, plan, overlap });
    cur = Math.max(cur, en);
  }
  return cur;
}
function number(steps, prefix) {
  steps.forEach((s, i) => { const l = prefix + (i + 1); LABELS.set(s.id, l); STEPS.set(s.id, s); number(s.children, l + '.'); });
}
function recompute() {
  const p = proj();
  T = new Map(); LABELS = new Map(); STEPS = new Map();
  ACTIVE_END = Math.max(0, ...leavesOf(p.steps).filter(s => s.status === 'doing').map(doingEnd));
  schedule(p.steps, Date.parse(p.start));
  number(p.steps, '');
}
function leavesOf(steps, out = []) { for (const s of steps) { if (s.children.length) leavesOf(s.children, out); else out.push(s); } return out; }
function allOf(steps, out = []) { for (const s of steps) { out.push(s); allOf(s.children, out); } return out; }
// gesperrt: Schritt stammt aus einer früheren Schleife oder das Projekt ist archiviert
const isLocked = s => !!(proj().archived || (s && s.loopAdded < proj().loop));
const readOnly = () => !!(proj().archived || proj().finished);   // archiviert oder Lauf abgeschlossen: nur lesen
function locate(id, steps = proj().steps) {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].id === id) return { step: steps[i], list: steps, index: i };
    const r = locate(id, steps[i].children);
    if (r) return r;
  }
  return null;
}
function tally(steps, acc = { n: 0, done: 0 }) {
  for (const s of steps) { acc.n++; if (s.status === 'done') acc.done++; tally(s.children, acc); }
  return acc;
}
function subParent() { return ui.path.length ? STEPS.get(ui.path[ui.path.length - 1]) : null; }
function axisSteps(key) { return key === 'sub' ? (subParent() || { children: [] }).children : proj().steps; }
function axisEl(key) { return key === 'sub' ? $('#subAxis') : $('#mainAxis'); }

/* ---------- Darstellung ---------- */
const ICON_LAYERS = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 4 6 6.5 1.5 4Z M1.5 6.5 6 9l4.5-2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
const ICON_LOCK = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="4.5" width="6" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><path d="M3.3 4.5V3.2a1.7 1.7 0 0 1 3.4 0v1.3" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
const ICON_CLIP = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8.5 4.5 5 8a1.4 1.4 0 0 1-2-2l4-4a2.3 2.3 0 0 1 3.3 3.3L6.2 9.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
const ICON_DOC = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8h5.2L11 4.6v7.6H3Z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M5.2 9.6 9.6 5.2l1.2 1.2-4.4 4.4H5.2Z" fill="currentColor" stroke="none"/></svg>';
const ICON_TRASH = '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M2 3.5h9M5 3.5V2h3v1.5M3.2 3.5l.6 7.5h5.4l.6-7.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const ICON_STOP = '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M3 11V2.2h6.2L8 4.4l1.2 2.2H3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const ICON_TOPROC = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="7.5" y="2" width="5" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1.5 7h5M4.5 4.8 6.7 7 4.5 9.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PAUSE_S = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5v7M8 2.5v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_MORE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="11" cy="7" r="1.2" fill="currentColor"/></svg>';
function attachCount(s) { return window.LF && LF.docs && LF.docs.attachCount ? LF.docs.attachCount(s) : (s.attachments || []).length; }
function chipsHTML(s) {
  const t = T.get(s.id);
  const real = Math.round((t.end - t.start) / MIN);
  const measured = !s.children.length && s.status === 'done' && s.doneAt && s.startedAt;
  const out = [];
  if (measured) out.push(`<span class="chip c-dur chip-real" title="Tatsächlich gebraucht">${fmtDur(real)} gebraucht</span>`, `<span class="chip">geplant ${fmtDur(s.dur)}</span>`);
  else out.push(`<span class="chip c-dur">${fmtDur(real)}</span>`);
  if (s.status === 'paused') out.push(`<span class="chip chip-paused">Unterbrochen · noch ${fmtDur(restDur(s))}</span>`);
  if (s.at) out.push('<span class="chip">feste Startzeit</span>');
  if (t.overlap) out.push(`<span class="chip chip-over">überschneidet sich um ${t.overlap} min</span>`);
  if (!s.children.length && s.status === 'doing' && t.end > t.plan) out.push(`<span class="chip chip-over">+${Math.max(1, Math.floor((Date.now() - t.plan) / MIN))} min über Plan</span>`);
  if (s.children.length) out.push(`<button class="chip chip-sub" data-act="sub" title="Teilschritte öffnen">${ICON_LAYERS}${s.children.length} Teilschritt${s.children.length > 1 ? 'e' : ''}</button>`);
  const ac = attachCount(s);
  if (ac) out.push(`<button class="chip" data-act="side-docs" title="Unterlagen öffnen">${ICON_CLIP}${ac}</button>`);
  if (s.log.length) out.push(`<span class="chip chip-log">Zwischenstand${s.log.length > 1 ? ' · ' + s.log.length : ''}</span>`);
  for (const [k, , one, many] of NOTES) {
    const n = countLines(s[k]);
    if (n) out.push(`<span class="chip chip-${k}"><i></i>${n} ${n === 1 ? one : many}</span>`);
  }
  if (proj().loop > 1 && s.loopAdded < proj().loop) out.push(`<span class="chip chip-lock" title="Aus einer früheren Schleife, Inhalt gesperrt">${ICON_LOCK}Schleife ${s.loopAdded}</span>`);
  else if (proj().loop > 1) out.push(`<span class="chip chip-new">neu in Schleife ${s.loopAdded}</span>`);
  return out.join('');
}
function compactHTML(s) {
  return `<h3 class="c-title">${s.title ? esc(s.title) : '<span class="ph">Ohne Titel</span>'}</h3>`
    + (s.desc ? `<p class="c-desc">${esc(s.desc)}</p>` : '')
    + `<div class="chips">${chipsHTML(s)}</div>`;
}
function logHTML(s) {
  if (!s.log.length) return '';
  return `<div class="zlog"><span class="note-h">Zwischenstand</span>${s.log.slice().reverse().map(x => `<div class="zlog-i"><span class="zlog-t">${esc(dayLabel(Date.parse(x.at)) + ' ' + hm(Date.parse(x.at)))}</span><span class="zlog-x">${esc(x.text)}</span></div>`).join('')}</div>`;
}
// Kleine, unscharfe Vorschau der Teilschritte-Zeitachse in der Karte; beim Überfahren scharf, Klick zoomt hinein
function zoomTabHTML(s) {
  const k = s.children;
  const rows = k.slice(0, 5).map(c => { const t = T.get(c.id); return `<span class="ma-row st-${c.status}"><i class="ma-sq">${LABELS.get(c.id)}</i><span class="ma-t">${esc(c.title || 'Ohne Titel')}</span><span class="ma-time">${t ? hm(t.start) : ''}</span></span>`; }).join('');
  return `<button class="mini-axis${k.length ? '' : ' empty'}" data-act="sub" title="${k.length ? 'In die Teilschritte zoomen (T)' : 'Teilschritte anlegen (T)'}">
    <span class="ma-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="ma-head"><span>${k.length ? `Teilschritte · ${k.length}` : 'Teilschritte'}</span><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <span class="ma-list">${rows || '<span class="ma-row ghost"><i class="ma-sq"></i><span class="ma-t">anlegen</span></span><span class="ma-row ghost"><i class="ma-sq"></i><span class="ma-t"></span></span>'}${k.length > 5 ? `<span class="ma-more">+ ${k.length - 5} weitere</span>` : ''}</span>
  </button>`;
}
function stepHTML(s) {
  const lab = LABELS.get(s.id);
  const kids = s.children.length;
  const locked = isLocked(s);
  const ro = locked ? ' readonly' : '';
  const cls = ['step', 'is-' + s.status, s.prio && 'is-prio', kids && 'has-kids', locked && 'is-locked', ui.path.includes(s.id) && 'sub-open'].filter(Boolean).join(' ');
  return `<article class="${cls}" data-id="${s.id}">
  <div class="time"><span class="t-date"></span><span class="t-start"></span><span class="t-end"></span></div>
  <div class="node"><button class="sq" data-act="cycle" title="Klicken: Status wechseln (${STATUS[s.status]})${locked ? '' : ' · Ziehen: verschieben'}" aria-label="Schritt ${lab}, ${STATUS[s.status]}. Klicken wechselt den Status.">${lab}</button></div>
  <div class="body">
    <div class="compact">${compactHTML(s)}</div>
    <div class="expanded">
      ${locked && !readOnly() ? `<p class="lock-note">${ICON_LOCK} Aus Schleife ${s.loopAdded}: Titel, Beschreibung und Prozessbeschreibung sind gesperrt. Notizen, Status und Zwischenschritte gehen.</p>` : ''}
      <textarea class="e-title" data-f="title" rows="1" placeholder="Titel des Schritts" aria-label="Titel"${ro}>${esc(s.title)}</textarea>
      <textarea class="e-desc" data-f="desc" rows="1" placeholder="Beschreibung: Was passiert in diesem Schritt?" aria-label="Beschreibung"${ro}>${esc(s.desc)}</textarea>
      <div class="notes">${NOTES.map(([k, h, , , ph]) => `
        <label class="note n-${k}"><span class="note-h">${h}${k !== 'learnings' && countLines(s[k]) && !readOnly() ? `<button class="note-act" data-act="to-steps" data-f="${k}" title="Zeilen als neue Schritte anlegen">→ Schritte</button>` : ''}</span><textarea data-f="${k}" rows="2" placeholder="${ph}"${readOnly() ? ' readonly' : ''}>${esc(s[k])}</textarea></label>`).join('')}
      </div>
      ${logHTML(s)}
      <button class="pill icon card-close" data-act="unfocus" aria-label="Schritt schließen" title="Schließen (Esc)"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
      ${zoomTabHTML(s)}
      <div class="tools">
        <div class="tool-row">
        <div class="seg" role="group" aria-label="Status">${SEG.map(v => `<button data-act="status" data-v="${v}" aria-pressed="${s.status === v}">${STATUS[v]}</button>`).join('')}</div>
        <button class="pill tg-prio" data-act="prio" aria-pressed="${s.prio}">Priorität</button>
        <label class="fld fld-dur" title="${kids ? 'Ergibt sich aus den Teilschritten' : 'Dauer in Minuten'}"><span>Dauer</span>${kids ? '' : '<button class="stp" data-act="dur" data-d="-5" aria-label="5 Minuten weniger">−</button>'}<input type="number" min="0" step="5" inputmode="numeric" data-f="dur" value="${s.dur}"${kids ? ' disabled' : ''}>${kids ? '' : '<button class="stp" data-act="dur" data-d="5" aria-label="5 Minuten mehr">+</button>'}<span class="unit">min</span></label>
        <button class="fld fld-btn" data-act="pick" data-target="step" title="Eine eigene Startzeit macht den Schritt fest. Folgende Schritte reihen sich dahinter ein."><span>Start</span><b class="fld-val"></b><svg class="cal-ic" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="1.5" y="2.5" width="10" height="9" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M1.5 5.5h10M4.5 1v3M8.5 1v3" stroke="currentColor" stroke-width="1.1"/></svg></button>
        <button class="pill" data-act="unfix" title="Startzeit wieder automatisch an den vorherigen Schritt hängen"${s.at ? '' : ' hidden'}>Zeit automatisch</button>
        </div>
        <div class="tool-row tool-icons-row">
        ${s.status === 'doing' ? `<button class="pill ic-l" data-act="break" title="Pause (B): Zeit hält an">${ICON_PAUSE_S}<span>${state.brk ? 'Fortsetzen' : 'Pause'}</span></button><button class="pill ic-l" data-act="interrupt" title="Unterbrechen mit Zwischenstand">${ICON_STOP}<span>Unterbrechen</span></button>` : ''}
        ${proj().role === 'run' && !readOnly() ? `<button class="pill icon" data-act="to-proc" title="${partnerOf(proj()) ? 'In Prozess übernehmen' : 'Prozess parallel gestalten'}" aria-label="${partnerOf(proj()) ? 'In Prozess übernehmen' : 'Prozess parallel gestalten'}">${ICON_TOPROC}</button>` : ''}
        <span class="tool-icons">
        <button class="pill icon" data-act="side-docs" aria-label="Unterlagen" title="Unterlagen: Anhänge, Links, Dokumente">${ICON_CLIP}</button>
        ${locked ? '' : `<button class="pill icon" data-act="new-doc" aria-label="Neues Dokument" title="Neues Dokument zu diesem Schritt">${ICON_DOC}</button>`}
        ${locked ? '' : `<button class="pill icon" data-act="card-menu" aria-label="Verschieben" title="Nach oben / unten">${ICON_MORE}</button>`}
        ${locked ? '' : `<button class="pill icon danger" data-act="del" aria-label="Schritt löschen" title="Schritt löschen">${ICON_TRASH}</button>`}
        </span>
        </div>
      </div>
      <div class="proc-slot" data-step="${s.id}"></div>
    </div>
  </div>
</article>`;
}
function gapHTML(i, total) {
  const label = i === 0 ? 'Schritt davor einfügen' : i === total ? 'Schritt anhängen' : 'Zwischenschritt einfügen';
  return `<div class="gap" data-index="${i}"><button class="ins" data-act="ins" data-index="${i}" aria-label="${label}"><span class="plus"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.3"/></svg></span><span class="lbl">${label}</span></button></div>`;
}
function foldHTML(steps, a, b) {
  const t0 = T.get(steps[a].id), t1 = T.get(steps[b].id);
  return `<button class="fold" data-act="unfold" data-ids="${steps.slice(a, b + 1).map(x => x.id).join(',')}" data-to="${b}" title="Erledigte Schritte anzeigen">
  <span class="fold-time">${hm(t0.start)}<br>${hm(t1.end)}</span>
  <span class="fold-node"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  <span class="fold-txt">${LABELS.get(steps[a].id)} – ${LABELS.get(steps[b].id)} erledigt <i>${b - a + 1} Schritte</i></span>
  <span class="fold-more">Anzeigen</span>
</button>`;
}
function axisHTML(steps, key) {
  let h = '<div class="rail" aria-hidden="true"><div class="rail-past"></div></div>'
    + '<div class="now" aria-hidden="true"><span class="now-label"></span><span class="now-dot"></span></div>';
  if (!steps.length) h += `<p class="empty">Noch keine Schritte${key === 'sub' ? ' in diesem Teil' : ''}.</p>`;
  const fold = proj().foldDone !== false;
  let i = 0;
  while (i < steps.length) {
    if (fold && !ui.unfolded.has(steps[i].id)) {
      let j = i;
      while (j < steps.length && steps[j].status === 'done' && !(ui.focus && ui.focus.id === steps[j].id) && !ui.path.includes(steps[j].id)) j++;
      if (j - i >= 2) { h += gapHTML(i, steps.length) + foldHTML(steps, i, j - 1); i = j; continue; }
    }
    h += gapHTML(i, steps.length) + stepHTML(steps[i]);
    i++;
  }
  h += `<div class="add-row"><button class="add-end" data-act="add"><span class="plus"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.3"/></svg></span>${key === 'sub' ? 'Teilschritt hinzufügen' : 'Schritt hinzufügen'}</button></div>`;
  return h;
}

function render() {
  hidePeek();
  recompute();
  const p = proj();
  $('#projName').textContent = p.title || 'Ohne Titel';
  document.title = (p.title ? p.title + ' · ' : '') + 'Lazerfocus';
  const pt = $('#pTitle');
  if (document.activeElement !== pt) pt.value = p.title;
  pt.readOnly = readOnly();
  document.documentElement.dataset.loop = p.loop;
  document.body.classList.toggle('ro', readOnly());
  $('#mainAxis').innerHTML = axisHTML(p.steps, 'main');
  renderSub();
  updateTimes();
  applyFocus(false);
  updateNav();
  updateCoach();
  renderRoleSwitch();
  renderSide();
}

function renderSub() {
  // Pfad prüfen (Schritte könnten gelöscht worden sein)
  let list = proj().steps;
  const chain = [];
  for (const id of ui.path) {
    const s = list.find(x => x.id === id);
    if (!s) break;
    chain.push(s); list = s.children;
  }
  ui.path = chain.map(s => s.id);
  const open = chain.length > 0;
  document.body.classList.toggle('has-sub', open);
  $('#colSub').hidden = !open;
  if (!open) { $('#subAxis').innerHTML = ''; if (ui.focus && ui.focus.axis === 'sub') ui.focus = null; return; }
  renderCrumbs();
  const par = chain[chain.length - 1];
  $('#zgNum').textContent = LABELS.get(par.id);
  $('#zoomGiant').className = 'zoom-giant is-' + par.status + (par.prio ? ' is-prio' : '');
  $('#subAxis').innerHTML = axisHTML(par.children, 'sub');
}
function renderCrumbs() {
  const chain = ui.path.map(id => STEPS.get(id));
  const last = chain[chain.length - 1];
  $('#crumbs').innerHTML = `<button data-act="crumb" data-i="-1">${esc(proj().title || 'Projekt')}</button>`
    + chain.map((s, i) => `<span class="sep">/</span><button data-act="crumb" data-i="${i}"${i === chain.length - 1 ? ' aria-current="true"' : ''}>${LABELS.get(s.id)} ${esc(s.title || 'Ohne Titel')}</button>`).join('');
  $('#subTitle').innerHTML = `<b>${LABELS.get(last.id)}</b>${last.title ? esc(last.title) : '<span style="color:var(--faint)">Ohne Titel</span>'}`;
}

function projectEnd() { const p = proj(); return p.steps.length ? Math.max(...p.steps.map(s => T.get(s.id).end)) : Date.parse(p.start); }
function renderHead() {
  const p = proj();
  $('#pStart .fld-val').textContent = fmtWhen(Date.parse(p.start));
  $('#pTarget .fld-val').textContent = p.target ? fmtWhen(Date.parse(p.target)) : 'keins';
  const end = projectEnd();
  let txt = p.steps.length ? 'Ende ' + (dayKey(end) !== dayKey(Date.parse(p.start)) ? dayLabel(end) + ' ' : '') + hm(end) : '';
  if (p.target && p.steps.length) {
    const diff = Math.round((end - Date.parse(p.target)) / MIN);
    txt += diff > 0 ? ` · <span class="warn">${fmtDur(diff)} über Ziel</span>` : ` · <span class="ok">${fmtDur(-diff)} Puffer</span>`;
  }
  $('#pEnd').innerHTML = txt;
  const doneN = p.steps.filter(s => s.status === 'done').length;
  const fb = $('#foldBtn');
  fb.setAttribute('aria-pressed', String(p.foldDone !== false));
  fb.querySelector('b').textContent = doneN;
  fb.hidden = doneN < 2;
  const lb = $('#loopBtn');
  lb.hidden = p.role === 'process';
  lb.className = 'chip-btn loop-btn l' + p.loop;
  lb.innerHTML = p.finished ? `<i class="loop-dot l3"></i>Lauf abgeschlossen` : `<i class="loop-dot l${p.loop}"></i>Schleife ${p.loop} · ${LOOPS[p.loop].name}`;
  const ab = $('#archBanner');
  ab.hidden = !readOnly();
  if (readOnly()) ab.innerHTML = `${ICON_LOCK} ${p.archived ? `Archivierte Version ${p.version}` : 'Lauf abgeschlossen'}${p.runs.length ? ` · ${p.runs.length} Schleife${p.runs.length > 1 ? 'n' : ''}` : ''} · nur lesen${p.finished && !p.archived ? ' · <button class="note-act" data-act="proj-version">Neue Prozessversion</button>' : ''}`;
  $('#roleTag').hidden = p.role !== 'process';
  $('#verTag').hidden = p.version < 2;
  $('#verTag').textContent = 'Version ' + p.version;
  const pb = $('#parkBtn');
  pb.hidden = !p.inbox.length;
  pb.querySelector('b').textContent = p.inbox.length;
}
function updateTimes() {
  recompute();
  const now = Date.now();
  for (const axis of [$('#mainAxis'), $('#subAxis')]) {
    let prev = null;
    for (const row of $$(':scope > .step', axis)) {
      const s = STEPS.get(row.dataset.id), t = T.get(row.dataset.id);
      if (!s || !t) continue;
      row.querySelector('.t-start').textContent = hm(t.start);
      row.querySelector('.t-end').textContent = hm(t.end);
      const dk = dayKey(t.start);
      row.querySelector('.t-date').textContent = prev !== dk ? dayLabel(t.start) : '';
      prev = dk;
      row.classList.toggle('is-past', t.end <= now);
      row.classList.toggle('is-now', t.start <= now && now < t.end);
      const pv = row.querySelector('[data-act="pick"] .fld-val');
      if (pv) pv.textContent = fmtWhen(t.start);
      const dur = row.querySelector('[data-f="dur"]');
      if (dur && document.activeElement !== dur) dur.value = s.children.length ? Math.round((t.end - t.start) / MIN) : s.dur;
      const unfix = row.querySelector('[data-act="unfix"]');
      if (unfix) unfix.hidden = !s.at;
      const cp = row.querySelector('.compact'), ch = compactHTML(s);
      if (cp._h !== ch) { cp.innerHTML = ch; cp._h = ch; }
    }
  }
  // Kopf
  const p = proj();
  renderHead();
  const tl = tally(p.steps);
  $('#pCount').textContent = `${tl.done} von ${tl.n} erledigt`;
  $('#pBar').style.width = tl.n ? (tl.done / tl.n * 100) + '%' : '0';
  const par = subParent();
  if (par) {
    const t = T.get(par.id);
    const st = tally(par.children);
    $('#subMeta').innerHTML = `<span>${hm(t.start)} – ${hm(t.end)}</span><span>${fmtDur((t.end - t.start) / MIN)}</span><span class="p-prog"><span>${st.done} von ${st.n} erledigt</span><span class="bar"><i style="width:${st.n ? st.done / st.n * 100 : 0}%"></i></span></span>`;
  }
  updateNow();
}

/* Rote Jetzt-Linie */
function updateNow() {
  const now = Date.now();
  for (const axis of [$('#mainAxis'), $('#subAxis')]) {
    const line = axis.querySelector('.now');
    if (!line) continue;
    const rows = $$(':scope > .step', axis);
    if (!rows.length || axis.offsetParent === null) { line.hidden = true; continue; }
    line.hidden = false;
    let top = null, outside = false;
    // Laufende Aufgabe hat Vorrang: die Linie geht mit ihr mit, auch wenn übersprungene Schritte davor stehen
    const run = rows.find(r => { const s = STEPS.get(r.dataset.id); return s && s.status === 'doing' && !s.children.length; });
    if (run) { const t = T.get(run.dataset.id); top = run.offsetTop + Math.min(1, Math.max(0, (now - t.start) / Math.max(1, t.end - t.start))) * run.offsetHeight; }
    for (let i = 0; i < rows.length && top === null; i++) {
      const t = T.get(rows[i].dataset.id);
      if (!t) continue;
      if (now < t.start) {
        if (i === 0) { top = rows[0].offsetTop + 2; outside = true; }
        else { const a = rows[i - 1].offsetTop + rows[i - 1].offsetHeight; top = (a + rows[i].offsetTop) / 2; }
      } else if (now < t.end) {
        top = rows[i].offsetTop + (now - t.start) / (t.end - t.start) * rows[i].offsetHeight;
      }
    }
    if (top === null) { const l = rows[rows.length - 1]; top = l.offsetTop + l.offsetHeight - 2; outside = true; }
    line.style.transform = `translateY(${top}px)`;
    for (const r of rows) {
      // Uhrzeit ausblenden, wenn das rote Label darüber liegt
      const tm = r.querySelector('.time'), ts = r.querySelector('.t-start');
      const td = r.querySelector('.t-date');
      const y0 = r.offsetTop + tm.offsetTop + (td.textContent ? td.offsetTop : 0), y1 = r.offsetTop + tm.offsetTop + ts.offsetTop + ts.offsetHeight;
      tm.classList.toggle('covered', top > y0 - 10 && top < y1 + 10);
    }
    for (const g of $$(':scope > .gap', axis)) g.classList.toggle('under-now', Math.abs(g.offsetTop + g.offsetHeight / 2 - top) < 14);
    line.classList.toggle('outside', outside);
    line.querySelector('.now-label').textContent = hm(now);
    const past = axis.querySelector('.rail-past');
    if (past) past.style.height = Math.max(0, top - past.parentNode.offsetTop) + 'px';
  }
}

/* ---------- Fokus ---------- */
function applyFocus(scroll) {
  if (ui.focus && !axisSteps(ui.focus.axis).some(s => s.id === ui.focus.id)) ui.focus = null;
  for (const axis of [$('#mainAxis'), $('#subAxis')]) {
    const key = axis.dataset.axis;
    const rows = $$(':scope > .step', axis);
    const fi = ui.focus && ui.focus.axis === key ? rows.findIndex(r => r.dataset.id === ui.focus.id) : -1;
    axis.classList.toggle('focusing', fi >= 0);
    rows.forEach((r, i) => {
      r.classList.toggle('is-focus', i === fi);
      r.style.setProperty('--d', fi >= 0 ? Math.abs(i - fi) : 0);
    });
    $$(':scope > .gap', axis).forEach(g => {
      const gi = +g.dataset.index;
      g.classList.toggle('near', fi >= 0 && (gi === fi || gi === fi + 1));
    });
    if (fi >= 0) {
      $$('textarea', rows[fi]).forEach(autosize);
      const slot = rows[fi].querySelector('.proc-slot');
      if (slot && !slot._mounted && window.LF && LF.docs && LF.docs.mountProcess) { slot._mounted = true; LF.docs.mountProcess(slot, rows[fi].dataset.id); }
      if (scroll) {
        // hohe Karten oben ausrichten, damit Titel und Felder sichtbar bleiben
        const col = axis.closest('.col');
        const free = col.clientHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--coach-h')) || 0) - 64;
        rows[fi].scrollIntoView({ block: rows[fi].offsetHeight > free ? 'start' : 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
    }
  }
  const fid = ui.focus ? ui.focus.id : null;
  if (fid !== lastFocusId) { lastFocusId = fid; if (window.LF && LF.docs && LF.docs.onFocus) LF.docs.onFocus(fid); }
  setTimeout(updateNow, 60);
  setTimeout(updateNow, 480);
}
let lastFocusId = null;
function setFocus(axis, id, opts = {}) {
  const changed = !ui.focus || ui.focus.id !== id;
  ui.focus = { axis, id };
  if (!axisEl(axis).querySelector(`.step[data-id="${id}"]`)) render();
  applyFocus(opts.scroll !== false);
  if (changed && !opts.silent) haptic('soft');
  if (opts.edit) {
    const row = axisEl(axis).querySelector(`.step[data-id="${id}"]`);
    const inp = row && row.querySelector('.e-title');
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 30);
  }
}
function clearFocus() {
  if (!ui.focus) return;
  ui.focus = null;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.step')) document.activeElement.blur();
  applyFocus(false);
}
function moveFocus(dir) {
  const key = ui.focus ? ui.focus.axis : 'main';
  const steps = axisSteps(key);
  if (!steps.length) return;
  let i = ui.focus ? steps.findIndex(s => s.id === ui.focus.id) : -1;
  if (i < 0) {
    const now = Date.now();
    const k = steps.findIndex(s => T.get(s.id).end > now);
    i = k < 0 ? steps.length - 1 : k;
  } else i = Math.min(steps.length - 1, Math.max(0, i + dir));
  setFocus(key, steps[i].id);
}
function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

/* ---------- Aktionen ---------- */
function insertAt(key, index) {
  const list = axisSteps(key);
  const s = newStep();
  mutate(() => list.splice(index, 0, s));
  const row = axisEl(key).querySelector(`.step[data-id="${s.id}"]`);
  if (row) row.classList.add('enter');
  haptic('strong');
  setFocus(key, s.id, { edit: true, silent: true });
}
function openSub(fromAxis, id) {
  if (!STEPS.get(id)) return;
  // Teilschritte öffnen = in die Übersicht der Teilschritte hineinzoomen (kein Fokus auf einen Teilschritt)
  goTo(fromAxis === 'sub' ? ui.path.concat(id) : [id]);
}
function closeSub() {
  if (!ui.path.length) return;
  goTo([]);
}
/* Waagerecht zwischen den Zeitachsen wechseln */
function navBack() {
  if (!ui.path.length) { haptic('error'); return; }
  goTo(ui.path.slice(0, -1));
}
function sqOf(axisKey, id) { return axisEl(axisKey).querySelector(`.step[data-id="${id}"] .sq`); }
// Ebene wechseln, mit Zoom-Animation: hinein = Quadrat wächst zum großen Eltern-Quadrat, heraus = umgekehrt
function goTo(newPath) {
  const old = ui.path.slice();
  if (newPath.length === old.length && newPath.every((x, i) => x === old[i])) return;
  const deeper = newPath.length > old.length;
  let from = null, label = '', status = 'open';
  if (deeper) {
    const id = newPath[newPath.length - 1];
    const sq = sqOf(old.length ? 'sub' : 'main', id);
    if (sq && sq.offsetParent) from = sq.getBoundingClientRect();
  } else if (!$('#colSub').hidden) {
    from = $('#zoomGiant').getBoundingClientRect();
    label = $('#zgNum').textContent;
    status = STEPS.get(old[old.length - 1]) ? STEPS.get(old[old.length - 1]).status : 'open';
  }
  if (deeper) {
    if (!newPath.every((x, i) => ui.trail[i] === x)) ui.trail = newPath.slice();
    const s = STEPS.get(newPath[newPath.length - 1]);
    label = LABELS.get(s.id); status = s.status;
  }
  ui.path = newPath;
  if (ui.focus && (ui.focus.axis === 'sub' || deeper)) ui.focus = null;
  render();
  $('#zoomScroll').scrollTop = 0;
  haptic(deeper ? 'strong' : 'soft');
  zoomAnim(deeper, old, newPath, from, label, status);
}
function fly(fromR, toR, label, status, ms) {
  const f = document.createElement('div');
  f.className = 'zoom-fly is-' + status;
  f.textContent = label;
  document.body.appendChild(f);
  const box = r => ({ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: Math.min(r.width, r.height) * .31 + 'px', fontSize: Math.max(12, r.height * .2) + 'px' });
  const a = f.animate([box(fromR), box(toR)], { duration: ms, easing: 'cubic-bezier(.65,0,.2,1)', fill: 'forwards' });
  a.onfinish = () => { f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }); };
  setTimeout(() => f.remove(), ms + 220);  // sicher aufräumen, auch wenn der Tab im Hintergrund ist
}
function zoomAnim(deeper, old, now, from, label, status) {
  if (reduceMotion.matches || !from || !Element.prototype.animate) return;
  const MS = 620, ease = 'cubic-bezier(.65,0,.2,1)';
  const giant = $('#zoomGiant'), zoom = $('#colSub'), content = $('#zoomScroll');
  const origin = r => `${r.left + r.width / 2}px ${r.top + r.height / 2 - $('#stageMain').getBoundingClientRect().top}px`;
  if (deeper) {
    const to = giant.getBoundingClientRect();
    giant.animate([{ opacity: 0 }, { opacity: 0, offset: .85 }, { opacity: 1 }], { duration: MS + 120 });
    fly(from, to, label, status, MS);
    if (!old.length) {
      // Hauptachse zoomt mit hinein und verschwindet
      const main = $('#colMain');
      main.style.transformOrigin = origin(from);
      main.animate([{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(2.6)', opacity: 0, filter: 'blur(6px)' }], { duration: MS, easing: ease });
      zoom.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MS * .7, easing: 'ease-out' });
    }
    content.style.transformOrigin = '0 0';
    content.animate([{ opacity: 0, transform: 'scale(.92) translateY(12px)' }, { opacity: 0, transform: 'scale(.92) translateY(12px)', offset: .35 }, { opacity: 1, transform: 'none' }], { duration: MS + 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  } else {
    // herauszoomen: großes Quadrat schrumpft auf seinen Platz in der übergeordneten Achse
    const key = now.length ? 'sub' : 'main';
    const sq = sqOf(key, old[now.length]);
    if (!sq) return;
    sq.closest('.step').scrollIntoView({ block: 'center' });
    const to = sq.getBoundingClientRect();
    fly(from, to, label, status, MS);
    sq.animate([{ opacity: 0 }, { opacity: 0, offset: .9 }, { opacity: 1 }], { duration: MS + 80 });
    const layer = now.length ? content : $('#colMain');
    layer.style.transformOrigin = origin(to);
    layer.animate([{ transform: 'scale(2.6)', opacity: 0, filter: 'blur(6px)' }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }], { duration: MS, easing: ease });
  }
}
function navForward() {
  const key = ui.path.length ? 'sub' : 'main';
  const list = axisSteps(key);
  const prefix = ui.path.every((x, i) => ui.trail[i] === x);
  let id = prefix ? ui.trail[ui.path.length] : null;
  if (!list.some(s => s.id === id)) id = null;
  if (!id && ui.focus && ui.focus.axis === key) {
    const f = STEPS.get(ui.focus.id);
    if (f && f.children.length) id = f.id;
  }
  if (!id) { const s = list.find(x => x.children.length); id = s && s.id; }
  if (!id) { haptic('error'); toast('Hier gibt es noch keine Teilschritte. Öffne einen Schritt und tippe auf „Teilschritte anlegen“.'); return; }
  openSub(key, id);
}
function updateNav() {
  const depth = ui.path.length;
  $('#navBack').disabled = !depth;
  $('#navLabel').textContent = depth ? 'Ebene ' + (depth + 1) + ' · ' + LABELS.get(ui.path[depth - 1]) : 'Hauptschritte';
  const prev = depth > 1 ? STEPS.get(ui.path[depth - 2]) : null;
  $('#backLabel').textContent = prev ? 'Zurück zu ' + LABELS.get(prev.id) : 'Zurück zu den Hauptschritten';
}

function moveStep(id, dir) {
  const L = locate(id);
  if (!L) return;
  if (isLocked(L.step)) { toast('Gesperrt: Schritt aus einer früheren Schleife.'); haptic('error'); return; }
  const j = L.index + dir;
  if (j < 0 || j >= L.list.length) { haptic('error'); return; }
  mutate(() => { L.list.splice(L.index, 1); L.list.splice(j, 0, L.step); });
  haptic('soft');
  applyFocus(true);
}
function deleteStep(id) {
  const L = locate(id);
  if (!L) return;
  if (isLocked(L.step)) { toast('Gesperrt: Schritt aus einer früheren Schleife.'); haptic('error'); return; }
  const before = snap();
  mutate(() => L.list.splice(L.index, 1));
  if (ui.focus && ui.focus.id === id) ui.focus = null;
  applyFocus(false);
  haptic('strong');
  const name = L.step.title ? `„${L.step.title.length > 32 ? L.step.title.slice(0, 32) + '…' : L.step.title}“` : 'Schritt';
  toast(`${name} gelöscht`, { label: 'Rückgängig', fn: undoTo(before) });
}
function applyStatus(s, v) {
  const iso = new Date().toISOString();
  if (v === 'doing') {
    if (!s.startedAt || s.status === 'open' || s.status === 'paused') { s.startedAt = iso; s.pauses = []; }
    if (s.status === 'open') s.worked = 0;
    s.doneAt = null;
    if (state.brk) s.pauses.push({ from: iso, to: null });
  } else if (v === 'done') { closePauses(s, iso); s.doneAt = iso; }
  else { s.startedAt = null; s.doneAt = null; s.worked = 0; s.pauses = []; }
  s.status = v;
}
// Zwischenstand nachtragen (z. B. nach automatischem Unterbrechen)
function addLog(id) {
  const s = STEPS.get(id);
  if (!s) return;
  openDialog({ title: 'Zwischenstand', body: `<p>Für <b>${esc(LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel'))}</b>: Was ist offen?</p><textarea class="park-in z-in" rows="5"></textarea>`,
    actions: [{ label: 'Abbrechen' }, { label: 'Speichern', cls: 'primary', fn: v => { if ((v || '').trim()) mutate(() => s.log.push({ at: new Date().toISOString(), text: v.trim(), kind: 'zwischenstand' })); } }] });
  setTimeout(() => { const t = $('#dialog textarea'); if (t) t.focus(); }, 30);
}
function cycle(id, el) {
  const s = STEPS.get(id);
  if (!s) return;
  const next = NEXT[s.status];
  let others = [];
  mutate(() => { if (next === 'doing') others = startStep(s); else applyStatus(s, next); });
  if (others.length) toast(`${others.map(o => LABELS.get(o.id)).join(', ')} unterbrochen`, { label: 'Zwischenstand', fn: () => addLog(others[0].id) });
  haptic(next === 'done' ? 'done' : 'tap');
  bump(document.querySelector(`.step[data-id="${id}"] .sq`) || el);
}
function setStatus(id, v) {
  const s = STEPS.get(id);
  if (!s || s.status === v) return;
  let others = [];
  mutate(() => { if (v === 'doing') others = startStep(s); else applyStatus(s, v); });
  if (others.length) toast(`${others.map(o => LABELS.get(o.id)).join(', ')} unterbrochen`, { label: 'Zwischenstand', fn: () => addLog(others[0].id) });
  haptic(v === 'done' ? 'done' : 'tap');
  bump(document.querySelector(`.step[data-id="${id}"] .sq`));
}
function togglePrio(id) {
  const s = STEPS.get(id);
  if (!s) return;
  mutate(() => { s.prio = !s.prio; });
  haptic(s.prio ? 'strong' : 'soft');
  bump(document.querySelector(`.step[data-id="${id}"] .sq`));
}

/* Projekte */
function switchProject(id) {
  if (id === state.activeId) return;
  state.activeId = id; ui.focus = null; ui.path = []; ui.trail = [];
  past = []; future = []; pendingSnap = null;
  save(); render(); haptic('soft');
  jumpToNow(false);
}
function createProject() {
  const p = newProject();
  p.folderId = proj().folderId || null;
  pushHistory();
  state.projects.push(p);
  state.activeId = p.id; ui.focus = null; ui.path = []; ui.trail = [];
  save(); render(); haptic('strong');
  const t = $('#pTitle');
  t.focus(); t.select();
}
function duplicateProject() {
  const src = proj();
  const copy = normProject(JSON.parse(JSON.stringify(src)));
  const reid = s => { s.id = uid(); s.children.forEach(reid); };
  copy.id = uid(); copy.title = src.title + ' (Kopie)'; copy.created = Date.now();
  copy.steps.forEach(reid);
  pushHistory();
  state.projects.push(copy);
  state.activeId = copy.id; ui.focus = null; ui.path = []; ui.trail = [];
  save(); render(); haptic('strong');
  toast('Projekt dupliziert');
}
function deleteProject() {
  const p = proj();
  const tl = tally(p.steps);
  openDialog({
    title: 'Projekt löschen?',
    body: `<p>„${esc(p.title || 'Ohne Titel')}“ mit ${tl.n} Schritt${tl.n === 1 ? '' : 'en'} wird gelöscht.</p><p>Direkt danach kannst du es über „Rückgängig“ zurückholen.</p>`,
    actions: [
      { label: 'Abbrechen' },
      { label: 'Löschen', cls: 'primary danger', fn: () => {
        const before = snap();
        pushHistory();
        state.projects = state.projects.filter(x => x.id !== p.id);
        if (!state.projects.length) state.projects.push(newProject());
        state.activeId = state.projects[0].id; ui.focus = null; ui.path = []; ui.trail = [];
        save(); render(); haptic('strong');
        toast('Projekt gelöscht', { label: 'Rückgängig', fn: undoTo(before) });
      } },
    ],
  });
}

/* Sichern & Laden */
function exportData() {
  const data = { app: 'zeitachse', version: 1, exported: new Date().toISOString(), projects: state.projects, folders: state.folders || [] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `zeitachse-sicherung-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  state.lastExport = Date.now(); save(); updateBackupChip();
  haptic('done');
  toast(`${state.projects.length} Projekt${state.projects.length === 1 ? '' : 'e'} als Datei gesichert`);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) {
      haptic('error'); toast('Die Datei ist keine gültige Sicherung (kein JSON).'); return;
    }
    const list = Array.isArray(data && data.projects) ? data.projects : (data && Array.isArray(data.steps) ? [data] : null);
    if (!list || !list.length) { haptic('error'); toast('In der Datei wurden keine Projekte gefunden.'); return; }
    const before = snap();
    pushHistory();
    const ids = new Set(state.projects.map(p => p.id));
    const reid = s => { s.id = uid(); s.children.forEach(reid); };
    const added = list.map(normProject).map(p => { if (ids.has(p.id)) p.id = uid(); p.steps.forEach(reid); return p; });
    state.projects.push(...added);
    if (Array.isArray(data.folders)) data.folders.map(normFolder).forEach(f => { if (!folderById(f.id)) state.folders.push(f); });
    state.activeId = added[0].id; ui.focus = null; ui.path = []; ui.trail = [];
    save(); render(); haptic('done');
    toast(`${added.length} Projekt${added.length === 1 ? '' : 'e'} geladen`, { label: 'Rückgängig', fn: undoTo(before) });
  };
  reader.onerror = () => { haptic('error'); toast('Die Datei konnte nicht gelesen werden.'); };
  reader.readAsText(file);
}

/* ---------- Menüs, Dialog, Toast ---------- */
function renderProjMenu() {
  const m = $('#projMenu');
  const groups = new Map();
  for (const p of state.projects) { const f = folderOf(p); if (!groups.has(f)) groups.set(f, []); groups.get(f).push(p); }
  ui.archOpen = ui.archOpen || new Set();
  const item = p => { const t = tally(p.steps); return `<button class="m-item${p.id === state.activeId ? ' active' : ''}" data-act="proj-open" data-pid="${p.id}"><span class="m-name">${esc(p.title || 'Ohne Titel')}</span>${p.role === 'process' ? '<span class="m-tag">Prozess</span>' : ''}${p.version > 1 ? `<span class="m-tag">v${p.version}</span>` : ''}<span class="m-sub">${t.done}/${t.n}</span></button>`; };
  let h = '<button class="m-item" data-act="home">Projektverwaltung … <span class="m-sub">Ordner</span></button><div class="m-sep"></div><span class="m-label">Projekte</span>';
  for (const [f, list] of groups) {
    const live = list.filter(p => !p.archived), arch = list.filter(p => p.archived).sort((a, b) => b.version - a.version);
    h += live.map(item).join('');
    if (arch.length) {
      const open = ui.archOpen.has(f);
      h += `<button class="m-item m-arch" data-act="arch-toggle" data-folder="${esc(f)}"><span class="m-name">Archiv · ${esc(f)}</span><span class="m-sub">${arch.length} ${open ? '▴' : '▾'}</span></button>`;
      if (open) h += arch.map(p => `<button class="m-item m-old${p.id === state.activeId ? ' active' : ''}" data-act="proj-open" data-pid="${p.id}"><span class="m-name">Version ${p.version}${p.role === 'process' ? ' · Prozess' : ''}</span><span class="m-sub">${p.runs.length} Schleife${p.runs.length === 1 ? '' : 'n'}</span></button>`).join('');
    }
  }
  const p = proj();
  m.innerHTML = h + '<div class="m-sep"></div>'
    + '<button class="m-item" data-act="proj-new">Neues Projekt</button>'
    + `<button class="m-item" data-act="proj-version">Neue Prozessversion <span class="m-sub">archiviert v${p.version}</span></button>`
    + (p.role === 'run' ? `<button class="m-item" data-act="proj-pair">${partnerOf(p) ? 'Zum Prozess-Entwurf' : 'Prozess parallel gestalten …'} <span class="m-sub">W</span></button>` : (partnerOf(p) ? '<button class="m-item" data-act="proj-pair">Zur Ausführung <span class="m-sub">W</span></button>' : ''))
    + '<button class="m-item" data-act="proj-dup">Projekt duplizieren</button>'
    + '<button class="m-item danger" data-act="proj-del">Projekt löschen …</button>';
}
function renderMoreMenu() {
  $('#moreMenu').innerHTML = '<span class="m-label">Daten</span>'
    + '<button class="m-item" data-act="export">Sicherung speichern <span class="m-sub">.json</span></button>'
    + '<button class="m-item" data-act="import">Sicherung laden …</button>'
    + `<button class="m-item" data-act="cloud">Cloud-Sync <span class="m-sub">${esc(window.LF && LF.label ? LF.label() : 'aus')}</span></button>`
    + `<span class="m-note">Zuletzt gesichert: ${state.lastExport ? dayLabel(state.lastExport) + ' ' + hm(state.lastExport) : 'noch nie'}</span>`
    + '<div class="m-sep"></div><span class="m-label">Projekt</span>'
    + '<button class="m-item" data-act="loop">Schleifen …</button>'
    + '<button class="m-item" data-act="report">Bericht: Ideen & Fragen …</button>'
    + '<button class="m-item" data-act="export-pdf">Zeitachse als PDF</button>'
    + `<button class="m-item" data-act="park-list">Parkplatz <span class="m-sub">${proj().inbox.length}</span></button>`
    + '<button class="m-item" data-act="park-new">Idee parken <span class="m-sub">I</span></button>'
    + '<div class="m-sep"></div><span class="m-label">Bedienung</span>'
    + `<button class="m-item" data-act="reminders">Erinnerungen … <span class="m-sub">${state.settings.remind ? (state.settings.notify ? 'an + System' : 'an') : 'aus'}</span></button>`
    + `<button class="m-item" data-act="sound">Klick-Ton <span class="m-sub">${state.settings.sound ? 'an' : 'aus'}</span></button>`
    + '<button class="m-item" data-act="undo">Rückgängig <span class="m-sub">⌘Z</span></button>'
    + '<button class="m-item" data-act="keys">Tastenkürzel <span class="m-sub">?</span></button>';
}
function toggleMenu(id, btn) {
  const m = $('#' + id);
  const willOpen = m.hidden;
  closeMenus();
  if (!willOpen) return;
  if (id === 'projMenu') renderProjMenu(); else renderMoreMenu();
  m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  haptic('soft');
}
function closeMenus() {
  $$('.menu').forEach(m => { m.hidden = true; });
  $$('[data-act="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

let dlgActions = [];
function openDialog({ title, body, actions }) {
  const d = $('#dialog');
  dlgActions = actions;
  d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgTitle"><h2 id="dlgTitle">${esc(title)}</h2><div class="dlg-body">${body}</div><div class="dlg-actions">${actions.map((a, i) => `<button class="pill ${a.cls || ''}" data-act="dlg" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  d.hidden = false;
  const last = d.querySelector('.dlg-actions button:last-child');
  if (last) last.focus();
}
function closeDialog() { $('#dialog').hidden = true; $('#dialog').innerHTML = ''; }
function showKeys() {
  const k = (keys, text) => `<dt>${keys.map(x => `<kbd>${x}</kbd>`).join('')}</dt><dd>${text}</dd>`;
  openDialog({
    title: 'Tastenkürzel',
    body: '<dl class="keys">'
      + k(['↑', '↓'], 'Vorheriger / nächster Schritt fokussieren')
      + k(['Enter'], 'Titel des fokussierten Schritts bearbeiten')
      + k(['N'], 'Neuer Schritt nach dem fokussierten')
      + k(['X'], 'Status wechseln')
      + k(['P'], 'Priorität an / aus')
      + k(['T'], 'Teilschritte öffnen')
      + k(['Alt', '↑'], 'Schritt nach oben schieben')
      + k(['Alt', '↓'], 'Schritt nach unten schieben')
      + k(['⌘/Strg', 'Z'], 'Rückgängig (⇧ für Wiederholen)')
      + k(['J'], 'Zur aktuellen Uhrzeit springen')
      + k(['I'], 'Idee parken, ohne den Schritt zu verlassen')
      + k(['B'], 'Pause / Fortsetzen (Zeit hält an)')
      + k(['W'], 'Wechsel Ausführung ⇄ Prozess')
      + k(['D'], 'Unterlagen ein/aus')
      + k(['←', '→'], 'Eine Ebene zurück / tiefer')
      + '<dt><kbd>Ziehen</kbd></dt><dd>Am Nummern-Quadrat: verschieben, auf einen Schritt: hineinlegen</dd>'
      + k(['Esc'], 'Fokus beenden, dann Teilschritte schließen')
      + '</dl>',
    actions: [{ label: 'Schließen', cls: 'primary' }],
  });
}

let toastTimer, toastFn = null;
function toast(msg, action) {
  const t = $('#toast');
  toastFn = action ? action.fn : null;
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button class="pill" data-act="toast">${esc(action.label)}</button>` : '');
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, action ? 6000 : 2600);
}

function jumpToNow(animate = true) {
  const line = $('#mainAxis .now');
  if (!line || line.hidden) return;
  const col = $('#colMain');
  const m = /translateY\(([-\d.]+)px\)/.exec(line.style.transform);
  const y = m ? +m[1] : 0;
  const axisTop = $('#mainAxis').getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
  col.scrollTo({ top: Math.max(0, axisTop + y - col.clientHeight / 2), behavior: animate && !reduceMotion.matches ? 'smooth' : 'auto' });
}

/* ---------- Kalender (eigener Datums- und Zeitwähler) ---------- */
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pk = { target: null, anchor: null, sel: 0, view: null };
function openPicker(anchor, target) {
  const p = proj();
  const cur = target.kind === 'project' ? Date.parse(p.start) : target.kind === 'target' ? (p.target ? Date.parse(p.target) : ceilMin(projectEnd() + 15 * MIN)) : (T.get(target.id) || {}).start;
  if (cur == null) return;
  if (pk.target && pk.anchor === anchor) { closePicker(); return; }
  pk.target = target; pk.anchor = anchor; pk.sel = cur;
  const d = new Date(cur); pk.view = new Date(d.getFullYear(), d.getMonth(), 1);
  closeMenus();
  renderPicker();
  $('#picker').hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  placePicker();
  haptic('soft');
}
function closePicker() {
  if (!pk.target) return;
  $('#picker').hidden = true;
  if (pk.anchor) { pk.anchor.setAttribute('aria-expanded', 'false'); if (pk.anchor.isConnected) pk.anchor.focus({ preventScroll: true }); }
  pk.target = null; pk.anchor = null;
}
function placePicker() {
  const el = $('#picker');
  if (innerWidth < 520) { el.style.left = el.style.top = ''; return; }  // als Blatt unten (CSS)
  el.style.maxHeight = ''; el.style.overflowY = '';
  const r = pk.anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  const below = innerHeight - r.bottom - 16, above = r.top - 16;
  // Seite mit mehr Platz wählen; reicht er nicht, scrollt der Kalender in sich – das Feld bleibt sichtbar
  const down = h <= below || below >= above;
  const space = down ? below : above;
  if (h > space) { el.style.maxHeight = space + 'px'; el.style.overflowY = 'auto'; }
  const top = down ? r.bottom + 8 : r.top - 8 - Math.min(h, space);
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
function renderPicker() {
  const sel = new Date(pk.sel), v = pk.view;
  const first = new Date(v.getFullYear(), v.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));  // Montag davor
  const today = dayKey(Date.now()), sk = dayKey(pk.sel);
  let days = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const cls = ['pk-d', d.getMonth() !== v.getMonth() && 'out', dayKey(d) === today && 'today', dayKey(d) === sk && 'sel'].filter(Boolean).join(' ');
    days += `<button class="${cls}" data-act="pk-day" data-ms="${d.getTime()}" aria-label="${d.getDate()}. ${MONTHS[d.getMonth()]}"${dayKey(d) === sk ? ' aria-pressed="true"' : ''}>${d.getDate()}</button>`;
  }
  const spin = (u, val, d) => `<div class="pk-spin"><button data-act="pk-step" data-u="${u}" data-d="${-d}" aria-label="weniger">−</button><input class="pk-in" data-u="${u}" inputmode="numeric" maxlength="2" value="${pad(val)}" aria-label="${u === 'h' ? 'Stunde' : 'Minute'}"><button data-act="pk-step" data-u="${u}" data-d="${d}" aria-label="mehr">+</button></div>`;
  const isStep = pk.target.kind === 'step';
  const isTarget = pk.target.kind === 'target';
  const fixed = (isStep && STEPS.get(pk.target.id) && STEPS.get(pk.target.id).at) || (isTarget && proj().target);
  $('#picker').innerHTML = `
    <div class="pk-head">
      <button class="pill icon" data-act="pk-prev" aria-label="Voriger Monat"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
      <span class="pk-month">${MONTHS[v.getMonth()]} <i>${v.getFullYear()}</i></span>
      <button class="pill icon" data-act="pk-next" aria-label="Nächster Monat"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
    </div>
    <div class="pk-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="pk-wd">${w}</span>`).join('')}${days}</div>
    <div class="pk-time">
      <span class="pk-lbl">Uhrzeit</span>
      ${spin('h', sel.getHours(), 1)}<span class="pk-colon">:</span>${spin('m', sel.getMinutes(), 5)}
      <button class="pill pk-now" data-act="pk-now">Jetzt</button>
    </div>
    <p class="pk-note">${isStep ? (fixed ? 'Feste Startzeit. Folgende Schritte reihen sich dahinter ein.' : 'Startet automatisch nach dem vorigen Schritt. Eine eigene Zeit macht ihn fest.') : isTarget ? 'Bis wann soll das Projekt fertig sein? Oben siehst du dann Puffer oder Verzug.' : 'Ab hier reihen sich alle Schritte des Projekts aneinander.'}</p>
    <div class="pk-actions">
      ${fixed ? `<button class="pill" data-act="pk-auto">${isTarget ? 'Kein Ziel' : 'Automatisch'}</button>` : ''}
      <span class="spacer"></span>
      <button class="pill" data-act="pk-cancel">Abbrechen</button>
      <button class="pill primary" data-act="pk-ok">Übernehmen</button>
    </div>`;
}
function pickerApply() {
  const t = pk.target, iso = new Date(pk.sel).toISOString();
  closePicker();
  if (!t) return;
  if (t.kind === 'project') mutate(() => { proj().start = iso; });
  else if (t.kind === 'target') mutate(() => { proj().target = iso; });
  else { const s = STEPS.get(t.id); if (!s) return; mutate(() => { s.at = iso; }); }
  haptic('done');
}
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.classList.contains('pk-in')) return;
  const v = parseInt(t.value, 10);
  if (isNaN(v)) return;
  const s = new Date(pk.sel);
  if (t.dataset.u === 'h') s.setHours(Math.min(23, Math.max(0, v))); else s.setMinutes(Math.min(59, Math.max(0, v)));
  pk.sel = s.getTime();
});
addEventListener('resize', () => { if (pk.target) placePicker(); });

/* ---------- Verschieben per Ziehen (am Nummern-Quadrat) ---------- */
const drag = { id: null, sx: 0, sy: 0, px: 0, py: 0, on: false, ghost: null, target: null, suppress: false };
const short = t => '„' + (t ? (t.length > 28 ? t.slice(0, 28) + '…' : t) : 'Ohne Titel') + '“';
const inSubtree = (step, list) => step.children === list || step.children.some(c => inSubtree(c, list));
document.addEventListener('pointerdown', e => {
  const sq = e.target.closest('.axis .sq');
  if (!sq || e.button !== 0) return;
  const st = STEPS.get(sq.closest('.step').dataset.id);
  if (!st || isLocked(st)) return;   // gesperrte Schritte (frühere Schleife) bleiben an ihrem Platz
  drag.id = st.id;
  drag.sx = drag.px = e.clientX; drag.sy = drag.py = e.clientY; drag.on = false;
});
addEventListener('pointermove', e => {
  if (!drag.id) return;
  drag.px = e.clientX; drag.py = e.clientY;
  if (!drag.on) {
    if (Math.hypot(drag.px - drag.sx, drag.py - drag.sy) < 6) return;
    startDrag();
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${drag.px + 14}px, ${drag.py - 18}px) rotate(-1.5deg)`;
  findDropTarget();
});
addEventListener('pointerup', () => { if (drag.on) endDrag(true); drag.id = null; });
addEventListener('pointercancel', () => { if (drag.on) endDrag(false); drag.id = null; });
// Nach dem Ziehen keinen Status-Klick auslösen
document.addEventListener('click', e => { if (drag.suppress) { drag.suppress = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);

function startDrag() {
  const s = STEPS.get(drag.id);
  if (!s) { drag.id = null; return; }
  drag.on = true;
  closePicker(); closeMenus();
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.innerHTML = `<span class="g-sq">${LABELS.get(s.id)}</span><span class="g-t">${esc(s.title || 'Ohne Titel')}</span>${s.children.length ? `<span class="g-sub">+ ${s.children.length} Teilschritt${s.children.length > 1 ? 'e' : ''}</span>` : ''}`;
  document.body.appendChild(g);
  drag.ghost = g;
  document.body.classList.add('dragging');
  $$(`.step[data-id="${s.id}"]`).forEach(r => r.classList.add('drag-src'));
  haptic('strong');
  requestAnimationFrame(autoScroll);
}
function clearDropMarks() { $$('.drop, .drop-into, .drop-bad').forEach(x => x.classList.remove('drop', 'drop-into', 'drop-bad')); }
function findDropTarget() {
  clearDropMarks();
  drag.target = null;
  const src = STEPS.get(drag.id);
  const el = document.elementFromPoint(drag.px, drag.py);
  if (!el || !src) return;
  let list = null, index = 0, mark = null, into = null;
  const crumb = el.closest('#crumbs [data-act="crumb"], .back-btn');
  const axis = el.closest('.axis');
  if (crumb) {
    let i = crumb.classList.contains('back-btn') ? ui.path.length - 2 : +crumb.dataset.i;
    list = i < 0 ? proj().steps : STEPS.get(ui.path[i]).children;
    index = list.length; mark = crumb; into = i < 0 ? 'die Hauptschritte' : short(STEPS.get(ui.path[i]).title);
  } else if (axis) {
    const key = axis.dataset.axis;
    const steps = axisSteps(key);
    const rows = $$(':scope > .step', axis);
    const row = el.closest('.step');
    if (row && row.dataset.id !== drag.id && el.closest('.body')) {
      const r = row.getBoundingClientRect(), rel = (drag.py - r.top) / r.height;
      if (rel > .3 && rel < .7) {
        const host = STEPS.get(row.dataset.id);
        list = host.children; index = list.length; mark = row; into = short(host.title);
        row.classList.add(host === src || inSubtree(src, list) || isLocked(host) ? 'drop-bad' : 'drop-into');
        if (isLocked(host)) { drag.target = null; return; }
      }
    }
    if (!list) {
      list = steps;
      index = 0;
      for (const it of $$(':scope > .step, :scope > .fold', axis)) {
        const b = it.getBoundingClientRect();
        if (b.top + b.height / 2 < drag.py) index = (it.classList.contains('fold') ? +it.dataset.to : steps.findIndex(x => x.id === it.dataset.id)) + 1;
      }
      mark = index < steps.length ? axis.querySelector(`:scope > .gap[data-index="${index}"]`) : axis.querySelector('.add-row');
    }
  }
  if (!list) return;
  const bad = list.some(x => x.id === src.id) ? false : inSubtree(src, list);
  if (mark && !mark.classList.contains('drop-into') && !mark.classList.contains('drop-bad')) mark.classList.add(bad ? 'drop-bad' : 'drop');
  if (!bad) drag.target = { list, index, into };
}
function autoScroll() {
  if (!drag.on) return;
  for (const col of $$('.col')) {
    if (col.hidden) continue;
    const r = col.getBoundingClientRect();
    if (drag.px < r.left || drag.px > r.right) continue;
    const edge = 70;
    let dy = 0;
    if (drag.py < r.top + edge) dy = -(r.top + edge - drag.py) / 4;
    else if (drag.py > r.bottom - edge) dy = (drag.py - (r.bottom - edge)) / 4;
    if (dy) { col.scrollTop += dy; findDropTarget(); }
  }
  requestAnimationFrame(autoScroll);
}
function endDrag(commit) {
  drag.on = false;
  drag.suppress = true;
  setTimeout(() => { drag.suppress = false; }, 80);
  if (drag.ghost) drag.ghost.remove();
  drag.ghost = null;
  document.body.classList.remove('dragging');
  $$('.drag-src').forEach(r => r.classList.remove('drag-src'));
  clearDropMarks();
  const t = drag.target;
  drag.target = null;
  if (!commit || !t) { haptic('soft'); return; }
  const L = locate(drag.id);
  if (!L) return;
  let index = t.index;
  if (L.list === t.list && (index === L.index || index === L.index + 1)) { haptic('soft'); return; }
  const before = snap();
  const id = drag.id;
  mutate(() => {
    L.list.splice(L.index, 1);
    if (L.list === t.list && index > L.index) index--;
    t.list.splice(index, 0, L.step);
  });
  haptic('done');
  const row = document.querySelector(`.step[data-id="${id}"]`);
  if (row) row.classList.add('enter');
  toast(t.into ? `Verschoben in ${t.into}` : 'Verschoben', { label: 'Rückgängig', fn: undoTo(before) });
}

/* ---------- Lenkung: Jetzt-Leiste & Erinnerungen ---------- */
// Meilensteine eines laufenden Schritts, gemessen an seiner geplanten Dauer ab dem echten Start
const MILESTONES = [
  { key: 'start', f: 0, minDur: 0, title: 'Los geht’s', msg: 'Ziel im Blick behalten, Details später.' },
  { key: 'third', f: 1 / 3, minDur: 15, title: 'Ein Drittel ist um', msg: 'Liegst du im Plan? Bleib beim Kern.' },
  { key: 'half', f: 1 / 2, minDur: 6, title: 'Halbzeit', msg: 'Konzentrier dich aufs Ergebnis, nicht auf Details.' },
  { key: 'twothird', f: 2 / 3, minDur: 15, title: 'Noch ein Drittel', msg: 'Fang nichts Neues mehr an.' },
  { key: 'quarter', f: 3 / 4, minDur: 10, title: 'Noch ein Viertel', msg: 'Zeit, abzurunden.' },
  { key: 'final', f: null, minDur: 5, title: '', msg: 'Abschließen und Ergebnis notieren.' },
  { key: 'end', f: 1, minDur: 0, title: 'Geplante Zeit ist um', msg: 'Erledigt markieren oder bewusst verlängern.' },
];
// Letzte Warnung: 10 % der Dauer vor Schluss, mindestens 1, höchstens 10 Minuten
const finalMinutes = dur => Math.min(10, Math.max(1, Math.round(dur * 0.1)));
const OVER_EVERY = 15;  // Minuten zwischen Nachfragen, wenn ein Schritt über Plan läuft
function leaves(steps, out = []) { for (const s of steps) { if (s.children.length) leaves(s.children, out); else out.push(s); } return out; }
function currentLeaf(now) {
  const L = leaves(proj().steps);
  return L.find(s => s.status === 'doing' && T.get(s.id).start <= now)
    || L.find(s => { const t = T.get(s.id); return s.status === 'open' && t.start <= now && now < t.end; })
    || null;
}
function nextLeaf(now, exceptId) {
  return leaves(proj().steps).filter(s => (s.status === 'open' || s.status === 'paused') && s.id !== exceptId && T.get(s.id).start > now - MIN)
    .sort((a, b) => T.get(a.id).start - T.get(b.id).start)[0] || null;
}
function milestoneTimes(s) {
  const t = T.get(s.id), dur = (t.plan - t.start) / MIN;
  return MILESTONES.filter(m => dur >= m.minDur && (m.key !== 'final' || dur >= 5)).map(m => {
    if (m.key === 'final') { const n = finalMinutes(dur); return Object.assign({}, m, { at: t.plan - n * MIN, title: `Noch ${n} Minute${n === 1 ? '' : 'n'}` }); }
    return Object.assign({}, m, { at: t.start + m.f * (t.plan - t.start) });
  }).filter((m, i, arr) => !(m.key === 'quarter' && arr.some(x => x.key === 'final' && x.at - m.at < 2 * MIN)));
}
function phaseOf(s, now) {
  const t = T.get(s.id), dur = t.plan - t.start;
  if (now >= t.plan) return 'over';
  if (now >= t.plan - finalMinutes(dur / MIN) * MIN) return 'final';
  if (dur > 0 && (now - t.start) / dur >= .75) return 'late';
  return 'calm';
}

let fired = {};
try { fired = JSON.parse(localStorage.getItem('zeitachse.fired')) || {}; } catch (e) { fired = {}; }
function markFired(k) {
  fired[k] = Date.now();
  for (const x in fired) if (Date.now() - fired[x] > 3 * 864e5) delete fired[x];
  try { localStorage.setItem('zeitachse.fired', JSON.stringify(fired)); } catch (e) { /* egal */ }
}
let coachAlert = null, coachAlertTimer;
function checkReminders() {
  if (!state.settings.remind || state.brk || readOnly()) return;
  const now = Date.now();
  const s = currentLeaf(now);
  if (!s) return;
  const t = T.get(s.id);
  if (s.status === 'open') {
    const k = `${s.id}|prompt|${dayKey(now)}`;
    if (!fired[k]) { markFired(k); remind(s, { key: 'start', title: 'Jetzt dran', msg: 'Tippe auf „Starten“, dann läuft die Zeit.' }); }
    return;
  }
  const base = `${s.id}|${t.start}|${s.dur}|`;
  for (const m of milestoneTimes(s)) {
    const k = base + m.key;
    if (fired[k] || now < m.at) continue;
    markFired(k);
    if (now - m.at > 3 * MIN) continue;  // zu alt, still überspringen
    remind(s, m);
  }
  if (now >= t.plan + OVER_EVERY * MIN) {
    const n = Math.floor((now - t.plan) / (OVER_EVERY * MIN));
    const k = base + 'over' + n;
    if (!fired[k]) { markFired(k); remind(s, { key: 'over', title: `${n * OVER_EVERY} min über Plan`, msg: 'Abschließen oder bewusst verlängern.' }); }
  }
}
function remind(s, m) {
  const label = LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel');
  coachAlert = { id: s.id, key: m.key, title: m.title, msg: m.msg };
  clearTimeout(coachAlertTimer);
  coachAlertTimer = setTimeout(() => { coachAlert = null; updateCoach(); }, 12000);
  const coach = $('#coach');
  coach.classList.remove('ping'); void coach.offsetWidth; coach.classList.add('ping');
  updateCoach();
  haptic(['final', 'end', 'over'].includes(m.key) ? 'warn' : m.key === 'start' ? 'done' : 'strong');
  const away = document.hidden || !document.hasFocus();
  if (state.settings.notify && away && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(m.title, { body: `${label}\n${m.msg}`, tag: 'zeitachse', renotify: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* Browser ohne Mitteilungen im Fenster */ }
  }
}

const ICON_PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5v7M8 2.5v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_PARK = '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><path d="M6.5 1.5a3.5 3.5 0 0 0-2 6.4V9.5h4V7.9a3.5 3.5 0 0 0-2-6.4ZM5 11.5h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
function updateCoach() {
  const c = $('#coach');
  if (!c) return;
  const now = Date.now();
  const s = currentLeaf(now);
  const nx = s ? null : nextLeaf(now);
  const mini = !!state.settings.coachMini && !coachAlert;
  c.classList.toggle('mini', mini);
  if (!s && !nx && !state.brk) { c.hidden = true; c._html = ''; document.documentElement.style.setProperty('--coach-h', '0px'); return; }
  if (readOnly() || proj().role === 'process') { c.hidden = true; c._html = ''; document.documentElement.style.setProperty('--coach-h', '0px'); return; }
  c.hidden = false;
  const park = `<button class="pill icon" data-act="coach-park" title="Idee parken (I)" aria-label="Idee parken">${ICON_PARK}</button>`;
  let html = '', pillTxt = '';
  if (state.brk) {
    const mins = Math.floor((now - Date.parse(state.brk.from)) / MIN);
    c.dataset.phase = 'break';
    pillTxt = `Pause ${mins} min`;
    html = `<div class="c-row">
      <span class="c-sq c-sq-break">${ICON_PAUSE}</span>
      <div class="c-main"><span class="c-eyebrow">Pause</span><span class="c-title">${s && s.status === 'doing' ? 'Danach weiter mit ' + esc(LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel')) : 'Die Zeitachse wartet'}</span></div>
      <div class="c-left"><b>${mins}</b><span>min Pause</span></div>
    </div>
    <div class="c-foot"><span class="c-msg">Die Zeit der Aufgabe steht still. Folgende Schritte rücken nach.</span><span class="c-actions"><button class="pill primary" data-act="coach-break">Fortsetzen</button></span></div>`;
  } else if (s && s.status === 'doing') {
    const t = T.get(s.id), total = Math.max(MIN, t.plan - t.start), f = Math.min(1, (now - t.start) / total);
    const ph = phaseOf(s, now);
    c.dataset.phase = ph;
    const ms = milestoneTimes(s).filter(m => m.f !== 0 && m.f !== 1);
    const alert = coachAlert && coachAlert.id === s.id ? coachAlert : null;
    const over = Math.floor((now - t.plan) / MIN);
    const left = Math.ceil((t.plan - now) / MIN);
    pillTxt = ph === 'over' ? `+${over} min` : `${left} min`;
    html = `<div class="c-row">
      <span class="c-sq is-doing">${LABELS.get(s.id)}</span>
      <div class="c-main"><span class="c-eyebrow">${alert ? esc(alert.title) : ph === 'over' ? 'Über Plan' : 'Läuft'}</span><span class="c-title">${esc(s.title || 'Ohne Titel')}</span></div>
      <div class="c-left">${ph === 'over' ? `<b>+${over}</b><span>min über Plan</span>` : `<b>${left}</b><span>min übrig</span>`}</div>
    </div>
    <div class="c-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}" aria-label="Verstrichene Zeit"><i style="width:${f * 100}%"></i>${ms.map(m => `<span class="tick${now >= m.at ? ' past' : ''}" style="left:${(m.at - t.start) / total * 100}%" title="${esc(m.title)}"></span>`).join('')}</div>
    <div class="c-foot">
      <span class="c-msg">${alert ? esc(alert.msg) : coachHint(s, f, ph)}</span>
      <span class="c-actions">${park}<button class="pill icon" data-act="coach-break" title="Pause (B): Zeit anhalten" aria-label="Pause">${ICON_PAUSE}</button><button class="pill icon" data-act="interrupt" data-id="${s.id}" title="Unterbrechen mit Zwischenstand" aria-label="Unterbrechen">${ICON_STOP}</button><button class="pill icon" data-act="coach-menu" data-id="${s.id}" title="Verlängern, öffnen" aria-label="Weitere Aktionen">${ICON_MORE}</button><button class="pill c-done" data-act="coach-done" data-id="${s.id}">Erledigt</button></span>
    </div>`;
  } else {
    const n = s || nx, t = T.get(n.id);
    c.dataset.phase = 'idle';
    pillTxt = s ? 'jetzt' : 'ab ' + hm(t.start);
    html = `<div class="c-row">
      <span class="c-sq is-${n.status}">${LABELS.get(n.id)}</span>
      <div class="c-main"><span class="c-eyebrow">${n.status === 'paused' ? 'Unterbrochen · fortsetzen?' : s ? 'Jetzt dran' : 'Als Nächstes · ' + hm(t.start)}</span><span class="c-title">${esc(n.title || 'Ohne Titel')}</span></div>
      <div class="c-left">${s ? `<b>${Math.round((t.end - t.start) / MIN)}</b><span>min geplant</span>` : `<b>${fmtCount(t.start - now)}</b><span>bis Start</span>`}</div>
    </div>
    <div class="c-foot"><span class="c-msg">${n.log.length ? 'Zwischenstand: ' + esc(n.log[n.log.length - 1].text.slice(0, 90)) : s ? 'Starte den Schritt, dann läuft die Uhr.' : 'Pause oder Vorbereitung.'}</span><span class="c-actions">${park}<button class="pill" data-act="coach-open" data-id="${n.id}">Öffnen</button><button class="pill primary" data-act="coach-start" data-id="${n.id}">${s ? 'Starten' : 'Jetzt starten'}</button></span></div>`;
  }
  const n = s || nx || { id: '', status: 'open' };
  html += `<button class="c-min" data-act="coach-mini" aria-label="${mini ? 'Leiste aufklappen' : 'Leiste einklappen'}" title="${mini ? 'Aufklappen' : 'Einklappen'}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${mini ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>`
    + `<button class="c-pill" data-act="coach-mini" aria-label="Leiste aufklappen"><span class="c-sq is-${n.status}">${state.brk ? ICON_PAUSE : LABELS.get(n.id) || ''}</span><b>${pillTxt}</b></button>`;
  // nur neu schreiben, wenn sich etwas geändert hat (verhindert Flackern der Knöpfe)
  if (c._html !== html) { c.innerHTML = html; c._html = html; }
  document.documentElement.style.setProperty('--coach-h', c.offsetHeight + 'px');
}
function fmtCount(ms) { const m = Math.max(1, Math.ceil(ms / MIN)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60); return h + ' h' + (m % 60 ? ' ' + (m % 60) : ''); }
function coachHint(s, f, ph) {
  if (ph === 'over') return 'Abschließen oder bewusst verlängern. Folgende Schritte rücken nach.';
  if (ph === 'final') return 'Abschließen und Ergebnis notieren.';
  const past = MILESTONES.filter(m => m.f !== null && m.f > 0 && m.f < 1 && f >= m.f);
  return past.length ? past[past.length - 1].msg : LOOPS[proj().loop].hint;
}

function coachAct(act, id, el) {
  if (act === 'coach-mini') {
    state.settings.coachMini = !$('#coach').classList.contains('mini');
    coachAlert = null; save(); updateCoach(); haptic('soft'); return;
  }
  if (act === 'coach-park') { openPark(); return; }
  const s = STEPS.get(id);
  if (!s) return;
  if (act === 'coach-open') {
    const chain = [];
    (function find(list, trail) { for (const x of list) { if (x.id === id) { chain.push(...trail); return true; } if (find(x.children, trail.concat(x.id))) return true; } return false; })(proj().steps, []);
    ui.path = chain; ui.trail = chain.slice();
    render();
    setFocus(chain.length ? 'sub' : 'main', id);
    return;
  }
  if (act === 'coach-start') {
    const before = snap();
    mutate(() => startStep(s));
    jumpToNow(true);
    haptic('done'); coachAlert = null;
    toast(`${LABELS.get(s.id)} läuft · ${s.dur} min geplant`, { label: 'Rückgängig', fn: undoTo(before) });
    updateCoach();
    return;
  }
  if (act === 'coach-done') {
    const t = T.get(id), early = Math.floor((t.plan - Date.now()) / MIN);
    mutate(() => applyStatus(s, 'done'));
    haptic('done'); coachAlert = null;
    jumpToNow(true);
    const nx = nextLeaf(Date.now(), id);
    const msg = early >= 2 ? `Erledigt, ${early} min früher` : 'Erledigt';
    if (nx) toast(`${msg} · weiter mit ${LABELS.get(nx.id)}`, { label: 'Starten', fn: () => coachAct('coach-start', nx.id) });
    else toast(msg);
    updateCoach();
    return;
  }
  if (act === 'coach-extend') {
    if (s.children.length) { toast('Dieser Schritt dauert so lange wie seine Teilschritte.'); return; }
    const elapsed = Math.ceil(workedNow(s));
    const before = snap();
    mutate(() => { s.dur = Math.max(s.dur || 0, elapsed) + 5; });
    haptic('tap'); coachAlert = null;
    toast(`${LABELS.get(s.id)} jetzt ${s.dur} min · folgende Schritte rücken nach`, { label: 'Rückgängig', fn: undoTo(before) });
    updateCoach();
  }
}

/* ---------- Ideen-Parkplatz ---------- */
function openPark() {
  const now = Date.now(), cur = currentLeaf(now);
  openDialog({
    title: 'Idee parken',
    body: `<p>Kurz notieren, später ansehen. Du bleibst bei deinem Schritt.</p><input class="park-in" id="parkIn" placeholder="Was dir gerade einfällt …" autocomplete="off" maxlength="300">${cur ? `<p class="muted-s">Wird vermerkt bei ${esc(LABELS.get(cur.id) + ' ' + (cur.title || 'Ohne Titel'))}.</p>` : ''}`,
    actions: [{ label: 'Abbrechen' }, { label: 'Parken', cls: 'primary', fn: v => savePark(v || '') }],
  });
  setTimeout(() => { const i = $('#parkIn'); if (i) i.focus(); }, 30);
}
function savePark(text) {
  text = text.trim();
  if (!text) return;
  const p = proj(), cur = currentLeaf(Date.now());
  pushHistory();
  p.inbox.unshift({ id: uid(), text, at: new Date().toISOString(), from: cur ? LABELS.get(cur.id) + ' ' + (cur.title || 'Ohne Titel') : '' });
  save(); renderHead();
  haptic('soft');
  toast('Geparkt. Weiter im Plan.', { label: 'Parkplatz', fn: showPark });
}
function showPark() {
  const p = proj();
  openDialog({
    title: 'Parkplatz',
    body: p.inbox.length
      ? `<ul class="park-list">${p.inbox.map(it => `<li><div><span class="park-t">${esc(it.text)}</span><span class="park-m">${esc(dayLabel(Date.parse(it.at)) + ' ' + hm(Date.parse(it.at)))}${it.from ? ' · bei ' + esc(it.from) : ''}</span></div><span class="park-a"><button class="pill" data-act="park-step" data-pid="${it.id}">Als Schritt</button><button class="pill icon danger" data-act="park-del" data-pid="${it.id}" aria-label="Löschen">×</button></span></li>`).join('')}</ul>`
      : '<p>Noch nichts geparkt. Taste <kbd>I</kbd> oder die Glühbirne in der Leiste unten parkt eine Idee, ohne deinen Schritt zu verlassen.</p>',
    actions: [{ label: 'Idee parken', fn: openPark, keep: true }, { label: 'Fertig', cls: 'primary' }],
  });
}
function parkAct(act, pid) {
  const p = proj(), it = p.inbox.find(x => x.id === pid);
  if (!it) return;
  if (act === 'park-step') {
    mutate(() => { p.inbox = p.inbox.filter(x => x !== it); p.steps.push(newStep({ title: it.text, ideas: it.from ? 'Geparkt bei ' + it.from : '' })); });
    haptic('done'); toast('Als letzter Schritt angelegt');
  } else {
    mutate(() => { p.inbox = p.inbox.filter(x => x !== it); });
    haptic('soft');
  }
  showPark();
}

/* ---------- Rückblick ---------- */
function reviewData() {
  const p = proj(), done = [], learn = [], quest = [];
  (function walk(list) {
    for (const s of list) {
      const lab = LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel');
      const t = T.get(s.id);
      if (s.status === 'done') done.push({ lab, plan: s.children.length ? null : s.dur, real: Math.round((t.end - t.start) / MIN), measured: !!(s.doneAt && s.startedAt) });
      if (s.learnings.trim()) learn.push({ lab, text: s.learnings.trim() });
      if (s.questions.trim() && s.status !== 'done') quest.push({ lab, text: s.questions.trim() });
      walk(s.children);
    }
  })(p.steps);
  return { p, done, learn, quest };
}
function reviewText() {
  const { p, done, learn, quest } = reviewData();
  const L = [`Rückblick: ${p.title || 'Ohne Titel'} (${dayLabel(Date.now())} ${hm(Date.now())})`, ''];
  L.push(`Erledigt (${done.length})`); done.forEach(d => L.push(`- ${d.lab}${d.plan != null ? ` · geplant ${d.plan} · ${d.measured ? 'echt' : 'laut Plan'} ${d.real} min` : ''}`));
  L.push('', 'Ergebnisse & Learnings'); learn.forEach(l => L.push(`- ${l.lab}: ${l.text.replace(/\n+/g, ' / ')}`));
  L.push('', 'Offene Fragen'); quest.forEach(q => L.push(`- ${q.lab}: ${q.text.replace(/\n+/g, ' / ')}`));
  L.push('', 'Parkplatz'); p.inbox.forEach(i => L.push(`- ${i.text}`));
  return L.join('\n');
}
function showReview() {
  const { p, done, learn, quest } = reviewData();
  const sec = (h, items, empty) => `<h3 class="rv-h">${h}</h3>${items.length ? `<ul class="rv-list">${items.join('')}</ul>` : `<p class="muted-s">${empty}</p>`}`;
  openDialog({
    title: 'Rückblick',
    body: sec(`Erledigt · ${done.length}`, done.map(d => `<li><span>${esc(d.lab)}</span>${d.plan != null ? `<span class="rv-m${d.measured && d.real > d.plan ? ' over' : ''}">geplant ${d.plan} · ${d.measured ? 'echt' : 'laut Plan'} ${d.real} min</span>` : ''}</li>`), 'Noch nichts erledigt.')
      + sec('Ergebnisse & Learnings', learn.map(l => `<li><span>${esc(l.lab)}</span><span class="rv-t">${esc(l.text)}</span></li>`), 'Noch keine Learnings notiert.')
      + sec('Offene Fragen', quest.map(q => `<li><span>${esc(q.lab)}</span><span class="rv-t">${esc(q.text)}</span></li>`), 'Keine offenen Fragen.')
      + sec(`Parkplatz · ${p.inbox.length}`, p.inbox.map(i => `<li><span class="rv-t">${esc(i.text)}</span></li>`), 'Nichts geparkt.'),
    actions: [{ label: 'Als Text kopieren', keep: true, fn: copyReview }, { label: 'Fertig', cls: 'primary' }],
  });
  $('.dlg').classList.add('wide');
}
function copyReview() {
  const text = reviewText();
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.className = 'rv-copy'; ta.readOnly = true;
    $('.dlg-body').appendChild(ta); ta.select();
    toast('Text markiert. Mit ⌘C kopieren.');
  };
  try {
    navigator.clipboard.writeText(text).then(() => { haptic('done'); toast('Rückblick kopiert'); }, fallback);
  } catch (e) { fallback(); }
}

/* ---------- Sicherungs-Hinweis ---------- */
function updateBackupChip() {
  const chip = $('#backupChip');
  if (!chip) return;
  const now = Date.now(), last = state.lastExport || 0, since = last || state.firstUse || now;
  const due = (state.lastChange || 0) > last && now - since > 7 * 864e5;
  chip.hidden = !due;
  if (due) chip.innerHTML = `<span class="bk-l">${last ? `Sicherung vor ${Math.floor((now - last) / 864e5)} Tagen` : 'Noch nie gesichert'}</span><span class="bk-s">Sichern</span>`;
}

function showReminders() {
  const sup = 'Notification' in window;
  const perm = sup ? Notification.permission : 'unsupported';
  const sw = (act, on, label, sub) => `<button class="switch-row" data-act="${act}" role="switch" aria-checked="${on}"><span><b>${label}</b><small>${sub}</small></span><i class="switch"></i></button>`;
  const permText = !sup ? 'Dieser Browser kann keine Mitteilungen anzeigen.'
    : perm === 'granted' ? 'Erlaubt.'
    : perm === 'denied' ? 'Blockiert. Erlauben: im Browser links neben der Adresse auf das Schloss bzw. Symbol klicken → Mitteilungen → Erlauben. Auf dem Mac zusätzlich: Systemeinstellungen → Mitteilungen → dein Browser → Erlauben.'
    : 'Noch nicht gefragt. Beim Einschalten fragt der Browser einmal nach.';
  openDialog({
    title: 'Erinnerungen',
    body: `<p>Damit du dich nicht in Details verlierst, meldet sich die App während eines Schritts:</p>
      <ol class="ms-list">
        <li><b>Start</b> Jetzt dran</li>
        <li><b>1/3</b> Ein Drittel ist um</li>
        <li><b>1/2</b> Halbzeit</li>
        <li><b>2/3</b> Noch ein Drittel</li>
        <li><b>3/4</b> Noch ein Viertel</li>
        <li><b>Schluss</b> Letzte Warnung: 10 % der Dauer vor Ende (1 bis 10 min)</li>
        <li><b>Ende</b> Zeit ist um</li>
      </ol>
      <p class="muted-s">Kurze Schritte bekommen weniger Meldungen (1/3 und 2/3 erst ab 15 min). Erledigte Schritte melden sich nicht.</p>
      <div class="switches">
        ${sw('set-remind', !!state.settings.remind, 'Erinnerungen', 'Leiste unten, Ton und Vibration')}
        ${sw('set-notify', !!state.settings.notify && perm === 'granted', 'Mitteilungen vom System', permText)}
      </div>
      <p class="muted-s">Mitteilungen kommen, solange der Browser offen ist. Der Tab darf im Hintergrund sein. Ist der Browser ganz geschlossen, kann keine Webseite eine Mitteilung schicken.</p>`,
    actions: [{ label: 'Test-Mitteilung', fn: testNotify, keep: true }, { label: 'Fertig', cls: 'primary' }],
  });
}
function testNotify() {
  const s = currentLeaf(Date.now()) || leaves(proj().steps)[0];
  if (!s) return;
  remind(s, { key: 'half', title: 'Test: Halbzeit', msg: 'So sieht eine Erinnerung aus.' });
  if (state.settings.notify && 'Notification' in window && Notification.permission === 'granted' && document.hasFocus()) {
    try { new Notification('Test: Halbzeit', { body: 'So sieht eine Mitteilung vom System aus.', tag: 'zeitachse' }); } catch (e) { toast('Der Browser hat die Mitteilung abgelehnt.'); }
  }
}
async function toggleNotify() {
  if (!('Notification' in window)) { haptic('error'); toast('Dieser Browser kann keine Mitteilungen anzeigen.'); return; }
  if (state.settings.notify && Notification.permission === 'granted') { state.settings.notify = false; save(); showReminders(); haptic('soft'); return; }
  let p = Notification.permission;
  if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
  state.settings.notify = p === 'granted';
  save(); showReminders();
  haptic(p === 'granted' ? 'done' : 'error');
  if (p !== 'granted') toast('Mitteilungen sind im Browser blockiert. Anleitung steht im Fenster.');
}

/* ---------- Pause & Unterbrechen ---------- */
// Netto gearbeitete Minuten eines laufenden Schritts (ohne Essenspausen), plus frühere Arbeit
function workedNow(s, now = Date.now()) {
  const st = s.startedAt ? Date.parse(s.startedAt) : NaN;
  return (s.worked || 0) + (isNaN(st) ? 0 : Math.max(0, (now - st - pausedMs(s, now)) / MIN));
}
function closePauses(s, iso) { (s.pauses || []).forEach(x => { if (!x.to) x.to = iso; }); }
// Start eines Schritts: andere laufende Schritte werden unterbrochen (Arbeit bleibt gezählt)
function startStep(s) {
  const iso = new Date().toISOString();
  const others = leavesOf(proj().steps).filter(x => x !== s && x.status === 'doing');
  if (state.brk) endBreak(true);
  for (const o of others) { o.worked = Math.round(workedNow(o)); o.status = 'paused'; o.startedAt = null; o.pauses = []; }
  applyStatus(s, 'doing');
  return others;
}
function startBreak() {
  if (state.brk || readOnly()) return;
  const iso = new Date().toISOString();
  mutate(() => {
    state.brk = { from: iso };
    leavesOf(proj().steps).filter(x => x.status === 'doing').forEach(x => x.pauses.push({ from: iso, to: null }));
  });
  coachAlert = null; haptic('soft');
  toast('Pause. Die Zeit der Aufgabe steht still.');
}
function endBreak(silent) {
  const b = state.brk;
  if (!b) return;
  const iso = new Date().toISOString(), mins = Math.round((Date.now() - Date.parse(b.from)) / MIN);
  const run = () => { allOf(proj().steps).forEach(x => closePauses(x, iso)); state.brk = null; };
  if (silent) run(); else { mutate(run); haptic('done'); toast(`Weiter geht's · ${fmtDur(mins)} Pause`); }
}
function interrupt(id) {
  const s = STEPS.get(id);
  if (!s || s.status !== 'doing') return;
  openDialog({
    title: 'Unterbrechen',
    body: `<p>Zwischenstand für <b>${esc(LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel'))}</b>: Was ist offen? Nächste Schritte, Links, Notizen.</p><textarea class="park-in z-in" rows="5" placeholder="z. B. Angebot von Firma X fehlt noch …"></textarea><p class="muted-s">Bisher gearbeitet: ${fmtDur(workedNow(s))} von ${fmtDur(s.dur)}. Beim Fortsetzen läuft nur die Restzeit.</p>`,
    actions: [{ label: 'Abbrechen' }, { label: 'Unterbrechen', cls: 'primary', fn: v => {
      const iso = new Date().toISOString();
      mutate(() => {
        if ((v || '').trim()) s.log.push({ at: iso, text: v.trim(), kind: 'zwischenstand' });
        s.worked = Math.round(workedNow(s)); s.status = 'paused'; s.startedAt = null; s.pauses = [];
      });
      haptic('strong'); coachAlert = null;
      const nx = nextLeaf(Date.now(), s.id);
      if (nx) toast(`Unterbrochen · weiter mit ${LABELS.get(nx.id)}`, { label: 'Starten', fn: () => coachAct('coach-start', nx.id) });
      else toast('Unterbrochen');
    } }],
  });
  setTimeout(() => { const t = $('#dialog textarea'); if (t) t.focus(); }, 30);
}

/* ---------- Schleifen ---------- */
function runSnapshot(p) {
  recompute();
  return {
    loop: p.loop, startedAt: p.loopStartedAt || p.start, endedAt: new Date().toISOString(),
    steps: allOf(p.steps).map(s => { const t = T.get(s.id); return { id: s.id, label: LABELS.get(s.id), title: s.title, status: s.status, dur: s.dur, real: t ? Math.round((t.end - t.start) / MIN) : null, measured: !!(s.startedAt && s.doneAt), worked: Math.round(workedNow(s)), log: s.log.slice(), ideas: s.ideas, questions: s.questions, learnings: s.learnings, loopAdded: s.loopAdded }; }),
    inbox: p.inbox.slice(),
  };
}
function showLoop() {
  const p = proj();
  const L = n => `<li class="${n === p.loop ? 'cur' : n < p.loop ? 'past' : ''}"><b class="loop-dot l${n}"></b><span><b>${n}. ${LOOPS[n].name}</b><small>${LOOPS[n].hint}</small></span></li>`;
  const tl = tally(p.steps);
  const last = p.loop === 3;
  openDialog({
    title: p.finished ? 'Lauf abgeschlossen' : `Schleife ${p.loop} · ${LOOPS[p.loop].name}`,
    body: `<ol class="loop-list">${L(1)}${L(2)}${L(3)}</ol>
      <p class="muted-s">${p.finished ? 'Alle drei Schleifen sind archiviert. Für den nächsten Durchgang erstellst du eine neue Prozessversion.' : `Erledigt: ${tl.done} von ${tl.n}. ${last ? 'Abschließen archiviert den Lauf.' : `Nächste Schleife: Schritte aus Schleife ${p.loop} werden gesperrt (Inhalt), der Status beginnt neu. Du kannst Schritte dazwischen einfügen und aus Ideen und Fragen neue Schritte bauen.`}`}</p>`,
    actions: p.finished || readOnly()
      ? [{ label: 'Bericht', fn: () => showReport(p.runs.length - 1) }, { label: 'Neue Prozessversion', cls: 'primary', fn: newVersion }]
      : [{ label: 'Bericht', fn: () => showReport(-1) }, { label: last ? 'Lauf abschließen' : `Schleife ${p.loop + 1} starten`, cls: 'primary', fn: finishLoop }],
  });
}
function finishLoop() {
  const p = proj();
  if (readOnly() || p.finished) return;
  if (state.brk) endBreak(true);
  const iso = new Date().toISOString();
  const runIdx = p.runs.length;
  mutate(() => {
    allOf(p.steps).forEach(s => { if (s.status === 'doing') { s.worked = Math.round(workedNow(s)); closePauses(s, iso); } });
    p.runs.push(runSnapshot(p));
    if (p.loop >= 3) { p.finished = iso; return; }
    allOf(p.steps).forEach(s => { s.status = 'open'; s.startedAt = null; s.doneAt = null; s.worked = 0; s.pauses = []; s.log = []; });
    p.loop += 1;
    p.start = new Date(floorMin(Date.now())).toISOString();
    p.loopStartedAt = iso;
    ui.unfolded.clear();
  });
  haptic('done');
  jumpToNow(true);
  showReport(runIdx, true);
}

/* ---------- Bericht: Ideen, Fragen, Zwischenstände, Zeiten ---------- */
function reportData(runIdx) {
  const p = proj();
  if (runIdx < 0 && p.finished && p.runs.length) runIdx = p.runs.length - 1;
  if (runIdx >= 0 && p.runs[runIdx]) { const r = p.runs[runIdx]; return { title: `Schleife ${r.loop} · ${LOOPS[r.loop].name}`, from: r.startedAt, to: r.endedAt, steps: r.steps, inbox: r.inbox || [] }; }
  return { title: `Schleife ${p.loop} · ${LOOPS[p.loop].name} (läuft)`, from: p.loopStartedAt || p.start, to: null, steps: runSnapshot(p).steps, inbox: p.inbox };
}
function reportHTML(d) {
  const lines = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  const sec = (h, items, empty) => `<h3 class="rv-h">${h}</h3>${items.length ? `<ul class="rv-list">${items.join('')}</ul>` : `<p class="muted-s">${empty}</p>`}`;
  const by = k => d.steps.filter(s => lines(s[k] || '').length).map(s => `<li><span>${esc(s.label + ' ' + (s.title || 'Ohne Titel'))}</span>${lines(s[k]).map(l => `<span class="rv-t">• ${esc(l)}</span>`).join('')}</li>`);
  const times = d.steps.filter(s => s.status === 'done' && s.measured).map(s => `<li><span>${esc(s.label + ' ' + (s.title || 'Ohne Titel'))}</span><span class="rv-m${s.real > s.dur ? ' over' : ''}">gebraucht ${fmtDur(s.real)} · geplant ${fmtDur(s.dur)}</span></li>`);
  const logs = d.steps.filter(s => (s.log || []).length).map(s => `<li><span>${esc(s.label + ' ' + (s.title || 'Ohne Titel'))}</span>${s.log.map(x => `<span class="rv-t">${esc(hm(Date.parse(x.at)))} · ${esc(x.text)}</span>`).join('')}</li>`);
  const open = d.steps.filter(s => s.status !== 'done' && !d.steps.some(c => c !== s && c.label.startsWith(s.label + '.'))).map(s => `<li><span>${esc(s.label + ' ' + (s.title || 'Ohne Titel'))}</span><span class="rv-m">${STATUS[s.status] || s.status}</span></li>`);
  return sec('Ideen', by('ideas'), 'Keine Ideen notiert.') + sec('Fragen', by('questions'), 'Keine Fragen notiert.')
    + sec('Zwischenstände', logs, 'Keine Unterbrechungen.') + sec('Ergebnisse & Learnings', by('learnings'), 'Keine Learnings notiert.')
    + sec('Zeiten', times, 'Noch keine gemessenen Schritte.') + sec('Nicht erledigt', open, 'Alles erledigt.')
    + sec(`Parkplatz · ${d.inbox.length}`, d.inbox.map(i => `<li><span class="rv-t">${esc(i.text)}</span></li>`), 'Nichts geparkt.');
}
function showReport(runIdx, afterLoop) {
  const d = reportData(runIdx);
  const p = proj();
  openDialog({
    title: afterLoop ? (p.finished ? 'Lauf abgeschlossen' : `Schleife ${p.loop} beginnt`) : 'Bericht',
    body: `${p.runs.length && !afterLoop ? `<div class="rp-runs" role="group" aria-label="Schleife wählen">${p.runs.map((r, i) => `<button class="chip-btn${(runIdx < 0 && p.finished ? p.runs.length - 1 : runIdx) === i ? ' on' : ''}" data-act="report-run" data-i="${i}"><i class="loop-dot l${r.loop}"></i>Schleife ${r.loop}</button>`).join('')}${p.finished ? '' : `<button class="chip-btn${runIdx < 0 ? ' on' : ''}" data-act="report-run" data-i="-1"><i class="loop-dot l${p.loop}"></i>Aktuell</button>`}</div>` : ''}<p class="rp-sub">${esc(d.title)} · ${esc(dayLabel(Date.parse(d.from)) + ' ' + hm(Date.parse(d.from)))}${d.to ? ' – ' + esc(hm(Date.parse(d.to))) : ''}</p>${afterLoop && !p.finished ? `<p class="muted-s">${LOOPS[p.loop].hint} In jedem Schritt machst du mit „→ Schritte“ aus Ideen und Fragen neue Schritte.</p>` : ''}${reportHTML(d)}`,
    actions: [{ label: 'Als PDF', keep: true, fn: () => printReport(d) }, ...(p.finished && afterLoop ? [{ label: 'Neue Prozessversion', fn: newVersion }] : []), { label: 'Fertig', cls: 'primary' }],
  });
  $('.dlg').classList.add('wide');
}
function printReport(d) {
  const p = proj();
  printHTML(`<header class="pr-head"><h1>${esc(p.title || 'Ohne Titel')}</h1><p>Bericht · ${esc(d.title)} · Version ${p.version}</p></header>${reportHTML(d)}`, `${p.title || 'Lazerfocus'} – Bericht`);
}

/* ---------- Zeitachse als PDF ---------- */
function timelineHTML() {
  recompute();
  const p = proj();
  const lines = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  const row = (s, depth) => {
    const t = T.get(s.id);
    const notes = NOTES.map(([k, h]) => lines(s[k]).length ? `<div class="pr-note"><b>${h}</b>${lines(s[k]).map(l => `<span>• ${esc(l)}</span>`).join('')}</div>` : '').join('');
    const real = Math.round((t.end - t.start) / MIN);
    return `<section class="pr-step d${Math.min(depth, 3)} st-${s.status}">
      <div class="pr-time">${hm(t.start)}<br><span>${hm(t.end)}</span></div>
      <div class="pr-num">${LABELS.get(s.id)}</div>
      <div class="pr-main"><h3>${esc(s.title || 'Ohne Titel')}<em>${STATUS[s.status]}</em></h3>
        ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
        <p class="pr-meta">${s.status === 'done' && s.startedAt && s.doneAt ? `gebraucht ${fmtDur(real)} · geplant ${fmtDur(s.dur)}` : `Dauer ${fmtDur(real)}`}${s.prio ? ' · Priorität' : ''}</p>
        ${notes}${s.log.length ? `<div class="pr-note"><b>Zwischenstand</b>${s.log.map(x => `<span>${esc(hm(Date.parse(x.at)))} · ${esc(x.text)}</span>`).join('')}</div>` : ''}
        ${s.process ? `<div class="pr-proc">${window.LF && LF.docs && LF.docs.processHTML ? LF.docs.processHTML(s) : ''}</div>` : ''}
      </div></section>` + s.children.map(c => row(c, depth + 1)).join('');
  };
  const tl = tally(p.steps);
  return `<header class="pr-head"><h1>${esc(p.title || 'Ohne Titel')}</h1><p>${p.role === 'process' ? 'Prozess-Entwurf' : 'Ausführung'} · Version ${p.version} · Schleife ${p.loop} ${LOOPS[p.loop].name} · ${tl.done} von ${tl.n} erledigt · Stand ${esc(dayLabel(Date.now()) + ' ' + hm(Date.now()))}</p></header>${p.steps.map(s => row(s, 0)).join('')}`;
}
function exportPdf() { const p = proj(); printHTML(timelineHTML(), `${p.title || 'Lazerfocus'} – Zeitachse`); }
function printHTML(html, title) {
  const root = $('#printRoot');
  root.innerHTML = `<div class="pr-doc">${html}</div>`;
  const old = document.title;
  document.title = title;   // wird beim Speichern als PDF zum Dateinamen
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); document.title = old; root.innerHTML = ''; removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/* ---------- Prozessversionen ---------- */
const folderOf = p => p.folder || p.title || 'Ohne Titel';
function newVersion() {
  const src = proj();
  const folder = folderOf(src);
  const maxV = Math.max(...state.projects.filter(x => folderOf(x) === folder && x.role === src.role).map(x => x.version));
  const copy = normProject(JSON.parse(JSON.stringify(src)));
  const reid = s => { s.id = uid(); s.children.forEach(reid); };
  copy.steps.forEach(reid);
  Object.assign(copy, { id: uid(), version: maxV + 1, folder, loop: 1, runs: [], finished: null, archived: false, loopStartedAt: null, start: roundedNow(15).toISOString(), created: Date.now(), inbox: [] });
  allOf(copy.steps).forEach(s => Object.assign(s, { status: 'open', startedAt: null, doneAt: null, worked: 0, pauses: [], log: [], ideas: '', questions: '', learnings: '', loopAdded: 1, at: null }));
  pushHistory();
  src.folder = folder; src.archived = true;
  const partner = state.projects.find(x => x.id === src.link);
  if (partner && partner.link === src.id) partner.link = copy.id;
  state.projects.push(copy);
  state.activeId = copy.id; ui.focus = null; ui.path = []; ui.trail = [];
  save(); render(); haptic('done');
  toast(`Version ${copy.version} erstellt · Version ${src.version} ist archiviert`);
}

/* ---------- Ausführung ⇄ Prozess ---------- */
const partnerOf = p => (p && p.link ? state.projects.find(x => x.id === p.link) : null);
function pairProject() {
  const p = proj();
  const partner = partnerOf(p);
  if (partner) { switchProject(partner.id); return; }
  if (p.role === 'process') { toast('Das ist bereits ein Prozess-Entwurf.'); return; }
  openDialog({
    title: 'Prozess parallel gestalten',
    body: '<p>Neben dieser Ausführung entsteht ein Prozess-Entwurf: der verfeinerte Ablauf, der später als eigenes Projekt startet.</p><p class="muted-s">Wechseln: Schalter „Ausführung / Prozess“ oben oder Taste W. Schritte übernimmst du in der Fokus-Karte über ··· → „In Prozess übernehmen“. Die Seitenleiste zeigt den Entwurf neben der Arbeit.</p>',
    actions: [{ label: 'Abbrechen' }, { label: 'Leer beginnen', fn: () => createPartner(false) }, { label: 'Ablauf kopieren', cls: 'primary', fn: () => createPartner(true) }],
  });
}
function cloneForProcess(s) {
  const c = normStep(JSON.parse(JSON.stringify(s)));
  const reset = x => { Object.assign(x, { id: uid(), status: 'open', startedAt: null, doneAt: null, worked: 0, pauses: [], log: [], ideas: '', questions: '', learnings: '', loopAdded: 1, at: null }); x.children.forEach(reset); };
  reset(c);
  c.fromId = s.id;
  return c;
}
function createPartner(copySteps) {
  const p = proj();
  const np = normProject(newProject(`${p.title || 'Ohne Titel'} · Prozess`));
  Object.assign(np, { role: 'process', link: p.id, folder: folderOf(p), folderId: p.folderId });
  if (copySteps && p.steps.length) np.steps = p.steps.map(cloneForProcess);
  pushHistory();
  p.link = np.id; p.folder = folderOf(p);
  state.projects.push(np);
  save(); render(); haptic('done');
  openSide('proc');
  toast('Prozess-Entwurf angelegt · rechts in der Seitenleiste');
}
function copyToProcess(id) {
  const p = proj(), s = STEPS.get(id);
  const partner = partnerOf(p);
  if (!s) return;
  if (!partner || p.role !== 'run') { pairProject(); return; }
  const clone = cloneForProcess(s);
  const existing = allOf(partner.steps).find(x => x.fromId === s.id);
  pushHistory();
  if (existing) Object.assign(existing, { title: clone.title, desc: clone.desc, dur: clone.dur, process: clone.process, attachments: clone.attachments, children: clone.children, prio: clone.prio });
  else partner.steps.push(clone);
  save(); renderSide(); haptic('done');
  toast(existing ? 'Im Prozess aktualisiert' : 'In den Prozess übernommen', { label: 'Rückgängig', fn: undo });
}
function renderRoleSwitch() {
  const p = proj(), partner = partnerOf(p);
  for (const el of [$('#roleSwitch'), $('#roleSwitch2')]) {
    el.hidden = !partner;
    if (partner) $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === p.role)));
  }
}

/* ---------- Seitenleiste: Unterlagen | Prozess ---------- */
let docsMounted = false;
function openSide(tab) {
  const side = $('#side');
  state.settings.side = { open: true, tab: tab || (state.settings.side && state.settings.side.tab) || 'docs' };
  side.hidden = false;
  document.body.classList.add('has-side');
  if (!docsMounted && window.LF && LF.docs && LF.docs.mountPanel) { LF.docs.mountPanel($('#sideDocs')); docsMounted = true; }
  renderSide();
  save();
  requestAnimationFrame(sideWidth);
}
function closeSide() {
  const side = $('#side');
  side.hidden = true; side.classList.remove('side--wide');
  document.body.classList.remove('has-side');
  state.settings.side = Object.assign({}, state.settings.side, { open: false });
  save(); sideWidth();
}
function sideWidth() {
  const side = $('#side');
  const w = side.hidden || innerWidth <= 900 ? 0 : side.offsetWidth;
  document.documentElement.style.setProperty('--side-open-w', w + 'px');
  updateNow();
}
addEventListener('resize', () => requestAnimationFrame(sideWidth));
$('#side').addEventListener('transitionend', e => { if (e.propertyName === 'width') sideWidth(); });
function renderSide() {
  const side = $('#side');
  if (side.hidden) return;
  const tab = (state.settings.side && state.settings.side.tab) || 'docs';
  $$('.side-tab', side).forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === tab)));
  $('#sideDocs').hidden = tab !== 'docs';
  $('#sideProc').hidden = tab !== 'proc';
  if (tab === 'docs' && window.LF && LF.docs && LF.docs.onRender) LF.docs.onRender();
  if (tab === 'proc') renderProcPanel();
}
function renderProcPanel() {
  const p = proj(), partner = partnerOf(p), el = $('#sideProc');
  if (!partner) {
    el.innerHTML = `<div class="pp-empty"><h3>Prozess parallel gestalten</h3><p>${p.role === 'process' ? 'Dieser Entwurf ist mit keiner Ausführung verbunden.' : 'Während du hier abarbeitest, entsteht daneben der verfeinerte Ablauf als eigenes Projekt.'}</p>${p.role === 'run' ? '<button class="pill primary" data-act="proj-pair">Prozess-Entwurf anlegen</button>' : ''}</div>`;
    return;
  }
  const editable = partner.role === 'process' && !partner.archived;
  const rows = [];
  const walk = (list, prefix, depth) => list.forEach((s, i) => {
    const lab = prefix + (i + 1);
    rows.push(`<li class="pp-row d${Math.min(depth, 3)}${s.fromId ? ' from-run' : ''}">
      <span class="pp-num">${lab}</span>
      ${editable && depth === 0 ? `<input class="pp-title" data-pf="title" data-sid="${s.id}" value="${esc(s.title)}" placeholder="Ohne Titel" aria-label="Titel">` : `<span class="pp-title ro">${esc(s.title || 'Ohne Titel')}</span>`}
      ${editable && depth === 0 ? `<input class="pp-dur" data-pf="dur" data-sid="${s.id}" type="number" min="0" step="5" value="${s.dur}" aria-label="Dauer in Minuten"><span class="pp-unit">min</span>
      <span class="pp-acts"><button class="pp-b" data-act="pp-up" data-sid="${s.id}" aria-label="Nach oben">↑</button><button class="pp-b" data-act="pp-down" data-sid="${s.id}" aria-label="Nach unten">↓</button><button class="pp-b danger" data-act="pp-del" data-sid="${s.id}" aria-label="Löschen">×</button></span>` : `<span class="pp-st st-${s.status}">${partner.role === 'run' ? STATUS[s.status] : fmtDur(s.dur)}</span>`}
    </li>`);
    walk(s.children, lab + '.', depth + 1);
  });
  walk(partner.steps, '', 0);
  el.innerHTML = `<div class="pp-head"><div><span class="eyebrow">${partner.role === 'process' ? 'Prozess-Entwurf' : 'Ausführung'}</span><h3>${esc(partner.title || 'Ohne Titel')}</h3></div><button class="pill" data-act="proj-pair">Öffnen</button></div>
    <ol class="pp-list">${rows.join('') || '<li class="pp-none">Noch keine Schritte.</li>'}</ol>
    ${editable ? '<input class="pp-add" id="ppAdd" placeholder="+ Schritt hinzufügen (Enter)" aria-label="Neuen Schritt hinzufügen">' : ''}
    <p class="muted-s pp-tip">${p.role === 'run' ? 'Schritte aus der Ausführung übernimmst du in der Fokus-Karte über ··· → „In Prozess übernehmen“.' : 'Links siehst du den Entwurf, hier die laufende Ausführung.'}</p>`;
}
function ppAct(act, sid) {
  const partner = partnerOf(proj());
  if (!partner) return;
  const i = partner.steps.findIndex(x => x.id === sid);
  if (i < 0) return;
  pushHistory();
  if (act === 'pp-del') partner.steps.splice(i, 1);
  else { const j = i + (act === 'pp-up' ? -1 : 1); if (j < 0 || j >= partner.steps.length) { past.pop(); haptic('error'); return; } const [x] = partner.steps.splice(i, 1); partner.steps.splice(j, 0, x); }
  save(); renderProcPanel(); haptic('soft');
  if (act === 'pp-del') toast('Schritt aus dem Prozess entfernt', { label: 'Rückgängig', fn: undo });
}

/* ---------- Teilschritt-Vorschau beim Überfahren ---------- */
let peekTimer;
function showPeek(anchor) {
  const row = anchor.closest('.step');
  const s = row && STEPS.get(row.dataset.id);
  if (!s || !s.children.length) return;
  const pk = $('#peek');
  pk.innerHTML = `<div class="pk-h"><span class="eyebrow">Teilschritte von ${LABELS.get(s.id)}</span></div><ol>${s.children.map(c => { const t = T.get(c.id); return `<li class="st-${c.status}"><span class="pk-sq">${LABELS.get(c.id)}</span><span class="pk-t">${esc(c.title || 'Ohne Titel')}</span><span class="pk-m">${t ? hm(t.start) : ''} · ${fmtDur(t ? (t.end - t.start) / MIN : c.dur)}</span></li>`; }).join('')}</ol><p class="pk-f">Klicken öffnet die Zeitachse der Teilschritte</p>`;
  pk.hidden = false;
  const r = anchor.getBoundingClientRect(), w = pk.offsetWidth, h = pk.offsetHeight;
  // links neben der Zeile (vor Uhrzeit und Quadrat), damit der eigene Schritt sichtbar bleibt
  const node = row.querySelector('.time') || row;
  let left = node.getBoundingClientRect().left - w - 12;
  if (left < 8) left = Math.min(innerWidth - w - 8, r.right + 12);
  const top = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  pk.style.left = left + 'px'; pk.style.top = top + 'px';
}
addEventListener('scroll', () => hidePeek(), true);
function hidePeek() { clearTimeout(peekTimer); const pk = $('#peek'); if (pk) pk.hidden = true; }
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', e => {
    const a = e.target.closest && e.target.closest('.step [data-act="sub"]:not(.mini-axis)');
    if (!a || drag.on) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => showPeek(a), 180);
  });
  document.addEventListener('mouseout', e => {
    const a = e.target.closest && e.target.closest('.step [data-act="sub"]:not(.mini-axis)');
    if (a && !a.contains(e.relatedTarget)) hidePeek();
  });
}

/* ---------- Schwebe-Menü (···) ---------- */
function openPop(anchor, items) {
  closePop();
  const m = document.createElement('div');
  m.className = 'menu pop'; m.id = 'pop';
  m.innerHTML = items.filter(Boolean).map(it => it.sep ? '<div class="m-sep"></div>' : `<button class="m-item${it.danger ? ' danger' : ''}" data-act="${it.act}" data-id="${it.id || ''}">${esc(it.label)}${it.sub ? `<span class="m-sub">${esc(it.sub)}</span>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8) + 'px';
  m.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  haptic('soft');
}
function closePop() { const m = $('#pop'); if (m) m.remove(); }
function cardMenu(anchor, id) {
  const s = STEPS.get(id);
  if (!s || isLocked(s)) return;
  openPop(anchor, [
    { label: 'Nach oben', act: 'up', id, sub: 'Alt ↑' },
    { label: 'Nach unten', act: 'down', id, sub: 'Alt ↓' },
  ]);
}
function coachMenu(anchor, id) {
  openPop(anchor, [
    { label: '+5 Minuten', act: 'coach-extend', id },
    { label: 'Öffnen', act: 'coach-open', id },
    { label: 'Idee parken', act: 'coach-park', id, sub: 'I' },
  ]);
}

/* ---------- Ideen und Fragen zu Schritten ---------- */
function notesToSteps(id, field) {
  const s = STEPS.get(id);
  if (!s) return;
  const items = s[field].split('\n').map(x => x.trim()).filter(Boolean);
  if (!items.length) return;
  openDialog({
    title: field === 'ideas' ? 'Ideen zu Schritten' : 'Fragen zu Schritten',
    body: `<p>Ausgewählte Zeilen werden neue Schritte direkt nach <b>${esc(LABELS.get(s.id) + ' ' + (s.title || 'Ohne Titel'))}</b>.</p><div class="ts-list">${items.map((t, i) => `<label class="ts-i"><input type="checkbox" data-i="${i}" checked><span>${esc(t)}</span></label>`).join('')}</div><label class="ts-i ts-opt"><input type="checkbox" id="tsRemove" checked><span>Übernommene Zeilen aus der Notiz entfernen</span></label>`,
    actions: [{ label: 'Abbrechen' }, { label: 'Schritte anlegen', cls: 'primary', keep: true, fn: () => {
      const pick = $$('#dialog .ts-list input:checked').map(x => +x.dataset.i);
      const remove = $('#tsRemove') && $('#tsRemove').checked;
      closeDialog();
      if (!pick.length) return;
      const L = locate(id);
      mutate(() => {
        const made = pick.map(i => newStep({ title: items[i], dur: 15, ideas: `Aus ${field === 'ideas' ? 'Idee' : 'Frage'} von ${LABELS.get(s.id)}`, loopAdded: proj().loop }));
        L.list.splice(L.index + 1, 0, ...made);
        if (remove) s[field] = items.filter((_, i) => !pick.includes(i)).join('\n');
      });
      haptic('done');
      toast(`${pick.length} Schritt${pick.length > 1 ? 'e' : ''} angelegt`, { label: 'Rückgängig', fn: undo });
    } }],
  });
}

/* ---------- Projektverwaltung: Ordner (mit Titelbild) → Prozesse → Versionen ---------- */
const ICON_GRID = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="8" y="1.5" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1.5" y="8" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="8" y="8" width="4.5" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const ICON_LIST = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3h7.5M5 7h7.5M5 11h7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="2" cy="3" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="11" r="1" fill="currentColor"/></svg>';
const ICON_ARCHIVE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2" width="9" height="2.5" rx=".8" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2.5 4.5V10h7V4.5M4.8 6.8h2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
const NONE = '__none';
const folderById = id => (state.folders || []).find(f => f.id === id) || null;
function normFolder(f) {
  f = f && typeof f === 'object' ? f : {};
  return { id: str(f.id) || uid(), name: str(f.name) || 'Ordner', cover: typeof f.cover === 'string' && f.cover.startsWith('data:image/') ? f.cover : '', created: +f.created || Date.now() };
}
// Prozesse eines Ordners: alle Projekte mit gleichem Prozess-Schlüssel (Versionen, Ausführung + Entwurf)
function processesIn(folderId) {
  const groups = new Map();
  for (const p of state.projects) {
    const fid = p.folderId && folderById(p.folderId) ? p.folderId : NONE;
    if (fid !== folderId) continue;
    const key = folderOf(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()].map(([key, items]) => {
    const live = items.filter(p => !p.archived);
    const main = live.filter(p => p.role === 'run').sort((a, b) => b.version - a.version)[0] || live.sort((a, b) => b.version - a.version)[0] || items.slice().sort((a, b) => b.version - a.version)[0];
    return { key, items, main, archived: items.filter(p => p.archived).sort((a, b) => b.version - a.version), partner: partnerOf(main), updated: Math.max(...items.map(p => p.updatedAt || p.created || 0)) };
  }).sort((a, b) => b.updated - a.updated);
}
function openHome(folderId) {
  ui.home = { folder: folderId === undefined ? (ui.home && ui.home.folder) || null : folderId };
  $('#home').hidden = false;
  document.body.classList.add('home-open');
  closeMenus(); closePop(); hidePeek();
  renderHome();
}
function closeHome() { $('#home').hidden = true; document.body.classList.remove('home-open'); }
function renderHome() {
  const el = $('#home');
  if (el.hidden) return;
  const view = state.settings.homeView === 'list' ? 'list' : 'grid';
  const fid = ui.home && ui.home.folder;
  const toggle = `<div class="seg h-view" role="group" aria-label="Ansicht"><button data-act="home-view" data-v="grid" aria-pressed="${view === 'grid'}" title="Kacheln">${ICON_GRID}</button><button data-act="home-view" data-v="list" aria-pressed="${view === 'list'}" title="Liste">${ICON_LIST}</button></div>`;
  if (!fid) {
    const folders = state.folders || [];
    const loose = processesIn(NONE);
    const tile = f => { const n = processesIn(f.id).length; return `<button class="h-folder" data-act="home-folder" data-id="${f.id}"><span class="hf-cover"${f.cover ? ` style="background-image:url('${f.cover}')"` : ''}>${f.cover ? '' : `<b>${esc((f.name || '?').slice(0, 1).toUpperCase())}</b>`}</span><span class="hf-body"><span class="hf-name">${esc(f.name)}</span><span class="hf-sub">${n} Prozess${n === 1 ? '' : 'e'}</span></span></button>`; };
    el.innerHTML = `<div class="h-inner">
      <div class="h-head"><div><span class="eyebrow">Lazerfocus</span><h1>Projekte</h1></div><button class="pill icon" data-act="home-close" aria-label="Schließen" title="Zurück zum Projekt (Esc)"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
      <div class="h-bar">${toggle}<span class="spacer"></span><button class="pill" data-act="home-new-folder">+ Ordner</button><button class="pill primary" data-act="home-new-proj">+ Projekt</button></div>
      <div class="h-grid ${view}">${folders.map(tile).join('')}${loose.length ? `<button class="h-folder loose" data-act="home-folder" data-id="${NONE}"><span class="hf-cover"><b>…</b></span><span class="hf-body"><span class="hf-name">Ohne Ordner</span><span class="hf-sub">${loose.length} Prozess${loose.length === 1 ? '' : 'e'}</span></span></button>` : ''}</div>
      ${!folders.length ? '<p class="h-empty">Lege einen Ordner an, z. B. für einen Kunden oder ein Thema. Darin liegen deine Prozesse.</p>' : ''}
    </div>`;
    return;
  }
  const f = fid === NONE ? null : folderById(fid);
  if (fid !== NONE && !f) { ui.home.folder = null; renderHome(); return; }
  const procs = processesIn(fid);
  const card = g => {
    const p = g.main, t = tally(p.steps), pct = t.n ? Math.round(t.done / t.n * 100) : 0;
    return `<article class="h-proc" data-act="open-pid" data-id="${p.id}" tabindex="0">
      <div class="hp-top"><span class="hp-title">${esc(p.title || 'Ohne Titel')}</span>${p.version > 1 ? `<span class="m-tag">v${p.version}</span>` : ''}${p.role === 'process' ? '<span class="m-tag">Prozess</span>' : ''}</div>
      <div class="hp-meta">${p.finished ? '<i class="loop-dot l3"></i>Lauf abgeschlossen' : `<i class="loop-dot l${p.loop}"></i>Schleife ${p.loop} · ${LOOPS[p.loop].name}`}</div>
      <div class="hp-prog"><span class="bar"><i style="width:${pct}%"></i></span><span>${t.done}/${t.n}</span></div>
      <div class="hp-foot"><span class="hp-date">${esc(dayLabel(g.updated))} ${hm(g.updated)}</span>${g.partner ? '<span class="hp-pair" title="Mit Prozess-Entwurf">⇄ Entwurf</span>' : ''}<span class="spacer"></span>
        ${g.archived.length ? `<button class="hp-arch" data-act="arch-pop" data-key="${esc(g.key)}" title="Archivierte Versionen">${ICON_ARCHIVE}${g.archived.length}</button>` : ''}
        <button class="hp-more" data-act="proc-menu" data-key="${esc(g.key)}" aria-label="Mehr">${ICON_MORE}</button></div>
    </article>`;
  };
  el.innerHTML = `<div class="h-inner">
    <div class="h-crumbs"><button data-act="home-folder" data-id="">Projekte</button><span class="sep">/</span><span>${esc(f ? f.name : 'Ohne Ordner')}</span><span class="spacer"></span><button class="pill icon" data-act="home-close" aria-label="Schließen" title="Zurück zum Projekt (Esc)"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
    <div class="h-banner"${f && f.cover ? ` style="background-image:linear-gradient(to top, rgba(12,11,10,.92), rgba(12,11,10,.15) 70%), url('${f.cover}')"` : ''}>
      ${f ? `<input class="h-fname" data-hf="name" value="${esc(f.name)}" aria-label="Ordnername" maxlength="80">` : '<h1 class="h-fname ro">Ohne Ordner</h1>'}
      <span class="hf-sub">${procs.length} Prozess${procs.length === 1 ? '' : 'e'}</span>
      ${f ? `<div class="h-banner-acts"><button class="pill" data-act="cover" data-id="${f.id}">${f.cover ? 'Titelbild ändern' : 'Titelbild wählen'}</button>${f.cover ? `<button class="pill" data-act="cover-del" data-id="${f.id}">Bild entfernen</button>` : ''}<button class="pill danger" data-act="folder-del" data-id="${f.id}">Ordner löschen</button></div>` : ''}
    </div>
    <div class="h-bar">${toggle}<span class="spacer"></span><button class="pill primary" data-act="home-new-proj" data-id="${f ? f.id : ''}">+ Projekt</button></div>
    <div class="h-grid procs ${view}">${procs.map(card).join('') || '<p class="h-empty">Noch keine Prozesse in diesem Ordner. „+ Projekt“ legt einen an.</p>'}</div>
  </div>`;
}
function homeNewFolder() {
  openDialog({ title: 'Neuer Ordner', body: '<input class="park-in" placeholder="z. B. Kunde Müller, Marketing, Privat" maxlength="80">', actions: [{ label: 'Abbrechen' }, { label: 'Anlegen', cls: 'primary', fn: v => {
    const name = (v || '').trim() || 'Neuer Ordner';
    const f = normFolder({ name });
    state.folders = (state.folders || []).concat(f);
    save(); haptic('done');
    openHome(f.id);
  } }] });
  setTimeout(() => { const i = $('#dialog input'); if (i) i.focus(); }, 30);
}
function homeNewProject(folderId) {
  const p = newProject();
  p.folderId = folderId && folderId !== NONE ? folderId : null;
  pushHistory();
  state.projects.push(p);
  state.activeId = p.id; ui.focus = null; ui.path = []; ui.trail = [];
  save(); closeHome(); render(); haptic('strong');
  const t = $('#pTitle'); t.focus(); t.select();
}
function procItems(key, folderId) { return state.projects.filter(p => folderOf(p) === key && ((p.folderId && folderById(p.folderId) ? p.folderId : NONE) === folderId)); }
function procMenu(anchor, key) {
  const fid = ui.home.folder;
  const items = procItems(key, fid);
  openPop(anchor, [
    { label: 'Öffnen', act: 'open-pid', id: (processesIn(fid).find(g => g.key === key) || {}).main?.id },
    { sep: true },
    ...(state.folders || []).filter(f => f.id !== fid).map(f => ({ label: 'Verschieben nach ' + f.name, act: 'proc-move', id: key + '\u0001' + f.id })),
    fid !== NONE && { label: 'Aus dem Ordner nehmen', act: 'proc-move', id: key + '\u0001' + NONE },
  ]);
}
function procMove(packed) {
  const [key, to] = packed.split('\u0001');
  const fid = ui.home.folder;
  pushHistory();
  procItems(key, fid).forEach(p => { p.folderId = to === NONE ? null : to; });
  save(); renderHome(); haptic('done');
  toast('Prozess verschoben', { label: 'Rückgängig', fn: () => { undo(); renderHome(); } });
}
function archPop(anchor, key) {
  const items = procItems(key, ui.home.folder).filter(p => p.archived).sort((a, b) => b.version - a.version);
  openPop(anchor, items.map(p => ({ label: `Version ${p.version}${p.role === 'process' ? ' · Entwurf' : ''}`, act: 'open-pid', id: p.id, sub: `${p.runs.length} Schleife${p.runs.length === 1 ? '' : 'n'}` })));
}
function openProject(id) {
  if (!state.projects.some(p => p.id === id)) return;
  closeHome();
  if (id !== state.activeId) switchProject(id); else render();
}
// Titelbild: verkleinert (max. 1200 px breit) als JPEG speichern, damit Speicher und Abgleich klein bleiben
function pickCover(folderId) {
  const inp = $('#coverFile');
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    inp.value = '';
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.naturalWidth);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const f = folderById(folderId);
      if (!f) return;
      f.cover = cv.toDataURL('image/jpeg', .78);
      save(); renderHome(); haptic('done');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Das Bild konnte nicht gelesen werden.'); haptic('error'); };
    img.src = url;
  };
  inp.click();
}
function deleteFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const n = processesIn(id).length;
  openDialog({ title: 'Ordner löschen?', body: `<p>„${esc(f.name)}“ wird gelöscht. ${n ? `Die ${n} Prozess${n === 1 ? '' : 'e'} darin bleiben erhalten und landen unter „Ohne Ordner“.` : ''}</p>`, actions: [{ label: 'Abbrechen' }, { label: 'Löschen', cls: 'primary danger', fn: () => {
    state.folders = state.folders.filter(x => x.id !== id);
    state.projects.forEach(p => { if (p.folderId === id) p.folderId = null; });
    save(); ui.home.folder = null; renderHome(); haptic('strong');
    toast('Ordner gelöscht');
  } }] });
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!e.target.closest('.menu-wrap')) closeMenus();
  if (!e.target.closest('#pop, [data-act="card-menu"], [data-act="coach-menu"]')) closePop();
  if (pk.target && !e.target.closest('#picker, [data-act="pick"]')) { closePicker(); if (!a) return; }
  if (a) { handleAct(a.dataset.act, a, e); return; }
  if (e.target.id === 'dialog') { closeDialog(); return; }
  const row = e.target.closest('.step');
  if (row) {
    const key = row.closest('.axis').dataset.axis;
    if (!(ui.focus && ui.focus.id === row.dataset.id)) setFocus(key, row.dataset.id);
    return;
  }
  if (e.target.closest('.col') && !e.target.closest('input, textarea, label, .gap, .axis-head, .sub-head')) clearFocus();
});

function handleAct(act, el) {
  const row = el.closest('.step');
  const id = el.dataset.id || (row && row.dataset.id);
  if (el.closest('#pop')) closePop();
  const axis = el.closest('.axis');
  const key = axis ? axis.dataset.axis : 'main';
  switch (act) {
    case 'cycle': cycle(id, el); break;
    case 'card-menu': cardMenu(el, id); break;
    case 'home': openHome(); break;
    case 'home-close': closeHome(); break;
    case 'home-folder': ui.home.folder = el.dataset.id || null; renderHome(); haptic('soft'); break;
    case 'home-view': state.settings.homeView = el.dataset.v; save(); renderHome(); haptic('soft'); break;
    case 'home-new-folder': homeNewFolder(); break;
    case 'home-new-proj': homeNewProject(el.dataset.id || (ui.home && ui.home.folder)); break;
    case 'open-pid': openProject(id); break;
    case 'proc-menu': procMenu(el, el.dataset.key); break;
    case 'proc-move': procMove(id); break;
    case 'arch-pop': archPop(el, el.dataset.key); break;
    case 'cover': pickCover(id); break;
    case 'cover-del': { const f = folderById(id); if (f) { f.cover = ''; save(); renderHome(); } break; }
    case 'folder-del': deleteFolder(id); break;
    case 'coach-menu': coachMenu(el, id); break;
    case 'interrupt': interrupt(id); break;
    case 'break': case 'coach-break': if (state.brk) endBreak(); else startBreak(); break;
    case 'to-proc': copyToProcess(id); break;
    case 'new-doc': if (window.LF && LF.docs && LF.docs.newDoc) LF.docs.newDoc(id); else { openSide('docs'); if (window.LF && LF.docs && LF.docs.openAttach) LF.docs.openAttach(id); } break;
    case 'to-steps': notesToSteps(id, el.dataset.f); break;
    case 'side-docs': openSide('docs'); if (window.LF && LF.docs && LF.docs.openAttach && id) LF.docs.openAttach(id); break;
    case 'side-toggle': if ($('#side').hidden) openSide(); else closeSide(); break;
    case 'side-tab': openSide(el.dataset.v); break;
    case 'side-close': closeSide(); break;
    case 'loop': showLoop(); break;
    case 'export-pdf': closeMenus(); exportPdf(); break;
    case 'report': closeMenus(); showReport(-1); break;
    case 'report-run': showReport(+el.dataset.i); break;
    case 'proj-version': closeMenus(); newVersion(); break;
    case 'proj-pair': closeMenus(); pairProject(); break;
    case 'role': { const pt = partnerOf(proj()); if (pt && el.dataset.v !== proj().role) switchProject(pt.id); break; }
    case 'pp-up': case 'pp-down': case 'pp-del': ppAct(act, el.dataset.sid); break;
    case 'arch-toggle': ui.archOpen = ui.archOpen || new Set(); if (ui.archOpen.has(el.dataset.folder)) ui.archOpen.delete(el.dataset.folder); else ui.archOpen.add(el.dataset.folder); renderProjMenu(); break;
    case 'status': setStatus(id, el.dataset.v); break;
    case 'prio': togglePrio(id); break;
    case 'ins': insertAt(key, +el.dataset.index); break;
    case 'add': insertAt(key, axisSteps(key).length); break;
    case 'sub': openSub(key, id); break;
    case 'up': moveStep(id, -1); break;
    case 'down': moveStep(id, 1); break;
    case 'del': deleteStep(id); break;
    case 'unfix': { const s = STEPS.get(id); if (s) { mutate(() => { s.at = null; }); haptic('soft'); } break; }
    case 'crumb': {
      const i = +el.dataset.i;
      goTo(i < 0 ? [] : ui.path.slice(0, i + 1));
      break;
    }
    case 'close-sub': closeSub(); break;
    case 'nav-back': navBack(); break;
    case 'coach-mini': case 'coach-open': case 'coach-done': case 'coach-extend': case 'coach-start': case 'coach-park': coachAct(act, el.dataset.id, el); break;
    case 'park-list': closeMenus(); showPark(); break;
    case 'park-new': closeMenus(); openPark(); break;
    case 'park-step': case 'park-del': parkAct(act, el.dataset.pid); break;
    case 'review': closeMenus(); showReport(-1); break;
    case 'backup': exportData(); break;
    case 'unfold': el.dataset.ids.split(',').forEach(x => ui.unfolded.add(x)); render(); haptic('soft'); break;
    case 'fold-toggle': { const p = proj(); p.foldDone = !p.foldDone; ui.unfolded.clear(); save(); render(); haptic('tap'); break; }
    case 'reminders': closeMenus(); showReminders(); break;
    case 'set-remind': state.settings.remind = !state.settings.remind; save(); showReminders(); updateCoach(); haptic('tap'); break;
    case 'set-notify': toggleNotify(); break;
    case 'nav-fwd': navForward(); break;
    case 'unfocus': clearFocus(); haptic('soft'); break;
    case 'dur': {
      const s = STEPS.get(id);
      if (!s || s.children.length || readOnly()) break;
      const d = +el.dataset.d;
      const v = Math.max(0, Math.round(((s.dur || 0) + d) / 5) * 5);
      if (v === s.dur) { haptic('error'); break; }
      pushHistory(); s.dur = v; save();
      row.querySelector('[data-f="dur"]').value = v;
      updateTimes(); row.querySelector('.compact').innerHTML = compactHTML(s);
      haptic('tap');
      break;
    }
    case 'pick': openPicker(el, el.dataset.target === 'step' ? { kind: 'step', id } : { kind: el.dataset.target }); break;
    case 'pk-prev': case 'pk-next': pk.view.setMonth(pk.view.getMonth() + (act === 'pk-prev' ? -1 : 1)); renderPicker(); haptic('soft'); break;
    case 'pk-day': { const d = new Date(+el.dataset.ms), s = new Date(pk.sel); s.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); pk.sel = s.getTime(); renderPicker(); haptic('tap'); break; }
    case 'pk-step': { const s = new Date(pk.sel); if (el.dataset.u === 'h') s.setHours(s.getHours() + +el.dataset.d); else s.setMinutes(Math.round(s.getMinutes() / 5) * 5 + +el.dataset.d); pk.sel = s.getTime(); pk.view = new Date(s.getFullYear(), s.getMonth(), 1); renderPicker(); haptic('soft'); break; }
    case 'pk-now': { pk.sel = roundedNow(0).getTime(); const n = new Date(pk.sel); pk.view = new Date(n.getFullYear(), n.getMonth(), 1); renderPicker(); haptic('tap'); break; }
    case 'pk-ok': pickerApply(); break;
    case 'pk-auto': {
      if (pk.target.kind === 'target') { closePicker(); mutate(() => { proj().target = null; }); haptic('soft'); break; }
      const s = STEPS.get(pk.target.id); closePicker(); if (s) { mutate(() => { s.at = null; }); haptic('soft'); } break;
    }
    case 'pk-cancel': closePicker(); break;
    case 'menu': toggleMenu(el.dataset.menu, el); break;
    case 'proj-open': closeMenus(); switchProject(el.dataset.pid); break;
    case 'proj-new': closeMenus(); createProject(); break;
    case 'proj-dup': closeMenus(); duplicateProject(); break;
    case 'proj-del': closeMenus(); deleteProject(); break;
    case 'export': closeMenus(); exportData(); break;
    case 'cloud': closeMenus(); if (LF.open) LF.open(); break;
    case 'import': closeMenus(); $('#importFile').click(); break;
    case 'sound':
      state.settings.sound = !state.settings.sound; save(); renderMoreMenu();
      if (state.settings.sound) haptic('tap');
      break;
    case 'undo': closeMenus(); undo(); break;
    case 'keys': closeMenus(); showKeys(); break;
    case 'jump-now': jumpToNow(); haptic('soft'); break;
    case 'toast': { const fn = toastFn; $('#toast').classList.remove('show'); if (fn) fn(); break; }
    case 'dlg': {
      const a = dlgActions[+el.dataset.i];
      const inp = $('#dialog input:not([type=checkbox]), #dialog textarea'), v = inp ? inp.value : undefined;  // Eingabe vor dem Schließen sichern
      if (!a || !a.keep) closeDialog();
      if (a && a.fn) a.fn(v);
      break;
    }
  }
}

// Texteingaben: Modell direkt ändern, ohne neu zu zeichnen
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t.matches('[data-f], [data-pf], #pTitle, #pStart')) pendingSnap = snap();
  const row = t.closest && t.closest('.step');
  if (t.matches && t.matches('button')) return;   // Klick auf Chips/Knöpfe nicht in Fokus umwandeln (sonst verschwindet der Knopf vor dem Klick)
  if (row && !(ui.focus && ui.focus.id === row.dataset.id)) setFocus(row.closest('.axis').dataset.axis, row.dataset.id, { scroll: false });
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'pTitle') {
    if (readOnly()) return;
    commitPending();
    proj().title = t.value;
    $('#projName').textContent = t.value || 'Ohne Titel';
    if (ui.path.length) renderCrumbs();
    save(); return;
  }
  if (t.id === 'pStart') {
    const ms = fromLocalInput(t.value);
    if (ms === null) return;
    commitPending();
    proj().start = new Date(ms).toISOString();
    save(); updateTimes(); return;
  }
  if (t.dataset.hf === 'name') { const f = folderById(ui.home.folder); if (f) { f.name = t.value; save(); } return; }
  if (t.dataset.pf) {
    const partner = partnerOf(proj()), ps = partner && partner.steps.find(x => x.id === t.dataset.sid);
    if (!ps) return;
    commitPending();
    if (t.dataset.pf === 'dur') { if (t.value === '') return; ps.dur = Math.max(0, Math.round(+t.value || 0)); } else ps.title = t.value;
    save(); return;
  }
  const f = t.dataset.f;
  const row = t.closest('.step');
  if (!f || !row) return;
  const s = STEPS.get(row.dataset.id);
  if (!s) return;
  if (readOnly() || (isLocked(s) && (f === 'title' || f === 'desc'))) return;
  commitPending();
  if (f === 'dur') {
    if (t.value === '') return;
    s.dur = Math.max(0, Math.round(+t.value || 0));
    save(); updateTimes(); return;
  }
  if (f === 'at') {
    const ms = fromLocalInput(t.value);
    if (ms === null) return;
    s.at = new Date(ms).toISOString();
    save(); updateTimes();
    row.querySelector('.compact').innerHTML = compactHTML(s);
    return;
  }
  s[f] = t.value;
  if (t.tagName === 'TEXTAREA') autosize(t);
  row.querySelector('.compact').innerHTML = compactHTML(s);
  if (f === 'title' && ui.path.includes(s.id)) renderCrumbs();
  save();
  setTimeout(updateNow, 0);
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-f="dur"], [data-f="at"], #pStart')) updateTimes();
});
$('#importFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) importData(f);
  e.target.value = '';
});

document.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t.matches && t.matches('input, textarea, [contenteditable]');
  if (e.key === 'Escape') {
    if ($('#pop')) { closePop(); return; }
    if (!$('#home').hidden && $('#dialog').hidden) { closeHome(); return; }
    hidePeek();
    if (pk.target) { closePicker(); return; }
    if (!$('#dialog').hidden) { closeDialog(); return; }
    if ($$('.menu').some(m => !m.hidden)) { closeMenus(); return; }
    if (typing) { t.blur(); if (t.closest('.step')) clearFocus(); return; }
    if (ui.focus) { clearFocus(); haptic('soft'); return; }
    if (ui.path.length) { closeSub(); return; }
    return;
  }
  if (e.key === 'Enter' && t.id === 'parkIn') { e.preventDefault(); const v = t.value; closeDialog(); savePark(v); return; }
  if (!$('#dialog').hidden) return;
  if (!$('#home').hidden) return;
  if (pk.target) { if (e.key === 'Enter' && t.classList && t.classList.contains('pk-in')) { e.preventDefault(); pickerApply(); } return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (typing && e.key === 'Enter' && t.id === 'ppAdd') {
    e.preventDefault();
    const v = t.value.trim(), partner = partnerOf(proj());
    if (v && partner) { pushHistory(); partner.steps.push(normStep({ title: v, dur: 15, loopAdded: 1 })); save(); renderProcPanel(); haptic('soft'); setTimeout(() => { const n = $('#ppAdd'); if (n) n.focus(); }, 0); }
    return;
  }
  if (typing) {
    if (e.key === 'Enter' && t.classList.contains('e-title')) {
      e.preventDefault();
      t.closest('.step').querySelector('.e-desc').focus();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (t.closest && t.closest('button, a, .menu')) return;
  const f = ui.focus;
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); navBack(); break;
    case 'ArrowRight': e.preventDefault(); navForward(); break;
    case 'ArrowDown':
      e.preventDefault();
      if (e.altKey && f) moveStep(f.id, 1); else moveFocus(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (e.altKey && f) moveStep(f.id, -1); else moveFocus(-1);
      break;
    case 'Enter':
      if (f) { e.preventDefault(); const inp = axisEl(f.axis).querySelector(`.step[data-id="${f.id}"] .e-title`); if (inp) inp.focus(); }
      break;
    case 'n': case 'N': {
      e.preventDefault();
      const key = f ? f.axis : 'main';
      const list = axisSteps(key);
      const i = f ? list.findIndex(s => s.id === f.id) + 1 : list.length;
      insertAt(key, i);
      break;
    }
    case 'x': case 'X': if (f) cycle(f.id); break;
    case 'p': case 'P': if (f) togglePrio(f.id); break;
    case 't': case 'T': if (f) openSub(f.axis, f.id); break;
    case 'j': case 'J': jumpToNow(); break;
    case 'i': case 'I': e.preventDefault(); openPark(); break;
    case 'b': case 'B': if (state.brk) endBreak(); else if (leavesOf(proj().steps).some(x => x.status === 'doing')) startBreak(); else toast('Keine laufende Aufgabe zum Pausieren.'); break;
    case 'w': case 'W': { const pt = partnerOf(proj()); if (pt) switchProject(pt.id); else pairProject(); break; }
    case 'd': case 'D': if ($('#side').hidden) openSide('docs'); else closeSide(); break;
    case '?': showKeys(); break;
  }
});

/* Uhr & Zeitlinie */
function tick() {
  const d = new Date();
  $('#clock').innerHTML = `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. · ${hm(d)}<span class="sec">:${pad(d.getSeconds())}</span>`;
}
let lastMinute = -1;
setInterval(() => {
  tick();
  const m = new Date().getMinutes();
  if (m !== lastMinute) { lastMinute = m; updateTimes(); updateBackupChip(); }
  checkReminders();
  updateCoach();
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimes(); });

function measureTop() { document.documentElement.style.setProperty('--top-h', $('#top').offsetHeight + 'px'); }
const ro = new ResizeObserver(() => { measureTop(); updateNow(); });
ro.observe($('#mainAxis')); ro.observe($('#subAxis')); ro.observe($('#top'));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateNow);

// Daten aus einem anderen Tab übernehmen
window.addEventListener('storage', e => {
  if (e.key !== KEY) return;
  const s = load();
  if (!s) return;
  const keep = state.activeId;
  state = Object.assign(s, { settings: Object.assign({ sound: true }, s.settings) });
  if (s.projects.some(p => p.id === keep)) state.activeId = keep;
  past = []; future = []; pendingSnap = null;
  const a = document.activeElement;
  if (a && a.closest && a.closest('.step, .axis-head')) updateTimes(); else render();
});

/* ---------- Schnittstelle für den Cloud-Abgleich (sync.js) ---------- */
state.projects.forEach(p => known.set(p.id, projJson(p)));
window.LF = {
  get state() { return state; },
  dialog: openDialog, toast, haptic,
  // Fremde Projekte übernehmen: upserts = Liste, removeIds = zu löschende IDs
  adopt(upserts, removeIds) {
    const keep = state.activeId;
    for (const r of upserts) {
      const p = normProject(r);
      const i = state.projects.findIndex(x => x.id === p.id);
      if (i >= 0) state.projects[i] = p; else state.projects.push(p);
      known.set(p.id, projJson(p));
      if (state.tomb) delete state.tomb[p.id];
    }
    for (const id of removeIds) { state.projects = state.projects.filter(x => x.id !== id); known.delete(id); }
    if (!state.projects.length) state.projects.push(newProject());
    state.activeId = state.projects.some(p => p.id === keep) ? keep : state.projects[0].id;
    past = []; future = []; pendingSnap = null;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* gesperrt */ }
    const act = document.activeElement;
    if (act && act.closest && act.closest('.step, .axis-head')) updateTimes(); else render();
  },
  onSave: null, onMenu: null,
  get meta() { return { folders: state.folders || [], updatedAt: state.metaUpdatedAt || 0 }; },
  adoptMeta(data, ts) {
    state.folders = Array.isArray(data && data.folders) ? data.folders.map(normFolder) : [];
    state.metaUpdatedAt = ts; knownMeta = JSON.stringify(state.folders);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* gesperrt */ }
    renderHome();
  },
  // für docs.js (Unterlagen & Prozessbeschreibung)
  proj, step: id => STEPS.get(id) || null, labelOf: id => LABELS.get(id) || '', focusId: () => (ui.focus ? ui.focus.id : null),
  allSteps: () => allOf(proj().steps), mutate, touch: () => { commitPending(); save(); }, render, esc, uid,
  isLocked, readOnly, openSide, closeSide, get sideEl() { return $('#side'); }, print: printHTML,
};
// docs.js wird nach app.js geladen: Panel einhängen, sobald es da ist
addEventListener('load', () => {
  if (state.settings.side && state.settings.side.open) openSide(state.settings.side.tab); else if (window.LF.docs) render();
});

/* ---------- Start ---------- */
knownMeta = JSON.stringify(state.folders);
if (!state.firstUse) state.firstUse = Date.now();
if (!state.persistAsked && navigator.storage && navigator.storage.persist) { state.persistAsked = true; navigator.storage.persist().catch(() => {}); save(); }
updateBackupChip();
tick();
render();
requestAnimationFrame(() => jumpToNow(false));
})();
