"use strict";
const VERSION = "18.11.2026 · 4";
const APP_ID = "la-trainingsgruppe";

/* ───────────── Hilfen ───────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const appUrl = () => location.origin + location.pathname;
const initials = n => (String(n || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2) || "?").toUpperCase();
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "du";
const ROLE_LABEL = { admin: "Admin", trainer: "Trainer", athlete: "Athlet" };
const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "", "de", { sensitivity: "base" });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2));

/* Datum (immer lokale Kalendertage als "YYYY-MM-DD") */
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => addDays(s, -((parseIso(s).getDay() + 6) % 7));
const todayIso = () => iso(new Date());
const dowOf = s => (parseIso(s).getDay() + 6) % 7;
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WDL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const dm = s => { const d = parseIso(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const fmtDay = s => `${WD[dowOf(s)]}, ${dm(s)}`;
const fmtLong = s => { const d = parseIso(s); return `${WDL[dowOf(s)]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };
function isoWeek(s) {
  const d = parseIso(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const weekLabel = mon => `KW ${isoWeek(mon)} · ${dm(mon)}–${dm(addDays(mon, 6))}`;
const hhmm = t => t ? String(t).slice(0, 5) : "";

function deErr(e) {
  const m = (e && (e.message || e.error_description)) || String(e || "Unbekannter Fehler");
  const map = [
    [/Invalid login credentials/i, "E-Mail oder Passwort ist falsch."],
    [/Email not confirmed/i, "Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail)."],
    [/already registered|already been registered|user already exists/i, "Für diese E-Mail gibt es schon ein Konto."],
    [/Password should be at least (\d+)/i, (_, n) => `Das Passwort muss mindestens ${n} Zeichen haben.`],
    [/New password should be different/i, "Das neue Passwort muss sich vom alten unterscheiden."],
    [/rate limit|too many requests|security purposes/i, "Zu viele Versuche. Bitte warte ein paar Minuten."],
    [/Failed to fetch|NetworkError|Load failed|network/i, "Keine Verbindung zum Server. Bist du online?"],
    [/JSON object requested|contain 0 rows|no rows/i, "Keine Berechtigung für diese Änderung."],
    [/row-level security|permission denied/i, "Keine Berechtigung für diese Änderung."],
    [/plan_groups_name_key/i, "Eine Trainingsgruppe mit diesem Namen gibt es schon."],
    [/exercises_name_uq/i, "Eine Übung mit diesem Namen gibt es schon."],
    [/duplicate key/i, "Diesen Eintrag gibt es schon."],
    [/Payload too large|exceeded the maximum allowed size|too large/i, "Die Datei ist zu groß (max. 50 MB)."],
    [/mime type|invalid_mime_type/i, "Dieses Videoformat wird nicht unterstützt (MP4, MOV oder WebM)."],
    [/valid email|invalid format|Unable to validate email/i, "Bitte gib eine gültige E-Mail-Adresse ein."],
    [/Invalid API key|No API key/i, "Der Supabase-Schlüssel ist ungültig."]
  ];
  for (const [re, t] of map) { const x = m.match(re); if (x) return typeof t === "function" ? t(...x) : t; }
  return m;
}

function toast(msg, kind) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "toast", kind === "error" ? 4500 : 2600);
}
function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

/* ───────────── Darstellung (pro Gerät) ───────────── */
const prefs = Object.assign({ theme: "system", textSize: "normal" }, LS.get("la_prefs", {}));
const darkMq = matchMedia("(prefers-color-scheme: dark)");
function applyPrefs() {
  const r = document.documentElement;
  if (prefs.theme === "system") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", prefs.theme);
  r.dataset.text = prefs.textSize;
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && darkMq.matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0A0A0A" : "#F4F4F3";
}
darkMq.addEventListener?.("change", applyPrefs);
function setPref(k, v) { prefs[k] = v; LS.set("la_prefs", prefs); applyPrefs(); render(); }

/* ───────────── Backend: Supabase ───────────── */
const BACKUP_TABLES = ["plan_groups", "plans", "plan_sheets", "exercises", "sessions", "session_weeks", "attendance", "attendance_private", "attendance_log"];
const CONFLICT = { attendance: "session_id,user_id", attendance_private: "session_id,user_id", session_weeks: "week_start" };

function makeSupabaseBackend(url, key) {
  const sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "la-auth" }
  });
  const ok = r => { if (r.error) throw r.error; return r.data; };
  const T = n => sb.from(n);
  return {
    kind: "supabase", host: new URL(url).host,
    async session() { return ok(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((ev, s) => setTimeout(() => cb(ev, s), 0)); },
    async signIn(email, password) { return ok(await sb.auth.signInWithPassword({ email, password })).session; },
    async signUp(email, password, name) {
      const d = ok(await sb.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: appUrl() } }));
      if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) throw new Error("User already registered");
      return d.session;
    },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })); },
    async setPassword(password) { ok(await sb.auth.updateUser({ password })); },
    async myProfile(id) { return ok(await T("profiles").select("*").eq("id", id).maybeSingle()); },
    async profiles() { return ok(await T("profiles").select("*")); },
    async emails() { return ok(await sb.rpc("member_emails")) || []; },
    async updateProfile(id, patch) { return ok(await T("profiles").update(patch).eq("id", id).select().single()); },
    async deleteUser(id) { ok(await sb.rpc("delete_user", { target: id })); },
    async settings() { return ok(await T("team_settings").select("*").eq("id", 1).maybeSingle()); },
    async updateSettings(patch) { return ok(await T("team_settings").update(patch).eq("id", 1).select().single()); },
    async groups() { return ok(await T("plan_groups").select("*").order("sort_order").order("name")); },
    async insertGroup(row) { return ok(await T("plan_groups").insert(row).select().single()); },
    async updateGroup(id, patch) { return ok(await T("plan_groups").update(patch).eq("id", id).select().single()); },
    async deleteGroup(id) { ok(await T("plan_groups").delete().eq("id", id)); },
    // Pläne
    async plans() { return ok(await T("plans").select("*").order("valid_from", { ascending: false }).order("created_at", { ascending: false })); },
    async planSheets(planId) { return ok(await T("plan_sheets").select("*").eq("plan_id", planId).order("sort_order")); },
    async savePlan(plan, sheets) {
      const p = ok(await T("plans").insert(plan).select().single());
      try { if (sheets.length) ok(await T("plan_sheets").insert(sheets.map(s => Object.assign({}, s, { plan_id: p.id })))); }
      catch (e) { await T("plans").delete().eq("id", p.id); throw e; }
      return p;
    },
    async deletePlan(id) { ok(await T("plans").delete().eq("id", id)); },
    // Übungen
    async exercises() { return ok(await T("exercises").select("*").order("name")); },
    async saveExercise(row) {
      if (row.id) { const { id, ...patch } = row; return ok(await T("exercises").update(patch).eq("id", id).select().single()); }
      return ok(await T("exercises").insert(row).select().single());
    },
    async deleteExercise(id) { ok(await T("exercises").delete().eq("id", id)); },
    async uploadVideo(file) {
      const ext = ((file.name || "").split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `${uid()}.${ext}`;
      ok(await sb.storage.from("uebungen").upload(path, file, { contentType: file.type || "video/mp4", upsert: false }));
      return path;
    },
    async videoUrl(path) { return ok(await sb.storage.from("uebungen").createSignedUrl(path, 3600)).signedUrl; },
    async deleteVideo(path) { await sb.storage.from("uebungen").remove([path]); },
    // Termine
    async ensureWeek(monday) { ok(await sb.rpc("ensure_week", { p_week: monday })); },
    async sessions(from, to) { return ok(await T("sessions").select("*").gte("session_date", from).lte("session_date", to).order("session_date").order("start_time")); },
    async saveSession(row) {
      if (row.id) { const { id, ...patch } = row; return ok(await T("sessions").update(patch).eq("id", id).select().single()); }
      return ok(await T("sessions").insert(row).select().single());
    },
    async deleteSession(id) { ok(await T("sessions").delete().eq("id", id)); },
    async attendance(ids) { return ids.length ? ok(await T("attendance").select("*").in("session_id", ids)) : []; },
    async attendancePrivate(ids) { return ids.length ? ok(await T("attendance_private").select("*").in("session_id", ids)) : []; },
    async attendanceLog(ids) { return ids.length ? ok(await T("attendance_log").select("*").in("session_id", ids).order("at")) : []; },
    async respond(session, user, status, reason, note) { ok(await sb.rpc("respond", { p_session: session, p_user: user, p_status: status, p_reason: reason || null, p_note: note || "" })); },
    async setMark(session, user, mark) { ok(await sb.rpc("set_mark", { p_session: session, p_user: user, p_mark: mark })); },
    // Backup
    async dump(table) {
      const out = []; const size = 1000;
      for (let from = 0; ; from += size) {
        const rows = ok(await T(table).select("*").range(from, from + size - 1));
        out.push(...rows); if (rows.length < size) break;
      }
      return out;
    },
    async upsert(table, rows) {
      for (let i = 0; i < rows.length; i += 500) ok(await T(table).upsert(rows.slice(i, i + 500), CONFLICT[table] ? { onConflict: CONFLICT[table] } : undefined));
    }
  };
}

/* ───────────── Backend: Demo (nur dieses Gerät) ─────────────
   Bildet die wichtigsten Regeln aus den SQL-Dateien nach, damit man alles gefahrlos ausprobieren kann. */
function demoSeed() {
  const now = new Date().toISOString(), mon = mondayOf(todayIso());
  const g = (id, name, s) => ({ id, name, sort_order: s });
  const p = (id, display_name, role, approved, plan_group_id) => ({ id, display_name, role, approved, plan_group_id, created_at: now });
  const it = (text, ...details) => ({ text, details });
  const day = (d, info, title, items) => ({ day: d, info, title, titleDetails: [], items });
  const days = sprint => [
    day(0, "", "Kraft Beine", [it("Rad", "Min 10min"), it("Reißen/ Umsetzen", "3x5"), it("BSS", "3x5"), it("rum.Kh", "3x5"), it("Soleus", "3x20")]),
    day(1, "LAA (17:25)", "Technik Beschleunigung / Tempoläufe", [it("Einlaufen", "800m"), it("Gymnastik"), it("Koordination"), it("Technik Sprintposition", "3x3 p.S"),
      sprint ? it("Tempoläufe", "6x120m I.2  P: 6 min", "Jungs 14,0-14,4", "Mädels 16,0") : it("Tempoläufe I.2", "150/200/300/200/150", "P: 6,8,12,8"), it("Auslaufen", "400m")]),
    day(2, "", "Mobi / Rumpf", [it("Individuelle Erwärmung"), it("Mobilisation"), it("Rumpfzirkel", "10 Min")]),
    day(3, "LAA (17:55)", "Sprung / Sprint", [it("Seilspringen", "5x100"), it("Dropjumps"), it("Hürdensprünge", "(76/76/84/84/84/91)"), it("Tempoläufe", sprint ? "2x5 60m I.2" : "2x3 150m")]),
    day(4, "", "Kraft Beine", [it("Rad", "Min 10"), it("BSS-Jump", "3x5 p.S"), it("OBS", "3x10"), it("NHE", "3x3")]),
    day(5, "LAA 9:55", "Technik fliegend / Tempoläufe lang", [it("Einlaufen", "800m"), it("Hütchenläufe", "5x 60m"), it("Tempoläufe", sprint ? "2x 200/150/100" : "2x 500/300/100")]),
    day(6, "Optional", "Kraft Oberkörper", [it("Rad", "0:15"), it("AR SG", "3x20"), it("Bank", "3x5"), it("Klimmzug", "3x5")])
  ];
  const sessions = [], weeks = [];
  for (const w of [addDays(mon, -7), mon, addDays(mon, 7)]) {
    weeks.push({ week_start: w });
    [[1, "17:25:00"], [3, "17:55:00"], [5, "09:55:00"]].forEach(([d, t], k) =>
      sessions.push({ id: `s-${w}-${k}`, session_date: addDays(w, d), start_time: t, title: "Training", location: "LAA", note: "", cancelled: false, created_at: now }));
  }
  const att = [], priv = [], log = [];
  const respond = (sid, u, status, reason, note) => {
    att.push({ session_id: sid, user_id: u, status, coach_mark: null, updated_at: now });
    if (status === "no") priv.push({ session_id: sid, user_id: u, reason, note: note || "" });
    log.push({ id: log.length + 1, session_id: sid, user_id: u, status, reason: status === "no" ? reason : null, coach_mark: null, changed_by: u, at: now });
  };
  sessions.slice(0, 3).forEach(s => ["u1", "u2", "u3", "u4", "u5"].forEach(u => respond(s.id, u, "yes")));
  respond(sessions[1].id, "u6", "no", "uni", "Klausur");
  respond(sessions[3].id, "u1", "yes"); respond(sessions[3].id, "u2", "yes"); respond(sessions[3].id, "u3", "no", "krank", "");
  log.unshift({ id: 0, session_id: sessions[3].id, user_id: "u3", status: "yes", reason: null, coach_mark: null, changed_by: "u3", at: new Date(Date.now() - 86400000).toISOString() });
  return {
    settings: { id: 1, team_name: "LT DSHS Köln (Demo)", plan_visibility: "all", session_template: [{ dow: 2, time: "17:25", location: "LAA" }, { dow: 4, time: "17:55", location: "LAA" }, { dow: 6, time: "09:55", location: "LAA" }] },
    plan_groups: [g("g1", "Kurzsprint", 1), g("g2", "Langsprint", 2), g("g3", "Stab", 3), g("g4", "Alternativplan", 4)],
    profiles: [
      p("u-admin", "Alex Admin", "admin", true, "g1"), p("u-trainer", "Toni Trainer", "trainer", true, null),
      p("u1", "Lena Berger", "athlete", true, "g1"), p("u2", "Jonas Keller", "athlete", true, "g1"),
      p("u3", "Mia Schulz", "athlete", true, "g2"), p("u4", "Paul Wagner", "athlete", true, "g2"),
      p("u5", "Sara Neumann", "athlete", true, "g3"), p("u6", "Noah Fischer", "athlete", true, null),
      p("u7", "Kim Neu", "athlete", false, null)
    ],
    plans: [{ id: "p1", valid_from: addDays(mon, -7), title: "Wintersaison", season: "Wintersaison", goal: "Vorbereitung auf die Hallensaison", source_name: "Demo", extra_sheets: [], created_at: now }],
    plan_sheets: [
      { id: "ps1", plan_id: "p1", name: "Kurzsprint", group_id: "g1", sort_order: 1, data: { days: days(true) } },
      { id: "ps2", plan_id: "p1", name: "Langsprint", group_id: "g2", sort_order: 2, data: { days: days(false) } }
    ],
    exercises: [
      { id: "e1", name: "Oberschenkelstrecker Maschine", abbreviation: "OBS", category: "Kraft", description: "", video_url: "", video_path: "" },
      { id: "e2", name: "Rumänisches Kreuzheben", abbreviation: "Rum.Kh", category: "Kraft", description: "Hüftbreiter Stand, Knie leicht gebeugt, Rücken gerade; Hantel nah am Bein bis unters Knie absenken.", video_url: "", video_path: "" },
      { id: "e3", name: "Nordic Hamstring Exercise", abbreviation: "NHE", category: "Kraft", description: "Exzentrisch langsam nach vorne ablassen.", video_url: "", video_path: "" },
      { id: "e4", name: "Bulgarian Split Squat-Sprünge", abbreviation: "BSS-Jump", category: "Sprung", description: "", video_url: "", video_path: "" }
    ],
    sessions, session_weeks: weeks, attendance: att, attendance_private: priv, attendance_log: log
  };
}

function makeDemoBackend() {
  const KEY = "la_demo_db_v2";
  let db = LS.get(KEY, null) || demoSeed();
  const save = () => LS.set(KEY, db);
  const me = () => LS.get("la_demo_user", "u-admin");
  const meRow = () => db.profiles.find(p => p.id === me());
  const myRole = () => { const m = meRow(); return m && m.approved ? m.role : null; };
  const staff = () => ["admin", "trainer"].includes(myRole());
  const deny = msg => { throw new Error(msg || "Keine Berechtigung für diese Änderung."); };
  const needMember = () => { if (!myRole()) deny(); };
  const needStaff = () => { if (!staff()) deny(); };
  const otherAdmins = id => db.profiles.some(p => p.role === "admin" && p.approved && p.id !== id);
  const email = p => p.id.replace("u-", "") + "@beispiel.de";
  const wait = () => new Promise(r => setTimeout(r, 40));
  const now = () => new Date().toISOString();
  return {
    kind: "demo", host: "Demo auf diesem Gerät",
    users: () => db.profiles.slice().sort(byName),
    switchUser(id) { LS.set("la_demo_user", id); },
    reset() { db = demoSeed(); save(); LS.set("la_demo_user", "u-admin"); },
    async session() { const m = meRow(); return m ? { user: { id: m.id, email: email(m) } } : null; },
    onAuth() {},
    async signOut() {},
    async myProfile(id) { await wait(); return clone(db.profiles.find(p => p.id === id) || null); },
    async profiles() { return clone(db.profiles.filter(p => p.id === me() || staff() || (p.approved && myRole()))); },
    async emails() { return staff() ? db.profiles.map(p => ({ id: p.id, email: email(p) })) : []; },
    async updateProfile(id, patch) {
      const old = db.profiles.find(p => p.id === id), my = myRole() || "";
      if (!old || !(id === me() || staff())) deny();
      const n = Object.assign({}, old, patch);
      if (my !== "admin") {
        if (n.role !== old.role) deny("Nur Admins dürfen Rollen ändern");
        if (old.id !== me() && old.role !== "athlete") deny("Nur Admins dürfen Trainer- und Admin-Profile ändern");
      }
      if (!["admin", "trainer"].includes(my) && (n.approved !== old.approved || n.plan_group_id !== old.plan_group_id))
        deny("Freischaltung und Trainingsgruppe dürfen nur Trainer und Admins ändern");
      if (old.role === "admin" && old.approved && (n.role !== "admin" || !n.approved) && !otherAdmins(old.id)) deny("Es muss mindestens einen Admin geben");
      Object.assign(old, patch); save(); return clone(old);
    },
    async deleteUser(id) {
      const t = db.profiles.find(p => p.id === id), my = myRole() || "";
      if (!t) return;
      if (id !== me() && !(my === "admin" || (my === "trainer" && t.role === "athlete" && !t.approved))) deny("Keine Berechtigung, dieses Konto zu löschen");
      if (t.role === "admin" && t.approved && !otherAdmins(id)) deny("Der letzte Admin kann nicht gelöscht werden");
      db.profiles = db.profiles.filter(p => p.id !== id);
      ["attendance", "attendance_private", "attendance_log"].forEach(k => db[k] = db[k].filter(r => r.user_id !== id));
      save();
    },
    async settings() { return myRole() ? clone(db.settings) : null; },
    async updateSettings(patch) {
      needStaff();
      if ("team_name" in patch && patch.team_name !== db.settings.team_name && myRole() !== "admin") deny("Nur Admins dürfen den Teamnamen ändern");
      Object.assign(db.settings, patch); save(); return clone(db.settings);
    },
    async groups() { return myRole() ? clone(db.plan_groups.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) : []; },
    async insertGroup(row) {
      needStaff();
      if (db.plan_groups.some(g => g.name === row.name)) deny("Eine Trainingsgruppe mit diesem Namen gibt es schon.");
      const g = Object.assign({ id: uid(), sort_order: 0 }, row); db.plan_groups.push(g); save(); return clone(g);
    },
    async updateGroup(id, patch) {
      needStaff();
      if (patch.name && db.plan_groups.some(g => g.name === patch.name && g.id !== id)) deny("Eine Trainingsgruppe mit diesem Namen gibt es schon.");
      const g = db.plan_groups.find(x => x.id === id); Object.assign(g, patch); save(); return clone(g);
    },
    async deleteGroup(id) {
      needStaff();
      db.plan_groups = db.plan_groups.filter(g => g.id !== id);
      db.profiles.forEach(p => { if (p.plan_group_id === id) p.plan_group_id = null; });
      db.plan_sheets.forEach(s => { if (s.group_id === id) s.group_id = null; }); save();
    },
    async plans() { needMember(); return clone(db.plans.slice().sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.created_at.localeCompare(a.created_at))); },
    async planSheets(planId) {
      needMember();
      const mine = (meRow() || {}).plan_group_id;
      return clone(db.plan_sheets.filter(s => s.plan_id === planId && (staff() || db.settings.plan_visibility === "all" || s.group_id === mine)).sort((a, b) => a.sort_order - b.sort_order));
    },
    async savePlan(plan, sheets) {
      needStaff();
      const p = Object.assign({ id: uid(), created_at: now(), created_by: me() }, plan); db.plans.push(p);
      sheets.forEach(s => db.plan_sheets.push(Object.assign({ id: uid() }, s, { plan_id: p.id }))); save(); return clone(p);
    },
    async deletePlan(id) { needStaff(); db.plans = db.plans.filter(p => p.id !== id); db.plan_sheets = db.plan_sheets.filter(s => s.plan_id !== id); save(); },
    async exercises() { needMember(); return clone(db.exercises.slice().sort((a, b) => a.name.localeCompare(b.name, "de"))); },
    async saveExercise(row) {
      needMember();
      const dup = db.exercises.find(e => e.name.trim().toLowerCase() === row.name.trim().toLowerCase() && e.id !== row.id);
      if (dup) deny("Eine Übung mit diesem Namen gibt es schon.");
      if (row.id) {
        const e = db.exercises.find(x => x.id === row.id);
        if (!staff() && e.created_by !== me()) deny();
        Object.assign(e, row, { updated_at: now() }); save(); return clone(e);
      }
      const e = Object.assign({ id: uid(), abbreviation: "", category: "", description: "", video_url: "", video_path: "", created_by: me(), created_at: now() }, row);
      db.exercises.push(e); save(); return clone(e);
    },
    async deleteExercise(id) {
      const e = db.exercises.find(x => x.id === id);
      if (!e || (!staff() && e.created_by !== me())) deny();
      db.exercises = db.exercises.filter(x => x.id !== id); save();
    },
    async uploadVideo() { deny("Videos hochladen geht im Demo-Modus nicht. Ein Link funktioniert."); },
    async videoUrl() { return ""; },
    async deleteVideo() {},
    async ensureWeek(monday) {
      needMember();
      if (db.session_weeks.some(w => w.week_start === monday)) return;
      db.session_weeks.push({ week_start: monday });
      (db.settings.session_template || []).forEach(t => db.sessions.push({ id: uid(), session_date: addDays(monday, t.dow - 1), start_time: t.time ? t.time + ":00" : null, title: "Training", location: t.location || "", note: "", cancelled: false, created_at: now() }));
      save();
    },
    async sessions(from, to) { needMember(); return clone(db.sessions.filter(s => s.session_date >= from && s.session_date <= to).sort((a, b) => (a.session_date + (a.start_time || "")).localeCompare(b.session_date + (b.start_time || "")))); },
    async saveSession(row) {
      needStaff();
      if (row.id) { const s = db.sessions.find(x => x.id === row.id); Object.assign(s, row); save(); return clone(s); }
      const s = Object.assign({ id: uid(), title: "Training", location: "", note: "", cancelled: false, created_at: now() }, row); db.sessions.push(s); save(); return clone(s);
    },
    async deleteSession(id) {
      needStaff(); db.sessions = db.sessions.filter(s => s.id !== id);
      ["attendance", "attendance_private", "attendance_log"].forEach(k => db[k] = db[k].filter(r => r.session_id !== id)); save();
    },
    async attendance(ids) { needMember(); return clone(db.attendance.filter(a => ids.includes(a.session_id))); },
    async attendancePrivate(ids) { needMember(); return clone(db.attendance_private.filter(a => ids.includes(a.session_id) && (staff() || a.user_id === me()))); },
    async attendanceLog(ids) { needMember(); return clone(db.attendance_log.filter(a => ids.includes(a.session_id) && (staff() || a.user_id === me())).sort((a, b) => a.at.localeCompare(b.at))); },
    async respond(sid, user, status, reason, note) {
      needMember();
      if (user !== me() && !staff()) deny("Du kannst nur für dich selbst zu- oder absagen");
      if (status === "no" && !reason) deny("Bitte wähle einen Absagegrund");
      if (status === "no" && reason === "sonstiges" && !String(note || "").trim()) deny("Bitte beschreibe kurz den Grund");
      const s = db.sessions.find(x => x.id === sid); if (!s) deny("Termin nicht gefunden"); if (s.cancelled) deny("Dieser Termin ist abgesagt");
      let a = db.attendance.find(x => x.session_id === sid && x.user_id === user);
      if (!a) { a = { session_id: sid, user_id: user, status: null, coach_mark: null }; db.attendance.push(a); }
      a.status = status; a.updated_at = now();
      db.attendance_private = db.attendance_private.filter(x => !(x.session_id === sid && x.user_id === user));
      if (status === "no") db.attendance_private.push({ session_id: sid, user_id: user, reason, note: note || "" });
      db.attendance_log.push({ id: Date.now(), session_id: sid, user_id: user, status, reason: status === "no" ? reason : null, coach_mark: null, changed_by: me(), at: now() });
      save();
    },
    async setMark(sid, user, mark) {
      if (!staff()) deny("Nur Trainer und Admins können markieren");
      let a = db.attendance.find(x => x.session_id === sid && x.user_id === user);
      if (!a) { a = { session_id: sid, user_id: user, status: null, coach_mark: null }; db.attendance.push(a); }
      a.coach_mark = mark; a.updated_at = now();
      db.attendance_log.push({ id: Date.now(), session_id: sid, user_id: user, status: null, reason: null, coach_mark: mark || "none", changed_by: me(), at: now() });
      save();
    },
    async dump(table) { if (myRole() !== "admin") deny(); return clone(db[table] || []); },
    async upsert(table, rows) {
      if (myRole() !== "admin") deny();
      const keys = (CONFLICT[table] || "id").split(",");
      const list = db[table] = db[table] || [];
      rows.forEach(r => { const i = list.findIndex(x => keys.every(k => x[k] === r[k])); if (i >= 0) list[i] = Object.assign(list[i], r); else list.push(clone(r)); });
      save();
    }
  };
}

/* ───────────── Zustand ───────────── */
const S = {
  be: null, user: null, me: null, profiles: [], emails: {}, groups: [], settings: null,
  plans: [], sheetCache: {}, exercises: [], sessions: [], att: [], priv: [], log: [],
  tab: LS.get("la_tab", "start"), authMode: "login", authMsg: null, recovery: false, loadError: null,
  planView: "week", planWeek: null, planSheet: LS.get("la_sheet", null), exSearch: "", showPast: false, scrolledToday: false
};
const role = () => S.me && S.me.role;
const isAdmin = () => role() === "admin";
const isStaff = () => role() === "admin" || role() === "trainer";
const canEdit = p => p.id === S.me.id || isAdmin() || (role() === "trainer" && p.role === "athlete");
const groupName = id => (S.groups.find(g => g.id === id) || {}).name;
const pending = () => S.profiles.filter(p => !p.approved && p.role === "athlete");
const person = id => S.profiles.find(p => p.id === id);

function connection() {
  const c = window.LA_CONFIG || {};
  if (c.supabaseUrl && c.supabaseKey) return { url: c.supabaseUrl.trim(), key: c.supabaseKey.trim(), source: "config" };
  const l = LS.get("la_conn", null);
  return l && l.url && l.key ? { url: l.url, key: l.key, source: "local" } : null;
}

async function loadSessions() {
  const mon = mondayOf(todayIso());
  await Promise.all([S.be.ensureWeek(mon), S.be.ensureWeek(addDays(mon, 7))]).catch(() => {});
  S.sessions = await S.be.sessions(addDays(mon, -35), addDays(mon, 20));
  const ids = S.sessions.map(s => s.id);
  [S.att, S.priv, S.log] = await Promise.all([S.be.attendance(ids), S.be.attendancePrivate(ids), S.be.attendanceLog(ids)]);
}
async function loadAll() {
  S.loadError = null;
  S.me = await S.be.myProfile(S.user.id);
  if (!S.me || !S.me.approved) { S.profiles = []; S.groups = []; S.settings = null; return; }
  const [profiles, groups, settings, plans, exercises] = await Promise.all([S.be.profiles(), S.be.groups(), S.be.settings(), S.be.plans(), S.be.exercises()]);
  S.profiles = profiles.sort(byName); S.groups = groups; S.settings = settings; S.plans = plans; S.exercises = exercises;
  S.sheetCache = {};
  S.emails = {};
  if (isStaff()) (await S.be.emails()).forEach(r => S.emails[r.id] = r.email);
  await loadSessions();
  const plan = planForWeek(mondayOf(todayIso()));
  if (plan) await sheetsOf(plan);
}
async function refresh() {
  if (S.user) { try { await loadAll(); } catch (e) { S.loadError = deErr(e); } }
  render();
}

/* ───────────── Plan-Logik ───────────── */
const planForWeek = mon => S.plans.find(p => p.valid_from <= mon) || null;
async function sheetsOf(plan) {
  if (!S.sheetCache[plan.id]) S.sheetCache[plan.id] = await S.be.planSheets(plan.id);
  return S.sheetCache[plan.id];
}
function defaultSheet(sheets) {
  if (!sheets.length) return null;
  return sheets.find(s => s.name === S.planSheet) || sheets.find(s => s.group_id && s.group_id === S.me.plan_group_id) || sheets[0];
}
const norm = s => String(s || "").toLowerCase().replace(/[\s.:;,/()\-–]+/g, "");
function findExercise(text) {
  const t = norm(text); if (!t) return null;
  let best = null, score = 0;
  for (const e of S.exercises) {
    const n = norm(e.name), a = norm(e.abbreviation);
    let sc = 0;
    if (t === n || (a && t === a)) sc = 100;
    else if (a && a.length >= 2 && new RegExp("(^|[^a-zäöüß])" + e.abbreviation.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-zäöüß])", "i").test(text)) sc = 60 + a.length;
    else if (a && t.length >= 4 && a.startsWith(t)) sc = 50;
    else if (n.length >= 5 && t.includes(n)) sc = 40 + n.length / 10;
    else if (t.length >= 5 && n.includes(t)) sc = 30;
    if (sc > score) { score = sc; best = e; }
  }
  return best;
}

/* ───────────── Termin-Logik ───────────── */
const REASONS = { krank: "Krank", verletzt: "Verletzt", uni: "Uni / Prüfung", arbeit: "Arbeit", sonstiges: "Sonstiges" };
const attOf = (sid, u) => S.att.find(a => a.session_id === sid && a.user_id === u);
const privOf = (sid, u) => S.priv.find(a => a.session_id === sid && a.user_id === u);
const logOf = (sid, u) => S.log.filter(a => a.session_id === sid && a.user_id === u && a.status);
const flipped = (sid, u) => { const l = logOf(sid, u); const cur = attOf(sid, u); return cur && cur.status === "no" && l.some(x => x.status === "yes"); };
const sessionKey = s => s.session_date + " " + (s.start_time || "99:99");
function rosterOf(s) {
  const ids = new Set(S.profiles.filter(p => p.approved && p.role === "athlete").map(p => p.id));
  S.att.filter(a => a.session_id === s.id && a.status).forEach(a => ids.add(a.user_id));
  return [...ids].map(person).filter(Boolean).sort(byName);
}
function countsOf(s) {
  const r = rosterOf(s); let yes = 0, no = 0;
  r.forEach(p => { const a = attOf(s.id, p.id); if (a && a.status === "yes") yes++; else if (a && a.status === "no") no++; });
  return { yes, no, open: r.length - yes - no };
}
function nextSession() {
  const t = todayIso(), now = new Date(Date.now() - 2 * 3600000).toTimeString().slice(0, 5);
  return S.sessions.find(s => !s.cancelled && (s.session_date > t || (s.session_date === t && (!s.start_time || hhmm(s.start_time) >= now)))) || null;
}

/* ───────────── Ansichten ───────────── */
const svg = (p, sw = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  start: svg('<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  plan: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10h7M8.5 14h7M8.5 18h4"/>'),
  termine: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.6c2 .7 3.4 2.5 4 5.4"/>'),
  settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>',
  flip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13l-3-3M20 15H7l3 3"/></svg>',
  upload: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>'
};
const roleChip = r => `<span class="chip ${r === "athlete" ? "" : r}">${ROLE_LABEL[r] || r}</span>`;

function render() {
  const app = $("#app");
  document.body.classList.add("no-nav");
  if (!S.be) { app.innerHTML = viewSetup(); return; }
  if (S.recovery) { app.innerHTML = viewNewPassword(); return; }
  if (!S.user) { app.innerHTML = viewAuth(); return; }
  if (S.loadError) { app.innerHTML = viewMessage("Laden fehlgeschlagen", esc(S.loadError), `<button class="btn block" data-act="reload">Erneut versuchen</button><button class="btn ghost block" data-act="logout" style="margin-top:8px">Abmelden</button>`); return; }
  if (!S.me) { app.innerHTML = viewMessage("Kein Zugang", "Für dieses Konto gibt es kein Profil (mehr). Wende dich an den Admin deiner Trainingsgruppe.", `<button class="btn ghost block" data-act="logout">Abmelden</button>`); return; }
  if (!S.me.approved) {
    app.innerHTML = demoBar() + viewMessage(`Hallo ${esc(firstName(S.me.display_name))}!`,
      "Dein Konto ist angelegt und wartet auf Freischaltung durch Trainer oder Admin. Sobald du freigeschaltet bist, geht es hier weiter.",
      `<button class="btn block" data-act="reload">Erneut prüfen</button><button class="btn ghost block" data-act="logout" style="margin-top:8px">Abmelden</button>`);
    return;
  }
  const y = scrollY, sameTab = render.lastTab === S.tab;
  document.body.classList.remove("no-nav");
  const views = { start: viewStart, plan: viewPlan, termine: viewTermine, team: viewTeam, settings: viewSettings };
  if (!views[S.tab]) S.tab = "start";
  app.innerHTML = demoBar() + viewTop() + `<main>${views[S.tab]()}</main>` + viewNav();
  render.lastTab = S.tab;
  if (sameTab) scrollTo(0, y);
  if (S.tab === "plan" && S.planView === "week" && !S.scrolledToday) {
    S.scrolledToday = true;
    const t = document.querySelector(".daycard.today");
    if (t) setTimeout(() => t.scrollIntoView({ block: "start", behavior: "instant" }), 0);
  }
}

function demoBar() {
  if (!S.be || S.be.kind !== "demo") return "";
  const opts = S.be.users().map(u => `<option value="${esc(u.id)}" ${u.id === S.user.id ? "selected" : ""}>${esc(u.display_name)} · ${ROLE_LABEL[u.role]}${u.approved ? "" : " (wartet)"}</option>`).join("");
  return `<div class="demo-bar"><div class="in"><b>Demo</b><span class="muted">Ansicht als</span>
    <select data-change="demoUser" aria-label="Demo-Person wählen">${opts}</select>
    <button class="btn sm ghost" data-act="demoExit">Beenden</button></div></div>`;
}
function viewTop() {
  const name = (S.settings && S.settings.team_name) || "LT DSHS Köln";
  return `<header class="top"><div class="top-in"><img class="logo" src="logo.png" alt="Logo LT DSHS Köln">
    <div class="grow"><h1>${esc(name)}</h1><div class="sub">${esc(S.me.display_name)} · ${ROLE_LABEL[role()]}</div></div></div></header>`;
}
function viewNav() {
  const n = isStaff() ? pending().length : 0;
  const ns = nextSession(), myOpen = ns && !attOf(ns.id, S.me.id)?.status && S.me.role === "athlete" ? 1 : 0;
  const b = (id, label, badge) => `<button data-act="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ""}>${ICON[id]}${label}${badge ? `<span class="badge">${badge}</span>` : ""}</button>`;
  return `<nav class="tabs" aria-label="Hauptmenü"><div class="in">${b("start", "Start")}${b("plan", "Plan")}${b("termine", "Termine", myOpen ? "!" : 0)}${b("team", "Team", n)}${b("settings", "Mehr")}</div></nav>`;
}
function viewMessage(title, text, actions) {
  return `<div class="auth"><div class="brand"><img src="logo.png" alt="Logo Leichtathletik-Team DSHS Köln"><h1>${title}</h1></div><div class="card"><p>${text}</p>${actions}</div></div>`;
}

function viewSetup() {
  return `<div class="auth"><div class="brand"><img src="logo.png" alt="Logo Leichtathletik-Team DSHS Köln"><h1>LT DSHS Köln</h1>
    <p class="muted">Die App ist noch mit keinem Server verbunden.</p></div>
    <div class="card"><h3>Ausprobieren</h3><p class="muted small">Alles läuft nur auf diesem Gerät, mit Beispielpersonen. Du kannst zwischen Admin-, Trainer- und Athletenansicht wechseln.</p>
      <button class="btn block" data-act="demoStart">Demo starten</button></div>
    <div class="card"><h3>Mit Supabase verbinden</h3>
      <p class="muted small">Werte aus Supabase → Project Settings → API. Dauerhaft für alle trägt man sie in <code>config.js</code> ein; hier gelten sie nur für dieses Gerät.</p>
      <form data-form="connect">
        <label class="f"><span>Project URL</span><input type="url" name="url" required placeholder="https://xyz.supabase.co" autocomplete="off"></label>
        <label class="f"><span>anon / publishable key</span><input type="text" name="key" required autocomplete="off" spellcheck="false"></label>
        <button class="btn ghost block">Verbinden</button></form></div></div>`;
}
function viewAuth() {
  const m = S.authMode, msg = S.authMsg;
  const note = msg ? `<div class="${msg.ok ? "okmsg" : "err"}">${esc(msg.text)}</div>` : "";
  let form;
  if (m === "register") form = `<form data-form="register">
      <label class="f"><span>Vor- und Nachname</span><input type="text" name="name" required maxlength="60" autocomplete="name"></label>
      <label class="f"><span>E-Mail</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="f"><span>Passwort</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"><div class="hint">Mindestens 8 Zeichen.</div></label>
      <button class="btn block">Konto anlegen</button>
      <p class="small muted" style="margin-top:12px">Nach der Registrierung schaltet dich ein Trainer oder Admin frei.</p></form>
      <p style="text-align:center">Schon ein Konto? <button class="linkbtn" data-act="authMode" data-mode="login">Anmelden</button></p>`;
  else if (m === "forgot") form = `<form data-form="forgot">
      <p class="small muted">Du bekommst eine E-Mail mit einem Link, über den du ein neues Passwort setzt.</p>
      <label class="f"><span>E-Mail</span><input type="email" name="email" required autocomplete="email"></label>
      <button class="btn block">Link senden</button></form>
      <p style="text-align:center"><button class="linkbtn" data-act="authMode" data-mode="login">Zurück zur Anmeldung</button></p>`;
  else form = `<form data-form="login">
      <label class="f"><span>E-Mail</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="f"><span>Passwort</span><input type="password" name="pw" required autocomplete="current-password"></label>
      <button class="btn block">Anmelden</button></form>
      <p style="text-align:center;margin-top:10px"><button class="linkbtn" data-act="authMode" data-mode="forgot">Passwort vergessen?</button></p>
      <p style="text-align:center">Neu hier? <button class="linkbtn" data-act="authMode" data-mode="register">Konto anlegen</button></p>`;
  const title = { login: "Anmelden", register: "Registrieren", forgot: "Passwort vergessen" }[m];
  return `<div class="auth"><div class="brand"><img src="logo.png" alt="Logo Leichtathletik-Team DSHS Köln"><h1>LT DSHS Köln</h1><p class="muted">${title}</p></div>
    <div class="card">${note}${form}</div>
    ${S.be.kind === "supabase" && connection()?.source === "local" ? `<p style="text-align:center"><button class="linkbtn small" data-act="disconnect">Verbindung ändern</button></p>` : ""}</div>`;
}
function viewNewPassword() {
  return `<div class="auth"><div class="brand"><img src="logo.png" alt="Logo Leichtathletik-Team DSHS Köln"><h1>Neues Passwort</h1></div>
    <div class="card"><form data-form="newpw">
      <label class="f"><span>Neues Passwort</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
      <label class="f"><span>Wiederholen</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
      <button class="btn block">Speichern</button></form></div></div>`;
}

/* ───── Start ───── */
function viewStart() {
  const me = S.me;
  const gname = groupName(me.plan_group_id);
  const n = isStaff() ? pending().length : 0;
  const ns = nextSession();
  let html = n ? `<div class="notice"><div class="grow"><b>${n} ${n === 1 ? "Konto wartet" : "Konten warten"} auf Freischaltung</b></div><button class="btn sm" data-act="tab" data-tab="team">Ansehen</button></div>` : "";
  html += `<div class="card hero"><h3>Hallo ${esc(firstName(me.display_name))}!</h3>
      <p style="margin:0">${roleChip(me.role)} ${gname ? `<span class="chip">${esc(gname)}</span>` : ""}</p></div>`;
  html += `<h2>Nächstes Training</h2>` + (ns ? sessionCard(ns) : `<div class="card muted">Keine Termine geplant.</div>`);
  // Heute im Plan
  const t = todayIso(), plan = planForWeek(mondayOf(t)), sheets = plan && S.sheetCache[plan.id];
  if (plan && sheets && sheets.length) {
    const sh = defaultSheet(sheets), d = sh && sh.data.days[dowOf(t)];
    html += `<h2>Heute im Plan</h2><button class="card linkcard" data-act="openPlanToday">
      <div class="small muted">${esc(sh.name)} · ${fmtDay(t)}</div>
      ${d && (d.title || d.items.length) ? `<b class="daytitle">${esc(d.title || "Training")}</b>
        <div class="small muted">${esc(d.items.slice(0, 6).map(i => i.text).join(" · "))}${d.items.length > 6 ? " …" : ""}</div>` : `<b class="daytitle">Kein Programm</b>`}
      </button>`;
  }
  const athletes = S.profiles.filter(p => p.approved && p.role === "athlete");
  html += `<h2>Team</h2><div class="card"><div class="stats">
      <div class="stat"><b>${athletes.length}</b><span>Athleten</span></div>
      <div class="stat"><b>${S.profiles.filter(p => p.approved && p.role !== "athlete").length}</b><span>Trainer &amp; Admins</span></div>
      <div class="stat"><b>${S.exercises.length}</b><span>Übungen</span></div></div></div>
    <h2>Kommt als Nächstes</h2>
    <div class="card"><ul class="soon"><li>Testwochen mit Verlauf und Abgleich mit Gruppennormen</li><li>Wettkampfergebnisse und Saisonkalender</li><li>Statistik für Trainer</li></ul></div>`;
  return html;
}

/* ───── Plan ───── */
function viewPlan() {
  const seg = [["week", "Wochenplan"], ["exercises", "Übungen"], ["archive", "Archiv"]];
  let html = `<div class="seg" role="tablist" style="margin-bottom:14px">${seg.map(([v, l]) => `<button data-act="planView" data-v="${v}" aria-pressed="${S.planView === v}">${l}</button>`).join("")}</div>`;
  if (S.planView === "exercises") return html + viewExercises();
  if (S.planView === "archive") return html + viewArchive();
  const mon = S.planWeek || mondayOf(todayIso());
  const plan = planForWeek(mon);
  html += `<div class="weeknav"><button class="iconbtn" data-act="planWeek" data-d="-7" aria-label="Vorherige Woche">${ICON.left}</button>
    <div class="grow"><b>${weekLabel(mon)}</b>${mon === mondayOf(todayIso()) ? ` <span class="chip">diese Woche</span>` : ""}</div>
    <button class="iconbtn" data-act="planWeek" data-d="7" aria-label="Nächste Woche">${ICON.right}</button></div>`;
  if (isStaff()) html += `<div class="btns" style="margin:0 0 12px"><button class="btn ghost" data-act="planUpload">${ICON.upload} Neuen Plan hochladen</button></div>
    <input type="file" id="plan-file" accept=".xlsx,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-change="planFile">`;
  if (!plan) return html + `<div class="card"><p><b>Für diese Woche gibt es noch keinen Plan.</b></p><p class="muted small" style="margin:0">${isStaff() ? "Lade den Wochenplan als Excel-Datei (.xlsx) hoch." : "Sobald der Trainer einen Plan hochlädt, erscheint er hier."}</p></div>`;
  const sheets = S.sheetCache[plan.id];
  if (!sheets) { sheetsOf(plan).then(render).catch(e => toast(deErr(e), "error")); return html + `<div class="card muted">Lädt …</div>`; }
  const since = plan.valid_from !== mon ? `seit ${weekLabel(plan.valid_from).split(" · ")[0]}` : "neu diese Woche";
  html += `<div class="planhead"><b>${esc(plan.title || plan.season || "Wochenplan")}</b> <span class="small muted">· ${since}</span>
    ${plan.goal ? `<div class="small"><span class="muted">Ziel:</span> ${esc(plan.goal)}</div>` : ""}</div>`;
  if (!sheets.length) return html + `<div class="card muted">Für dich ist in diesem Plan kein Blatt freigegeben. Frag deinen Trainer, welcher Trainingsgruppe du zugeordnet bist.</div>`;
  const sh = defaultSheet(sheets);
  if (sheets.length > 1) html += `<div class="chips" role="tablist">${sheets.map(s => `<button class="chipbtn" data-act="planSheet" data-name="${esc(s.name)}" aria-pressed="${s.id === sh.id}">${esc(s.name)}${s.group_id && s.group_id === S.me.plan_group_id ? " ★" : ""}</button>`).join("")}</div>`;
  const t = todayIso();
  html += sh.data.days.map(d => {
    const date = addDays(mon, d.day), sess = S.sessions.filter(s => s.session_date === date && !s.cancelled);
    const empty = !d.title && !d.items.length && !d.info;
    return `<section class="daycard ${date === t ? "today" : ""} ${empty ? "empty" : ""}">
      <div class="dayhead"><span class="dayname">${WDL[d.day]}</span><span class="muted small">${dm(date)}</span>
        ${d.info ? `<span class="chip">${esc(d.info)}</span>` : ""}${sess.length ? `<span class="chip solid">Training ${esc(hhmm(sess[0].start_time))}</span>` : ""}</div>
      ${d.title ? `<div class="daytitle">${esc(d.title)}</div>` : ""}
      ${(d.titleDetails || []).length ? `<div class="small muted">${d.titleDetails.map(esc).join(" · ")}</div>` : ""}
      ${d.items.length ? `<ul class="items">${d.items.map((it, k) => {
        const ex = findExercise(it.text);
        return `<li class="${it.gap ? "gap" : ""}"><button class="item" data-act="itemInfo" data-text="${esc(it.text)}">
          <span class="it ${ex ? "known" : ""}">${esc(it.text)}${ex && (ex.video_path || ex.video_url) ? ` <span class="vid">${ICON.video}</span>` : ""}</span>
          ${it.details.length ? `<span class="det">${it.details.map(esc).join("<br>")}</span>` : ""}</button></li>`;
      }).join("")}</ul>` : empty ? `<div class="small muted">Frei</div>` : ""}
    </section>`;
  }).join("");
  if ((plan.extra_sheets || []).length) html += `<h2>Weitere Blätter</h2>` + plan.extra_sheets.map((x, i) => `<details class="card extra"><summary><b>${esc(x.name)}</b></summary>${gridTable(x.rows)}</details>`).join("");
  return html;
}
function gridTable(rows) {
  const used = rows.filter(r => r.some(Boolean)); if (!used.length) return "";
  const w = Math.max(...used.map(r => r.length)); const cols = [];
  for (let c = 0; c < w; c++) if (used.some(r => r[c])) cols.push(c);
  return `<div class="tablewrap"><table class="grid">${used.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] || "")}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
function viewArchive() {
  if (!S.plans.length) return `<div class="card muted">Noch keine Pläne hochgeladen.</div>`;
  const cur = planForWeek(mondayOf(todayIso()));
  return `<div class="card flush">${S.plans.map(p => `<div class="row">
    <button class="grow rowbtn" data-act="openPlan" data-id="${esc(p.id)}"><span class="name">${esc(p.title || p.season || "Wochenplan")} ${p === cur ? '<span class="chip solid">aktuell</span>' : ""}</span>
      <span class="meta">ab ${esc(weekLabel(p.valid_from))}${p.source_name ? " · " + esc(p.source_name) : ""}</span></button>
    ${isStaff() ? `<button class="iconbtn" data-act="planDelete" data-id="${esc(p.id)}" aria-label="Plan löschen">${ICON.trash}</button>` : ""}</div>`).join("")}</div>
    <p class="small muted" style="margin:8px 4px">Ein Plan gilt ab seiner Woche, bis ein neuerer hochgeladen wird.</p>`;
}
function viewExercises() {
  const q = S.exSearch.trim().toLowerCase();
  const list = S.exercises.filter(e => !q || [e.name, e.abbreviation, e.category, e.description].some(v => String(v || "").toLowerCase().includes(q)));
  const cats = {};
  list.forEach(e => (cats[e.category || "Ohne Kategorie"] = cats[e.category || "Ohne Kategorie"] || []).push(e));
  const keys = Object.keys(cats).sort((a, b) => a === "Ohne Kategorie" ? 1 : b === "Ohne Kategorie" ? -1 : a.localeCompare(b, "de"));
  return `<div class="searchrow"><input type="search" placeholder="Übung oder Abkürzung suchen" value="${esc(S.exSearch)}" data-input="exSearch" aria-label="Suchen">
      <button class="btn" data-act="exNew">+ Übung</button></div>
    ${keys.length ? `<div class="card flush">${keys.map(k => `<div class="subhead">${esc(k)} · ${cats[k].length}</div>${cats[k].map(e => `
      <button class="row" data-act="exOpen" data-id="${esc(e.id)}"><span class="grow"><span class="name">${esc(e.name)}</span>
        <span class="meta">${[e.abbreviation, e.description].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</span></span>
        ${e.video_path || e.video_url ? `<span class="muted">${ICON.video}</span>` : ""}<span class="chev">${ICON.chev}</span></button>`).join("")}`).join("")}</div>`
      : `<div class="card muted">${q ? "Nichts gefunden." : "Noch keine Übungen. Beim Hochladen eines Plans werden die Abkürzungen automatisch übernommen."}</div>`}`;
}

/* ───── Termine ───── */
function sessionCard(s, compact) {
  const a = attOf(s.id, S.me.id), pr = privOf(s.id, S.me.id), c = countsOf(s);
  const head = `<div class="sesshead"><div class="sessdate"><b>${WD[dowOf(s.session_date)]}</b><span>${dm(s.session_date)}</span></div>
    <div class="grow"><div class="sesstitle">${esc(s.title || "Training")}${s.cancelled ? ' <span class="chip off">abgesagt</span>' : ""}</div>
    <div class="small muted">${[hhmm(s.start_time) && hhmm(s.start_time) + " Uhr", s.location].filter(Boolean).map(esc).join(" · ")}</div>
    ${s.note ? `<div class="small">${esc(s.note)}</div>` : ""}</div></div>`;
  if (s.cancelled) return `<div class="card sess cancelled">${head}</div>`;
  const past = s.session_date < todayIso();
  const resp = past ? (a && a.status ? `<div class="small muted">Du hattest ${a.status === "yes" ? "zugesagt" : "abgesagt"}${a.coach_mark === "late" ? " · zu spät" : a.coach_mark === "no_show" ? " · nicht erschienen" : ""}</div>` : "")
    : `<div class="resp">
      <button class="${a && a.status === "yes" ? "on yes" : ""}" data-act="respYes" data-id="${esc(s.id)}" aria-pressed="${!!(a && a.status === "yes")}">${ICON.check} Dabei</button>
      <button class="${a && a.status === "no" ? "on no" : ""}" data-act="respNo" data-id="${esc(s.id)}" aria-pressed="${!!(a && a.status === "no")}">${ICON.x} ${a && a.status === "no" ? "Abgesagt" : "Absagen"}</button></div>
      ${a && a.status === "no" && pr ? `<div class="small muted" style="margin-top:6px">Grund: ${esc(REASONS[pr.reason] || pr.reason)}${pr.note ? " – " + esc(pr.note) : ""} <span class="muted">(sehen nur Trainer)</span></div>` : ""}
      ${a && a.coach_mark ? `<div class="small" style="margin-top:6px">Trainer: ${a.coach_mark === "late" ? "zu spät" : "nicht erschienen"}</div>` : ""}`;
  return `<div class="card sess">${head}${resp}
    <button class="counts" data-act="sessOpen" data-id="${esc(s.id)}"><span><b>${c.yes}</b> dabei</span><span><b>${c.no}</b> abgesagt</span><span><b>${c.open}</b> offen</span>${ICON.chev}</button></div>`;
}
function viewTermine() {
  const mon = mondayOf(todayIso()), t = todayIso();
  const upcoming = S.sessions.filter(s => s.session_date >= t);
  const past = S.sessions.filter(s => s.session_date < t).reverse();
  const byWeek = {};
  upcoming.forEach(s => (byWeek[mondayOf(s.session_date)] = byWeek[mondayOf(s.session_date)] || []).push(s));
  let html = isStaff() ? `<div class="btns" style="margin:0 0 6px"><button class="btn ghost" data-act="sessNew">+ Termin</button></div>` : "";
  const weeks = Object.keys(byWeek).sort();
  if (!weeks.length) html += `<div class="card muted">Keine kommenden Termine.</div>`;
  weeks.forEach(w => { html += `<h2>${w === mon ? "Diese Woche" : w === addDays(mon, 7) ? "Nächste Woche" : weekLabel(w)}</h2>` + byWeek[w].map(s => sessionCard(s)).join(""); });
  if (past.length) {
    html += `<h2>Vergangene Termine</h2>`;
    html += S.showPast ? past.map(s => sessionCard(s)).join("") : `<button class="btn ghost block" data-act="showPast">${past.length} vergangene Termine anzeigen</button>`;
  }
  if (!isStaff()) html += `<p class="small muted" style="margin:10px 4px">Absagegründe sehen nur Trainer und Admins. Alle sehen, wer zugesagt hat.</p>`;
  return html;
}

/* ───── Team ───── */
function memberRow(p) {
  const g = groupName(p.plan_group_id);
  const meta = [p.role === "athlete" ? (g || "keine Gruppe") : g, isStaff() ? S.emails[p.id] : null].filter(Boolean).map(esc).join(" · ");
  const flags = (p.role !== "athlete" ? roleChip(p.role) : "") + (!p.approved ? ` <span class="chip off">gesperrt</span>` : "");
  return `<button class="row" data-act="member" data-id="${esc(p.id)}">
    <span class="avatar ${p.role}">${esc(initials(p.display_name))}</span>
    <span class="grow"><span class="name">${esc(p.display_name)}${p.id === S.me.id ? ' <span class="muted">(du)</span>' : ""}</span><span class="meta">${meta || "&nbsp;"}</span></span>
    ${flags}<span class="chev">${ICON.chev}</span></button>`;
}
const isWaiting = p => !p.approved && p.role === "athlete";
function viewTeam() {
  const staff = isStaff();
  const waiting = staff ? S.profiles.filter(isWaiting) : [];
  const rest = S.profiles.filter(p => !waiting.includes(p));
  const coaches = rest.filter(p => p.role !== "athlete"), athletes = rest.filter(p => p.role === "athlete");
  let html = "";
  if (waiting.length) html += `<h2>Wartet auf Freischaltung</h2><div class="card flush">` + waiting.map(p => `
      <div class="row"><span class="avatar">${esc(initials(p.display_name))}</span>
        <span class="grow"><span class="name">${esc(p.display_name)}</span><span class="meta">${esc(S.emails[p.id] || "")}</span></span>
        <button class="btn sm" data-act="approve" data-id="${esc(p.id)}">Freischalten</button>
        <button class="iconbtn" data-act="reject" data-id="${esc(p.id)}" aria-label="Ablehnen" title="Ablehnen">${ICON.trash}</button></div>`).join("") + `</div>`;
  html += `<h2>Trainer &amp; Admins</h2><div class="card flush">${coaches.map(memberRow).join("") || `<div class="row muted">Niemand</div>`}</div>`;
  html += `<h2>Athleten</h2><div class="card flush">`;
  const groups = S.groups.map(g => [g.name, athletes.filter(a => a.plan_group_id === g.id)]);
  groups.push(["Ohne Trainingsgruppe", athletes.filter(a => !groupName(a.plan_group_id))]);
  html += groups.filter(([, l]) => l.length).map(([name, list]) => `<div class="subhead">${esc(name)} · ${list.length}</div>${list.map(memberRow).join("")}`).join("") || `<div class="row muted">Noch keine Athleten</div>`;
  html += `</div>`;
  if (staff) html += `<p class="small muted" style="margin:8px 4px">Neue Mitglieder registrieren sich selbst in der App und erscheinen dann oben zur Freischaltung. Link zum Teilen: <a href="${esc(appUrl())}">${esc(appUrl())}</a></p>`;
  return html;
}

/* ───── Einstellungen ───── */
function viewSettings() {
  const s = S.settings || {};
  const seg = (k, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-act="pref" data-k="${k}" data-v="${v}" aria-pressed="${prefs[k] === v}">${l}</button>`).join("")}</div>`;
  let html = `<h2>Darstellung</h2><div class="card">
      <label class="f"><span>Design</span>${seg("theme", [["system", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]])}</label>
      <label class="f" style="margin:0"><span>Schriftgröße</span>${seg("textSize", [["normal", "Normal"], ["large", "Groß"]])}</label>
      <div class="hint">Gilt nur auf diesem Gerät.</div></div>
    <h2>Mein Konto</h2><div class="card">
      <form data-form="myname"><label class="f"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(S.me.display_name)}"></label>
      <label class="f"><span>E-Mail</span><input type="email" value="${esc(S.user.email || "")}" readonly></label>
      <button class="btn sm ghost">Name speichern</button></form>
      <div class="btns"><button class="btn ghost" data-act="changePw" ${S.be.kind === "demo" ? "disabled" : ""}>Passwort ändern</button>
      <button class="btn ghost" data-act="logout">Abmelden</button></div></div>`;
  if (isStaff()) {
    const tpl = s.session_template || [];
    html += `<h2>Trainingspläne</h2><div class="card">
      <h3>Wer sieht welchen Plan?</h3>
      <label class="opt"><input type="radio" name="vis" value="all" data-change="visibility" ${s.plan_visibility === "all" ? "checked" : ""}>
        <span><b>Alle sehen alle Pläne</b><span class="small muted">Jeder sieht seinen Plan zuerst, kann aber auch die anderen öffnen.</span></span></label>
      <label class="opt"><input type="radio" name="vis" value="assigned" data-change="visibility" ${s.plan_visibility === "assigned" ? "checked" : ""}>
        <span><b>Nur den eigenen Plan</b><span class="small muted">Athleten sehen nur das Blatt ihrer Trainingsgruppe.</span></span></label>
      <div class="hint">Trainer und Admins sehen immer alle Pläne.</div></div>
      <div class="card flush"><div class="subhead">Trainingsgruppen (= Blätter im Excel-Plan)</div>
      ${S.groups.map((g, i) => `<div class="setrow"><span class="grow"><b>${esc(g.name)}</b>
          <span class="small muted" style="display:block">${S.profiles.filter(p => p.plan_group_id === g.id).length} Personen</span></span>
        <button class="iconbtn" data-act="groupMove" data-id="${esc(g.id)}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">${ICON.up}</button>
        <button class="iconbtn" data-act="groupMove" data-id="${esc(g.id)}" data-dir="1" ${i === S.groups.length - 1 ? "disabled" : ""} aria-label="Nach unten">${ICON.down}</button>
        <button class="iconbtn" data-act="groupRename" data-id="${esc(g.id)}" aria-label="Umbenennen">${ICON.edit}</button>
        <button class="iconbtn" data-act="groupDelete" data-id="${esc(g.id)}" aria-label="Löschen">${ICON.trash}</button></div>`).join("")}
      <div class="setrow"><button class="btn sm ghost" data-act="groupAdd">+ Trainingsgruppe hinzufügen</button></div></div>
      <h2>Feste Trainingstage</h2><div class="card">
      <p class="small muted">Für diese Tage werden jede Woche automatisch Termine zum Zu- und Absagen angelegt. Einzelne Termine änderst oder ergänzt du unter <b>Termine</b>.</p>
      <form data-form="template">${tpl.map((t, i) => templateRow(t, i)).join("")}<div id="tpl-more"></div>
      <div class="btns"><button type="button" class="btn sm ghost" data-act="tplAdd">+ Tag</button><button class="btn sm">Speichern</button></div>
      <div class="hint">Änderungen gelten für Wochen, die noch nicht angelegt sind (ab übernächster Woche). Die aktuelle und nächste Woche passt du direkt unter Termine an.</div></form></div>`;
  }
  if (isAdmin()) {
    html += `<h2>Admin</h2><div class="card">
      <form data-form="teamname"><label class="f"><span>Name der Trainingsgruppe</span><input type="text" name="name" required maxlength="60" value="${esc(s.team_name || "")}"></label>
      <button class="btn sm ghost">Speichern</button></form></div>
      <div class="card"><h3>Backup</h3>
      <p class="small muted">Sichert Einstellungen, Trainingsgruppen, Rollen, Pläne, Übungen, Termine und Zu-/Absagen als Datei. Videos sind nicht enthalten. Beim Wiederherstellen werden diese Werte zurückgeschrieben; Konten werden dabei weder angelegt noch gelöscht.</p>
      <div class="btns"><button class="btn" data-act="backup">Backup herunterladen</button>
      <button class="btn ghost" data-act="restore">Wiederherstellen …</button></div>
      ${LS.get("la_last_backup", null) ? `<div class="hint">Letztes Backup von diesem Gerät: ${new Date(LS.get("la_last_backup")).toLocaleString("de-DE")}</div>` : ""}
      <input type="file" id="restore-file" accept="application/json,.json" hidden data-change="restoreFile"></div>`;
  }
  html += `<h2>Daten &amp; App</h2><div class="card flush">
    <div class="setrow"><span class="grow">Meine Daten<div class="small muted">Alles, was über dich gespeichert ist, als Datei</div></span><button class="btn sm ghost" data-act="exportMine">Exportieren</button></div>
    <div class="setrow"><span class="grow">Version<div class="small muted">${esc(VERSION)}</div></span><button class="btn sm ghost" data-act="update">Aktualisieren</button></div>
    <div class="setrow"><span class="grow">Verbunden mit<div class="small muted">${esc(S.be.host)}</div></span>
      ${S.be.kind === "demo" ? `<button class="btn sm ghost" data-act="demoReset">Demo zurücksetzen</button>` : connection()?.source === "local" ? `<button class="btn sm ghost" data-act="disconnect">Trennen</button>` : ""}</div>
    <div class="setrow"><span class="grow">Konto löschen<div class="small muted">Entfernt dein Konto und alle deine Daten</div></span><button class="btn sm danger" data-act="deleteMe">Löschen</button></div></div>`;
  return html;
}
function templateRow(t, i) {
  return `<div class="tplrow" data-row>
    <select name="dow" aria-label="Wochentag">${WDL.map((d, k) => `<option value="${k + 1}" ${Number(t.dow) === k + 1 ? "selected" : ""}>${d}</option>`).join("")}</select>
    <input type="time" name="time" value="${esc(t.time || "")}" aria-label="Uhrzeit">
    <input type="text" name="location" value="${esc(t.location || "")}" placeholder="Ort" maxlength="80" aria-label="Ort">
    <button type="button" class="iconbtn" data-act="tplRemove" aria-label="Entfernen">${ICON.trash}</button></div>`;
}

/* ───────────── Dialoge ───────────── */
const dlg = $("#dlg");
function sheet(html) { $("#dlg-body").innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeSheet() { if (dlg.open) dlg.close(); const v = dlg.querySelector("video"); if (v) v.pause(); }
dlg.addEventListener("click", e => { if (e.target === dlg) closeSheet(); });
function ask(title, text, okLabel = "OK", danger = false) {
  return new Promise(res => {
    sheet(`<h3>${esc(title)}</h3><p>${text}</p><div class="btns">
      <button class="btn ghost" data-r="0">Abbrechen</button><button class="btn ${danger ? "danger" : ""}" data-r="1">${esc(okLabel)}</button></div>`);
    let settled = false;
    const done = v => { settled = true; closeSheet(); res(v); };
    dlg.addEventListener("close", () => { if (!settled) res(false); }, { once: true });
    $("#dlg-body").querySelectorAll("[data-r]").forEach(b => b.onclick = () => done(b.dataset.r === "1"));
  });
}
function askText(title, label, value = "") {
  return new Promise(res => {
    sheet(`<h3>${esc(title)}</h3><form id="ask-f"><label class="f"><span>${esc(label)}</span><input type="text" name="v" required maxlength="60" value="${esc(value)}"></label>
      <div class="btns"><button type="button" class="btn ghost" data-r="0">Abbrechen</button><button class="btn">Speichern</button></div></form>`);
    const f = $("#ask-f"); let settled = false;
    const done = v => { settled = true; closeSheet(); res(v); };
    dlg.addEventListener("close", () => { if (!settled) res(null); }, { once: true });
    f.querySelector("[data-r]").onclick = () => done(null);
    f.onsubmit = e => { e.preventDefault(); done(f.v.value.trim()); };
    setTimeout(() => f.v.focus(), 50);
  });
}

function memberSheet(id) {
  const p = person(id); if (!p) return;
  const edit = canEdit(p), self = p.id === S.me.id, staffEdit = isStaff() && edit;
  const canDelete = !self && (isAdmin() || (role() === "trainer" && p.role === "athlete" && !p.approved));
  const groupOpts = `<option value="">– keine –</option>` + S.groups.map(g => `<option value="${esc(g.id)}" ${g.id === p.plan_group_id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  const info = `<p class="muted small">${roleChip(p.role)} ${S.emails[p.id] ? esc(S.emails[p.id]) : ""}</p>`;
  if (!edit) {
    sheet(`<h3>${esc(p.display_name)}</h3>${info}<p>Trainingsgruppe: <b>${esc(groupName(p.plan_group_id) || "keine")}</b></p>
      <div class="btns"><button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
    return;
  }
  sheet(`<h3>${esc(p.display_name)}</h3>${info}
    <form data-form="member" data-id="${esc(p.id)}">
      <label class="f"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(p.display_name)}"></label>
      ${staffEdit ? `<label class="f"><span>Trainingsgruppe</span><select name="group">${groupOpts}</select><div class="hint">Bestimmt, welches Blatt im Wochenplan zuerst geöffnet wird.</div></label>` : ""}
      ${isAdmin() ? `<label class="f"><span>Rolle</span><select name="role">${["athlete", "trainer", "admin"].map(r => `<option value="${r}" ${r === p.role ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>
        <div class="hint">Trainer: Freischalten, Gruppen, Pläne, Termine, Absagegründe sehen. Admin: zusätzlich Rollen, Teamname, Backup.</div></label>` : ""}
      ${staffEdit && !self ? `<label class="opt"><input type="checkbox" name="approved" ${p.approved ? "checked" : ""}><span><b>Zugang aktiv</b><span class="small muted">Ohne Haken kann sich die Person zwar anmelden, sieht aber nichts.</span></span></label>` : ""}
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div>
    </form>
    ${canDelete ? `<div class="btns"><button class="btn danger block" data-act="deleteMember" data-id="${esc(p.id)}">Konto löschen</button></div>` : ""}`);
}

function absageSheet(sid, uidFor) {
  const s = S.sessions.find(x => x.id === sid), pr = privOf(sid, uidFor);
  const forOther = uidFor !== S.me.id;
  sheet(`<h3>Absagen</h3><p class="small muted">${esc(s.title || "Training")} · ${fmtLong(s.session_date)}${forOther ? ` · für <b>${esc(person(uidFor).display_name)}</b>` : ""}</p>
    <form data-form="absage" data-id="${esc(sid)}" data-user="${esc(uidFor)}">
      <div class="reasons">${Object.entries(REASONS).map(([k, l]) => `<label class="opt"><input type="radio" name="reason" value="${k}" required ${pr && pr.reason === k ? "checked" : ""}><span><b>${l}</b></span></label>`).join("")}</div>
      <label class="f"><span>Bemerkung <span class="muted">(bei „Sonstiges“ Pflicht)</span></span><textarea name="note" maxlength="300" rows="2">${esc(pr ? pr.note : "")}</textarea></label>
      <p class="small muted">Den Grund sehen nur Trainer und Admins.</p>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Absagen</button></div></form>`);
}

function sessionSheet(sid) {
  const s = S.sessions.find(x => x.id === sid); if (!s) return;
  const roster = rosterOf(s), staff = isStaff();
  const groups = { yes: [], no: [], open: [] };
  roster.forEach(p => { const a = attOf(s.id, p.id); groups[a && a.status === "yes" ? "yes" : a && a.status === "no" ? "no" : "open"].push(p); });
  const line = p => {
    const a = attOf(s.id, p.id), pr = privOf(s.id, p.id);
    const mark = a && a.coach_mark ? `<span class="chip ${a.coach_mark === "no_show" ? "off" : ""}">${a.coach_mark === "late" ? "zu spät" : "nicht erschienen"}</span>` : "";
    const flip = staff && flipped(s.id, p.id) ? `<span class="chip" title="Erst zugesagt, dann abgesagt">${ICON.flip} umentschieden</span>` : "";
    const reason = staff && pr ? `<span class="meta">${esc(REASONS[pr.reason] || pr.reason)}${pr.note ? " – " + esc(pr.note) : ""}</span>` : "";
    const inner = `<span class="avatar ${p.role}">${esc(initials(p.display_name))}</span><span class="grow"><span class="name">${esc(p.display_name)}</span>${reason}</span>${flip}${mark}`;
    return staff ? `<button class="row" data-act="attPerson" data-sid="${esc(s.id)}" data-uid="${esc(p.id)}">${inner}<span class="chev">${ICON.chev}</span></button>` : `<div class="row">${inner}</div>`;
  };
  const block = (title, list) => `<div class="subhead">${title} · ${list.length}</div>${list.map(line).join("") || `<div class="row muted small">–</div>`}`;
  sheet(`<h3>${esc(s.title || "Training")}</h3>
    <p class="small muted">${fmtLong(s.session_date)}${s.start_time ? " · " + hhmm(s.start_time) + " Uhr" : ""}${s.location ? " · " + esc(s.location) : ""}${s.cancelled ? ' · <span class="chip off">abgesagt</span>' : ""}</p>
    <div class="card flush">${block("Dabei", groups.yes)}${block("Abgesagt", groups.no)}${block("Keine Antwort", groups.open)}</div>
    ${staff ? `<div class="btns"><button class="btn ghost" data-act="sessEdit" data-id="${esc(s.id)}">Termin bearbeiten</button></div>` : ""}
    <div class="btns"><button class="btn ghost block" data-act="closeSheet">Schließen</button></div>`);
}

function attPersonSheet(sid, u) {
  const s = S.sessions.find(x => x.id === sid), p = person(u), a = attOf(sid, u), pr = privOf(sid, u);
  const hist = S.log.filter(l => l.session_id === sid && l.user_id === u);
  const when = iso => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const histLine = l => {
    const by = l.changed_by && l.changed_by !== u ? ` <span class="muted">(von ${esc((person(l.changed_by) || {}).display_name || "Trainer")})</span>` : "";
    if (l.status) return `<li>${when(l.at)}: <b>${l.status === "yes" ? "zugesagt" : "abgesagt"}</b>${l.reason ? " – " + esc(REASONS[l.reason] || l.reason) : ""}${by}</li>`;
    return `<li>${when(l.at)}: Markierung <b>${l.coach_mark === "late" ? "zu spät" : l.coach_mark === "no_show" ? "nicht erschienen" : "entfernt"}</b>${by}</li>`;
  };
  sheet(`<h3>${esc(p.display_name)}</h3>
    <p class="small muted">${esc(s.title || "Training")} · ${fmtDay(s.session_date)}</p>
    <p>Status: <b>${a && a.status === "yes" ? "zugesagt" : a && a.status === "no" ? "abgesagt" : "keine Antwort"}</b>${pr ? ` – ${esc(REASONS[pr.reason] || pr.reason)}${pr.note ? ": " + esc(pr.note) : ""}` : ""}</p>
    <div class="small muted" style="margin-bottom:6px">Markieren</div>
    <div class="seg">${[["", "Keine"], ["late", "Zu spät"], ["no_show", "Nicht erschienen"]].map(([v, l]) => `<button data-act="setMark" data-sid="${esc(sid)}" data-uid="${esc(u)}" data-v="${v}" aria-pressed="${(a && a.coach_mark || "") === v}">${l}</button>`).join("")}</div>
    ${!s.cancelled ? `<div class="btns"><button class="btn ghost" data-act="respFor" data-sid="${esc(sid)}" data-uid="${esc(u)}" data-v="yes">Zusage eintragen</button><button class="btn ghost" data-act="respFor" data-sid="${esc(sid)}" data-uid="${esc(u)}" data-v="no">Absage eintragen</button></div>` : ""}
    <h3 style="margin-top:18px;font-size:1.05rem">Verlauf</h3>
    ${hist.length ? `<ul class="hist">${hist.map(histLine).join("")}</ul>` : `<p class="small muted">Noch keine Reaktion.</p>`}
    <div class="btns"><button class="btn ghost block" data-act="sessOpen" data-id="${esc(sid)}">Zurück</button></div>`);
}

function sessionEditSheet(s) {
  const isNew = !s.id;
  sheet(`<h3>${isNew ? "Neuer Termin" : "Termin bearbeiten"}</h3>
    <form data-form="session" data-id="${esc(s.id || "")}">
      <label class="f"><span>Titel</span><input type="text" name="title" maxlength="80" value="${esc(s.title || "Training")}" required></label>
      <div class="two"><label class="f"><span>Datum</span><input type="date" name="date" required value="${esc(s.session_date || todayIso())}"></label>
      <label class="f"><span>Uhrzeit</span><input type="time" name="time" value="${esc(hhmm(s.start_time))}"></label></div>
      <label class="f"><span>Ort</span><input type="text" name="location" maxlength="80" value="${esc(s.location || "")}"></label>
      <label class="f"><span>Hinweis</span><input type="text" name="note" maxlength="500" value="${esc(s.note || "")}" placeholder="z. B. Spikes mitbringen"></label>
      ${isNew ? "" : `<label class="opt"><input type="checkbox" name="cancelled" ${s.cancelled ? "checked" : ""}><span><b>Training fällt aus</b><span class="small muted">Der Termin bleibt sichtbar, Zu-/Absagen sind gesperrt.</span></span></label>`}
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${isNew ? "" : `<div class="btns"><button class="btn danger block" data-act="sessDelete" data-id="${esc(s.id)}">Termin löschen</button></div>`}`);
}

async function exerciseSheet(id, prefillName) {
  const e = id ? S.exercises.find(x => x.id === id) : null;
  const mayEdit = e && (isStaff() || e.created_by === S.me.id);
  if (e && !exerciseSheet.edit) {
    let media = "";
    if (e.video_path) media = `<video controls playsinline preload="metadata" class="exvideo" id="exvideo"></video>`;
    if (e.video_url) media += `<p><a class="btn ghost" href="${esc(e.video_url)}" target="_blank" rel="noopener noreferrer">${ICON.video} Video ansehen</a></p>`;
    sheet(`<h3>${esc(e.name)}</h3><p class="small muted">${[e.abbreviation && `Abkürzung: <b>${esc(e.abbreviation)}</b>`, e.category && esc(e.category)].filter(Boolean).join(" · ")}</p>
      ${e.description ? `<p class="pre">${esc(e.description)}</p>` : `<p class="small muted">Noch keine Beschreibung.</p>`}${media}
      <div class="btns">${mayEdit ? `<button class="btn ghost" data-act="exEdit" data-id="${esc(e.id)}">Bearbeiten</button>` : ""}<button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
    if (e.video_path) S.be.videoUrl(e.video_path).then(u => { const v = $("#exvideo"); if (v && u) v.src = u; }).catch(err => toast(deErr(err), "error"));
    return;
  }
  exerciseSheet.edit = false;
  const cats = [...new Set(S.exercises.map(x => x.category).filter(Boolean))].sort();
  const x = e || { name: prefillName || "", abbreviation: "", category: "", description: "", video_url: "" };
  sheet(`<h3>${e ? "Übung bearbeiten" : "Neue Übung"}</h3>
    <form data-form="exercise" data-id="${esc(e ? e.id : "")}">
      <label class="f"><span>Name</span><input type="text" name="name" required maxlength="120" value="${esc(x.name)}"></label>
      <div class="two"><label class="f"><span>Abkürzung</span><input type="text" name="abbreviation" maxlength="30" value="${esc(x.abbreviation)}" placeholder="z. B. NHE"></label>
      <label class="f"><span>Kategorie</span><input type="text" name="category" maxlength="60" list="cats" value="${esc(x.category)}" placeholder="z. B. Kraft"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label></div>
      <label class="f"><span>Beschreibung / Ausführung</span><textarea name="description" maxlength="4000" rows="4">${esc(x.description)}</textarea></label>
      <label class="f"><span>Video-Link <span class="muted">(YouTube, Instagram …)</span></span><input type="url" name="video_url" maxlength="500" value="${esc(x.video_url)}" placeholder="https://"></label>
      <label class="f"><span>Kurzvideo hochladen <span class="muted">(max. 50 MB)</span></span><input type="file" name="video" accept="video/mp4,video/quicktime,video/webm,video/*">
        ${e && e.video_path ? `<label class="small"><input type="checkbox" name="removeVideo"> Vorhandenes Video entfernen</label>` : ""}</label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${e ? `<div class="btns"><button class="btn danger block" data-act="exDelete" data-id="${esc(e.id)}">Übung löschen</button></div>` : ""}`);
}

function itemSheet(text) {
  const ex = findExercise(text);
  if (ex) return exerciseSheet(ex.id);
  sheet(`<h3>${esc(text)}</h3><p class="muted small">Zu dieser Übung gibt es noch keine Erklärung in der Übungssammlung.</p>
    <div class="btns"><button class="btn" data-act="exNew" data-name="${esc(text)}">Erklärung hinzufügen</button><button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
}

/* ───── Plan-Import ───── */
let IMPORT = null;
function defaultImportWeek() { const t = todayIso(), mon = mondayOf(t); return dowOf(t) >= 4 ? addDays(mon, 7) : mon; }
function importSheet() {
  const r = IMPORT, wk = r.week;
  const opts = [-7, 0, 7, 14, 21].map(d => addDays(mondayOf(todayIso()), d));
  if (!opts.includes(wk)) opts.push(wk);
  const existing = S.plans.find(p => p.valid_from === wk);
  const abk = r.extras.find(x => /abk/i.test(x.name));
  const abkList = abk ? XlsxPlan.abbreviationsFrom(abk) : [];
  const newAbk = abkList.filter(a => !S.exercises.some(e => norm(e.abbreviation) === norm(a.abbreviation) || norm(e.name) === norm(a.name)));
  const p0 = r.plans[0];
  sheet(`<h3>Plan hochladen</h3><p class="small muted">${esc(r.file)} · ${r.plans.length} Plan-Blätter${r.extras.length ? `, ${r.extras.length} weitere` : ""}</p>
    <form data-form="import">
      <label class="f"><span>Gilt ab</span><select name="week">${opts.sort().map(w => `<option value="${w}" ${w === wk ? "selected" : ""}>${weekLabel(w)}${w === mondayOf(todayIso()) ? " (diese Woche)" : ""}</option>`).join("")}</select>
        <div class="hint">Gilt so lange, bis ein neuerer Plan hochgeladen wird.</div></label>
      <label class="f"><span>Titel</span><input type="text" name="title" maxlength="120" value="${esc([p0.season, /test/i.test(r.file + p0.name) ? "Testwoche" : ""].filter(Boolean).join(" · ") || "Wochenplan")}"></label>
      ${p0.goal ? `<p class="small"><span class="muted">Ziel:</span> ${esc(p0.goal)}</p>` : ""}
      <div class="small muted" style="margin:10px 0 6px">Welches Blatt gehört zu welcher Trainingsgruppe?</div>
      ${r.plans.map((p, i) => {
        const match = S.groups.find(g => norm(g.name) === norm(p.name));
        return `<div class="maprow"><span class="grow"><b>${esc(p.name)}</b><span class="small muted" style="display:block">${p.days.filter(d => d.items.length).length} Tage mit Programm</span></span>
          <select name="map${i}" aria-label="Trainingsgruppe für ${esc(p.name)}"><option value="">– keine –</option>
          ${S.groups.map(g => `<option value="${esc(g.id)}" ${match && match.id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
          <option value="__new" ${match ? "" : "selected"}>+ Neue Gruppe „${esc(p.name)}“</option></select></div>`;
      }).join("")}
      ${r.extras.length ? `<p class="small muted" style="margin-top:10px">Weitere Blätter werden unter dem Plan angezeigt: ${r.extras.map(x => esc(x.name)).join(", ")}</p>` : ""}
      ${newAbk.length ? `<label class="opt"><input type="checkbox" name="abk" checked><span><b>${newAbk.length} Abkürzungen in die Übungssammlung übernehmen</b><span class="small muted">${esc(newAbk.map(a => a.abbreviation).join(", "))}</span></span></label>` : ""}
      ${existing ? `<p class="small" style="margin-top:8px">Für diese Woche gibt es schon den Plan „${esc(existing.title)}“. Der neue Plan ersetzt ihn.</p>` : ""}
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Plan speichern</button></div></form>`);
}

/* ───────────── Aktionen ───────────── */
async function busy(el, fn) {
  const btns = el ? el.querySelectorAll("button") : [];
  btns.forEach(b => b.disabled = true);
  try { return await fn(); }
  catch (e) { toast(deErr(e), "error"); throw e; }
  finally { btns.forEach(b => b.disabled = false); }
}
const quiet = p => p.catch(() => {});
async function reloadSessions() { await loadSessions(); render(); }

const actions = {
  tab(el) { S.tab = el.dataset.tab; LS.set("la_tab", S.tab); if (S.tab === "plan") S.scrolledToday = false; render(); scrollTo(0, 0); },
  authMode(el) { S.authMode = el.dataset.mode; S.authMsg = null; render(); },
  pref(el) { setPref(el.dataset.k, el.dataset.v); },
  reload() { refresh(); },
  closeSheet() { closeSheet(); },
  member(el) { memberSheet(el.dataset.id); },
  // Plan
  planView(el) { S.planView = el.dataset.v; render(); },
  planWeek(el) { S.planWeek = addDays(S.planWeek || mondayOf(todayIso()), Number(el.dataset.d)); S.scrolledToday = false; render(); },
  planSheet(el) { S.planSheet = el.dataset.name; LS.set("la_sheet", S.planSheet); render(); },
  openPlanToday() { S.tab = "plan"; S.planView = "week"; S.planWeek = null; S.scrolledToday = false; LS.set("la_tab", "plan"); render(); },
  openPlan(el) { const p = S.plans.find(x => x.id === el.dataset.id); S.planWeek = p.valid_from; S.planView = "week"; render(); scrollTo(0, 0); },
  planUpload() { $("#plan-file").click(); },
  async planDelete(el) {
    const p = S.plans.find(x => x.id === el.dataset.id);
    if (!await ask("Plan löschen?", `„${esc(p.title || "Wochenplan")}“ (ab ${esc(weekLabel(p.valid_from))}) wird gelöscht.`, "Löschen", true)) return;
    await quiet(busy(null, async () => { await S.be.deletePlan(p.id); S.plans = await S.be.plans(); render(); toast("Plan gelöscht"); }));
  },
  itemInfo(el) { itemSheet(el.dataset.text); },
  // Übungen
  exOpen(el) { exerciseSheet.edit = false; exerciseSheet(el.dataset.id); },
  exNew(el) { exerciseSheet.edit = true; exerciseSheet(null, el.dataset.name || ""); },
  exEdit(el) { exerciseSheet.edit = true; exerciseSheet(el.dataset.id); },
  async exDelete(el) {
    const e = S.exercises.find(x => x.id === el.dataset.id);
    if (!await ask("Übung löschen?", `„${esc(e.name)}“ wird aus der Übungssammlung gelöscht.`, "Löschen", true)) return;
    await quiet(busy(null, async () => {
      await S.be.deleteExercise(e.id); if (e.video_path) await S.be.deleteVideo(e.video_path).catch(() => {});
      S.exercises = await S.be.exercises(); render(); toast("Übung gelöscht");
    }));
  },
  // Termine
  async respYes(el) {
    await quiet(busy(el.parentElement, async () => { await S.be.respond(el.dataset.id, S.me.id, "yes"); await reloadSessions(); toast("Zugesagt"); }));
  },
  respNo(el) { absageSheet(el.dataset.id, S.me.id); },
  sessOpen(el) { sessionSheet(el.dataset.id); },
  attPerson(el) { attPersonSheet(el.dataset.sid, el.dataset.uid); },
  async setMark(el) {
    await quiet(busy(el.parentElement, async () => { await S.be.setMark(el.dataset.sid, el.dataset.uid, el.dataset.v || null); await loadSessions(); render(); attPersonSheet(el.dataset.sid, el.dataset.uid); }));
  },
  async respFor(el) {
    if (el.dataset.v === "no") return absageSheet(el.dataset.sid, el.dataset.uid);
    await quiet(busy(el.parentElement, async () => { await S.be.respond(el.dataset.sid, el.dataset.uid, "yes"); await loadSessions(); render(); attPersonSheet(el.dataset.sid, el.dataset.uid); }));
  },
  sessNew() { sessionEditSheet({ session_date: todayIso(), title: "Training", location: ((S.settings.session_template || [])[0] || {}).location || "" }); },
  sessEdit(el) { sessionEditSheet(S.sessions.find(x => x.id === el.dataset.id)); },
  async sessDelete(el) {
    if (!await ask("Termin löschen?", "Der Termin und alle Zu-/Absagen dazu werden gelöscht. Wenn das Training nur ausfällt, setze lieber den Haken „Training fällt aus“.", "Löschen", true)) return;
    await quiet(busy(null, async () => { await S.be.deleteSession(el.dataset.id); await reloadSessions(); toast("Termin gelöscht"); }));
  },
  showPast() { S.showPast = true; render(); },
  tplAdd() { $("#tpl-more").insertAdjacentHTML("beforebegin", templateRow({ dow: 2, time: "", location: "" })); },
  tplRemove(el) { el.closest("[data-row]").remove(); },
  // Konto & Team
  async logout() {
    if (S.be.kind === "demo") return actions.demoExit();
    await S.be.signOut(); S.user = null; S.me = null; S.authMode = "login"; S.authMsg = null; render();
  },
  async approve(el) {
    await quiet(busy(el.parentElement, async () => {
      await S.be.updateProfile(el.dataset.id, { approved: true });
      const p = person(el.dataset.id);
      toast(`${p ? p.display_name : "Konto"} ist freigeschaltet`);
      await refresh();
      if (S.groups.length) memberSheet(el.dataset.id);
    }));
  },
  async reject(el) {
    const p = person(el.dataset.id);
    if (!await ask("Registrierung ablehnen?", `Das Konto von <b>${esc(p.display_name)}</b> wird gelöscht.`, "Ablehnen", true)) return;
    await quiet(busy(null, async () => { await S.be.deleteUser(p.id); toast("Abgelehnt"); await refresh(); }));
  },
  async deleteMember(el) {
    const p = person(el.dataset.id);
    if (!await ask("Konto löschen?", `Das Konto von <b>${esc(p.display_name)}</b> und alle zugehörigen Daten werden endgültig gelöscht.`, "Endgültig löschen", true)) return;
    await quiet(busy(null, async () => { await S.be.deleteUser(p.id); toast("Konto gelöscht"); await refresh(); }));
  },
  async deleteMe() {
    if (!await ask("Eigenes Konto löschen?", "Dein Konto und alle deine Daten werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.", "Endgültig löschen", true)) return;
    await quiet(busy(null, async () => {
      await S.be.deleteUser(S.me.id);
      if (S.be.kind === "demo") { S.be.switchUser("u-admin"); return boot(); }
      await S.be.signOut(); S.user = null; S.me = null; render(); toast("Konto gelöscht");
    }));
  },
  changePw() {
    sheet(`<h3>Passwort ändern</h3><form data-form="changepw">
      <label class="f"><span>Neues Passwort</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"></label>
      <label class="f"><span>Wiederholen</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>`);
  },
  async groupAdd() {
    const name = await askText("Neue Trainingsgruppe", "Name (wie das Blatt im Excel-Plan)"); if (!name) return;
    const max = Math.max(0, ...S.groups.map(g => g.sort_order || 0));
    await quiet(busy(null, async () => { await S.be.insertGroup({ name, sort_order: max + 1 }); await refresh(); toast("Hinzugefügt"); }));
  },
  async groupRename(el) {
    const g = S.groups.find(x => x.id === el.dataset.id);
    const name = await askText("Umbenennen", "Name", g.name); if (!name || name === g.name) return;
    await quiet(busy(null, async () => { await S.be.updateGroup(g.id, { name }); await refresh(); }));
  },
  async groupMove(el) {
    const i = S.groups.findIndex(x => x.id === el.dataset.id), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= S.groups.length) return;
    const list = S.groups.slice(); [list[i], list[j]] = [list[j], list[i]];
    await quiet(busy(el.closest(".card"), async () => {
      await Promise.all(list.map((g, k) => g.sort_order === k + 1 ? null : S.be.updateGroup(g.id, { sort_order: k + 1 })));
      await refresh();
    }));
  },
  async groupDelete(el) {
    const g = S.groups.find(x => x.id === el.dataset.id);
    const n = S.profiles.filter(p => p.plan_group_id === g.id).length;
    if (!await ask("Trainingsgruppe löschen?", `<b>${esc(g.name)}</b> wird gelöscht.${n ? ` ${n} Person(en) sind danach keiner Gruppe mehr zugeordnet.` : ""}`, "Löschen", true)) return;
    await quiet(busy(null, async () => { await S.be.deleteGroup(g.id); await refresh(); toast("Gelöscht"); }));
  },
  async backup() {
    await quiet(busy(null, async () => {
      await loadAll();
      const tables = {};
      for (const t of BACKUP_TABLES) tables[t] = await S.be.dump(t);
      download(`lt-dshs-backup_${stamp()}.json`, {
        app: APP_ID, format: 2, created_at: new Date().toISOString(), created_by: S.me.display_name, app_version: VERSION,
        settings: { team_name: S.settings.team_name, plan_visibility: S.settings.plan_visibility, session_template: S.settings.session_template },
        profiles: S.profiles.map(p => ({ id: p.id, display_name: p.display_name, email: S.emails[p.id] || null, role: p.role, approved: p.approved, plan_group_id: p.plan_group_id })),
        tables
      });
      LS.set("la_last_backup", new Date().toISOString());
      toast("Backup gespeichert"); render();
    }));
  },
  restore() { $("#restore-file").click(); },
  async exportMine() {
    const mine = { attendance: S.att.filter(a => a.user_id === S.me.id), reasons: S.priv.filter(a => a.user_id === S.me.id), history: S.log.filter(a => a.user_id === S.me.id) };
    download(`meine-daten_${stamp()}.json`, {
      app: APP_ID, exported_at: new Date().toISOString(), email: S.user.email || null,
      profile: { display_name: S.me.display_name, role: S.me.role, approved: S.me.approved, trainingsgruppe: groupName(S.me.plan_group_id) || null, created_at: S.me.created_at },
      zu_und_absagen: mine, uebungen_von_mir: S.exercises.filter(e => e.created_by === S.me.id), geraete_einstellungen: prefs
    });
  },
  async update() {
    toast("Suche nach neuer Version …");
    try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch {}
    setTimeout(() => location.reload(), 600);
  },
  demoStart() { LS.set("la_mode", "demo"); boot(); },
  demoExit() { LS.del("la_mode"); S.be = null; S.user = null; S.me = null; boot(); },
  async demoReset() {
    if (!await ask("Demo zurücksetzen?", "Alle Änderungen im Demo-Modus gehen verloren.", "Zurücksetzen", true)) return;
    S.be.reset(); boot();
  },
  async disconnect() {
    if (!await ask("Verbindung trennen?", "Die Server-Daten bleiben erhalten; nur dieses Gerät vergisst die Verbindung.", "Trennen", true)) return;
    try { await S.be.signOut(); } catch {}
    LS.del("la_conn"); S.be = null; S.user = null; S.me = null; boot();
  }
};

const changes = {
  async demoUser(el) { S.be.switchUser(el.value); closeSheet(); await boot(); },
  async visibility(el) {
    await quiet(busy(null, async () => {
      S.settings = await S.be.updateSettings({ plan_visibility: el.value }); S.sheetCache = {};
      toast(el.value === "all" ? "Alle sehen jetzt alle Pläne" : "Athleten sehen jetzt nur ihren Plan"); render();
    }));
  },
  async planFile(el) {
    const file = el.files[0]; el.value = ""; if (!file) return;
    if (/\.numbers$/i.test(file.name)) return toast("Numbers-Dateien bitte als Excel exportieren: Ablage → Exportieren → Excel (.xlsx).", "error");
    try {
      const r = await XlsxPlan.parsePlanFile(await file.arrayBuffer());
      IMPORT = Object.assign(r, { file: file.name, week: defaultImportWeek() });
      importSheet();
    } catch (e) { toast(deErr(e), "error"); }
  },
  async restoreFile(el) {
    const file = el.files[0]; el.value = ""; if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast("Die Datei ist kein gültiges Backup.", "error"); }
    if (!data || data.app !== APP_ID || ![1, 2].includes(data.format)) return toast("Die Datei ist kein Backup dieser App.", "error");
    const when = data.created_at ? new Date(data.created_at).toLocaleString("de-DE") : "unbekannt";
    const n = data.format === 2 ? `${(data.tables.plans || []).length} Pläne, ${(data.tables.sessions || []).length} Termine, ${data.profiles.length} Personen` : `${data.plan_groups.length} Trainingsgruppen, ${data.profiles.length} Personen`;
    if (!await ask("Backup wiederherstellen?", `Backup vom <b>${esc(when)}</b>: ${n}. Gleichnamige Einträge werden mit dem Stand aus dem Backup überschrieben.`, "Wiederherstellen", true)) return;
    await quiet(busy(null, () => restoreBackup(data)));
  }
};
const inputs = {
  exSearch(el) {
    S.exSearch = el.value; const pos = el.selectionStart;
    render(); const n = document.querySelector('[data-input="exSearch"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }
};

async function restoreBackup(data) {
  await loadAll();
  const tables = data.format === 2 ? data.tables : { plan_groups: data.plan_groups };
  const r = { people: 0, skipped: 0 };
  const st = data.settings || {};
  await S.be.updateSettings(Object.fromEntries(Object.entries({ team_name: st.team_name, plan_visibility: st.plan_visibility, session_template: st.session_template }).filter(([, v]) => v !== undefined)));
  // Trainingsgruppen: gleiche ID oder gleicher Name
  const idMap = {};
  for (const g of tables.plan_groups || []) {
    const byId = S.groups.find(x => x.id === g.id), byNm = S.groups.find(x => x.name === g.name);
    if (byId) { await S.be.updateGroup(byId.id, { name: g.name, sort_order: g.sort_order }); idMap[g.id] = byId.id; }
    else if (byNm) { await S.be.updateGroup(byNm.id, { sort_order: g.sort_order }); idMap[g.id] = byNm.id; }
    else { const n = await S.be.insertGroup({ id: g.id, name: g.name, sort_order: g.sort_order }); idMap[g.id] = n.id; }
  }
  const mapG = id => id ? (idMap[id] || null) : null;
  const known = new Set(S.profiles.map(p => p.id));
  const keepUser = row => !row.user_id || known.has(row.user_id);
  const fixRef = (row, ...keys) => { const o = Object.assign({}, row); keys.forEach(k => { if (o[k] && !known.has(o[k])) o[k] = null; }); return o; };
  if (data.format === 2) {
    await S.be.upsert("plans", (tables.plans || []).map(p => fixRef(p, "created_by")));
    await S.be.upsert("plan_sheets", (tables.plan_sheets || []).map(s => Object.assign({}, s, { group_id: mapG(s.group_id) })));
    await S.be.upsert("exercises", (tables.exercises || []).map(e => fixRef(e, "created_by")));
    await S.be.upsert("sessions", (tables.sessions || []).map(s => fixRef(s, "created_by")));
    await S.be.upsert("session_weeks", tables.session_weeks || []);
    await S.be.upsert("attendance", (tables.attendance || []).filter(keepUser));
    await S.be.upsert("attendance_private", (tables.attendance_private || []).filter(keepUser));
    await S.be.upsert("attendance_log", (tables.attendance_log || []).filter(keepUser).map(l => fixRef(l, "changed_by")));
  }
  const rows = data.profiles.slice().sort((a, b) => (b.role === "admin") - (a.role === "admin"));
  for (const p of rows) {
    if (!known.has(p.id)) { r.skipped++; continue; }
    const patch = { display_name: p.display_name, plan_group_id: mapG(p.plan_group_id) };
    if (p.id !== S.me.id) { patch.role = p.role; patch.approved = p.approved; }
    try { await S.be.updateProfile(p.id, patch); r.people++; } catch { r.skipped++; }
  }
  await refresh();
  toast(`Wiederhergestellt: ${r.people} Personen${r.skipped ? `, ${r.skipped} übersprungen (Konto existiert nicht mehr)` : ""}`);
}

const forms = {
  async connect(f) {
    const url = f.url.value.trim().replace(/\/+$/, ""), key = f.key.value.trim();
    if (!/^https:\/\/.+/.test(url)) return toast("Die URL muss mit https:// beginnen.", "error");
    LS.set("la_conn", { url, key }); boot();
  },
  async login(f) {
    S.authMsg = null;
    try { const s = await S.be.signIn(f.email.value.trim(), f.pw.value); S.user = s.user; await refresh(); }
    catch (e) { S.authMsg = { text: deErr(e) }; render(); }
  },
  async register(f) {
    S.authMsg = null;
    try {
      const s = await S.be.signUp(f.email.value.trim(), f.pw.value, f.name.value.trim());
      if (s) { S.user = s.user; await refresh(); }
      else { S.authMode = "login"; S.authMsg = { ok: true, text: "Fast geschafft: Bestätige deine E-Mail-Adresse über den Link in der Mail und melde dich dann an." }; render(); }
    } catch (e) { S.authMsg = { text: deErr(e) }; render(); }
  },
  async forgot(f) {
    try { await S.be.resetPassword(f.email.value.trim()); S.authMode = "login"; S.authMsg = { ok: true, text: "Wenn es ein Konto mit dieser E-Mail gibt, ist ein Link unterwegs." }; }
    catch (e) { S.authMsg = { text: deErr(e) }; }
    render();
  },
  async newpw(f) {
    if (f.pw.value !== f.pw2.value) return toast("Die Passwörter stimmen nicht überein.", "error");
    await S.be.setPassword(f.pw.value);
    S.recovery = false; history.replaceState(null, "", appUrl()); toast("Passwort gespeichert"); await refresh();
  },
  async changepw(f) {
    if (f.pw.value !== f.pw2.value) return toast("Die Passwörter stimmen nicht überein.", "error");
    await S.be.setPassword(f.pw.value); closeSheet(); toast("Passwort geändert");
  },
  async myname(f) { await S.be.updateProfile(S.me.id, { display_name: f.name.value.trim() }); await refresh(); toast("Name gespeichert"); },
  async teamname(f) { S.settings = await S.be.updateSettings({ team_name: f.name.value.trim() }); render(); toast("Gespeichert"); },
  async template(f) {
    const rows = [...f.querySelectorAll("[data-row]")].map(r => ({ dow: Number(r.querySelector("[name=dow]").value), time: r.querySelector("[name=time]").value, location: r.querySelector("[name=location]").value.trim() }))
      .sort((a, b) => a.dow - b.dow || a.time.localeCompare(b.time));
    S.settings = await S.be.updateSettings({ session_template: rows }); render(); toast("Feste Trainingstage gespeichert");
  },
  async member(f) {
    const id = f.dataset.id, p = person(id), patch = {};
    const name = f.name.value.trim(); if (name !== p.display_name) patch.display_name = name;
    if (f.group) { const g = f.group.value || null; if (g !== p.plan_group_id) patch.plan_group_id = g; }
    if (f.role && f.role.value !== p.role) {
      if (id === S.me.id && f.role.value !== "admin" && !await ask("Eigene Admin-Rechte abgeben?", "Du kannst sie dir danach nicht selbst zurückgeben.", "Abgeben", true)) return;
      patch.role = f.role.value;
    }
    if (f.approved && f.approved.checked !== p.approved) patch.approved = f.approved.checked;
    if (Object.keys(patch).length) { await S.be.updateProfile(id, patch); await refresh(); toast("Gespeichert"); }
    closeSheet();
  },
  async absage(f) {
    const reason = (f.querySelector("[name=reason]:checked") || {}).value, note = f.note.value.trim();
    if (!reason) return toast("Bitte wähle einen Grund.", "error");
    if (reason === "sonstiges" && !note) return toast("Bitte beschreibe kurz den Grund.", "error");
    await S.be.respond(f.dataset.id, f.dataset.user, "no", reason, note);
    await loadSessions(); render();
    if (f.dataset.user !== S.me.id) attPersonSheet(f.dataset.id, f.dataset.user); else { closeSheet(); toast("Abgesagt"); }
  },
  async session(f) {
    const row = { title: f.title.value.trim() || "Training", session_date: f.date.value, start_time: f.time.value || null, location: f.location.value.trim(), note: f.note.value.trim() };
    if (f.dataset.id) { row.id = f.dataset.id; row.cancelled = !!(f.cancelled && f.cancelled.checked); }
    await S.be.saveSession(row); closeSheet(); await reloadSessions(); toast("Termin gespeichert");
  },
  async exercise(f) {
    const id = f.dataset.id || null, old = id ? S.exercises.find(x => x.id === id) : null;
    const row = { name: f.name.value.trim(), abbreviation: f.abbreviation.value.trim(), category: f.category.value.trim(), description: f.description.value.trim(), video_url: f.video_url.value.trim() };
    if (row.video_url && !/^https?:\/\//i.test(row.video_url)) return toast("Der Video-Link muss mit https:// beginnen.", "error");
    if (id) row.id = id;
    const file = f.video.files[0];
    if (file && file.size > 50 * 1024 * 1024) return toast("Das Video ist größer als 50 MB. Bitte kürzen oder komprimieren.", "error");
    let oldPath = old && old.video_path;
    if (file) { toast("Video wird hochgeladen …"); row.video_path = await S.be.uploadVideo(file); }
    else if (f.removeVideo && f.removeVideo.checked) row.video_path = "";
    const saved = await S.be.saveExercise(row);
    if (oldPath && row.video_path !== undefined && row.video_path !== oldPath) await S.be.deleteVideo(oldPath).catch(() => {});
    S.exercises = await S.be.exercises();
    exerciseSheet.edit = false; render(); exerciseSheet(saved.id); toast("Übung gespeichert");
  },
  async import(f) {
    const r = IMPORT, week = f.week.value;
    const existing = S.plans.filter(p => p.valid_from === week);
    // Gruppen anlegen bzw. zuordnen
    const sheets = [];
    let max = Math.max(0, ...S.groups.map(g => g.sort_order || 0));
    for (let i = 0; i < r.plans.length; i++) {
      const p = r.plans[i]; let gid = f["map" + i].value || null;
      if (gid === "__new") {
        const ex = S.groups.find(g => norm(g.name) === norm(p.name));
        gid = ex ? ex.id : (await S.be.insertGroup({ name: p.name.slice(0, 60), sort_order: ++max })).id;
      }
      sheets.push({ name: p.name, group_id: gid, sort_order: i + 1, data: { days: p.days } });
    }
    const p0 = r.plans[0];
    await S.be.savePlan({ valid_from: week, title: f.title.value.trim(), season: p0.season || "", goal: p0.goal || "", source_name: r.file, extra_sheets: r.extras.filter(x => !/abk/i.test(x.name)).map(x => ({ name: x.name, rows: x.rows })) }, sheets);
    for (const old of existing) await S.be.deletePlan(old.id);
    let added = 0;
    if (f.abk && f.abk.checked) {
      const abk = r.extras.find(x => /abk/i.test(x.name));
      for (const a of XlsxPlan.abbreviationsFrom(abk)) {
        if (S.exercises.some(e => norm(e.abbreviation) === norm(a.abbreviation) || norm(e.name) === norm(a.name))) continue;
        try { S.exercises.push(await S.be.saveExercise({ name: a.name, abbreviation: a.abbreviation, category: "" })); added++; } catch {}
      }
    }
    IMPORT = null; closeSheet();
    await refresh();
    S.tab = "plan"; S.planView = "week"; S.planWeek = week; S.scrolledToday = false; render();
    toast(`Plan gespeichert${added ? `, ${added} Übungen übernommen` : ""}`);
  }
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (el && actions[el.dataset.act] && !el.disabled) { e.preventDefault(); actions[el.dataset.act](el); }
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});
document.addEventListener("input", e => {
  const el = e.target.closest("[data-input]");
  if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el);
});
document.addEventListener("submit", e => {
  const f = e.target.closest("form[data-form]");
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  quiet(busy(f, () => forms[f.dataset.form](f)));
});

/* ───────────── Start ───────────── */
async function boot() {
  applyPrefs();
  closeSheet();
  S.be = null; S.user = null; S.me = null; S.loadError = null;
  const conn = connection();
  if (LS.get("la_mode", null) === "demo") S.be = makeDemoBackend();
  else if (conn) {
    if (!window.supabase) { $("#app").innerHTML = viewMessage("Fehler", "Die Supabase-Bibliothek konnte nicht geladen werden.", `<button class="btn block" data-act="update">Neu laden</button>`); return; }
    try { S.be = makeSupabaseBackend(conn.url, conn.key); }
    catch (e) { LS.del("la_conn"); toast(deErr(e), "error"); render(); return; }
    S.be.onAuth(async (ev, session) => {
      if (ev === "PASSWORD_RECOVERY") { S.recovery = true; S.user = session?.user || S.user; render(); }
      else if (ev === "SIGNED_OUT") { S.user = null; S.me = null; render(); }
      else if (ev === "SIGNED_IN" && session && session.user.id !== S.user?.id) { S.user = session.user; await refresh(); }
    });
  }
  if (!S.be) { render(); return; }
  try { S.user = (await S.be.session())?.user || null; }
  catch (e) { S.user = null; S.authMsg = { text: deErr(e) }; }
  if (/type=recovery/.test(location.hash)) S.recovery = true;
  await refresh();
}

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
