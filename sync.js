(() => {
'use strict';
const cfg = window.LF_CONFIG || {};
const ready = !!(cfg.url && cfg.anonKey);
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
let sb = null, user = null, busy = false, again = false, status = ready ? 'nicht angemeldet' : 'nicht eingerichtet', timer;

const S = () => LF.state;
const cs = () => (S().cloud = S().cloud || { linked: false });

function loadSdk() {
  return new Promise((res, rej) => {
    if (window.supabase) return res();
    const s = document.createElement('script');
    s.src = SDK; s.onload = res; s.onerror = () => rej(new Error('Supabase-Skript nicht ladbar (kein Internet?)'));
    document.head.appendChild(s);
  });
}

async function init() {
  if (!ready) return;
  try {
    await loadSdk();
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_e, session) => {
      const was = user; user = session ? session.user : null;
      status = user ? 'verbunden' : 'nicht angemeldet';
      if (user && !was) syncNow(true);
    });
    status = user ? 'verbunden' : 'nicht angemeldet';
    if (user) syncNow();
  } catch (e) { status = 'Fehler'; console.warn(e); }
}

// Abgleich je Projekt: neueste Änderung (updatedAt) gewinnt
async function syncNow(first) {
  if (!sb || !user) return;
  if (busy) { again = true; return; }
  busy = true; status = 'gleicht ab …';
  try {
    const { data: all, error } = await sb.from('projects').select('id,data,updated_at,deleted');
    if (error) throw error;
    // Ordner (Projektverwaltung) liegen in einer eigenen Zeile „__meta“
    const metaRow = all.find(r => r.id === '__meta');
    const rows = all.filter(r => r.id !== '__meta');
    const st = S(), tomb = st.tomb || {};
    const remote = new Map(rows.map(r => [r.id, { data: r.data, ts: Date.parse(r.updated_at), deleted: r.deleted }]));
    const live = rows.filter(r => !r.deleted);

    if (!cs().linked && live.length) {
      // Erster Abgleich auf diesem Gerät: Nutzer entscheidet
      const choice = await new Promise(res => LF.dialog({
        title: 'Cloud gefunden',
        body: `<p>In der Cloud liegen ${live.length} Projekt${live.length === 1 ? '' : 'e'}. Auf diesem Gerät gibt es auch Projekte.</p><p><b>Cloud übernehmen:</b> lokale Projekte werden ersetzt.<br><b>Zusammenführen:</b> beides bleibt (gleiche Projekte: das neuere gewinnt).</p>`,
        actions: [{ label: 'Zusammenführen', fn: () => res('merge') }, { label: 'Cloud übernehmen', cls: 'primary', fn: () => res('cloud') }],
      }));
      if (choice === 'cloud') {
        LF.adopt(live.map(r => Object.assign({}, r.data, { id: r.id, updatedAt: Date.parse(r.updated_at) })), st.projects.filter(p => !remote.has(p.id) || remote.get(p.id).deleted).map(p => p.id));
        if (metaRow) LF.adoptMeta(metaRow.data, Date.parse(metaRow.updated_at));
        cs().linked = true; status = 'verbunden'; busy = false; return;
      }
    }

    const pull = [], drop = [], push = [];
    for (const p of st.projects) {
      const r = remote.get(p.id);
      if (!r) push.push({ id: p.id, data: p, ts: p.updatedAt || Date.now(), deleted: false });
      else if (r.deleted) { if ((p.updatedAt || 0) > r.ts) push.push({ id: p.id, data: p, ts: p.updatedAt, deleted: false }); else drop.push(p.id); }
      else if (r.ts > (p.updatedAt || 0)) pull.push(Object.assign({}, r.data, { id: p.id, updatedAt: r.ts }));
      else if ((p.updatedAt || 0) > r.ts) push.push({ id: p.id, data: p, ts: p.updatedAt, deleted: false });
    }
    for (const [id, r] of remote) {
      if (r.deleted || st.projects.some(p => p.id === id)) continue;
      if (tomb[id] && tomb[id] > r.ts) push.push({ id, data: {}, ts: tomb[id], deleted: true });
      else pull.push(Object.assign({}, r.data, { id, updatedAt: r.ts }));
    }
    for (const [id, t] of Object.entries(tomb)) if (!remote.has(id)) push.push({ id, data: {}, ts: t, deleted: true });

    const lm = LF.meta, rts = metaRow ? Date.parse(metaRow.updated_at) : 0;
    if (metaRow && rts > lm.updatedAt) LF.adoptMeta(metaRow.data, rts);
    else if (lm.updatedAt > rts) push.push({ id: '__meta', data: { folders: lm.folders }, ts: lm.updatedAt, deleted: false });
    if (push.length) {
      const { error: e2 } = await sb.from('projects').upsert(push.map(x => ({ id: x.id, data: x.data, updated_at: new Date(x.ts).toISOString(), deleted: x.deleted })), { onConflict: 'user_id,id' });
      if (e2) throw e2;
    }
    if (pull.length || drop.length) LF.adopt(pull, drop);
    cs().linked = true; status = 'verbunden';
    if (first) LF.toast('Cloud verbunden');
  } catch (e) { status = 'Fehler'; console.warn(e); LF.toast('Cloud-Abgleich fehlgeschlagen: ' + (e.message || e)); }
  busy = false;
  if (again) { again = false; syncNow(); }
}

function open() {
  if (!ready) {
    LF.dialog({ title: 'Cloud-Sync', body: '<p>Noch nicht eingerichtet. In <code>config.js</code> fehlen URL und anon key aus Supabase.</p>', actions: [{ label: 'OK', cls: 'primary' }] });
    return;
  }
  if (user) {
    LF.dialog({ title: 'Cloud-Sync', body: `<p>Angemeldet als ${user.email.replace(/[<>&]/g, '')}.<br>Status: ${status}</p>`, actions: [
      { label: 'Abmelden', fn: async () => { await sb.auth.signOut(); cs().linked = false; } },
      { label: 'Jetzt abgleichen', cls: 'primary', fn: () => syncNow(true) },
    ] });
    return;
  }
  LF.dialog({ title: 'Cloud-Login', body: '<p>E-Mail eingeben. Du bekommst einen Link zum Anmelden (kein Passwort).</p><input type="email" placeholder="name@example.com" autocomplete="email" style="width:100%">', actions: [
    { label: 'Abbrechen' },
    { label: 'Link senden', cls: 'primary', fn: async email => {
      email = (email || '').trim();
      if (!email) return LF.toast('Bitte E-Mail eingeben');
      if (!sb) return LF.toast('Cloud noch nicht geladen');
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      LF.toast(error ? 'Fehler: ' + error.message : 'Link gesendet. Bitte E-Mail öffnen.');
    } },
  ] });
}

LF.label = () => status;
// für docs.js: Dateien in Supabase Storage (Bucket „files“)
LF.cloud = { get sb() { return sb; }, get user() { return user; } };
LF.open = open;
LF.onSave = () => { if (!user) return; clearTimeout(timer); timer = setTimeout(() => syncNow(), 1500); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
init();
})();
