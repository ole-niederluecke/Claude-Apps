"use strict";
const VERSION = "20.11.2026 · 3";
// Stand der Datenbank, den diese App-Version braucht (= Nummer in supabase/alles_in_einem_vNN.sql)
const REQUIRED_SQL = 10;
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
    [/already registered|already been registered|user already exists/i, "Für diese E-Mail gibt es schon ein Konto. Melde dich an – oder nimm für ein zweites Konto eine andere Adresse (bei Gmail z. B. name+athlet@gmail.com, landet im selben Postfach)."],
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
const BACKUP_TABLES = ["plan_groups", "plans", "plan_sheets", "exercises", "sessions", "session_weeks", "attendance", "attendance_private", "attendance_log",
  "test_types", "norms", "athlete_info", "injuries", "test_results", "calendar_entries", "competition_results", "week_openings", "feedback", "attendance_weekly", "competition_entries"];
const CONFLICT = { competition_entries: "entry_id,user_id", attendance_weekly: "user_id,week_start", attendance: "session_id,user_id", attendance_private: "session_id,user_id", session_weeks: "week_start", athlete_info: "user_id", week_openings: "week_start" };
const INSERT_ONLY = new Set(["session_weeks", "week_openings", "attendance_log", "attendance_weekly"]); // nur ergänzen, nie überschreiben
const ORDER = { attendance_weekly: ["week_start"], feedback: ["created_at"], test_types: ["sort_order", "name"], calendar_entries: ["start_date"], test_results: ["test_date"], competition_results: ["comp_date"], injuries: ["start_date"] };

// Ein Supabase-Client pro Verbindung (z. B. nach „Demo beenden“ wiederverwenden statt einen zweiten anzulegen)
const SB_CLIENTS = {};
function makeSupabaseBackend(url, key) {
  const sb = SB_CLIENTS[url + "|" + key] = SB_CLIENTS[url + "|" + key] || window.supabase.createClient(url, key, {
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
    async updateSheet(id, patch) { return ok(await T("plan_sheets").update(patch).eq("id", id).select().single()); },
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
    async clearResponse(session, user) { ok(await sb.rpc("clear_response", { p_session: session, p_user: user })); },
    async openings() { return (ok(await T("week_openings").select("week_start"))).map(r => r.week_start); },
    async openWeek(monday, open) { ok(await sb.rpc("open_week", { p_week: monday, p_open: open })); },
    async changeEmail(email) { ok(await sb.auth.updateUser({ email }, { emailRedirectTo: appUrl() })); },
    async setInvites(entryId, ids, status) {
      const cur = ok(await T("competition_entries").select("*").eq("entry_id", entryId));
      const drop = cur.filter(c => !ids.includes(c.user_id)).map(c => c.user_id);
      if (drop.length) ok(await T("competition_entries").delete().eq("entry_id", entryId).in("user_id", drop));
      const add = ids.filter(u => !cur.some(c => c.user_id === u)).map(u => ({ entry_id: entryId, user_id: u }));
      if (add.length) ok(await T("competition_entries").insert(add));
      for (const c of cur) if (ids.includes(c.user_id) && status[c.user_id] && status[c.user_id] !== c.status)
        ok(await T("competition_entries").update({ status: status[c.user_id], updated_at: new Date().toISOString() }).eq("entry_id", entryId).eq("user_id", c.user_id));
    },
    async answerInvite(entryId, status) { ok(await sb.rpc("answer_competition", { p_entry: entryId, p_status: status })); },
    async feedbackBoard() { return ok(await sb.rpc("feedback_board")) || []; },
    // vor Stand 10 gab es die Funktion noch nicht → 0
    async sqlVersion() { const r = await sb.rpc("sql_version"); return r.error ? 0 : Number(r.data) || 0; },
    async voteFeedback(id, on) {
      if (on) ok(await T("feedback_votes").upsert({ feedback_id: id, user_id: S.me.id }, { onConflict: "feedback_id,user_id", ignoreDuplicates: true }));
      else ok(await T("feedback_votes").delete().eq("feedback_id", id).eq("user_id", S.me.id));
    },
    // Allgemeine Tabellen (Leistung, Kalender)
    async list(table) { let q = T(table).select("*"); (ORDER[table] || []).forEach(c => { q = q.order(c); }); return ok(await q); },
    async saveRow(table, row) {
      if (table === "athlete_info") return ok(await T(table).upsert(row, { onConflict: "user_id" }).select().single());
      if (row.id) { const { id, ...patch } = row; return ok(await T(table).update(patch).eq("id", id).select().single()); }
      return ok(await T(table).insert(row).select().single());
    },
    async removeRow(table, id) { ok(await T(table).delete().eq("id", id)); },
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
      const opt = Object.assign({}, CONFLICT[table] ? { onConflict: CONFLICT[table] } : {}, INSERT_ONLY.has(table) ? { ignoreDuplicates: true } : {});
      for (let i = 0; i < rows.length; i += 500) ok(await T(table).upsert(rows.slice(i, i + 500), opt));
    }
  };
}

/* ───────────── Backend: Demo (nur dieses Gerät) ─────────────
   Bildet die wichtigsten Regeln aus den SQL-Dateien nach, damit man alles gefahrlos ausprobieren kann. */
function demoSeed() {
  const now = new Date().toISOString(), mon = mondayOf(todayIso());
  const g = (id, name, s) => ({ id, name, sort_order: s });
  const joined = new Date(Date.now() - 200 * 864e5).toISOString();
  const p = (id, display_name, role, approved, plan_group_id) => ({ id, display_name, role, approved, plan_group_id, created_at: approved ? joined : now });
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
      p("u-admin", "Alex Admin", "admin", true, null), p("u-trainer", "Toni Trainer", "trainer", true, null),
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
    sessions, session_weeks: weeks, attendance: att, attendance_private: priv, attendance_log: log,
    week_openings: [{ week_start: addDays(mon, -7) }, { week_start: mon }],
    feedback: [
      { id: "f1", user_id: "u3", category: "fehler", message: "Beim Absagen springt die Seite nach oben.", context: "Termine", app_version: "Demo", device: "iPhone", status: "neu", admin_note: "", created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: "f2", user_id: "u-trainer", category: "idee", message: "Es wäre gut, beim Plan eine Notiz für die ganze Woche zu haben.", context: "Plan", app_version: "Demo", device: "", status: "erledigt", admin_note: "Kommt in der nächsten Version.", created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: "f3", user_id: "u4", category: "idee", message: "Eine Erinnerung, wenn die Anmeldung für die nächste Woche offen ist, wäre super.", context: "Termine", app_version: "Demo", device: "Android", status: "neu", admin_note: "", created_at: new Date(Date.now() - 2 * 86400000).toISOString() }
    ],
    feedback_votes: [{ feedback_id: "f1", user_id: "u4" }, { feedback_id: "f1", user_id: "u-trainer" }, { feedback_id: "f3", user_id: "u3" }]
  };
}

const DEMO_RULES = (() => {
  const staffOnly = (n, o, c) => c.staff;
  return {
    athlete_info: { read: "staffSelf", defaults: { norm_group_ids: [] }, canWrite: staffOnly },
    injuries: { read: "staffSelf", defaults: { note: "", exclude_attendance: true, exclude_tests: true, end_date: null }, canWrite: staffOnly },
    test_types: { read: "member", defaults: { unit: "", category: "sonstiges", better: "higher", sides: false, entry: "staff", note: "", sort_order: 0, active: true }, canWrite: staffOnly },
    norms: { read: "member", defaults: { group_id: null }, canWrite: staffOnly },
    test_results: { read: "staffSelf", defaults: { note: "", value_left: null, value_right: null, entered_by: null },
      canWrite: (n, o, c) => c.staff || (n.user_id === c.me && c.test && c.test.entry === "self" && (!o || o.entered_by === c.me)) },
    calendar_entries: { read: "member", defaults: { end_date: null, location: "", note: "", keep: false }, canWrite: staffOnly },
    competition_entries: { read: "staffSelf", defaults: { status: "angefragt" }, canWrite: (n, o, c) => c.staff },
    attendance_weekly: { read: "staffSelf", defaults: { reasons: {} }, canWrite: () => false },
    feedback: { read: "adminSelf", defaults: { category: "idee", context: "", app_version: "", device: "", status: "neu", admin_note: "" },
      canWrite: (n, o, c) => c.admin || (n.user_id === c.me && (!o || (o.status === n.status && o.admin_note === n.admin_note))) },
    competition_results: { read: "member", defaults: { entry_id: null, place: "", wind: "", note: "", better: "lower", entered_by: null },
      canWrite: (n, o, c) => c.staff || (n.user_id === c.me && (!o || o.user_id === c.me)) }
  };
})();

function demoPerformance(db) {
  const T = (id, name, unit, category, better, sides, entry, note, sort_order) => ({ id, name, unit, category, better, sides, entry, note, sort_order, active: true });
  db.test_types = [
    T("t1", "30m fliegend", "s", "sprint", "lower", false, "staff", "30m Anlauf", 10), T("t2", "80m", "s", "sprint", "lower", false, "staff", "Kurzsprint", 11),
    T("t3", "300m", "s", "sprint", "lower", false, "staff", "Langsprint", 12), T("t4", "5er Hop", "m", "sprung", "higher", true, "staff", "aus dem Stand, bester Versuch je Bein", 20),
    T("t5", "10er SPL", "m", "sprung", "higher", false, "staff", "", 21), T("t6", "Standweitsprung", "m", "sprung", "higher", false, "staff", "", 22),
    T("t7", "Umsetzen", "kg", "kraft", "higher", false, "self", "1RM", 31), T("t8", "Kniebeuge", "kg", "kraft", "higher", false, "self", "1RM", 32),
    T("t9", "Bankdrücken", "kg", "kraft", "higher", false, "self", "1RM", 36), T("t10", "Klimmzug", "kg", "kraft", "higher", false, "self", "Zusatzgewicht bei 1RM", 39)
  ];
  const N = (id, test_id, sex, group_id, value) => ({ id, test_id, sex, group_id, value });
  db.norms = [N("n1", "t1", "m", null, 3.4), N("n2", "t1", "w", null, 3.65), N("n3", "t2", "m", "g1", 9.9), N("n4", "t2", "w", "g1", 10.7),
    N("n5", "t3", "m", "g2", 40.1), N("n6", "t3", "w", "g2", 45.3), N("n7", "t6", "m", null, 2.65), N("n8", "t6", "w", null, 2.35)];
  const sex = { u1: "w", u2: "m", u3: "w", u4: "m", u5: "w", u6: "m" };
  db.athlete_info = Object.entries(sex).map(([user_id, s]) => ({ user_id, sex: s, norm_group_ids: user_id === "u4" ? ["g1"] : [] }));
  const t = todayIso(), d = n => addDays(t, -n);
  db.injuries = [{ id: "i1", user_id: "u6", start_date: d(25), end_date: null, note: "Muskelfaserriss Oberschenkel", exclude_attendance: true, exclude_tests: true }];
  const R = []; let k = 0;
  const r = (user_id, test_id, date, value, l, rr) => R.push({ id: "r" + (++k), user_id, test_id, test_date: date, value, value_left: l ?? null, value_right: rr ?? null, note: "", entered_by: "u-trainer", created_at: date + "T12:00:00Z" });
  const dates = [d(120), d(60), d(6)];
  const base = { u1: [3.70, 10.9, null, 2.38], u2: [3.30, 9.7, null, 2.80], u3: [3.66, null, 44.2, 2.42], u4: [3.25, 9.6, 39.0, 2.92], u5: [3.63, null, 43.8, 2.50] };
  Object.entries(base).forEach(([u, [s30, s80, s300, sw]]) => dates.forEach((dt, i) => {
    const f = 1 - i * 0.012;
    r(u, "t1", dt, +(s30 * f).toFixed(2)); if (s80) r(u, "t2", dt, +(s80 * f).toFixed(2)); if (s300) r(u, "t3", dt, +(s300 * f).toFixed(1));
    r(u, "t6", dt, +(sw * (1 + i * 0.015)).toFixed(2)); r(u, "t4", dt, null, +(sw * 4.9 + i * 0.2).toFixed(2), +(sw * 4.7 + i * 0.25).toFixed(2));
  }));
  R.filter(x => x.test_id === "t4").forEach(x => x.value = Math.max(x.value_left, x.value_right));
  ["u1", "u2", "u3", "u4"].forEach((u, j) => dates.forEach((dt, i) => { r(u, "t8", dt, 80 + j * 15 + i * 5); r(u, "t7", dt, 50 + j * 10 + i * 2.5); }));
  R.filter(x => ["t7", "t8"].includes(x.test_id)).forEach(x => x.entered_by = x.user_id);
  db.test_results = R;
  const C = (id, kind, title, start_date, end_date, location) => ({ id, kind, title, start_date, end_date, location, note: "", created_at: t });
  db.calendar_entries = [
    C("c1", "phase", "Allgemeine Vorbereitung", d(70), d(-20), ""), C("c2", "phase", "Hallensaison", d(-21), d(-110), ""),
    C("c3", "testwoche", "Testwoche", d(6), d(1), ""), C("c4", "wettkampf", "Hallen-Meeting Leverkusen", d(-31), null, "Leverkusen"),
    C("c5", "wettkampf", "NRW Hallenmeisterschaften", d(-66), d(-65), "Dortmund"), C("c6", "testwoche", "Testwoche Herbst", d(56), d(50), "")
  ];
  db.competition_entries = [
    { entry_id: "c4", user_id: "u2", status: "zugesagt" }, { entry_id: "c4", user_id: "u3", status: "angefragt" },
    { entry_id: "c5", user_id: "u1", status: "angefragt" }, { entry_id: "c5", user_id: "u2", status: "angefragt" }, { entry_id: "c5", user_id: "u4", status: "abgesagt" }
  ];
  db.competition_results = [
    { id: "w1", user_id: "u2", entry_id: null, comp_date: d(150), comp_name: "Sportfest Köln", discipline: "100m", result: "10,92", value: 10.92, better: "lower", place: "2", wind: "+0,8", note: "", entered_by: "u2", is_pb: true },
    { id: "w2", user_id: "u2", entry_id: null, comp_date: d(110), comp_name: "Kreismeisterschaften", discipline: "100m", result: "10,85", value: 10.85, better: "lower", place: "1", wind: "+1,2", note: "", entered_by: "u2" },
    { id: "w3", user_id: "u3", entry_id: null, comp_date: d(110), comp_name: "Kreismeisterschaften", discipline: "400m", result: "57,80", value: 57.8, better: "lower", place: "3", wind: "", note: "", entered_by: "u3" }
  ];
  return db;
}

// wie compact_attendance() in Teil 6: Trainings älter als 14 Tage → Wochenstatistik, danach löschen
function demoCompact(db) {
  const cutoff = addDays(todayIso(), -14), old = db.sessions.filter(s => s.session_date < cutoff);
  if (!old.length) return;
  db.attendance_weekly = db.attendance_weekly || [];
  const people = db.profiles.filter(p => p.approved && (p.trains == null ? p.role === "athlete" : p.trains));
  old.filter(s => !s.cancelled).forEach(s => people.forEach(p => {
    if (String(p.created_at || "").slice(0, 10) > s.session_date) return;
    const wk = mondayOf(s.session_date);
    let w = db.attendance_weekly.find(x => x.user_id === p.id && x.week_start === wk);
    if (!w) { w = { user_id: p.id, week_start: wk, counted: 0, attended: 0, n_yes: 0, n_no: 0, n_open: 0, n_late: 0, n_no_show: 0, n_flipped: 0, n_skipped: 0, reasons: {} }; db.attendance_weekly.push(w); }
    const inj = (db.injuries || []).some(i => i.user_id === p.id && i.exclude_attendance && i.start_date <= s.session_date && (!i.end_date || i.end_date >= s.session_date));
    if (inj) { w.n_skipped++; return; }
    const a = db.attendance.find(x => x.session_id === s.id && x.user_id === p.id) || {}, pr = db.attendance_private.find(x => x.session_id === s.id && x.user_id === p.id);
    w.counted++;
    if ((a.status === "yes" && a.coach_mark !== "no_show") || a.coach_mark === "late") w.attended++;
    if (a.status === "yes") w.n_yes++; else if (a.status === "no") { w.n_no++; const k = (pr && pr.reason) || "ohne Angabe"; w.reasons[k] = (w.reasons[k] || 0) + 1; } else w.n_open++;
    if (a.coach_mark === "late") w.n_late++;
    if (a.coach_mark === "no_show") w.n_no_show++;
    if (a.status === "no" && db.attendance_log.some(l => l.session_id === s.id && l.user_id === p.id && l.status === "yes")) w.n_flipped++;
  }));
  const ids = new Set(old.map(s => s.id));
  db.sessions = db.sessions.filter(s => !ids.has(s.id));
  ["attendance", "attendance_private", "attendance_log"].forEach(k => db[k] = db[k].filter(r => !ids.has(r.session_id)));
}
function demoAutoOpen(settings, monday) { return autoOpenAt(settings, monday); }
function makeDemoBackend() {
  const KEY = "la_demo_db_v10";
  let db = LS.get(KEY, null) || demoPerformance(demoSeed());
  const save = () => LS.set(KEY, db);
  const me = () => LS.get("la_demo_user", "u-admin");
  const meRow = () => db.profiles.find(p => p.id === me());
  const myRole = () => { const m = meRow(); return m && m.approved ? m.role : null; };
  const staff = () => ["admin", "trainer"].includes(myRole());
  const deny = msg => { throw new Error(msg || "Keine Berechtigung für diese Änderung."); };
  const inPause = d => (db.calendar_entries || []).some(e => e.kind === "pause" && d >= e.start_date && d <= (e.end_date || e.start_date));
  const needMember = () => { if (!myRole()) deny(); };
  const needStaff = () => { if (!staff()) deny(); };
  const otherAdmins = id => db.profiles.some(p => p.role === "admin" && p.approved && p.id !== id);
  const email = p => p.id.replace("u-", "") + "@beispiel.de";
  const wait = () => new Promise(r => setTimeout(r, 40));
  const now = () => new Date().toISOString();
  return {
    kind: "demo", host: "Demo auf diesem Gerät",
    async sqlVersion() { return REQUIRED_SQL; },
    users: () => db.profiles.slice().sort(byName),
    switchUser(id) { LS.set("la_demo_user", id); },
    reset() { db = demoPerformance(demoSeed()); save(); LS.set("la_demo_user", "u-admin"); },
    async session() { const m = meRow(); return m ? { user: { id: m.id, email: email(m) } } : null; },
    onAuth() {},
    async signOut() {},
    async myProfile(id) { await wait(); return clone(db.profiles.find(p => p.id === id) || null); },
    // wie „profile: lesen“ in Teil 1: Athleten sehen keine Admins, außer der Admin trainiert selbst mit
    async profiles() { return clone(db.profiles.filter(p => p.id === me() || staff() || (p.approved && myRole() && (p.role !== "admin" || p.trains)))); },
    async emails() { return staff() ? db.profiles.map(p => ({ id: p.id, email: email(p) })) : []; },
    async updateProfile(id, patch) {
      const old = db.profiles.find(p => p.id === id), my = myRole() || "";
      if (!old || !(id === me() || staff())) deny();
      const n = Object.assign({}, old, patch);
      if (my === "trainer") {
        if ((n.role === "admin") !== (old.role === "admin")) deny("Nur Admins dürfen Admin-Rechte vergeben oder entziehen");
        if (old.id !== me() && old.role === "admin") deny("Nur Admins dürfen Admin-Profile ändern");
      } else if (my !== "admin") {
        if (n.role !== old.role) deny("Nur Trainer und Admins dürfen Rollen ändern");
        if (old.id !== me()) deny("Du kannst nur dein eigenes Profil ändern");
      }
      if (!["admin", "trainer"].includes(my) && (n.approved !== old.approved || n.plan_group_id !== old.plan_group_id))
        deny("Freischaltung und Trainingsgruppe dürfen nur Trainer und Admins ändern");
      if (old.role === "admin" && old.approved && (n.role !== "admin" || !n.approved) && !otherAdmins(old.id)) deny("Es muss mindestens einen Admin geben");
      Object.assign(old, patch); save(); return clone(old);
    },
    async deleteUser(id) {
      const t = db.profiles.find(p => p.id === id), my = myRole() || "";
      if (!t) return;
      if (id !== me() && !(my === "admin" || (my === "trainer" && t.role !== "admin"))) deny("Keine Berechtigung, dieses Konto zu löschen");
      if (t.role === "admin" && t.approved && !otherAdmins(id)) deny("Der letzte Admin kann nicht gelöscht werden");
      db.profiles = db.profiles.filter(p => p.id !== id);
      ["attendance", "attendance_private", "attendance_log"].forEach(k => db[k] = db[k].filter(r => r.user_id !== id));
      save();
    },
    async settings() { return myRole() ? clone(db.settings) : null; },
    async updateSettings(patch) {
      needStaff();
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
      return clone(db.plan_sheets.filter(s => s.plan_id === planId && (staff() || db.settings.plan_visibility === "all" || (s.group_id && s.group_id === mine) || (s.user_ids || []).includes(me()))).sort((a, b) => a.sort_order - b.sort_order));
    },
    async savePlan(plan, sheets) {
      needStaff();
      const p = Object.assign({ id: uid(), created_at: now(), created_by: me() }, plan); db.plans.push(p);
      sheets.forEach(s => db.plan_sheets.push(Object.assign({ id: uid() }, s, { plan_id: p.id }))); save(); return clone(p);
    },
    async updateSheet(id, patch) { needStaff(); const s = db.plan_sheets.find(x => x.id === id); Object.assign(s, patch); save(); return clone(s); },
    async deletePlan(id) { needStaff(); db.plans = db.plans.filter(p => p.id !== id); db.plan_sheets = db.plan_sheets.filter(s => s.plan_id !== id); save(); },
    async exercises() { needMember(); return clone(db.exercises.slice().sort((a, b) => a.name.localeCompare(b.name, "de"))); },
    async saveExercise(row) {
      needStaff();
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
      if (!e || !staff()) deny();
      db.exercises = db.exercises.filter(x => x.id !== id); save();
    },
    async uploadVideo() { deny("Videos hochladen geht im Demo-Modus nicht. Ein Link funktioniert."); },
    async videoUrl() { return ""; },
    async deleteVideo() {},
    async ensureWeek(monday) {
      needMember();
      demoCompact(db); save();
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
      const target = db.profiles.find(p => p.id === user), coach = target && target.role !== "athlete" && !target.trains;
      if (status === "no" && !reason && !coach) deny("Bitte wähle einen Absagegrund");
      if (status === "no" && reason === "sonstiges" && !coach && !String(note || "").trim()) deny("Bitte beschreibe kurz den Grund");
      const s = db.sessions.find(x => x.id === sid); if (!s) deny("Termin nicht gefunden"); if (s.cancelled) deny("Dieser Termin ist abgesagt");
      if (inPause(s.session_date)) deny("In der Saisonpause findet kein Training statt");
      const wk = mondayOf(s.session_date), auto = demoAutoOpen(db.settings, wk);
      if (!staff() && !(db.week_openings || []).some(w => w.week_start === wk) && !(auto && new Date() >= auto)) deny("Die Anmeldung für diese Woche ist noch nicht geöffnet");
      let a = db.attendance.find(x => x.session_id === sid && x.user_id === user);
      if (!a) { a = { session_id: sid, user_id: user, status: null, coach_mark: null }; db.attendance.push(a); }
      a.status = status; a.updated_at = now();
      db.attendance_private = db.attendance_private.filter(x => !(x.session_id === sid && x.user_id === user));
      if (status === "no" && (reason || note)) db.attendance_private.push({ session_id: sid, user_id: user, reason: reason || null, note: note || "" });
      db.attendance_log.push({ id: Date.now(), session_id: sid, user_id: user, status, reason: status === "no" ? reason : null, coach_mark: null, changed_by: me(), at: now() });
      save();
    },
    async clearResponse(sid, user) {
      needMember(); if (user !== me() && !staff()) deny();
      const a = db.attendance.find(x => x.session_id === sid && x.user_id === user); if (a) a.status = null;
      db.attendance_private = db.attendance_private.filter(x => !(x.session_id === sid && x.user_id === user));
      db.attendance_log.push({ id: Date.now(), session_id: sid, user_id: user, status: "cleared", reason: null, coach_mark: null, changed_by: me(), at: now() }); save();
    },
    async openings() { needMember(); return (db.week_openings || []).map(w => w.week_start); },
    async openWeek(monday, open) {
      if (!staff()) deny("Nur Trainer und Admins können die Anmeldung öffnen");
      db.week_openings = (db.week_openings || []).filter(w => w.week_start !== monday);
      if (open) db.week_openings.push({ week_start: monday, opened_at: now() }); save();
    },
    async changeEmail() { deny("Im Demo-Modus gibt es keine E-Mail-Adressen."); },
    async setInvites(entryId, ids, status) {
      needStaff(); db.competition_entries = db.competition_entries || [];
      db.competition_entries = db.competition_entries.filter(c => c.entry_id !== entryId || ids.includes(c.user_id));
      ids.forEach(u => { const c = db.competition_entries.find(x => x.entry_id === entryId && x.user_id === u);
        if (!c) db.competition_entries.push({ entry_id: entryId, user_id: u, status: "angefragt", updated_at: now() }); else if (status[u]) c.status = status[u]; });
      save();
    },
    async answerInvite(entryId, st) {
      needMember(); const c = (db.competition_entries || []).find(x => x.entry_id === entryId && x.user_id === me());
      if (!c) deny("Du bist für diesen Wettkampf nicht vorgesehen"); c.status = st; save();
    },
    async feedbackBoard() {
      needMember(); const v = db.feedback_votes || [];
      return clone(db.feedback.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(f => ({
        id: f.id, category: f.category, message: f.message, context: f.context, status: f.status, admin_note: f.admin_note, created_at: f.created_at,
        votes: v.filter(x => x.feedback_id === f.id).length, voted: v.some(x => x.feedback_id === f.id && x.user_id === me()), mine: f.user_id === me() })));
    },
    async voteFeedback(id, on) {
      needMember(); db.feedback_votes = (db.feedback_votes || []).filter(x => !(x.feedback_id === id && x.user_id === me()));
      if (on) db.feedback_votes.push({ feedback_id: id, user_id: me(), created_at: now() }); save();
    },
    async setMark(sid, user, mark) {
      const ss = db.sessions.find(x => x.id === sid); if (mark && ss && inPause(ss.session_date)) deny("In der Saisonpause findet kein Training statt");
      if (!staff()) deny("Nur Trainer und Admins können markieren");
      let a = db.attendance.find(x => x.session_id === sid && x.user_id === user);
      if (!a) { a = { session_id: sid, user_id: user, status: null, coach_mark: null }; db.attendance.push(a); }
      a.coach_mark = mark; a.updated_at = now();
      db.attendance_log.push({ id: Date.now(), session_id: sid, user_id: user, status: null, reason: null, coach_mark: mark || "none", changed_by: me(), at: now() });
      save();
    },
    async list(table) {
      needMember(); const R = DEMO_RULES[table]; const rows = db[table] || [];
      let vis = rows.filter(r => R.read === "member" || (R.read === "adminSelf" ? myRole() === "admin" : staff()) || r.user_id === me());
      if (table === "calendar_entries" && !staff()) vis = vis.filter(e => e.kind !== "wettkampf" || (db.competition_entries || []).some(c => c.entry_id === e.id && c.user_id === me()));
      const ord = ORDER[table] || [];
      return clone(vis.slice().sort((a, b) => { for (const k of ord) { const c = String(a[k] ?? "").localeCompare(String(b[k] ?? ""), "de", { numeric: true }); if (c) return c; } return 0; }));
    },
    async saveRow(table, row) {
      needMember(); const R = DEMO_RULES[table]; const list = db[table] = db[table] || [];
      const key = table === "athlete_info" ? "user_id" : "id";
      const old = list.find(r => r[key] === row[key]);
      const n = Object.assign({}, old || {}, row);
      if (table === "feedback" && !n.user_id) n.user_id = me();
      if (!R.canWrite(n, old, { me: me(), staff: staff(), admin: myRole() === "admin", test: db.test_types.find(t => t.id === n.test_id) })) deny();
      if (table === "test_results") {
        const t = db.test_types.find(x => x.id === n.test_id);
        if (t && t.sides && (n.value_left != null || n.value_right != null)) n.value = t.better === "lower" ? Math.min(...[n.value_left, n.value_right].filter(v => v != null)) : Math.max(...[n.value_left, n.value_right].filter(v => v != null));
        if (n.value == null) deny("Bitte einen Wert eintragen");
      }
      if (table === "norms" && list.some(x => x.id !== n.id && x.test_id === n.test_id && x.sex === n.sex && (x.group_id || null) === (n.group_id || null))) deny("Diese Norm gibt es schon.");
      if (old) Object.assign(old, n); else { if (key === "id" && !n.id) n.id = uid(); if (!n.created_at) n.created_at = now(); if ("entered_by" in R.defaults && !n.entered_by) n.entered_by = me(); list.push(Object.assign({}, R.defaults, n)); }
      save(); return clone(old || list[list.length - 1]);
    },
    async removeRow(table, id) {
      needMember(); const R = DEMO_RULES[table]; const old = (db[table] || []).find(r => r.id === id);
      if (!old || !R.canWrite(old, old, { me: me(), staff: staff(), admin: myRole() === "admin", test: db.test_types.find(t => t.id === old.test_id), del: true })) deny();
      db[table] = db[table].filter(r => r.id !== id);
      if (table === "calendar_entries") db.competition_entries = (db.competition_entries || []).filter(c => c.entry_id !== id);
      if (table === "test_types") { db.norms = db.norms.filter(r => r.test_id !== id); db.test_results = db.test_results.filter(r => r.test_id !== id); }
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
  planView: "week", planWeek: null, sheetChoice: {}, exSearch: "", showPast: false, scrolledToday: false,
  tests: [], norms: [], results: [], ainfo: [], injuries: [], calendar: [], comps: [],
  stats: { loaded: false }, statRange: "4w", statSort: "name", perfView: null, enterTest: null, enterDate: null,
  termView: "training", moreView: "team", showPastCal: false, openings: [], feedback: [], fbBoard: [], fbDraft: "", fbFilter: "neu", compEntries: []
};
if (S.tab === "team") S.tab = "settings";
const role = () => S.me && S.me.role;
const isAdmin = () => role() === "admin";
const isStaff = () => role() === "admin" || role() === "trainer";
// Trainer dürfen fast alles wie Admins – nur Admin-Profile und Admin-Rechte bleiben bei den Admins
const canEdit = p => p.id === S.me.id || isAdmin() || (role() === "trainer" && p.role !== "admin");
const groupName = id => (S.groups.find(g => g.id === id) || {}).name;
const pending = () => S.profiles.filter(p => !p.approved && p.role === "athlete");
const trainsP = p => p.trains == null ? p.role === "athlete" : !!p.trains;          // trainiert mit (Zu-/Absagen, Tests, Statistik)
const trainees = () => S.profiles.filter(p => p.approved && trainsP(p));
const isCoach = p => p.role !== "athlete" && !trainsP(p);                               // Trainer/Admin, der nicht mitrainiert
function autoOpenAt(settings, monday) {
  const a = settings && settings.registration_auto; if (!a || !a.dow) return null;
  const d = parseIso(Number(a.dow) === 1 ? monday : addDays(monday, Number(a.dow) - 8));
  const [h, m] = String(a.time || "00:00").split(":").map(Number); d.setHours(h || 0, m || 0, 0, 0); return d;
}
const weekOpen = monday => S.openings.includes(monday) || (() => { const t = autoOpenAt(S.settings, monday); return !!(t && new Date() >= t); })();
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
  [S.att, S.priv, S.log, S.openings] = await Promise.all([S.be.attendance(ids), S.be.attendancePrivate(ids), S.be.attendanceLog(ids), S.be.openings()]);
}
async function loadAll() {
  S.loadError = null;
  S.me = await S.be.myProfile(S.user.id);
  if (!S.me || !S.me.approved) { S.profiles = []; S.groups = []; S.settings = null; return; }
  const [profiles, groups, settings, plans, exercises] = await Promise.all([S.be.profiles(), S.be.groups(), S.be.settings(), S.be.plans(), S.be.exercises()]);
  S.profiles = profiles.sort(byName); S.groups = groups; S.settings = settings; S.plans = plans; S.exercises = exercises;
  S.sheetCache = {}; S.sheetChoice = {}; S.loadedAt = Date.now();
  S.emails = {};
  if (isStaff()) (await S.be.emails()).forEach(r => S.emails[r.id] = r.email);
  S.sqlVersion = isAdmin() ? await S.be.sqlVersion().catch(() => 0) : null;
  await Promise.all([loadSessions(), reloadPerf()]);
  S.stats = { loaded: false };
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
const sheetIsMine = s => (s.user_ids || []).includes(S.me.id);
function defaultSheet(sheets) {
  if (!sheets.length) return null;
  const chosen = S.sheetChoice[sheets[0].plan_id];
  return sheets.find(s => s.id === chosen) || sheets.find(sheetIsMine) || sheets.find(s => s.group_id && s.group_id === S.me.plan_group_id) || sheets[0];
}
const sheetFor = s => [s.group_id && groupName(s.group_id), ...(s.user_ids || []).map(u => (person(u) || {}).display_name).filter(Boolean)].filter(Boolean).join(", ");
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
const REASONS = { krank: "Krank", verletzt: "Verletzt", uni: "Uni / Prüfung", arbeit: "Arbeit", urlaub: "Urlaub", heimat: "Heimatbesuch", sonstiges: "Sonstiges", fortbildung: "Fortbildung" };
const ATHLETE_REASONS = ["krank", "verletzt", "uni", "arbeit", "urlaub", "heimat", "sonstiges"];
// Diese Gründe zählen nicht als Fehlen (das Training fällt für die Person aus der Statistik)
const NEUTRAL_REASONS = ["urlaub", "heimat"];
// Saisonpause: Kalendereintrag der Art „pause“
const pauseOn = d => (S.calendar || []).find(e => e.kind === "pause" && d >= e.start_date && d <= (e.end_date || e.start_date)) || null;
const sessOff = s => s.cancelled || !!pauseOn(s.session_date);
const COACH_REASONS = ["fortbildung", "krank", "arbeit", "sonstiges"];
const attOf = (sid, u) => S.att.find(a => a.session_id === sid && a.user_id === u);
const privOf = (sid, u) => S.priv.find(a => a.session_id === sid && a.user_id === u);
const logOf = (sid, u) => S.log.filter(a => a.session_id === sid && a.user_id === u && a.status);
const flipped = (sid, u) => { const l = logOf(sid, u); const cur = attOf(sid, u); return cur && cur.status === "no" && l.some(x => x.status === "yes"); };
const sessionKey = s => s.session_date + " " + (s.start_time || "99:99");
function rosterOf(s) { return trainees().sort(byName); }
const coachesAway = s => S.profiles.filter(p => p.approved && isCoach(p) && (attOf(s.id, p.id) || {}).status === "no");
function countsOf(s) {
  const r = rosterOf(s); let yes = 0, no = 0;
  r.forEach(p => { const a = attOf(s.id, p.id); if (a && a.status === "yes") yes++; else if (a && a.status === "no") no++; });
  return { yes, no, open: r.length - yes - no };
}
function nextSession() {
  const t = todayIso(), now = new Date(Date.now() - 2 * 3600000).toTimeString().slice(0, 5);
  return S.sessions.find(s => !sessOff(s) && (s.session_date > t || (s.session_date === t && (!s.start_time || hhmm(s.start_time) >= now)))) || null;
}

/* ───────────── Ansichten ───────────── */
const svg = (p, sw = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>'),
  start: svg('<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  plan: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10h7M8.5 14h7M8.5 18h4"/>'),
  termine: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
  leistung: svg('<path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/>'),
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
  const views = { start: viewStart, plan: viewPlan, termine: viewTermine, leistung: viewLeistung, settings: viewMore };
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
    <button class="btn sm ghost" data-act="demoExit">Beenden</button></div>
    ${LS.get("la_demo_hint_seen", false) ? "" : `<div class="in demo-hint small"><span class="grow">Zum Ausprobieren: Alle Namen und Daten sind ausgedacht und bleiben nur auf deinem Gerät. Oben wählst du, als wer du die App siehst – Athlet, Trainer oder Admin.</span><button class="iconbtn" data-act="demoHintOk" aria-label="Hinweis schließen">${ICON.x}</button></div>`}</div>`;
}
function viewTop() {
  const name = (S.settings && S.settings.team_name) || "LT DSHS Köln";
  return `<header class="top"><div class="top-in"><img class="logo" src="logo.png" alt="Logo LT DSHS Köln">
    <div class="grow"><h1>${esc(name)}${S.settings && S.settings.beta !== false ? ` <button class="betachip" data-act="feedback" aria-label="Beta – Feedback geben">Beta</button>` : ""}</h1><div class="sub">${esc(S.me.display_name)} · ${ROLE_LABEL[role()]}</div></div>
    <button class="acctbtn" data-act="account" aria-label="Konto: ${esc(S.me.display_name)}"><span class="avatar ${role()}">${esc(initials(S.me.display_name))}</span></button></div></header>`;
}
function viewNav() {
  const n = (isStaff() ? pending().length : 0) + (isAdmin() ? S.feedback.filter(f => f.status === "neu").length : 0) + (sqlOutdated() ? 1 : 0);
  const ns = nextSession(), myOpen = (ns && trainsP(S.me) && weekOpen(mondayOf(ns.session_date)) && !attOf(ns.id, S.me.id)?.status) || pendingInvites().length ? 1 : 0;
  const b = (id, label, badge) => `<button data-act="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ""}>${ICON[id]}${label}${badge ? `<span class="badge">${badge}</span>` : ""}</button>`;
  return `<nav class="tabs" aria-label="Hauptmenü"><div class="in">${b("start", "Start")}${b("plan", "Trainingsplan")}${b("termine", "Termine", myOpen ? "!" : 0)}${b("leistung", "Leistung")}${b("settings", "Mehr", n)}</div></nav>`;
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
    <div class="card"><h3>Erst mal umsehen?</h3><p class="small muted">Die Demo läuft nur auf diesem Gerät, mit Beispielpersonen. Du kannst zwischen Admin-, Trainer- und Athletenansicht wechseln und alles gefahrlos ausprobieren.</p>
      <button class="btn ghost block" data-act="demoStart">Demo ohne Konto ansehen</button></div>
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
  let html = n ? `<div class="notice"><div class="grow"><b>${n} ${n === 1 ? "Konto wartet" : "Konten warten"} auf Freischaltung</b></div><button class="btn sm" data-act="goTeam">Ansehen</button></div>` : "";
  const inj = currentInjury(me.id);
  if (inj) html += `<div class="notice"><div class="grow"><b>Gute Besserung!</b> Du bist seit ${dm(inj.start_date)} als verletzt eingetragen.</div></div>`;
  html += `<div class="card hero"><h3>Hallo ${esc(firstName(me.display_name))}!</h3>
      <p style="margin:0">${roleChip(me.role)} ${gname ? `<span class="chip">${esc(gname)}</span>` : ""}</p></div>`;
  pendingInvites().forEach(e => {
    html += `<div class="card invcard"><div class="small muted">Wettkampf-Meldung</div><b>${esc(e.title)}</b> <span class="small muted">${fmtDay(e.start_date)}${e.location ? " · " + esc(e.location) : ""}</span>
      <p class="small" style="margin:6px 0 0">Der Trainer möchte dich melden.</p>
      <div class="resp"><button data-act="invAnswer" data-id="${esc(e.id)}" data-v="zugesagt">${ICON.check} Ich bin dabei</button><button data-act="invAnswer" data-id="${esc(e.id)}" data-v="abgesagt">${ICON.x} Lieber nicht</button></div></div>`;
  });
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
  const t2 = todayIso(), phase = S.calendar.find(e => e.kind === "phase" && e.start_date <= t2 && (e.end_date || e.start_date) >= t2);
  const nextComp = S.calendar.filter(e => e.kind !== "phase" && (e.end_date || e.start_date) >= t2 && (e.kind !== "wettkampf" || isStaff() || (myInvite(e.id) || {}).status !== "abgesagt")).sort((x, y) => x.start_date.localeCompare(y.start_date))[0];
  if (phase || nextComp) html += `<h2>Saison</h2><button class="card linkcard" data-act="goSeason">
      ${phase ? `<div class="small muted">Aktuelle Phase</div><b class="daytitle" style="margin:0 0 8px">${esc(phase.title)}${phase.end_date ? ` <span class="small muted">bis ${dm(phase.end_date)}</span>` : ""}</b>` : ""}
      ${nextComp ? `<div class="small muted">Als Nächstes · ${KIND_LABEL[nextComp.kind]}</div><b>${esc(nextComp.title)}</b> <span class="small muted">${fmtDay(nextComp.start_date)} · in ${Math.round((parseIso(nextComp.start_date) - parseIso(t2)) / 864e5)} Tagen</span>` : ""}</button>`;
  if (isStaff()) {
    const athletes = trainees();
    html += `<h2>Team</h2><div class="card"><div class="stats">
      <div class="stat"><b>${athletes.length}</b><span>Athleten</span></div>
      <div class="stat"><b>${athletes.filter(p => currentInjury(p.id)).length}</b><span>verletzt</span></div>
      <div class="stat"><b>${S.profiles.filter(p => p.approved && isCoach(p)).length}</b><span>Trainer</span></div></div></div>`;
  }
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
  if (sheets.length > 1) html += `<div class="chips" role="tablist">${sheets.map(s => `<button class="chipbtn" data-act="planSheet" data-id="${esc(s.id)}" aria-pressed="${s.id === sh.id}">${esc(s.name)}${sheetIsMine(s) || (s.group_id && s.group_id === S.me.plan_group_id) ? " ★" : ""}</button>`).join("")}</div>`;
  if (sheetIsMine(sh)) html += `<div class="notice" style="padding:10px 14px"><div class="grow small"><b>Dein persönlicher Plan</b>${sh.group_id ? "" : " – vom Trainer für dich zugeordnet"}</div></div>`;
  if (isStaff()) html += `<div class="sheetfor small muted"><span class="grow">Blatt „${esc(sh.name)}“ für: <b>${esc(sheetFor(sh) || "niemanden zugeordnet")}</b></span><button class="linkbtn small" data-act="sheetAssign" data-id="${esc(sh.id)}">Zuordnung ändern</button></div>`;
  html += renderDays(sh.data.days, mon, true);
  return html;
}
// Ort/Uhrzeit aus dem Plan und der Termin werden zu einem Chip ("LAA · 17:55")
const TIME_IN = /\(?\s*\b\d{1,2}[:.]\d{2}\b\s*\)?/g;
function dayChips(info, sess) {
  const place = String(info || "").replace(TIME_IN, " ").replace(/\s+/g, " ").trim();
  if (sess.length) return `<span class="chip solid">${esc([place, hhmm(sess[0].start_time)].filter(Boolean).join(" · "))}</span>`;
  if (!info) return "";
  const tm = String(info).match(/\d{1,2}[:.]\d{2}/);
  return `<span class="chip">${esc(tm && place ? `${place} · ${tm[0].replace(".", ":")}` : info)}</span>`;
}
// Blöcke aus Leerzeilen; an Krafttagen je zwei Übungen zusammen (Supersatz)
// Aufwärmen am Krafttag (Rad, Ergometer, Laufband …) steht immer einzeln vor den Supersätzen
const WARMUP_RE = /(^|[\s.])(rad|fahrrad|ergo(meter)?|rudern|rudergerät|crosstrainer|laufband|seilspringen|einlaufen|eingehen|(auf|er)wärm[a-zäöüß]*|warm ?up)(?![a-zäöüß])/i;
function itemGroups(d) {
  const blocks = [];
  d.items.forEach(it => { if (!blocks.length || it.gap) blocks.push([]); blocks[blocks.length - 1].push(it); });
  if (!/kraft/i.test(d.title || "")) return blocks.map(items => ({ items }));
  const out = [];
  blocks.forEach(b => {
    b = b.slice();
    while (b.length && WARMUP_RE.test(b[0].text.trim())) out.push({ items: [b.shift()], warmup: true });
    if (!b.length) return;
    if (b.length === 1) return out.push({ items: b });
    // Gerade Anzahl → Paare (Supersätze); ungerade Gruppe (z. B. 3 Übungen) bleibt zusammen, wie im Plan
    if (b.length % 2 === 0) for (let i = 0; i < b.length; i += 2) out.push({ items: b.slice(i, i + 2), pair: true });
    else out.push({ items: b, pair: true });
  });
  return out;
}
// Zeilen wie „Djamil & Ole“ oder „Alternativ Biene“ sind Hinweise, für wen die folgenden Übungen gelten
function itemKind(text) {
  const t = text.trim();
  if (/^(alternativ|oder)$/i.test(t)) return "or";
  const first = new Set(S.profiles.map(p => firstName(p.display_name).toLowerCase()).filter(n => n.length >= 2));
  const words = t.replace(/^(alternativ|nur|für)\s+/i, "").split(/\s*(?:&|\+|,|\/|\bund\b)\s*/i).map(w => w.trim().toLowerCase()).filter(Boolean);
  if (words.length && words.length <= 6 && words.every(w => first.has(w))) return "who";
  return "";
}
// Eine Übung: Name links, Umfang groß rechts, darunter Zusätze, Pausen, Zielzeiten, Teilübungen
function itemHtml(it, live) {
  const kind = itemKind(it.text);
  if (kind === "or") return `<div class="itemlabel">oder</div>`;
  if (kind === "who" && !it.details.length) return `<div class="itemlabel who">${esc(it.text)}</div>`;
  const rx = PlanFormat.formatRx(it.details, it.text);
  const ex = live ? findExercise(it.text) : null;
  const chips = [...rx.tags.map(t => `<span class="rxchip">${esc(t)}</span>`), ...rx.rest.map(t => `<span class="rxchip rest">${ICON.clock || ""}${esc(t)}</span>`)].join("");
  const sub = (chips ? `<span class="rxchips">${chips}</span>` : "")
    + (rx.targets.length ? `<span class="rxtargets">${rx.targets.map(t => `<span class="rxt"><span class="who">${esc(t.who)}</span><span>${esc(t.value)}</span></span>`).join("")}</span>` : "")
    + (rx.steps.length ? `<span class="rxsteps">${rx.steps.map((st, i) => `<span><b>${i + 1}</b>${esc(st)}</span>`).join("")}</span>` : "")
    + (rx.notes.length ? `<span class="rxnote">${rx.notes.map(esc).join(" · ")}</span>` : "");
  return `<button class="item${/^alternativ\b/i.test(it.text) ? " altitem" : ""}" ${live ? `data-act="itemInfo" data-text="${esc(it.text)}"` : 'type="button" tabindex="-1"'}>
    <span class="ibody"><span class="irow"><span class="it ${ex ? "known" : ""}">${esc(rx.title || it.text)}${ex && (ex.video_path || ex.video_url) ? ` <span class="vid">${ICON.video}</span>` : ""}</span>
    ${rx.main ? `<span class="rx">${esc(rx.main)}</span>` : ""}</span>${sub}</span></button>`;
}
function renderDays(days, mon, live) {
  const t = todayIso();
  return days.map(d => {
    const date = addDays(mon, d.day), sess = live ? S.sessions.filter(s => s.session_date === date && !sessOff(s)) : [];
    const empty = !d.title && !d.items.length && !d.info;
    return `<section class="daycard ${live && date === t ? "today" : ""} ${empty ? "empty" : ""}">
      <div class="dayhead"><span class="dayname">${WDL[d.day]}</span>${live ? `<span class="muted small">${dm(date)}</span>` : ""}
        ${dayChips(d.info, sess)}</div>
      ${d.title ? `<div class="daytitle">${esc(d.title)}</div>` : ""}
      ${(d.titleDetails || []).length ? `<div class="small muted">${d.titleDetails.map(esc).join(" · ")}</div>` : ""}
      ${d.items.length ? `<ul class="items">${itemGroups(d).map(g => `<li class="grp ${g.pair ? "pair" : ""} ${g.warmup ? "warmup" : ""}">${g.warmup ? '<span class="wutag">Aufwärmen</span>' : ""}${g.items.map(it => itemHtml(it, live)).join("")}</li>`).join("")}</ul>` : empty ? `<div class="small muted">Frei</div>` : ""}
    </section>`;
  }).join("");
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
      ${isStaff() ? `<button class="btn" data-act="exNew">+ Übung</button>` : ""}</div>
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
    <div class="grow"><div class="sesstitle">${esc(s.title || "Training")}${s.cancelled ? ' <span class="chip off">fällt aus</span>' : pauseOn(s.session_date) ? ' <span class="chip off">Saisonpause</span>' : ""}</div>
    <div class="small muted">${[hhmm(s.start_time) && hhmm(s.start_time) + " Uhr", s.location].filter(Boolean).map(esc).join(" · ")}</div>
    ${s.note ? `<div class="small">${esc(s.note)}</div>` : ""}</div></div>`;
  if (sessOff(s)) return `<div class="card sess cancelled">${head}${isStaff() && s.cancelled ? `<div class="btns"><button class="btn sm ghost" data-act="sessCancel" data-id="${esc(s.id)}" data-v="0">Findet doch statt</button></div>` : ""}</div>`;
  const past = s.session_date < todayIso(), open = weekOpen(mondayOf(s.session_date));
  const away = coachesAway(s);
  const awayLine = away.length ? `<div class="small awayline">Nicht da: ${away.map(p => { const pr2 = privOf(s.id, p.id); return esc(p.display_name) + (isStaff() && pr2 && (pr2.reason || pr2.note) ? ` (${esc([REASONS[pr2.reason], pr2.note].filter(Boolean).join(": "))})` : ""); }).join(", ")}</div>` : "";
  const counts = `<div class="counts">${[["yes", c.yes, "dabei"], ["no", c.no, "abgesagt"], ["open", c.open, "offen"]].map(([g, n, l]) => `<button data-act="sessOpen" data-id="${esc(s.id)}" data-g="${g}"><b>${n}</b> ${l}</button>`).join("")}</div>`;
  if (isCoach(S.me)) {
    const meAway = a && a.status === "no";
    return `<div class="card sess">${head}${awayLine}${past ? "" : `<div class="resp one">${meAway
      ? `<button class="on no" data-act="coachBack" data-id="${esc(s.id)}">${ICON.check} Doch da</button>`
      : `<button data-act="coachAway" data-id="${esc(s.id)}">${ICON.x} Ich bin nicht da</button>`}</div>`}
      ${!open && !past ? `<div class="small muted" style="margin-top:8px">Anmeldung für die Athleten noch geschlossen.</div>` : ""}${counts}</div>`;
  }
  if (!past && !open && !isStaff()) {
    const at = autoOpenAt(S.settings, mondayOf(s.session_date));
    return `<div class="card sess">${head}${awayLine}<div class="closed small">${at ? `Anmeldung öffnet ${WD[(at.getDay() + 6) % 7]}, ${at.getDate()}.${at.getMonth() + 1}. um ${pad(at.getHours())}:${pad(at.getMinutes())} Uhr` : "Die Anmeldung für diese Woche öffnet der Trainer."}</div>${counts}</div>`;
  }
  const resp = past ? (a && a.status ? `<div class="small muted">Du hattest ${a.status === "yes" ? "zugesagt" : "abgesagt"}${a.coach_mark === "late" ? " · zu spät" : a.coach_mark === "no_show" ? " · nicht erschienen" : ""}</div>` : "")
    : `<div class="resp">
      <button class="${a && a.status === "yes" ? "on yes" : ""}" data-act="respYes" data-id="${esc(s.id)}" aria-pressed="${!!(a && a.status === "yes")}">${ICON.check} Dabei</button>
      <button class="${a && a.status === "no" ? "on no" : ""}" data-act="respNo" data-id="${esc(s.id)}" aria-pressed="${!!(a && a.status === "no")}">${ICON.x} ${a && a.status === "no" ? "Abgesagt" : "Absagen"}</button></div>
      ${a && a.status === "no" && pr ? `<div class="small muted" style="margin-top:6px">Grund: ${esc(REASONS[pr.reason] || pr.reason)}${pr.note ? " – " + esc(pr.note) : ""} <span class="muted">(sehen nur Trainer)</span></div>` : ""}
      ${a && a.coach_mark ? `<div class="small" style="margin-top:6px">Trainer: ${a.coach_mark === "late" ? "zu spät" : "nicht erschienen"}</div>` : ""}`;
  return `<div class="card sess">${head}${awayLine}${resp}${counts}</div>`;
}
function viewTermine() {
  const seg = `<div class="seg" style="margin-bottom:14px"><button data-act="termView" data-v="training" aria-pressed="${S.termView !== "season"}">Training</button><button data-act="termView" data-v="season" aria-pressed="${S.termView === "season"}">Saison &amp; Wettkämpfe</button></div>`;
  if (S.termView === "season") return seg + viewSeason();
  return seg + viewTraining();
}
function viewTraining() {
  const mon = mondayOf(todayIso()), t = todayIso();
  const next = addDays(mon, 7), showNext = isStaff() || weekOpen(next);
  const upcoming = S.sessions.filter(s => s.session_date >= t && (mondayOf(s.session_date) === mon || (showNext && mondayOf(s.session_date) === next)));
  const past = S.sessions.filter(s => s.session_date < t && s.session_date >= addDays(t, -14)).reverse(); // ältere nur noch in der Statistik
  const byWeek = {};
  upcoming.forEach(s => (byWeek[mondayOf(s.session_date)] = byWeek[mondayOf(s.session_date)] || []).push(s));
  let html = isStaff() ? `<div class="btns" style="margin:0 0 6px"><button class="btn ghost" data-act="sessNew">+ Termin</button><button class="btn ghost" data-act="pauseNew">+ Saisonpause</button></div>` : "";
  const pz = pauseOn(t) || (S.calendar || []).filter(e => e.kind === "pause" && e.start_date > t && e.start_date <= addDays(t, 14)).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (pz) html += `<div class="card notice-card pausecard"><b>${pz.start_date <= t ? "Saisonpause" : "Bald Saisonpause"}${pz.title && pz.title !== "Saisonpause" ? ": " + esc(pz.title) : ""}</b>
    <div class="small muted">${fmtDay(pz.start_date)} – ${fmtDay(pz.end_date || pz.start_date)} · kein Training, nichts zählt in die Statistik</div>${isStaff() ? `<div class="btns"><button class="btn sm ghost" data-act="calOpen" data-id="${esc(pz.id)}">Bearbeiten</button></div>` : ""}</div>`;
  const weeks = Object.keys(byWeek).sort();
  if (!weeks.length) html += `<div class="card muted">Keine kommenden Termine.</div>`;
  weeks.forEach(w => {
    const open = weekOpen(w), at = autoOpenAt(S.settings, w), manual = S.openings.includes(w);
    const bar = isStaff() ? `<div class="weekbar ${open ? "open" : ""}"><span class="grow">${open ? "<b>Anmeldung offen</b>" : `<b>Anmeldung geschlossen</b>${at ? ` · öffnet automatisch ${WD[(at.getDay() + 6) % 7]} ${pad(at.getHours())}:${pad(at.getMinutes())}` : ""}`}</span>
      ${open ? (manual ? `<button class="btn sm ghost" data-act="weekOpen" data-w="${w}" data-open="0">Schließen</button>` : "") : `<button class="btn sm" data-act="weekOpen" data-w="${w}" data-open="1">Jetzt öffnen</button>`}</div>` : "";
    html += `<h2>${w === mon ? "Diese Woche" : w === addDays(mon, 7) ? "Nächste Woche" : weekLabel(w)}</h2>${bar}` + byWeek[w].map(s => sessionCard(s)).join("");
  });
  if (past.length) {
    html += `<h2>Vergangene Termine</h2>`;
    html += S.showPast ? past.map(s => sessionCard(s)).join("") + `<button class="btn ghost block" data-act="showPast" data-v="0">Vergangene Termine ausblenden</button>` : `<button class="btn ghost block" data-act="showPast">${past.length} Termine der letzten 2 Wochen anzeigen</button>`;
  }
  html += `<p class="small muted" style="margin:10px 4px">${isStaff() ? "Angezeigt werden diese und nächste Woche. Ältere Termine zählen nur noch in der Statistik (Leistung → Übersicht)." : `${showNext ? "" : "Die nächste Woche erscheint, sobald die Anmeldung geöffnet ist. "}Absagegründe sehen nur Trainer und Admins. Alle sehen, wer zugesagt hat.`}</p>`;
  return html;
}

/* ───── Mehr: Team + Einstellungen ───── */
function viewMore() {
  const n = isStaff() ? pending().length : 0, nf = S.feedback.filter(f => f.status === "neu").length;
  if ((S.moreView === "feedback" && !isAdmin()) || (S.moreView === "help" && !isStaff())) S.moreView = "team";
  return `<div class="seg" style="margin-bottom:14px"><button data-act="moreView" data-v="team" aria-pressed="${S.moreView === "team"}">Team${n ? ` (${n})` : ""}</button>
    ${isAdmin() ? `<button data-act="moreView" data-v="feedback" aria-pressed="${S.moreView === "feedback"}">Feedback${nf ? ` (${nf})` : ""}</button>` : ""}
    <button data-act="moreView" data-v="settings" aria-pressed="${S.moreView === "settings" || S.moreView === "help"}">Einstellungen</button></div>`
    + (S.moreView === "settings" ? viewSettings() : S.moreView === "feedback" ? viewFeedbackAdmin() : S.moreView === "help" ? viewAdminHelp() : viewTeam());
}
function viewAdminHelp() {
  if (!isStaff()) return `<div class="card muted">Nur für Trainer und Admins.</div>`;
  const R = (t, a, tr, ad) => `<tr><td>${t}</td><td>${a ? "✓" : ""}</td><td>${tr ? "✓" : ""}</td><td>${ad ? "✓" : ""}</td></tr>`;
  return `<div class="btns" style="margin:0 0 10px"><button class="btn ghost" data-act="moreView" data-v="settings">← Zurück zu den Einstellungen</button></div>
  <div class="card helptext"><h3>Handbuch</h3><p class="small muted">Für Trainer und Admins. Athleten sehen es nicht.</p>
  <h4>Eine Trainingswoche</h4><ol class="steps">
    <li><b>Plan hochladen:</b> Trainingsplan → „Neuen Plan hochladen“, Excel-Datei wählen. Jedes Blatt einer Trainingsgruppe zuordnen; einzelne Athleten lassen sich zusätzlich zuweisen („Zuordnung ändern“).</li>
    <li><b>Anmeldung öffnen:</b> Termine → „Jetzt öffnen“. Oder automatisch unter Einstellungen → Trainingsanmeldung.</li>
    <li><b>Vor dem Training:</b> Beim Termin auf <i>dabei</i>, <i>abgesagt</i> oder <i>offen</i> tippen. Dort stehen Namen und Absagegründe.</li>
    <li><b>Nach dem Training:</b> Person antippen → „zu spät“ oder „nicht erschienen“ markieren. Fehlt eine Absage, kannst du sie für die Person nachtragen.</li>
    <li><b>Tests und Wettkämpfe:</b> Werte unter Leistung → Eintragen. Wettkämpfe unter Termine → Saison &amp; Wettkämpfe anlegen und die Leute auswählen, die starten sollen.</li></ol>
  <h4>Rollen</h4><div class="tablewrap"><table class="grid roles"><tr><th></th><th>Athlet</th><th>Trainer</th><th>Admin</th></tr>
    ${R("Wochenplan ansehen, zu-/absagen, eigene Werte und Beteiligung", 1, 1, 1)}${R("Wettkampfergebnisse eintragen, Feedback schicken", 1, 1, 1)}
    ${R("Plan hochladen, Übungen, Termine, Saisonpause, Tests, Normen, Verletzungen", 0, 1, 1)}${R("Absagegründe, Verlauf, Statistik", 0, 1, 1)}
    ${R("Freischalten, Gruppen, Rollen Athlet/Trainer, Konten löschen, Teamname", 0, 1, 1)}${R("Admin-Rechte vergeben, Admin-Profile ändern, Backup, Feedback zur App", 0, 0, 1)}</table></div>
  <h4>Admins sind für Athleten unsichtbar</h4><p>Der Admin macht nur die Verwaltung. Athleten sehen Admins deshalb nicht im Team, und Admins zählen nicht in Termine oder Statistik. Trainer und andere Admins sehen sie weiter.</p>
    <p><b>Admin, der selbst trainiert:</b> Am einfachsten ein zweites Konto als Athlet anlegen. Supabase erlaubt jede E-Mail-Adresse nur einmal. Bei Gmail kommt <code>name+athlet@gmail.com</code> aber im selben Postfach an wie <code>name@gmail.com</code>, das Passwort darf gleich sein. Das neue Konto registrieren und mit dem Admin-Konto unter Mehr → Team freischalten. Alternativ: In „Mein Konto“ den Haken „Ich trainiere selbst mit“ setzen. Dann sehen dich die Athleten aber wieder.</p>
  <h4>Neue Mitglieder</h4><p>Wer den Link hat, kann sich registrieren, sieht aber nichts, bis ein Trainer oder Admin ihn unter <b>Mehr → Team</b> freischaltet. Schalte nur Leute frei, die du kennst. Trainer bekommen ihre Rolle im Profil (Name antippen → Rolle).</p>
  <h4>Trainingsanmeldung</h4><p>Athleten können erst zu-/absagen, wenn die Woche geöffnet ist. Trainer sagen nicht zu, können aber „Ich bin nicht da“ eintragen. Wer als Trainer selbst trainiert, setzt in „Mein Konto“ den Haken „Ich trainiere selbst mit“.</p>
  <h4>Saisonpause und Ausfall</h4><p><b>Saisonpause:</b> Termine → „+ Saisonpause“ (von–bis). In der Zeit fällt jedes Training aus und nichts zählt in die Statistik. <b>Einzelnes Training:</b> Termin antippen → „Training fällt aus“. Absagen wegen <i>Urlaub</i> oder <i>Heimatbesuch</i> zählen nicht als Fehlen.</p>
  <h4>Alte Trainings</h4><p>Nach 14 Tagen bleiben von einem Training nur die Zahlen für die Statistik. Einzelne Absagen, Gründe und Freitext werden gelöscht.</p>
  <h4>Wettkämpfe melden</h4><p>Beim Anlegen eines Wettkampfs wählt der Trainer aus, wen er melden möchte. Nur diese Personen sehen ihn und sagen auf der Startseite zu oder ab. Teilnehmer und Antworten lassen sich danach jederzeit ändern.</p>
  <h4>Übungsvideos</h4><p>Am besten auf YouTube als <b>„nicht gelistet“</b> hochladen und den Link bei der Übung eintragen. Das Video läuft direkt in der App und braucht keinen Speicher. „Privat“ geht nicht, private Videos sieht nur der Besitzer.</p>
  <h3 style="margin-top:22px">Technik (macht der Admin)</h3>
  <h4>Datenmenge</h4><p>Kostenlos sind 500 MB Datenbank und 1 GB für Videos. Die Gruppe braucht nur wenige MB pro Jahr, Platz kosten nur hochgeladene Videos.</p>
  <h4>Backup</h4><p>Supabase sichert in der kostenlosen Stufe nicht automatisch. Lade als Admin regelmäßig unter Einstellungen → Backup eine Sicherung herunter. Videos sind nicht enthalten.</p>
  <h4>Supabase pausiert</h4><p>Kostenlose Supabase-Projekte werden nach 7 Tagen <b>ohne jeden Zugriff</b> angehalten, um Rechenleistung zu sparen. Die App zeigt dann nur noch einen Verbindungsfehler, die Daten bleiben aber erhalten. Wieder starten: im Supabase-Dashboard beim Projekt auf <b>Restore</b> klicken (dauert ein paar Minuten).</p>
    <p>Damit es gar nicht so weit kommt, ruft eine kleine GitHub-Aktion zweimal pro Woche die Datenbank kurz auf (Ordner <code>.github/workflows</code>). Kostenlos, liest keine Daten. Unter GitHub → <b>Actions</b> siehst du, ob sie läuft. GitHub schaltet solche geplanten Aktionen ab, wenn im Repository 60 Tage lang nichts passiert. Dann dort auf „Enable workflow“ klicken.</p>
  <h4>Datenschutz</h4><p>Im öffentlichen GitHub-Repository liegt nur der Programmcode. Alle Daten liegen in Supabase und sind nur mit freigeschaltetem Konto erreichbar. Der <b>secret- bzw. service_role-Key</b> umgeht alle Regeln und gehört nie ins Repo, in die App oder in einen Chat. Verletzungen sehen nur Trainer, Admins und die Person selbst.</p>
  <h4>Feedback zur App</h4><p>Nur Admins sehen unter Mehr → Feedback alle Rückmeldungen mit Namen. „Antworten“ zeigt die Antwort allen auf der Pinnwand, „Erledigt“ schiebt sie nach unten.</p>
  <h4>Updates</h4><p>Die Datenbank-Datei heißt <code>supabase/alles_in_einem_vNN.sql</code>, die Nummer ist der Stand. Es gibt immer nur die aktuelle. Kommt eine neue Nummer, diese Datei <b>vor</b> dem Mergen komplett im Supabase SQL Editor ausführen. Sie darf beliebig oft laufen, vorhandene Daten bleiben erhalten. Welcher Stand in Supabase läuft, steht unter Einstellungen → Version. Fehlt ein Update, zeigt die App dem Admin oben in den Einstellungen einen Hinweis.</p>
  </div>
  <div class="card helptext">${planFormatHtml()}</div>`;
}
const FB_CAT = { fehler: "Fehler", idee: "Idee", sonstiges: "Sonstiges" };
const TAB_LABEL = { start: "Start", plan: "Trainingsplan", termine: "Termine", leistung: "Leistung", settings: "Mehr" };
function fbItem(f, admin) {
  const who = (person(f.user_id) || {}).display_name || "Unbekannt";
  const when = new Date(f.created_at).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<div class="fbitem ${f.status}"><div class="fbhead"><span class="kind ${f.category === "fehler" ? "wettkampf" : ""}">${FB_CAT[f.category] || f.category}</span>
      <span class="grow small muted">${admin ? esc(who) + " · " : ""}${esc(when)}${f.context ? " · " + esc(f.context) : ""}${admin && votesOf(f.id) ? ` · <b>${votesOf(f.id)}× ich auch</b>` : ""}</span>
      ${f.status === "erledigt" ? '<span class="chip ok">✓ erledigt</span>' : '<span class="chip">neu</span>'}</div>
    <p class="pre" style="margin:8px 0">${esc(f.message)}</p>
    ${f.admin_note ? `<div class="small awayline"><b>Antwort:</b> ${esc(f.admin_note)}</div>` : ""}
    ${admin ? `<div class="btns"><button class="btn sm ghost" data-act="fbReply" data-id="${esc(f.id)}">Antworten</button>
      <button class="btn sm ${f.status === "neu" ? "" : "ghost"}" data-act="fbStatus" data-id="${esc(f.id)}" data-v="${f.status === "neu" ? "erledigt" : "neu"}">${f.status === "neu" ? "Erledigt" : "Wieder öffnen"}</button>
      <button class="iconbtn" data-act="fbDelete" data-id="${esc(f.id)}" aria-label="Löschen">${ICON.trash}</button></div>`
      : `<div class="btns"><button class="btn sm ghost" data-act="fbDelete" data-id="${esc(f.id)}">Zurückziehen</button></div>`}</div>`;
}
const votesOf = id => ((S.fbBoard || []).find(b => b.id === id) || {}).votes || 0;
// Ähnlichkeit zum Entwurf: gemeinsame Wörter (ab 4 Buchstaben, Wortanfang reicht, damit „Absagen“ auch „absage“ trifft)
const fbWords = t => [...new Set(String(t).toLowerCase().replace(/[^a-zäöüß0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 4).map(w => w.slice(0, 5)))];
const FB_STOP = new Set(["wenn", "dass", "eine", "einen", "einem", "einer", "nicht", "beim", "wäre", "ware", "auch", "noch", "aber", "oder", "sind", "habe", "kann", "dann", "schon", "immer", "mehr", "sich", "werd", "wird", "würde", "diese", "diese", "für", "über", "nach", "bitte", "gerne", "gern", "mein", "meine"].map(w => w.slice(0, 5)));
function fbSimilarity(msg, draft) { const d = fbWords(draft).filter(w => !FB_STOP.has(w)); if (!d.length) return 0; const m = new Set(fbWords(msg)); return d.filter(w => m.has(w)).length; }
function fbBoardItem(b, similar) {
  const when = new Date(b.created_at).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
  return `<div class="fbitem ${b.status}"><div class="fbhead"><span class="kind ${b.category === "fehler" ? "wettkampf" : ""}">${FB_CAT[b.category] || b.category}</span>
      <span class="grow small muted">${esc(when)}${b.context ? " · " + esc(b.context) : ""}${b.mine ? " · von dir" : ""}</span>
      ${similar ? '<span class="chip">ähnlich</span>' : ""}${b.status === "erledigt" ? '<span class="chip ok">✓ erledigt</span>' : ""}</div>
    <p class="pre" style="margin:8px 0">${esc(b.message)}</p>
    ${b.admin_note ? `<div class="small awayline"><b>Antwort:</b> ${esc(b.admin_note)}</div>` : ""}
    <div class="btns fbvote">${b.mine ? `<span class="small muted grow">${b.votes ? `${b.votes}× „Ich auch“` : ""}</span><button class="btn sm ghost" data-act="fbDelete" data-id="${esc(b.id)}">Zurückziehen</button>`
      : b.status === "erledigt" ? (b.votes ? `<span class="small muted">${b.votes}× „Ich auch“</span>` : "")
      : `<button class="btn sm ${b.voted ? "" : "ghost"}" data-act="fbVote" data-id="${esc(b.id)}" aria-pressed="${b.voted}">${b.voted ? "✓ Ich auch" : "Ich auch"}${b.votes ? ` · ${b.votes}` : ""}</button>`}</div></div>`;
}
function fbBoardHtml() {
  const all = S.fbBoard || [];
  if (!all.length) return `<p class="small muted">Noch nichts gemeldet – du bist die oder der Erste.</p>`;
  // Eigene Meldungen bleiben immer sichtbar, damit man die Antwort des Admins sieht
  const scored = all.filter(b => b.status !== "erledigt" || b.mine).map(b => ({ b, s: fbSimilarity(b.message, S.fbDraft) }));
  const sim = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s), rest = scored.filter(x => !x.s).sort((a, b) => b.b.votes - a.b.votes || String(b.b.created_at).localeCompare(String(a.b.created_at)));
  const done = all.filter(b => b.status === "erledigt" && !b.mine);
  return `${sim.length ? `<p class="small" style="margin:0 0 8px"><b>Klingt ähnlich wie deine Nachricht.</b> Ist es dasselbe? Dann reicht „Ich auch“.</p>` : ""}
    ${sim.length + rest.length ? `<div class="card flush">${sim.map(x => fbBoardItem(x.b, true)).join("")}${rest.map(x => fbBoardItem(x.b, false)).join("")}</div>` : `<p class="small muted">Gerade ist nichts offen.</p>`}
    ${done.length ? `<details class="fbdone"><summary class="small">Schon erledigt (${done.length})</summary><div class="card flush">${done.map(b => fbBoardItem(b, false)).join("")}</div></details>` : ""}`;
}
function viewFeedbackAdmin() {
  const list = S.feedback.filter(f => S.fbFilter === "all" || f.status === S.fbFilter);
  const c = k => S.feedback.filter(f => k === "all" || f.status === k).length;
  return `<div class="sortrow small muted">${[["neu", "Neu"], ["erledigt", "Erledigt"], ["all", "Alle"]].map(([k, l]) => `<button class="linkbtn small" data-act="fbFilter" data-v="${k}" ${S.fbFilter === k ? 'aria-pressed="true"' : ""}>${l} (${c(k)})</button>`).join(" · ")}</div>
    ${list.length ? `<div class="card flush">${list.map(f => fbItem(f, true)).join("")}</div>` : `<div class="card muted">${S.fbFilter === "neu" ? "Kein neues Feedback." : "Noch kein Feedback."}</div>`}
    <div class="btns"><button class="btn ghost" data-act="fbExport">Als Datei herunterladen</button></div>`;
}
function feedbackSheet() {
  S.fbDraft = "";
  const open = (S.fbBoard || []).filter(b => b.status !== "erledigt").length;
  sheet(`<h3>Feedback zur Beta</h3><p class="small muted">Was funktioniert nicht, was fehlt, was ist umständlich? Unten siehst du, was schon gemeldet wurde – ohne Namen. Wer etwas geschickt hat, sieht nur der Admin.</p>
    <form data-form="feedback">
      <div class="seg" role="radiogroup" style="margin-bottom:12px">${Object.entries(FB_CAT).map(([v, l], i) => `<label class="segopt"><input type="radio" name="cat" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
      <label class="f"><span>Nachricht</span><textarea name="msg" rows="5" maxlength="2000" required data-input="fbSimilar" placeholder="z. B. Beim Absagen am Handy springt die Seite nach oben."></textarea>
        <div class="hint">Mitgeschickt wird automatisch: Bereich „${esc(TAB_LABEL[S.tab] || S.tab)}“, App-Version und Gerätetyp.</div></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Senden</button></div></form>
    <h3 style="font-size:1.05rem;margin-top:18px">Schon gemeldet${open ? ` (${open} offen)` : ""}</h3>
    <div id="fb-board">${fbBoardHtml()}</div>`);
}
/* ───── Team ───── */
// Für Athleten erscheint ein Admin, der selbst mittrainiert, wie ein Athlet (Admins machen nur die Verwaltung)
const shownRole = p => p.role === "admin" && !isStaff() ? "athlete" : p.role;
function memberRow(p) {
  const g = groupName(p.plan_group_id), r = shownRole(p);
  const meta = [r === "athlete" ? (g || "keine Gruppe") : g, isStaff() ? S.emails[p.id] : null].filter(Boolean).map(esc).join(" · ");
  const flags = (r !== "athlete" ? roleChip(r) : "") + (!p.approved ? ` <span class="chip off">gesperrt</span>` : "");
  return `<button class="row" data-act="member" data-id="${esc(p.id)}">
    <span class="avatar ${r}">${esc(initials(p.display_name))}</span>
    <span class="grow"><span class="name">${esc(p.display_name)}${p.id === S.me.id ? ' <span class="muted">(du)</span>' : ""}</span><span class="meta">${meta || "&nbsp;"}</span></span>
    ${flags}<span class="chev">${ICON.chev}</span></button>`;
}
const isWaiting = p => !p.approved && p.role === "athlete";
function viewTeam() {
  const staff = isStaff();
  const waiting = staff ? S.profiles.filter(isWaiting) : [];
  const rest = S.profiles.filter(p => !waiting.includes(p));
  const coaches = rest.filter(p => shownRole(p) !== "athlete"), athletes = rest.filter(p => shownRole(p) === "athlete");
  let html = "";
  if (waiting.length) html += `<h2>Wartet auf Freischaltung</h2><div class="card flush">` + waiting.map(p => `
      <div class="row"><span class="avatar">${esc(initials(p.display_name))}</span>
        <span class="grow"><span class="name">${esc(p.display_name)}</span><span class="meta">${esc(S.emails[p.id] || "")}</span></span>
        <button class="btn sm" data-act="approve" data-id="${esc(p.id)}">Freischalten</button>
        <button class="iconbtn" data-act="reject" data-id="${esc(p.id)}" aria-label="Ablehnen" title="Ablehnen">${ICON.trash}</button></div>`).join("") + `</div>`;
  html += `<h2>${staff ? "Trainer &amp; Admins" : "Trainer"}</h2><div class="card flush">${coaches.map(memberRow).join("") || `<div class="row muted">Niemand</div>`}</div>`;
  if (staff && coaches.some(p => p.role === "admin" && !trainsP(p))) html += `<p class="small muted" style="margin:-4px 4px 10px">Admins sind für Athleten unsichtbar.</p>`;
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
  let html = sqlUpdateCard() + `<h2>Darstellung</h2><div class="card">
      <label class="f"><span>Design</span>${seg("theme", [["system", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]])}</label>
      <label class="f" style="margin:0"><span>Schriftgröße</span>${seg("textSize", [["normal", "Normal"], ["large", "Groß"]])}</label>
      <div class="hint">Gilt nur auf diesem Gerät.</div></div>
    <h2>Mein Konto</h2><div class="card">
      <form data-form="myname"><label class="f"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(S.me.display_name)}"></label>
      ${S.me.role !== "athlete" ? `<label class="opt"><input type="checkbox" name="trains" ${trainsP(S.me) ? "checked" : ""}><span><b>Ich trainiere selbst mit</b><span class="small muted">Dann sagst du wie die Athleten zu/ab und erscheinst bei Tests und Statistik.</span></span></label>` : ""}
      <button class="btn sm ghost">Speichern</button></form>
      <form data-form="myemail" style="margin-top:14px"><label class="f"><span>E-Mail</span><input type="email" name="email" required value="${esc(S.user.email || "")}" ${S.be.kind === "demo" ? "readonly" : ""}></label>
      ${S.be.kind === "demo" ? "" : `<button class="btn sm ghost">E-Mail ändern</button><div class="hint">Du bekommst einen Bestätigungslink an die neue Adresse.</div>`}</form>
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
      <h2>Trainingsanmeldung</h2><div class="card">
      <p class="small muted">Athleten können erst zu- oder absagen, wenn die Woche geöffnet ist. Öffnen geht jederzeit unter <b>Termine</b>.</p>
      <form data-form="regauto">
        ${(() => { const dow = Number((s.registration_auto || {}).dow) || 0;
          // 2–7 = Dienstag–Sonntag vor der Woche; 1 (Montag der Woche) bleibt nur für alte Einstellungen wählbar
          const days = [[5, "Freitag"], [6, "Samstag"], [7, "Sonntag"], [4, "Donnerstag"], [3, "Mittwoch"], [2, "Dienstag"]];
          return `<label class="opt"><input type="radio" name="mode" value="manual" ${dow ? "" : "checked"}><span><b>Nur von Hand öffnen</b></span></label>
          <label class="opt"><input type="radio" name="mode" value="auto" ${dow ? "checked" : ""}><span><b>Automatisch in der Woche davor</b><span class="small muted">Wochentag und Uhrzeit wählst du unten.</span></span></label>
          <label class="f"><span>Wochentag (vor der Trainingswoche)</span><select name="dow">${days.map(([v, l]) => `<option value="${v}" ${dow === v || (!dow && v === 7) ? "selected" : ""}>${l} vor der Woche</option>`).join("")}${dow === 1 ? `<option value="1" selected>Montag der Woche selbst</option>` : ""}</select></label>`; })()}
        <label class="f"><span>Uhrzeit für automatisches Öffnen</span><input type="time" name="time" value="${esc((s.registration_auto || {}).time || "18:00")}"></label>
        <button class="btn sm ghost">Speichern</button></form></div>
      <h2>Feste Trainingstage</h2><div class="card">
      <p class="small muted">Für diese Tage werden jede Woche automatisch Termine zum Zu- und Absagen angelegt. Einzelne Termine änderst oder ergänzt du unter <b>Termine</b>.</p>
      <form data-form="template">${tpl.map((t, i) => templateRow(t, i)).join("")}<div id="tpl-more"></div>
      <div class="btns"><button type="button" class="btn sm ghost" data-act="tplAdd">+ Tag</button><button class="btn sm">Speichern</button></div>
      <div class="hint">Änderungen gelten für Wochen, die noch nicht angelegt sind (ab übernächster Woche). Die aktuelle und nächste Woche passt du direkt unter Termine an.</div></form></div>`;
  }
  if (isStaff()) {
    html += `<h2>Verwaltung</h2><div class="card">
      <label class="opt"><input type="checkbox" data-change="betaToggle" ${s.beta !== false ? "checked" : ""}><span><b>Beta-Phase</b><span class="small muted">Zeigt „Beta“ in der Kopfzeile. Ein Tipp darauf öffnet das Feedback-Formular.</span></span></label>
      <form data-form="teamname"><label class="f"><span>Name der Trainingsgruppe</span><input type="text" name="name" required maxlength="60" value="${esc(s.team_name || "")}"></label>
      <button class="btn sm ghost">Speichern</button></form></div>
      <div class="card"><h3>Handbuch</h3><p class="small muted">Anleitung für Trainer und Admins: Ablauf einer Woche, Rollen, Plan-Format, Technik.</p>
      <button class="btn ghost" data-act="moreView" data-v="help">Handbuch öffnen</button></div>`;
  }
  if (isAdmin()) {
    html += `<div class="card"><h3>Backup</h3>
      <p class="small muted">Nur für Admins. Sichert Einstellungen, Trainingsgruppen, Rollen, Pläne, Übungen, Termine und Zu-/Absagen als Datei. Videos sind nicht enthalten. Beim Wiederherstellen werden diese Werte zurückgeschrieben; Konten werden dabei weder angelegt noch gelöscht.</p>
      <div class="btns"><button class="btn" data-act="backup">Backup herunterladen</button>
      <button class="btn ghost" data-act="restore">Wiederherstellen …</button></div>
      ${LS.get("la_last_backup", null) ? `<div class="hint">Letztes Backup von diesem Gerät: ${new Date(LS.get("la_last_backup")).toLocaleString("de-DE")}</div>` : ""}
      <input type="file" id="restore-file" accept="application/json,.json" hidden data-change="restoreFile"></div>`;
  }
  html += `<h2>Daten &amp; App</h2><div class="card flush">
    <div class="setrow"><span class="grow">Meine Daten<div class="small muted">Alles, was über dich gespeichert ist, als Datei</div></span><button class="btn sm ghost" data-act="exportMine">Exportieren</button></div>
    <div class="setrow"><span class="grow">Version<div class="small muted">${esc(VERSION)}${S.sqlVersion != null ? ` · Datenbank Stand ${S.sqlVersion || "älter als 10"}` : ""}</div></span><button class="btn sm ghost" data-act="update">Aktualisieren</button></div>
    <div class="setrow"><span class="grow">Verbunden mit<div class="small muted">${esc(S.be.host)}</div></span>
      ${S.be.kind === "demo" ? `<button class="btn sm ghost" data-act="demoReset">Demo zurücksetzen</button>` : connection()?.source === "local" ? `<button class="btn sm ghost" data-act="disconnect">Trennen</button>` : ""}</div>
    <div class="setrow"><span class="grow">Konto löschen<div class="small muted">Entfernt dein Konto und alle deine Daten</div></span><button class="btn sm danger" data-act="deleteMe">Löschen</button></div></div>`;
  return html;
}
const sqlOutdated = () => isAdmin() && S.sqlVersion != null && S.sqlVersion < REQUIRED_SQL;
const sqlUpdateCard = () => sqlOutdated() ? `<div class="card warncard"><b>Datenbank-Update nötig</b><p class="small" style="margin:6px 0 0">Diese App-Version braucht Datenbank-Stand ${REQUIRED_SQL}, in Supabase läuft Stand ${S.sqlVersion || "älter als 10"}. Führe <code>supabase/alles_in_einem_v${REQUIRED_SQL}.sql</code> komplett im Supabase SQL Editor aus und lade die App dann neu.</p></div>` : "";
function templateRow(t, i) {
  return `<div class="tplrow" data-row>
    <select name="dow" aria-label="Wochentag">${WDL.map((d, k) => `<option value="${k + 1}" ${Number(t.dow) === k + 1 ? "selected" : ""}>${d}</option>`).join("")}</select>
    <input type="time" name="time" value="${esc(t.time || "")}" aria-label="Uhrzeit">
    <input type="text" name="location" value="${esc(t.location || "")}" placeholder="Ort" maxlength="80" aria-label="Ort">
    <button type="button" class="iconbtn" data-act="tplRemove" aria-label="Entfernen">${ICON.trash}</button></div>`;
}

/* ───────────── Leistung: Logik ───────────── */
const CAT_LABEL = { sprint: "Sprint", sprung: "Sprung", kraft: "Kraft", sonstiges: "Sonstiges" };
const KIND_LABEL = { phase: "Phase", wettkampf: "Wettkampf", testwoche: "Testwoche", pause: "Saisonpause", sonstiges: "Termin" };
const nowHm = () => new Date().toTimeString().slice(0, 5);
function parseVal(str) {
  const t = String(str || "").trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!t) return null;
  const m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t.replace(/[^\d.\-]/g, ""));
  return t.replace(/[^\d.\-]/g, "") && isFinite(n) ? n : null;
}
function fmtNum(v, unit) {
  if (v == null || v === "" || !isFinite(v)) return "–";
  v = Number(v);
  if (unit === "s" && v >= 60) { const m = Math.floor(v / 60), r = v - m * 60; return `${m}:${r.toFixed(2).padStart(5, "0").replace(".", ",")}`; }
  const d = unit === "kg" ? (Number.isInteger(v) ? 0 : 1) : 2;
  return v.toFixed(d).replace(".", ",");
}
const fmtVal = (v, unit) => fmtNum(v, unit) + (unit && v != null ? (unit === "s" && v >= 60 ? "" : " " + unit) : "");
const testById = id => S.tests.find(t => t.id === id);
const infoOf = u => S.ainfo.find(i => i.user_id === u) || { user_id: u, sex: null, norm_group_ids: [] };
const groupsOf = u => { const p = person(u) || {}; return [p.plan_group_id, ...(infoOf(u).norm_group_ids || [])].filter(Boolean); };
function normFor(test, u) {
  const sex = infoOf(u).sex; if (!sex || !test) return null;
  const g = groupsOf(u);
  const list = S.norms.filter(n => n.test_id === test.id && n.sex === sex && (!n.group_id || g.includes(n.group_id)));
  return list.find(n => n.group_id) || list[0] || null;
}
const normApplies = (test, u) => { const sex = infoOf(u).sex; return S.norms.some(n => n.test_id === test.id && (!sex || n.sex === sex) && (!n.group_id || groupsOf(u).includes(n.group_id))); };
const meets = (test, v, norm) => norm && v != null && (test.better === "lower" ? Number(v) <= Number(norm.value) : Number(v) >= Number(norm.value));
const resultsOf = (u, tid) => S.results.filter(r => r.user_id === u && r.test_id === tid).sort((a, b) => a.test_date.localeCompare(b.test_date) || String(a.created_at).localeCompare(String(b.created_at)));
const bestOf = (test, rows) => rows.reduce((b, r) => b == null || (test.better === "lower" ? r.value < b.value : r.value > b.value) ? r : b, null);
const injuriesOf = u => S.injuries.filter(i => i.user_id === u).sort((a, b) => b.start_date.localeCompare(a.start_date));
const injuredOn = (u, date, kind) => S.injuries.some(i => i.user_id === u && i.start_date <= date && (!i.end_date || i.end_date >= date) && (!kind || i[kind]));
const currentInjury = u => S.injuries.find(i => i.user_id === u && i.start_date <= todayIso() && (!i.end_date || i.end_date >= todayIso())) || null;
const mayEnterTest = (test, u) => isStaff() || (test.entry === "self" && u === S.me.id);
const mayDeleteResult = r => isStaff() || (r.user_id === S.me.id && r.entered_by === S.me.id && (testById(r.test_id) || {}).entry === "self");

function normStatus(u) {
  // Normen der zuletzt gemessenen Werte; fehlende Tests nur, wenn nicht von Tests befreit
  let met = 0, total = 0, missing = 0;
  const exempt = injuredOn(u, todayIso(), "exclude_tests");
  S.tests.filter(t => t.active).forEach(t => {
    const n = normFor(t, u); if (!n) return;
    const rows = resultsOf(u, t.id), last = rows[rows.length - 1];
    if (!last) { if (!exempt) missing++; return; }
    total++; if (meets(t, last.value, n)) met++;
  });
  return { met, total, missing, exempt };
}
function attendanceStats(u, sessions, att) {
  const t = todayIso(), hm = nowHm(), joined = String((person(u) || {}).created_at || "").slice(0, 10);
  const res = { counted: 0, attended: 0, yes: 0, no: 0, open: 0, late: 0, noShow: 0, flipped: 0, excluded: 0, excused: 0, reasons: {}, recent: [] };
  (S.stats.weekly || []).filter(w => w.user_id === u && w.week_start >= mondayOf(S.stats.from || t)).forEach(w => {
    res.counted += w.counted; res.attended += w.attended; res.yes += w.n_yes; res.no += w.n_no; res.open += w.n_open;
    res.late += w.n_late; res.noShow += w.n_no_show; res.flipped += w.n_flipped; res.excluded += w.n_skipped; res.excused += w.n_excused || 0;
    Object.entries(w.reasons || {}).forEach(([k, v]) => res.reasons[k] = (res.reasons[k] || 0) + Number(v));
  });
  sessions.forEach(s => {
    if (sessOff(s) || s.session_date > t || (s.session_date === t && s.start_time && hhmm(s.start_time) > hm)) return;
    if (joined && s.session_date < joined) return;
    if (injuredOn(u, s.session_date, "exclude_attendance")) { res.excluded++; return; }
    const a = att.find(x => x.session_id === s.id && x.user_id === u);
    const st = a && a.status, mk = a && a.coach_mark;
    const pr = st === "no" ? (S.stats.priv || []).find(x => x.session_id === s.id && x.user_id === u) : null;
    if (st === "no") res.recent.push({ date: s.session_date, reason: pr ? pr.reason : null, note: pr ? pr.note : "" });
    if (st === "no" && pr && NEUTRAL_REASONS.includes(pr.reason)) { res.excused++; res.reasons[pr.reason] = (res.reasons[pr.reason] || 0) + 1; return; }
    res.counted++;
    if (st === "yes") res.yes++; else if (st === "no") res.no++; else res.open++;
    if (mk === "late") res.late++;
    if (mk === "no_show") res.noShow++;
    if ((st === "yes" && mk !== "no_show") || mk === "late") res.attended++;
    if (st === "no" && (S.stats.log || []).some(l => l.session_id === s.id && l.user_id === u && l.status === "yes")) res.flipped++;
    if (st === "no") { const k = pr ? pr.reason : "unbekannt"; res.reasons[k] = (res.reasons[k] || 0) + 1; }
  });
  res.rate = res.counted ? Math.round(res.attended / res.counted * 100) : null;
  return res;
}
const STAT_RANGES = { "4w": ["4 Wochen", 28], "3m": ["3 Monate", 91], "season": ["Saison", 365] };
async function loadStats() {
  const days = STAT_RANGES[S.statRange][1], from = addDays(todayIso(), -days);
  if (S.stats.from === from && S.stats.loaded) return;
  const sessions = await S.be.sessions(from, todayIso());
  const ids = sessions.map(s => s.id), att = [], priv = [], log = [];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const [a, p, l] = await Promise.all([S.be.attendance(part), S.be.attendancePrivate(part), S.be.attendanceLog(part)]);
    att.push(...a); priv.push(...p); log.push(...l);
  }
  const weekly = await S.be.list("attendance_weekly");
  S.stats = { from, sessions, att, priv, log, weekly, loaded: true };
}
const RUN_RE = /^\s*(\d+\s*x\s*)?\d+(\s*m)?\b|hürden|huerden|lauf|staffel|gehen|cross/i;
const betterFor = disc => /(weit|hoch|stab|drei|kugel|diskus|speer|hammer|ball|kampf|punkte)/i.test(disc) ? "higher" : RUN_RE.test(disc) ? "lower" : "higher";
const DISCIPLINES = ["60m", "100m", "200m", "300m", "400m", "800m", "1500m", "60m Hürden", "100m Hürden", "110m Hürden", "400m Hürden", "4x100m", "4x400m", "Weitsprung", "Hochsprung", "Stabhochsprung", "Dreisprung", "Kugelstoß", "Diskuswurf", "Speerwurf", "Siebenkampf", "Zehnkampf"];
// PB nur, wenn sie als solche markiert wurde oder einen früheren Eintrag geschlagen hat
function pbInfo(c) {
  const k = c.discipline.trim().toLowerCase();
  const same = S.comps.filter(x => x.user_id === c.user_id && x.discipline.trim().toLowerCase() === k && x.value != null);
  const best = pbMap(c.user_id)[k];
  if (!best || best.id !== c.id) return null;
  const beaten = same.some(x => x.id !== c.id && x.comp_date <= c.comp_date);
  return c.is_pb || beaten ? (beaten ? "neu" : "pb") : null;
}
function pbMap(u) {
  const m = {};
  S.comps.filter(c => c.user_id === u && c.value != null).forEach(c => {
    const k = c.discipline.trim().toLowerCase(), b = m[k];
    if (!b || (c.better === "lower" ? c.value < b.value : c.value > b.value)) m[k] = c;
  });
  return m;
}

/* ───── Diagramm: Verlauf eines Tests (eine Linie, Norm als Bezugslinie) ───── */
function lineChart(test, rows, norm) {
  if (!rows.length) return "";
  const W = 320, H = 160, pl = 44, pr = 12, pt = 16, pb = 26;
  const xs = rows.map(r => parseIso(r.test_date).getTime());
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 7 * 864e5; x1 += 7 * 864e5; }
  const vals = rows.map(r => Number(r.value)).concat(norm ? [Number(norm.value)] : []);
  let y0 = Math.min(...vals), y1 = Math.max(...vals); const padY = (y1 - y0) * 0.18 || Math.abs(y1) * 0.04 || 1; y0 -= padY; y1 += padY;
  const inv = test.better === "lower"; // Zeiten: kleiner ist besser → oben
  const X = t => pl + (t - x0) / (x1 - x0) * (W - pl - pr);
  const Y = v => inv ? pt + (v - y0) / (y1 - y0) * (H - pt - pb) : H - pb - (v - y0) / (y1 - y0) * (H - pt - pb);
  const ticks = [0, 0.5, 1].map(f => y0 + (y1 - y0) * f);
  const path = rows.map((r, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(r.value).toFixed(1)}`).join("");
  const pts = rows.map((r, i) => {
    const x = X(xs[i]), y = Y(r.value), label = `${dm(r.test_date)}: ${fmtVal(r.value, test.unit)}`;
    const tw = label.length * 6.4 + 12, tx = Math.min(Math.max(x - tw / 2, 2), W - tw - 2), ty = y < 40 ? y + 12 : y - 30;
    return `<g class="pt" tabindex="0" aria-label="${esc(label)}"><circle cx="${x}" cy="${y}" r="14" fill="transparent"/>
      <circle cx="${x}" cy="${y}" r="4.5" class="dot"/><g class="tip"><rect x="${tx}" y="${ty}" width="${tw}" height="20" rx="6"/><text x="${tx + tw / 2}" y="${ty + 14}" text-anchor="middle">${esc(label)}</text></g></g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${esc(test.name)}">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${esc(fmtNum(v, test.unit))}</text>`).join("")}
    ${norm ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(norm.value)}" y2="${Y(norm.value)}" class="norm"/><text x="${W - pr}" y="${Y(norm.value) - 5}" text-anchor="end" class="ax">Norm ${esc(fmtNum(norm.value, test.unit))}</text>` : ""}
    <path d="${path}" class="line"/>${pts}
    <text x="${pl}" y="${H - 6}" class="ax">${dm(rows[0].test_date)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end" class="ax">${dm(rows[rows.length - 1].test_date)}</text>
    <text x="${(pl + W - pr) / 2}" y="${H - 6}" text-anchor="middle" class="ax">${inv ? "oben = schneller" : "oben = besser"}</text></svg>`;
}

/* ───────────── Leistung: Ansichten ───────────── */
function normBadge(test, value, norm) {
  if (!norm || value == null) return "";
  const ok = meets(test, value, norm), diff = Math.abs(Number(value) - Number(norm.value));
  return ok ? `<span class="chip ok">✓ Norm</span>` : `<span class="chip off">✗ ${esc(fmtNum(diff, test.unit))} ${esc(test.unit)} fehlen</span>`;
}
function testRows(u) {
  const cats = ["sprint", "sprung", "kraft", "sonstiges"];
  return cats.map(c => {
    const tests = S.tests.filter(t => t.active && t.category === c); if (!tests.length) return "";
    return `<div class="subhead">${CAT_LABEL[c]}</div>` + tests.map(t => {
      const rows = resultsOf(u, t.id), last = rows[rows.length - 1], best = bestOf(t, rows), n = normFor(t, u);
      const sideTxt = last && t.sides ? ` <span class="muted small">(L ${fmtNum(last.value_left, t.unit)} · R ${fmtNum(last.value_right, t.unit)})</span>` : "";
      return `<button class="row" data-act="testOpen" data-uid="${esc(u)}" data-tid="${esc(t.id)}">
        <span class="grow"><span class="name">${esc(t.name)}${t.entry === "self" ? "" : ' <span class="muted small">· Trainer</span>'}</span>
        <span class="meta">${last ? `${dm(last.test_date)} · ${rows.length > 1 && best !== last ? "Bestwert " + esc(fmtVal(best.value, t.unit)) : rows.length + " Messung" + (rows.length > 1 ? "en" : "")}` : (n ? "noch kein Wert" : "&nbsp;")}${n ? ` · Norm ${esc(fmtVal(n.value, t.unit))}` : ""}</span></span>
        <span class="val">${last ? esc(fmtVal(last.value, t.unit)) + sideTxt : "–"}</span>${normBadge(t, last && last.value, n)}<span class="chev">${ICON.chev}</span></button>`;
    }).join("");
  }).join("");
}
function viewLeistung() {
  const staff = isStaff();
  const segs = staff ? [["overview", "Übersicht"], ["enter", "Eintragen"], ...(trainsP(S.me) ? [["mine", "Ich"]] : []), ["comps", "Wettkämpfe"], ["setup", "Normen"]] : [["mine", "Meine Werte"], ["comps", "Wettkämpfe"]];
  if (!segs.some(([v]) => v === S.perfView)) S.perfView = segs[0][0];
  let html = `<div class="seg" style="margin-bottom:14px">${segs.map(([v, l]) => `<button data-act="perfView" data-v="${v}" aria-pressed="${S.perfView === v}">${l}</button>`).join("")}</div>`;
  if (S.perfView === "mine") {
    const inj = currentInjury(S.me.id);
    if (inj) html += `<div class="notice"><div class="grow"><b>Als verletzt eingetragen</b> seit ${dm(inj.start_date)}${inj.note ? " – " + esc(inj.note) : ""}${inj.exclude_tests ? "<div class='small muted'>Fehlende Tests werden nicht angerechnet.</div>" : ""}</div></div>`;
    if (trainsP(S.me)) html += myAttendanceCard();
    if (!infoOf(S.me.id).sex && S.norms.length) html += `<p class="small muted">Für den Abgleich mit den Normen trägt dein Trainer noch ein, ob für dich die Normen der Jungs oder der Mädels gelten.</p>`;
    html += `<div class="card flush">${testRows(S.me.id)}</div><p class="small muted" style="margin:8px 4px">Krafttests trägst du selbst ein (Wert antippen). Sprint- und Sprungtests trägt der Trainer ein. Deine Werte sehen nur du und die Trainer.</p>`;
    return html;
  }
  if (S.perfView === "comps") return html + viewComps();
  if (S.perfView === "setup") return html + viewNormSetup();
  if (S.perfView === "enter") return html + viewEnter();
  return html + viewOverview();
}
// Fließende Farbskala, streng: unter 50 % rot, 65 % orange, 80 % gelb, erst ab 90 % hellgrün, 100 % dunkelgrün
const RATE_STOPS = [[0, [208, 59, 59]], [50, [208, 59, 59]], [65, [236, 131, 90]], [80, [250, 178, 25]], [90, [150, 200, 90]], [100, [24, 120, 56]]];
function rateColor(r) {
  if (r == null) return "var(--line)";
  r = Math.max(0, Math.min(100, r));
  let i = 1; while (i < RATE_STOPS.length - 1 && r > RATE_STOPS[i][0]) i++;
  const [a, ca] = RATE_STOPS[i - 1], [b, cb] = RATE_STOPS[i], t = (r - a) / (b - a);
  return "rgb(" + ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(",") + ")";
}
const rateDot = r => `<i class="ratedot" style="background:${rateColor(r)}"></i>`;
const rateBar = (r, big) => `<span class="bar${big ? " big" : ""}" aria-hidden="true"><i style="width:${r ?? 0}%;background:${rateColor(r)}"></i></span>`;
const RATE_LEGEND = `<div class="ratelegend small muted"><span class="rategrad" aria-hidden="true"></span><span class="rateticks"><span>0 %</span><span>50</span><span>65</span><span>80</span><span>100 %</span></span></div>`;
// Eigene Trainingsbeteiligung für Athleten
function myAttendanceCard() {
  if (!S.stats.loaded || S.stats.from !== addDays(todayIso(), -STAT_RANGES[S.statRange][1])) {
    loadStats().then(render).catch(e => toast(deErr(e), "error"));
    return `<div class="card muted">Trainingsbeteiligung wird geladen …</div>`;
  }
  const a = attendanceStats(S.me.id, S.stats.sessions, S.stats.att);
  const seg = Object.entries(STAT_RANGES).map(([k, [l]]) => `<button data-act="statRange" data-v="${k}" aria-pressed="${S.statRange === k}">${l}</button>`).join("");
  return `<h2>Deine Trainingsbeteiligung</h2><div class="card myatt"><div class="seg" style="margin-bottom:12px">${seg}</div>
    <div class="myrate"><b>${rateDot(a.rate)}${a.rate == null ? "–" : a.rate + " %"}</b><span class="small muted">${a.counted ? `${a.attended} von ${a.counted} Trainings da` : "Noch keine gezählten Trainings"}</span></div>
    ${rateBar(a.rate, true)}
    <p class="small muted" style="margin:10px 0 0">${[a.late && a.late + "× zu spät", a.excused && a.excused + "× Urlaub/Heimatbesuch (zählt nicht)", a.excluded && a.excluded + " Trainings wegen Verletzung nicht gezählt"].filter(Boolean).join(" · ") || "Gezählt werden die gemeinsamen Trainings, bei denen du zugesagt hast und da warst."}</p></div>`;
}
// „2× Krank, 1× Urlaub“ – häufigster Grund zuerst
const reasonSummary = a => Object.entries(a.reasons).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v}× ${esc(REASONS[k] || (k === "unbekannt" || k === "ohne Angabe" ? "ohne Grund" : k))}`).join(", ");
function viewOverview() {
  if (!S.stats.loaded || S.stats.from !== addDays(todayIso(), -STAT_RANGES[S.statRange][1])) {
    loadStats().then(render).catch(e => toast(deErr(e), "error"));
    return `<div class="card muted">Statistik wird geladen …</div>`;
  }
  const athletes = trainees();
  const rows = athletes.map(p => ({ p, a: attendanceStats(p.id, S.stats.sessions, S.stats.att), n: normStatus(p.id), inj: currentInjury(p.id) }));
  const rated = rows.filter(r => r.a.rate != null);
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.a.rate, 0) / rated.length) : null;
  const metAll = rows.filter(r => r.n.total && r.n.met === r.n.total && !r.n.missing).length;
  const sorted = rows.sort((a, b) => S.statSort === "rate" ? (b.a.rate ?? -1) - (a.a.rate ?? -1) : S.statSort === "norm" ? (b.n.total ? b.n.met / b.n.total : -1) - (a.n.total ? a.n.met / a.n.total : -1) : byName(a.p, b.p));
  const seg = Object.entries(STAT_RANGES).map(([k, [l]]) => `<button data-act="statRange" data-v="${k}" aria-pressed="${S.statRange === k}">${l}</button>`).join("");
  return `<div class="seg" style="margin-bottom:12px">${seg}</div>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><b>${rateDot(avg)}${avg == null ? "–" : avg + " %"}</b><span>Ø Trainingsbeteiligung</span></div>
      <div class="stat"><b>${metAll}/${rows.length}</b><span>erfüllen alle Normen</span></div>
      <div class="stat"><b>${rows.filter(r => r.inj).length}</b><span>verletzt</span></div></div>
    <div class="sortrow small muted">Sortieren: ${[["name", "Name"], ["rate", "Beteiligung"], ["norm", "Normen"]].map(([k, l]) => `<button class="linkbtn small" data-act="statSort" data-v="${k}" ${S.statSort === k ? 'aria-pressed="true"' : ""}>${l}</button>`).join(" · ")}</div>
    <div class="card flush overview">${sorted.map(({ p, a, n, inj }) => `<button class="row" data-act="athleteOpen" data-id="${esc(p.id)}">
      <span class="grow"><span class="name">${esc(p.display_name)} ${inj ? '<span class="chip off">verletzt</span>' : ""}</span>
      <span class="meta">${esc(groupName(p.plan_group_id) || "keine Gruppe")}${a.counted ? ` · ${a.attended}/${a.counted} Trainings` : ""}${a.flipped ? ` · ${a.flipped}× umentschieden` : ""}${a.late ? ` · ${a.late}× zu spät` : ""}</span>

      ${rateBar(a.rate, true)}</span>
      <span class="statcol"><b>${rateDot(a.rate)}${a.rate == null ? "–" : a.rate + " %"}</b><span class="small muted">${n.total || n.missing ? `Normen ${n.met}/${n.total + n.missing}` : "keine Norm"}</span></span>
      <span class="chev">${ICON.chev}</span></button>`).join("") || `<div class="row muted">Noch keine Athleten</div>`}</div>
    ${RATE_LEGEND}
    <p class="small muted" style="margin:8px 4px">Trainingsbeteiligung: Anteil der vergangenen gemeinsamen Trainings, bei denen jemand da war (zugesagt und nicht als „nicht erschienen“ markiert). Zeiten mit Verletzung zählen nicht mit, wenn das so eingetragen ist. Normen: zuletzt gemessener Wert je Test.</p>`;
}
function viewEnter() {
  const tests = S.tests.filter(t => t.active);
  if (!tests.length) return `<div class="card muted">Noch keine Tests angelegt (unter „Normen“).</div>`;
  const t = testById(S.enterTest) || tests[0]; S.enterTest = t.id;
  const date = S.enterDate || todayIso();
  const athletes = trainees().sort(byName);
  const inp = (name, v) => `<input type="text" inputmode="decimal" name="${name}" value="${v == null ? "" : esc(fmtNum(v, t.unit))}" placeholder="${esc(t.unit)}" autocomplete="off">`;
  return `<div class="card">
    <div class="two"><label class="f"><span>Test</span><select data-change="enterTest">${tests.map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}${x.unit ? " (" + esc(x.unit) + ")" : ""}</option>`).join("")}</select></label>
    <label class="f"><span>Datum</span><input type="date" value="${esc(date)}" data-change="enterDate"></label></div>
    <p class="small muted" style="margin:0">${esc(t.note || "")}${t.sides ? " · links und rechts jeweils der beste Versuch" : ""}${t.unit === "s" ? " · Zeiten über 60 s als 1:52,30 eingeben" : ""}</p></div>
    <form data-form="bulkResults" data-tid="${esc(t.id)}" data-date="${esc(date)}"><div class="card flush">${athletes.map(p => {
      const ex = S.results.find(r => r.user_id === p.id && r.test_id === t.id && r.test_date === date);
      const inj = injuredOn(p.id, date, "exclude_tests"), n = normFor(t, p.id);
      return `<div class="row enterrow ${inj ? "dim" : ""}"><span class="grow"><span class="name">${esc(p.display_name)}</span>
        <span class="meta">${inj ? "verletzt · " : ""}${n ? "Norm " + esc(fmtVal(n.value, t.unit)) : esc(groupName(p.plan_group_id) || "")}</span></span>
        ${t.sides ? `<label class="lr">L ${inp("l_" + p.id, ex && ex.value_left)}</label><label class="lr">R ${inp("r_" + p.id, ex && ex.value_right)}</label>` : inp("v_" + p.id, ex && ex.value)}</div>`;
    }).join("")}</div>
    <div class="btns"><button class="btn block">Werte speichern</button></div></form>`;
}
function viewNormSetup() {
  return `<div class="btns" style="margin:0 0 10px"><button class="btn ghost" data-act="testTypeNew">+ Test</button></div>
    <div class="card flush">${["sprint", "sprung", "kraft", "sonstiges"].map(c => {
      const tests = S.tests.filter(t => t.category === c); if (!tests.length) return "";
      return `<div class="subhead">${CAT_LABEL[c]}</div>` + tests.map(t => {
        const ns = S.norms.filter(n => n.test_id === t.id);
        return `<button class="row" data-act="testTypeOpen" data-id="${esc(t.id)}"><span class="grow"><span class="name">${esc(t.name)} ${t.active ? "" : '<span class="chip">inaktiv</span>'}</span>
          <span class="meta">${esc(t.unit || "ohne Einheit")} · ${t.better === "lower" ? "weniger ist besser" : "mehr ist besser"} · ${t.entry === "self" ? "Athlet trägt ein" : "Trainer trägt ein"}${t.sides ? " · links/rechts" : ""}</span>
          ${ns.length ? `<span class="meta">${ns.map(n => `${n.sex === "m" ? "Jungs" : "Mädels"}${n.group_id ? " (" + esc(groupName(n.group_id) || "?") + ")" : ""} ${esc(fmtNum(n.value, t.unit))}`).join(" · ")}</span>` : ""}</span><span class="chev">${ICON.chev}</span></button>`;
      }).join("");
    }).join("")}</div>
    <p class="small muted" style="margin:8px 4px">Normen gelten je Geschlecht, auf Wunsch nur für eine Trainingsgruppe (z. B. 80m nur Kurzsprint). Wer in mehreren Gruppen trainiert, bekommt die weiteren Gruppen im Athletenprofil (Übersicht → Name).</p>`;
}
function viewComps() {
  const mine = S.comps.filter(c => c.user_id === S.me.id);
  const pbs = pbMap(S.me.id);
  let html = `<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="compNew">+ Ergebnis eintragen</button><button class="btn ghost" data-act="pbNew">+ Bisherige Bestleistung</button></div>`;
  if (!isStaff() || mine.length) {
    html += `<h2>Meine Bestleistungen</h2>` + (Object.keys(pbs).length ? `<div class="card flush">${Object.values(pbs).sort((a, b) => a.discipline.localeCompare(b.discipline, "de", { numeric: true })).map(c => { const known = pbInfo(c); return `<div class="row"><span class="grow"><span class="name">${esc(c.discipline)}</span><span class="meta">${known ? "" : "bester Eintrag in der App · "}${esc(c.comp_name)} · ${dm(c.comp_date)}${String(c.comp_date).slice(0, 4) !== String(todayIso()).slice(0, 4) ? String(c.comp_date).slice(2, 4) : ""}</span></span><span class="val">${esc(c.result)}</span>${known ? '<span class="chip solid">PB</span>' : ""}</div>`; }).join("")}</div>
      <p class="small muted" style="margin:6px 4px">Trag deine bisherigen Bestleistungen einmal ein („+ Bisherige Bestleistung“). Dann erkennt die App bei neuen Ergebnissen, ob es eine neue PB ist.</p>` : `<div class="card muted">Noch keine Ergebnisse. Trag am besten zuerst deine bisherigen Bestleistungen ein.</div>`);
  }
  const recent = S.comps.slice().sort((a, b) => b.comp_date.localeCompare(a.comp_date)).slice(0, 60);
  const groups = {};
  recent.forEach(c => { const k = c.comp_date + "|" + c.comp_name; (groups[k] = groups[k] || []).push(c); });
  html += `<h2>Ergebnisse der Gruppe</h2>` + (recent.length ? Object.entries(groups).map(([k, list]) => {
    const [d, name] = k.split("|");
    return `<div class="card flush"><div class="subhead">${esc(name)} · ${fmtDay(d)}</div>${list.map(c => {
      const editable = isStaff() || c.user_id === S.me.id;
      const inner = `<span class="grow"><span class="name">${esc((person(c.user_id) || {}).display_name || "?")}</span><span class="meta">${esc(c.discipline)}${c.place ? " · Platz " + esc(c.place) : ""}${c.wind ? " · Wind " + esc(c.wind) : ""}${c.note ? " · " + esc(c.note) : ""}</span></span>
        <span class="val">${esc(c.result)}</span>${pbInfo(c) ? `<span class="chip solid">${pbInfo(c) === "neu" ? "neue PB" : "PB"}</span>` : ""}`;
      return editable ? `<button class="row" data-act="compEdit" data-id="${esc(c.id)}">${inner}<span class="chev">${ICON.chev}</span></button>` : `<div class="row">${inner}</div>`;
    }).join("")}</div>`;
  }).join("") : `<div class="card muted">Noch keine Wettkampfergebnisse.</div>`);
  return html;
}
const PHASE_COLORS = 4;
function timelineHtml(entries, lo, hi, big) {
  const span = Math.max(1, (parseIso(hi) - parseIso(lo)) / 864e5), t = todayIso();
  const pos = d => Math.min(100, Math.max(0, (parseIso(d) - parseIso(lo)) / 864e5 / span * 100));
  const vis = e => (e.end_date || e.start_date) >= lo && e.start_date <= hi;
  const phases = entries.filter(e => e.kind === "phase" && vis(e)), pauses = entries.filter(e => e.kind === "pause" && vis(e));
  const tests = entries.filter(e => e.kind === "testwoche" && vis(e));
  const comps = entries.filter(e => (e.kind === "wettkampf" || e.kind === "sonstiges") && vis(e));
  const allPh = entries.filter(e => e.kind === "phase");
  const bar = (e, cls, minDays) => {
    const end = e.end_date || addDays(e.start_date, minDays - 1), l = pos(e.start_date), w = Math.max(cls === "tw" ? (big ? 3.5 : 9) : (big ? 1.2 : 2.5), pos(addDays(end, 1)) - l);
    return `<button class="tl-bar ${cls}" style="left:${l}%;width:${w}%" data-act="calOpen" data-id="${esc(e.id)}" title="${esc(e.title)} (${dm(e.start_date)}${e.end_date && e.end_date !== e.start_date ? "–" + dm(e.end_date) : ""})"><span>${esc(e.title)}</span></button>`;
  };
  const months = [];
  for (let d = new Date(parseIso(lo).getFullYear(), parseIso(lo).getMonth() + 1, 1); iso(d) <= hi; d.setMonth(d.getMonth() + 1)) months.push(iso(d));
  return `<div class="tlwrap ${big ? "big" : ""}"><div class="tl" style="${big ? `width:${Math.max(100, span / 1.6)}%` : ""}">
    <div class="tl-months">${months.map(m => `<span style="left:${pos(m)}%">${new Date(m + "T12:00:00").toLocaleDateString("de-DE", { month: "short" })}</span>`).join("")}</div>
    <div class="tl-lane ph">${phases.map(e => bar(e, "ph" + (allPh.indexOf(e) % PHASE_COLORS + 1) + (e.start_date <= t && (e.end_date || e.start_date) >= t ? " cur" : ""), 7)).join("")}${pauses.map(e => bar(e, "pause", 1)).join("")}</div>
    <div class="tl-lane tw">${tests.map(e => bar(e, "tw", 7).replace(`<span>${esc(e.title)}</span>`, big ? `<span>${esc(e.title)}</span>` : "")).join("")}</div>
    <div class="tl-lane wk">${comps.map((e, i) => `<button class="tl-dot ${e.kind}" style="left:${pos(e.start_date)}%" data-act="calOpen" data-id="${esc(e.id)}" title="${esc(e.title)} (${dm(e.start_date)})"></button>${big ? `<span class="tl-dotlabel ${i % 2 ? "alt" : ""}" style="left:${pos(e.start_date)}%">${esc(e.title)}</span>` : ""}`).join("")}</div>
    ${t >= lo && t <= hi ? `<div class="tl-today" style="left:${pos(t)}%"><span>heute</span></div>` : ""}</div></div>`;
}
const invitesOf = id => S.compEntries.filter(c => c.entry_id === id);
const myInvite = id => S.compEntries.find(c => c.entry_id === id && c.user_id === S.me.id);
const INV_LABEL = { angefragt: "angefragt", zugesagt: "zugesagt", abgesagt: "abgelehnt" };
function viewSeason() {
  const t = todayIso();
  const entries = S.calendar.slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
  const phase = entries.find(e => e.kind === "phase" && e.start_date <= t && (e.end_date || e.start_date) >= t);
  const others = entries.filter(e => e.kind !== "phase");
  const upcoming = others.filter(e => (e.end_date || e.start_date) >= t);
  const past = others.filter(e => (e.end_date || e.start_date) < t).reverse();
  let html = isStaff() ? `<div class="btns" style="margin:0 0 10px"><button class="btn ghost" data-act="calNew">+ Eintrag</button></div>` : "";
  // Nach 2 Wochen nachfragen: behalten oder löschen?
  const stale = isStaff() ? entries.filter(e => !e.keep && (e.end_date || e.start_date) < addDays(t, -14)) : [];
  if (stale.length) html += `<div class="card notice-card"><b>Seit über 2 Wochen vorbei</b><p class="small muted" style="margin:2px 0 8px">Behalten oder löschen? Eingetragene Wettkampfergebnisse bleiben in jedem Fall erhalten.</p>
    ${stale.map(e => `<div class="injrow"><span class="grow"><b>${esc(e.title)}</b><span class="small muted" style="display:block">${KIND_LABEL[e.kind]} · ${fmtDay(e.start_date)}</span></span>
      <button class="btn sm ghost" data-act="calKeep" data-id="${esc(e.id)}">Behalten</button><button class="btn sm danger" data-act="calDrop" data-id="${esc(e.id)}">Löschen</button></div>`).join("")}</div>`;
  if (entries.length) {
    const lo = addDays(t, -21), hi = addDays(t, 120);
    html += `<div class="card"><div class="tlhead"><span class="grow"><span class="small muted">Periodisierung · nächste Monate</span>${phase ? `<br><b>Jetzt: ${esc(phase.title)}</b>${phase.end_date ? ` <span class="small muted">bis ${dm(phase.end_date)}</span>` : ""}` : ""}</span>
      <button class="btn sm ghost" data-act="tlBig">Vergrößern</button></div>
      ${timelineHtml(entries, lo, hi, false)}
      <div class="small muted tl-legend"><span><i class="lg ph1"></i>Phasen</span><span><i class="lg tw"></i>Testwoche</span><span><i class="lg wk"></i>Wettkampf</span>${entries.some(e => e.kind === "pause") ? `<span><i class="lg pause"></i>Saisonpause</span>` : ""}</div></div>`;
  }
  const entryRow = e => {
    const inv = invitesOf(e.id), mine = myInvite(e.id);
    const staffInfo = e.kind === "wettkampf" && isStaff() ? (inv.length ? `${inv.length} gemeldet · ${inv.filter(i => i.status === "zugesagt").length} zugesagt${inv.some(i => i.status === "angefragt") ? ` · ${inv.filter(i => i.status === "angefragt").length} offen` : ""}` : "noch niemand gemeldet") : "";
    const tag = e.kind === "wettkampf" && !isStaff() && mine ? `<span class="chip ${mine.status === "zugesagt" ? "ok" : mine.status === "abgesagt" ? "off" : "warnc"}">${INV_LABEL[mine.status]}</span>` : "";
    return `<button class="row" data-act="calOpen" data-id="${esc(e.id)}"><span class="kind ${e.kind}">${KIND_LABEL[e.kind]}</span>
    <span class="grow"><span class="name">${esc(e.title)}</span><span class="meta">${fmtDay(e.start_date)}${e.end_date && e.end_date !== e.start_date ? " – " + fmtDay(e.end_date) : ""}${e.location ? " · " + esc(e.location) : ""}</span>${staffInfo ? `<span class="meta">${esc(staffInfo)}</span>` : ""}</span>${tag}<span class="chev">${ICON.chev}</span></button>`;
  };
  const months = {};
  upcoming.forEach(e => { const k = e.start_date.slice(0, 7); (months[k] = months[k] || []).push(e); });
  const mName = k => new Date(k + "-01T12:00:00").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  html += Object.keys(months).length ? Object.entries(months).map(([k, list]) => `<h2>${esc(mName(k))}</h2><div class="card flush">${list.map(entryRow).join("")}</div>`).join("")
    : `<div class="card muted">${isStaff() ? "Keine kommenden Wettkämpfe, Testwochen oder Termine." : "Für dich stehen gerade keine Wettkämpfe oder Termine an."}</div>`;
  if (past.length) html += S.showPastCal ? `<h2>Vergangen</h2><div class="card flush">${past.map(entryRow).join("")}</div><button class="btn ghost block" style="margin-top:10px" data-act="showPastCal" data-v="0">Vergangene Einträge ausblenden</button>` : `<button class="btn ghost block" style="margin-top:14px" data-act="showPastCal">Vergangene Einträge anzeigen (${past.length})</button>`;
  if (!isStaff()) html += `<p class="small muted" style="margin:10px 4px">Wettkämpfe siehst du, wenn der Trainer dich dafür vorgesehen hat.</p>`;
  return html;
}
function pendingInvites() {
  return S.compEntries.filter(c => c.user_id === S.me.id && c.status === "angefragt").map(c => S.calendar.find(e => e.id === c.entry_id)).filter(e => e && (e.end_date || e.start_date) >= todayIso());
}

/* ───── Leistung: Dialoge ───── */
function testSheet(u, tid) {
  const t = testById(tid), rows = resultsOf(u, tid), n = normFor(t, u), p = person(u);
  const canAdd = mayEnterTest(t, u);
  const best = bestOf(t, rows);
  sheet(`<h3>${esc(t.name)}</h3><p class="small muted">${u !== S.me.id ? esc(p.display_name) + " · " : ""}${esc(t.note || "")}${n ? ` · Norm ${esc(fmtVal(n.value, t.unit))}` : ""}</p>
    ${rows.length ? lineChart(t, rows, n) : `<p class="muted small">Noch keine Werte.</p>`}
    ${rows.length ? `<div class="card flush"><div class="subhead">Werte · Bestwert ${esc(fmtVal(best.value, t.unit))}</div>${rows.slice().reverse().map(r => `<div class="row"><span class="grow"><span class="name">${esc(fmtVal(r.value, t.unit))}${t.sides ? ` <span class="muted small">L ${fmtNum(r.value_left, t.unit)} · R ${fmtNum(r.value_right, t.unit)}</span>` : ""}</span>
      <span class="meta">${fmtDay(r.test_date)}${r.note ? " · " + esc(r.note) : ""}</span></span>${normBadge(t, r.value, n)}
      ${mayDeleteResult(r) ? `<button class="iconbtn" data-act="resultDelete" data-id="${esc(r.id)}" data-uid="${esc(u)}" aria-label="Wert löschen">${ICON.trash}</button>` : ""}</div>`).join("")}</div>` : ""}
    ${canAdd ? `<form data-form="result" data-uid="${esc(u)}" data-tid="${esc(t.id)}"><h3 style="font-size:1.05rem;margin-top:16px">Neuer Wert</h3>
      <div class="two">${t.sides ? `<label class="f"><span>Links (${esc(t.unit)})</span><input type="text" inputmode="decimal" name="l"></label><label class="f"><span>Rechts (${esc(t.unit)})</span><input type="text" inputmode="decimal" name="r"></label>`
        : `<label class="f"><span>Wert (${esc(t.unit)})</span><input type="text" inputmode="decimal" name="v" required></label>`}
      <label class="f"><span>Datum</span><input type="date" name="date" value="${todayIso()}" required></label></div>
      <label class="f"><span>Bemerkung</span><input type="text" name="note" maxlength="200"></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Schließen</button><button class="btn">Speichern</button></div></form>`
      : `<div class="btns"><button class="btn ghost block" data-act="closeSheet">Schließen</button></div>`}`);
}
function athleteSheet(u) {
  const p = person(u), info = infoOf(u), a = attendanceStats(u, S.stats.sessions || [], S.stats.att || []), inj = injuriesOf(u);
  const reasons = reasonSummary(a);
  const myComps = S.comps.filter(c => c.user_id === u).sort((x, y) => y.comp_date.localeCompare(x.comp_date)).slice(0, 8);
  sheet(`<h3>${esc(p.display_name)}</h3><p class="small muted">${esc(groupName(p.plan_group_id) || "keine Trainingsgruppe")}${S.emails[u] ? " · " + esc(S.emails[u]) : ""}</p>
    <div class="card"><div class="small muted" style="margin-bottom:6px">Trainingsbeteiligung (${esc(STAT_RANGES[S.statRange][0])})</div>
      <div class="stats"><div class="stat"><b>${a.rate == null ? "–" : a.rate + " %"}</b><span>${a.attended}/${a.counted} Trainings</span></div>
      <div class="stat"><b>${a.no}</b><span>abgesagt</span></div><div class="stat"><b>${a.open}</b><span>keine Antwort</span></div></div>
      <p class="small" style="margin:10px 0 0">${[reasons && "<b>Absagegründe:</b> " + reasons, a.late && a.late + "× zu spät", a.noShow && a.noShow + "× nicht erschienen", a.flipped && a.flipped + "× erst zu-, dann abgesagt", a.excused && a.excused + "× Urlaub/Heimatbesuch (zählt nicht)", a.excluded && a.excluded + " Trainings wegen Verletzung nicht gezählt"].filter(Boolean).join(" · ") || "Keine Auffälligkeiten."}</p>
      ${a.recent.length ? `<div class="subhead" style="padding-left:0">Absagen der letzten 2 Wochen</div>${a.recent.slice().reverse().map(r => `<div class="small">${fmtDay(r.date)}: <b>${esc(REASONS[r.reason] || "ohne Grund")}</b>${r.note ? " – " + esc(r.note) : ""}</div>`).join("")}<p class="small muted" style="margin:6px 0 0">Ältere Absagen werden nur noch gezählt, ohne Datum und Text.</p>` : ""}</div>
    <form data-form="ainfo" data-uid="${esc(u)}" class="card"><div class="small muted" style="margin-bottom:6px">Für die Normen</div>
      <div class="seg" role="radiogroup">${[["m", "Jungs"], ["w", "Mädels"], ["", "offen"]].map(([v, l]) => `<label class="segopt"><input type="radio" name="sex" value="${v}" ${(info.sex || "") === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
      <div class="small muted" style="margin:10px 0 4px">Weitere Trainingsgruppen, deren Normen gelten</div>
      <div class="checks">${S.groups.filter(g => g.id !== p.plan_group_id).map(g => `<label><input type="checkbox" name="g" value="${esc(g.id)}" ${(info.norm_group_ids || []).includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || '<span class="small muted">–</span>'}</div>
      <div class="btns"><button class="btn sm ghost">Speichern</button></div></form>
    <div class="card"><div class="small muted" style="margin-bottom:6px">Verletzungen / Pausen</div>
      ${inj.map(i => `<div class="injrow"><span class="grow"><b>${dm(i.start_date)} – ${i.end_date ? dm(i.end_date) : "heute"}</b>${!i.end_date ? ' <span class="chip off">aktuell</span>' : ""}<span class="small muted" style="display:block">${esc(i.note || "")}${[i.exclude_attendance && "Training", i.exclude_tests && "Tests"].filter(Boolean).length ? " · befreit von: " + [i.exclude_attendance && "Training", i.exclude_tests && "Tests"].filter(Boolean).join(", ") : ""}</span></span>
        ${!i.end_date ? `<button class="btn sm ghost" data-act="injEnd" data-id="${esc(i.id)}" data-uid="${esc(u)}">Wieder fit</button>` : ""}<button class="iconbtn" data-act="injDelete" data-id="${esc(i.id)}" data-uid="${esc(u)}" aria-label="Löschen">${ICON.trash}</button></div>`).join("") || `<p class="small muted">Keine.</p>`}
      <form data-form="injury" data-uid="${esc(u)}" class="injform"><div class="two"><label class="f"><span>Verletzt seit</span><input type="date" name="start" value="${todayIso()}" required></label>
        <label class="f"><span>Bis (optional)</span><input type="date" name="end"></label></div>
        <label class="f"><span>Bemerkung</span><input type="text" name="note" maxlength="300" placeholder="z. B. Muskelfaserriss, Reha"></label>
        <div class="checks"><label><input type="checkbox" name="att" checked> zählt nicht in die Trainingsbeteiligung</label><label><input type="checkbox" name="tests" checked> fehlende Tests nicht anrechnen</label></div>
        <div class="btns"><button class="btn sm ghost">Verletzung eintragen</button></div></form></div>
    <div class="card flush"><div class="subhead">Tests</div>${testRows(u)}</div>
    ${myComps.length ? `<div class="card flush"><div class="subhead">Wettkämpfe</div>${myComps.map(c => `<div class="row"><span class="grow"><span class="name">${esc(c.discipline)} · ${esc(c.result)}</span><span class="meta">${esc(c.comp_name)} · ${fmtDay(c.comp_date)}</span></span></div>`).join("")}</div>` : ""}
    <div class="btns"><button class="btn ghost block" data-act="closeSheet">Schließen</button></div>`);
}
function testTypeSheet(id) {
  const t = id ? testById(id) : { name: "", unit: "", category: "sprint", better: "lower", sides: false, entry: "staff", note: "", active: true, sort_order: 0 };
  const ns = id ? S.norms.filter(n => n.test_id === id) : [];
  const opt = (name, cur, list) => `<select name="${name}">${list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  sheet(`<h3>${id ? esc(t.name) : "Neuer Test"}</h3>
    <form data-form="testType" data-id="${esc(id || "")}">
      <div class="two"><label class="f"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(t.name)}"></label>
      <label class="f"><span>Einheit</span><input type="text" name="unit" maxlength="12" value="${esc(t.unit)}" placeholder="s, m, kg"></label></div>
      <div class="two"><label class="f"><span>Bereich</span>${opt("category", t.category, Object.entries(CAT_LABEL))}</label>
      <label class="f"><span>Besser ist</span>${opt("better", t.better, [["lower", "weniger (Zeit)"], ["higher", "mehr (Weite, kg)"]])}</label></div>
      <div class="two"><label class="f"><span>Wer trägt ein</span>${opt("entry", t.entry, [["staff", "nur Trainer"], ["self", "Athlet selbst"]])}</label>
      <label class="f"><span>Links/rechts getrennt</span>${opt("sides", t.sides, [["false", "nein"], ["true", "ja"]])}</label></div>
      <label class="f"><span>Hinweis</span><input type="text" name="note" maxlength="200" value="${esc(t.note)}"></label>
      <label class="opt"><input type="checkbox" name="active" ${t.active ? "checked" : ""}><span><b>Aktiv</b><span class="small muted">Inaktive Tests bleiben mit ihren Werten erhalten, erscheinen aber nicht mehr.</span></span></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${id ? `<h3 style="font-size:1.05rem;margin-top:18px">Normen</h3>
      <div class="card flush">${ns.map(n => `<div class="row"><span class="grow"><span class="name">${n.sex === "m" ? "Jungs" : "Mädels"} · ${esc(fmtVal(n.value, t.unit))}</span><span class="meta">${n.group_id ? "nur " + esc(groupName(n.group_id) || "?") : "alle Trainingsgruppen"}</span></span>
        <button class="iconbtn" data-act="normDelete" data-id="${esc(n.id)}" data-tid="${esc(id)}" aria-label="Norm löschen">${ICON.trash}</button></div>`).join("") || `<div class="row muted small">Noch keine Norm.</div>`}</div>
      <form data-form="norm" data-tid="${esc(id)}"><div class="normform">
        <select name="sex" aria-label="Geschlecht"><option value="m">Jungs</option><option value="w">Mädels</option></select>
        <select name="group" aria-label="Trainingsgruppe"><option value="">alle Gruppen</option>${S.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select>
        <input type="text" inputmode="decimal" name="value" required placeholder="${esc(t.unit || "Wert")}" aria-label="Normwert"><button class="btn sm">+ Norm</button></div>
        <div class="hint">Gibt es für dieselbe Gruppe schon eine Norm, wird sie ersetzt.</div></form>
      <div class="btns"><button class="btn danger block" data-act="testTypeDelete" data-id="${esc(id)}">Test löschen</button></div>` : ""}`);
}
function compSheet(id, asPb) {
  const c = id ? S.comps.find(x => x.id === id) : { user_id: S.me.id, comp_date: asPb ? "" : todayIso(), comp_name: "", discipline: "", result: "", place: "", wind: "", note: "", entry_id: null, is_pb: !!asPb };
  const wk = S.calendar.filter(e => e.kind === "wettkampf").sort((a, b) => b.start_date.localeCompare(a.start_date));
  const athletes = S.profiles.filter(p => p.approved).sort(byName);
  sheet(`<h3>${id ? "Ergebnis bearbeiten" : "Wettkampfergebnis"}</h3>
    <form data-form="comp" data-id="${esc(id || "")}">
      ${isStaff() ? `<label class="f"><span>Athlet</span><select name="user">${athletes.map(p => `<option value="${esc(p.id)}" ${p.id === c.user_id ? "selected" : ""}>${esc(p.display_name)}</option>`).join("")}</select></label>` : ""}
      ${wk.length ? `<label class="f"><span>Wettkampf aus dem Kalender</span><select name="entry" data-change="compEntry"><option value="">– anderer Wettkampf –</option>${wk.map(e => `<option value="${esc(e.id)}" data-name="${esc(e.title)}" data-date="${esc(e.start_date)}" ${e.id === c.entry_id ? "selected" : ""}>${esc(e.title)} (${dm(e.start_date)})</option>`).join("")}</select></label>` : ""}
      <div class="two"><label class="f"><span>Wettkampf</span><input type="text" name="name" required maxlength="120" value="${esc(c.comp_name)}"></label>
      <label class="f"><span>Datum</span><input type="date" name="date" required value="${esc(c.comp_date)}"></label></div>
      <div class="two"><label class="f"><span>Disziplin</span><input type="text" name="disc" required maxlength="60" list="discs" value="${esc(c.discipline)}"><datalist id="discs">${DISCIPLINES.map(d => `<option value="${d}">`).join("")}</datalist></label>
      <label class="f"><span>Leistung</span><input type="text" name="result" required maxlength="30" value="${esc(c.result)}" placeholder="10,85 · 1:52,30 · 6,45"></label></div>
      <div class="two"><label class="f"><span>Platz</span><input type="text" name="place" maxlength="20" value="${esc(c.place)}"></label>
      <label class="f"><span>Wind</span><input type="text" name="wind" maxlength="10" value="${esc(c.wind)}" placeholder="+1,2"></label></div>
      <label class="f"><span>Bemerkung</span><input type="text" name="note" maxlength="300" value="${esc(c.note)}"></label>
      <label class="opt"><input type="checkbox" name="is_pb" ${c.is_pb ? "checked" : ""}><span><b>Das ist meine Bestleistung (PB)</b><span class="small muted">Z. B. eine PB aus der Zeit vor der App. Spätere bessere Ergebnisse erkennt die App dann als neue PB.</span></span></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${id ? `<div class="btns"><button class="btn danger block" data-act="compDelete" data-id="${esc(id)}">Ergebnis löschen</button></div>` : ""}`);
}
function calSheet(id, kind) {
  const e = id ? S.calendar.find(x => x.id === id) : { kind: kind || "wettkampf", title: kind === "pause" ? "Saisonpause" : "", start_date: todayIso(), end_date: kind === "pause" ? addDays(todayIso(), 13) : null, location: "", note: "" };
  if (id && !isStaff()) {
    const res = S.comps.filter(c => c.entry_id === id), mine = myInvite(id);
    sheet(`<h3>${esc(e.title)}</h3><p class="small muted">${KIND_LABEL[e.kind]} · ${fmtLong(e.start_date)}${e.end_date && e.end_date !== e.start_date ? " – " + fmtLong(e.end_date) : ""}${e.location ? " · " + esc(e.location) : ""}</p>
      ${e.note ? `<p class="pre">${esc(e.note)}</p>` : ""}
      ${mine ? `<div class="card"><div class="small muted">Der Trainer möchte dich melden${mine.status !== "angefragt" ? ` · du hast <b>${INV_LABEL[mine.status]}</b>` : ""}</div>
        <div class="resp"><button class="${mine.status === "zugesagt" ? "on yes" : ""}" data-act="invAnswer" data-id="${esc(id)}" data-v="zugesagt">${ICON.check} Ich bin dabei</button>
        <button class="${mine.status === "abgesagt" ? "on no" : ""}" data-act="invAnswer" data-id="${esc(id)}" data-v="abgesagt">${ICON.x} Lieber nicht</button></div>
        <p class="small muted" style="margin:8px 0 0">Absprachen dazu laufen über WhatsApp. Der Trainer kann die Meldung danach noch anpassen.</p></div>` : ""}
      ${res.length ? `<div class="card flush">${res.map(c => `<div class="row"><span class="grow"><span class="name">${esc((person(c.user_id) || {}).display_name || "?")}</span><span class="meta">${esc(c.discipline)}</span></span><span class="val">${esc(c.result)}</span></div>`).join("")}</div>` : ""}
      <div class="btns">${e.kind === "wettkampf" ? `<button class="btn" data-act="compNewFor" data-id="${esc(id)}">Mein Ergebnis eintragen</button>` : ""}<button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
    return;
  }
  const inv = id ? invitesOf(id) : [];
  const people = S.profiles.filter(p => p.approved && (trainsP(p) || inv.some(i => i.user_id === p.id))).sort(byName);
  sheet(`<h3>${id ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h3>
    <form data-form="cal" data-id="${esc(id || "")}" class="kind-${esc(e.kind)}">
      <label class="f"><span>Art</span><select name="kind" data-change="calKind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${e.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <div class="hint only-phase">Phasen (z. B. Allgemeine Vorbereitung, Hallensaison) erscheinen als farbige Balken in der Periodisierung.</div>
        <div class="hint only-testwoche">Eine Testwoche dauert normalerweise eine Woche. Ohne Enddatum werden 7 Tage eingetragen.</div>
        <div class="hint only-pause">In der Saisonpause findet kein Training statt: Termine fallen aus, niemand kann zu-/absagen oder zu spät kommen, nichts zählt in die Statistik. Für ein einzelnes ausfallendes Training: Termin antippen → „Training fällt aus“.</div></label>
      <label class="f"><span>Titel</span><input type="text" name="title" required maxlength="120" value="${esc(e.title)}"></label>
      <div class="two"><label class="f"><span>Von</span><input type="date" name="start" required value="${esc(e.start_date)}" data-change="calStart"></label>
      <label class="f"><span>Bis <span class="muted">(optional)</span></span><input type="date" name="end" value="${esc(e.end_date || "")}" data-change="calEnd"></label></div>
      <label class="f not-phase"><span>Ort</span><input type="text" name="location" maxlength="120" value="${esc(e.location)}"></label>
      <label class="f"><span>Notiz</span><input type="text" name="note" maxlength="500" value="${esc(e.note)}"></label>
      <div class="only-wettkampf"><div class="small muted" style="margin:2px 0 6px">Wen möchtest du melden? Die Personen sehen den Wettkampf und können zusagen oder ablehnen. Alle anderen sehen ihn nicht.</div>
        <div class="checks personlist">${people.map(p => { const i = inv.find(x => x.user_id === p.id); return `<label><input type="checkbox" name="inv" value="${esc(p.id)}" ${i ? "checked" : ""}> ${esc(p.display_name)} ${i ? `<span class="chip ${i.status === "zugesagt" ? "ok" : i.status === "abgesagt" ? "off" : "warnc"}">${INV_LABEL[i.status]}</span>` : ""}${currentInjury(p.id) ? ' <span class="muted small">· verletzt</span>' : ""}</label>`; }).join("")}</div>
        ${inv.length ? `<details class="mapmore"><summary class="small">Antworten ändern (nach Absprache)</summary>${inv.map(i => `<div class="maprow"><span class="grow">${esc((person(i.user_id) || {}).display_name || "?")}</span>
          <select name="st_${esc(i.user_id)}">${Object.entries(INV_LABEL).map(([k, l]) => `<option value="${k}" ${i.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}</details>` : ""}</div>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${id ? `<div class="btns"><button class="btn danger block" data-act="calDelete" data-id="${esc(id)}">Eintrag löschen</button></div>` : ""}`);
}
async function reloadPerf() {
  const [tests, norms, results, ainfo, injuries, calendar, comps, feedback, compEntries] = await Promise.all(["test_types", "norms", "test_results", "athlete_info", "injuries", "calendar_entries", "competition_results", "feedback", "competition_entries"].map(t => S.be.list(t)));
  Object.assign(S, { tests, norms, results, ainfo, injuries, calendar, comps, compEntries, feedback: feedback.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) });
  await reloadBoard();
}
// Pinnwand: ohne SQL Teil 8 bleibt sie leer, die App läuft weiter
async function reloadBoard() { try { S.fbBoard = await S.be.feedbackBoard(); } catch (e) { S.fbBoard = []; } }

const perfActions = {
  perfView(el) { S.perfView = el.dataset.v; render(); },
  statRange(el) { S.statRange = el.dataset.v; S.stats.loaded = false; render(); },
  statSort(el) { S.statSort = el.dataset.v; render(); },
  testOpen(el) { testSheet(el.dataset.uid, el.dataset.tid); },
  athleteOpen(el) { athleteSheet(el.dataset.id); },
  async resultDelete(el) {
    if (!await ask("Wert löschen?", "Der Messwert wird gelöscht.", "Löschen", true)) return;
    const r = S.results.find(x => x.id === el.dataset.id);
    await quiet(busy(null, async () => { await S.be.removeRow("test_results", r.id); await reloadPerf(); render(); testSheet(r.user_id, r.test_id); }));
  },
  async injEnd(el) {
    await quiet(busy(null, async () => { const inj = S.injuries.find(i => i.id === el.dataset.id), y = addDays(todayIso(), -1);
      await S.be.saveRow("injuries", { id: el.dataset.id, end_date: y < inj.start_date ? inj.start_date : y }); await reloadPerf(); render(); athleteSheet(el.dataset.uid); toast("Als wieder fit eingetragen"); }));
  },
  async injDelete(el) {
    if (!await ask("Eintrag löschen?", "Die Verletzung wird aus dem Verlauf gelöscht.", "Löschen", true)) return athleteSheet(el.dataset.uid);
    await quiet(busy(null, async () => { await S.be.removeRow("injuries", el.dataset.id); await reloadPerf(); render(); athleteSheet(el.dataset.uid); }));
  },
  testTypeNew() { testTypeSheet(null); },
  testTypeOpen(el) { testTypeSheet(el.dataset.id); },
  async testTypeDelete(el) {
    const t = testById(el.dataset.id), n = S.results.filter(r => r.test_id === t.id).length;
    if (!await ask("Test löschen?", `„${esc(t.name)}“ und ${n} gespeicherte Werte werden gelöscht. Wenn der Test nur nicht mehr gemacht wird, nimm lieber den Haken bei „Aktiv“ raus.`, "Löschen", true)) return testTypeSheet(t.id);
    await quiet(busy(null, async () => { await S.be.removeRow("test_types", t.id); await reloadPerf(); closeSheet(); render(); toast("Test gelöscht"); }));
  },
  async normDelete(el) {
    await quiet(busy(null, async () => { await S.be.removeRow("norms", el.dataset.id); await reloadPerf(); render(); testTypeSheet(el.dataset.tid); }));
  },
  compNew() { compSheet(null); },
  pbNew() { compSheet(null, true); },
  compNewFor(el) { compSheet(null); const sel = document.querySelector('#dlg select[name=entry]'); if (sel) { sel.value = el.dataset.id; changes.compEntry(sel); } },
  compEdit(el) { compSheet(el.dataset.id); },
  async compDelete(el) {
    if (!await ask("Ergebnis löschen?", "Das Wettkampfergebnis wird gelöscht.", "Löschen", true)) return compSheet(el.dataset.id);
    await quiet(busy(null, async () => { await S.be.removeRow("competition_results", el.dataset.id); await reloadPerf(); closeSheet(); render(); }));
  },
  termView(el) { S.termView = el.dataset.v; render(); },
  calNew() { calSheet(null); },
  pauseNew() { calSheet(null, "pause"); },
  tlBig() {
    const es = S.calendar, t = todayIso();
    const lo = es.reduce((m, e) => e.start_date < m ? e.start_date : m, addDays(t, -28)), hi = es.reduce((m, e) => (e.end_date || e.start_date) > m ? (e.end_date || e.start_date) : m, addDays(t, 120));
    sheet(`<h3>Periodisierung</h3><p class="small muted">Seitlich wischen. Balken und Punkte antippen für Details.</p>${timelineHtml(es, addDays(lo, -7), addDays(hi, 7), true)}
      <div class="small muted tl-legend"><span><i class="lg ph1"></i>Phasen</span><span><i class="lg tw"></i>Testwoche</span><span><i class="lg wk"></i>Wettkampf</span></div>
      <div class="btns"><button class="btn ghost block" data-act="closeSheet">Schließen</button></div>`);
    setTimeout(() => { const w = document.querySelector("#dlg .tlwrap"), td = document.querySelector("#dlg .tl-today"); if (w && td) w.scrollLeft = td.offsetLeft - w.clientWidth / 3; }, 50);
  },
  async calKeep(el) { await quiet(busy(null, async () => { await S.be.saveRow("calendar_entries", { id: el.dataset.id, keep: true }); await reloadPerf(); render(); })); },
  async calDrop(el) { await quiet(busy(null, async () => { await S.be.removeRow("calendar_entries", el.dataset.id); await reloadPerf(); render(); toast("Gelöscht"); })); },
  async invAnswer(el) {
    await quiet(busy(el.parentElement, async () => { await S.be.answerInvite(el.dataset.id, el.dataset.v); await reloadPerf(); render();
      if ($("#dlg").open && document.querySelector("#dlg [data-act=invAnswer]")) calSheet(el.dataset.id);
      toast(el.dataset.v === "zugesagt" ? "Zugesagt – der Trainer sieht es" : "Abgelehnt – der Trainer sieht es"); }));
  },
  calOpen(el) { calSheet(el.dataset.id); },
  async calDelete(el) {
    if (!await ask("Eintrag löschen?", "Der Kalendereintrag wird gelöscht. Eingetragene Wettkampfergebnisse bleiben erhalten.", "Löschen", true)) return calSheet(el.dataset.id);
    await quiet(busy(null, async () => { await S.be.removeRow("calendar_entries", el.dataset.id); await reloadPerf(); closeSheet(); render(); }));
  },
  showPastCal(el) { S.showPastCal = el.dataset.v !== "0"; render(); },
  moreView(el) { S.moreView = el.dataset.v; render(); },
  memberPerf(el) { closeSheet(); S.tab = "leistung"; S.perfView = "overview"; render(); loadStats().then(() => athleteSheet(el.dataset.id)).catch(e => toast(deErr(e), "error")); }
};
const perfChanges = {
  calKind(el) {
    const f = el.form; f.className = "kind-" + el.value;
    if (el.value === "testwoche" && (!f.end.value || f.end.dataset.auto) && f.start.value) { f.end.value = addDays(f.start.value, 6); f.end.dataset.auto = "1"; }
  },
  calStart(el) { const f = el.form; if (f.kind.value === "testwoche" && el.value && (!f.end.value || f.end.dataset.auto)) { f.end.value = addDays(el.value, 6); f.end.dataset.auto = "1"; } },
  calEnd(el) { delete el.dataset.auto; },
  async betaToggle(el) { await quiet(busy(null, async () => { S.settings = await S.be.updateSettings({ beta: el.checked }); render(); toast(el.checked ? "Beta-Schild an" : "Beta-Schild aus"); })); },
  enterTest(el) { S.enterTest = el.value; render(); },
  enterDate(el) { S.enterDate = el.value || todayIso(); render(); },
  compEntry(el) {
    const o = el.selectedOptions[0], f = el.form; if (!o || !o.value) return;
    f.name.value = o.dataset.name; f.date.value = o.dataset.date;
  }
};
const perfForms = {
  async feedback(f) {
    const msg = f.msg.value.trim(); if (!msg) return toast("Bitte schreib kurz, worum es geht.", "error");
    const ua = navigator.userAgent, device = (/iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Gerät") + (matchMedia("(display-mode: standalone)").matches ? " · App" : " · Browser") + ` · ${innerWidth}px`;
    await S.be.saveRow("feedback", { user_id: S.me.id, category: (f.querySelector("[name=cat]:checked") || {}).value || "idee", message: msg, context: TAB_LABEL[S.tab] || S.tab, app_version: VERSION, device });
    await reloadPerf(); render(); closeSheet(); toast("Danke für dein Feedback!");
  },
  async fbReply(f) {
    await S.be.saveRow("feedback", { id: f.dataset.id, admin_note: f.note.value.trim(), status: f.done.checked ? "erledigt" : "neu" });
    await reloadPerf(); closeSheet(); render(); toast("Gespeichert");
  },
  async result(f) {
    const t = testById(f.dataset.tid), row = { user_id: f.dataset.uid, test_id: t.id, test_date: f.date.value, note: f.note.value.trim() };
    if (t.sides) { row.value_left = parseVal(f.l.value); row.value_right = parseVal(f.r.value); if (row.value_left == null && row.value_right == null) return toast("Bitte mindestens ein Bein eintragen.", "error"); }
    else { row.value = parseVal(f.v.value); if (row.value == null) return toast("Bitte eine Zahl eintragen, z. B. 3,45.", "error"); }
    await S.be.saveRow("test_results", row); await reloadPerf(); render(); testSheet(row.user_id, t.id); toast("Gespeichert");
  },
  async bulkResults(f) {
    const t = testById(f.dataset.tid), date = f.dataset.date; let n = 0, bad = [];
    for (const p of trainees()) {
      const ex = S.results.find(r => r.user_id === p.id && r.test_id === t.id && r.test_date === date);
      const row = { user_id: p.id, test_id: t.id, test_date: date };
      if (t.sides) {
        const l = f["l_" + p.id].value.trim(), r = f["r_" + p.id].value.trim();
        if (!l && !r) continue;
        row.value_left = parseVal(l); row.value_right = parseVal(r);
        if ((l && row.value_left == null) || (r && row.value_right == null)) { bad.push(p.display_name); continue; }
        if (ex && ex.value_left === row.value_left && ex.value_right === row.value_right) continue;
      } else {
        const v = f["v_" + p.id].value.trim(); if (!v) continue;
        row.value = parseVal(v); if (row.value == null) { bad.push(p.display_name); continue; }
        if (ex && Number(ex.value) === row.value) continue;
      }
      if (ex) row.id = ex.id;
      await S.be.saveRow("test_results", row); n++;
    }
    await reloadPerf(); S.stats.loaded = false; render();
    toast(bad.length ? `${n} gespeichert. Nicht lesbar: ${bad.join(", ")}` : `${n} Werte gespeichert`, bad.length ? "error" : undefined);
  },
  async ainfo(f) {
    const u = f.dataset.uid, sex = (f.querySelector("[name=sex]:checked") || {}).value || null;
    const ids = [...f.querySelectorAll("[name=g]:checked")].map(x => x.value);
    await S.be.saveRow("athlete_info", { user_id: u, sex, norm_group_ids: ids, updated_at: new Date().toISOString() });
    await reloadPerf(); render(); athleteSheet(u); toast("Gespeichert");
  },
  async injury(f) {
    const u = f.dataset.uid;
    if (f.end.value && f.end.value < f.start.value) return toast("Das Ende liegt vor dem Beginn.", "error");
    await S.be.saveRow("injuries", { user_id: u, start_date: f.start.value, end_date: f.end.value || null, note: f.note.value.trim(), exclude_attendance: f.att.checked, exclude_tests: f.tests.checked });
    await reloadPerf(); render(); athleteSheet(u); toast("Verletzung eingetragen");
  },
  async testType(f) {
    const row = { name: f.name.value.trim(), unit: f.unit.value.trim(), category: f.category.value, better: f.better.value, entry: f.entry.value, sides: f.sides.value === "true", note: f.note.value.trim(), active: f.active.checked };
    if (f.dataset.id) row.id = f.dataset.id; else row.sort_order = Math.max(0, ...S.tests.map(t => t.sort_order || 0)) + 1;
    const saved = await S.be.saveRow("test_types", row); await reloadPerf(); render(); testTypeSheet(saved.id); toast("Gespeichert");
  },
  async norm(f) {
    const tid = f.dataset.tid, value = parseVal(f.value.value), sex = f.sex.value, group_id = f.group.value || null;
    if (value == null) return toast("Bitte einen Normwert eintragen.", "error");
    const ex = S.norms.find(n => n.test_id === tid && n.sex === sex && (n.group_id || null) === group_id);
    await S.be.saveRow("norms", ex ? { id: ex.id, value } : { test_id: tid, sex, group_id, value });
    await reloadPerf(); render(); testTypeSheet(tid); toast("Norm gespeichert");
  },
  async comp(f) {
    const disc = f.disc.value.trim(), result = f.result.value.trim();
    const row = { user_id: f.user ? f.user.value : S.me.id, entry_id: f.entry ? (f.entry.value || null) : null, comp_name: f.name.value.trim(), comp_date: f.date.value, discipline: disc,
      result, value: parseVal(result), better: betterFor(disc), place: f.place.value.trim(), wind: f.wind.value.trim(), note: f.note.value.trim(), is_pb: f.is_pb.checked };
    if (f.dataset.id) row.id = f.dataset.id;
    const before = pbMap(row.user_id)[disc.toLowerCase()];
    const saved = await S.be.saveRow("competition_results", row); await reloadPerf(); closeSheet(); render();
    const newPb = before && before.id !== saved.id && row.value != null && (row.better === "lower" ? row.value < before.value : row.value > before.value);
    toast(newPb ? `Neue Bestleistung über ${disc}! Vorher ${before.result}` : "Ergebnis gespeichert");
  },
  async cal(f) {
    if (f.end.value && f.end.value < f.start.value) return toast("Das Ende liegt vor dem Beginn.", "error");
    const kind = f.kind.value;
    const row = { kind, title: f.title.value.trim(), start_date: f.start.value, end_date: f.end.value || (kind === "testwoche" ? addDays(f.start.value, 6) : null),
      location: kind === "phase" || kind === "pause" ? "" : f.location.value.trim(), note: f.note.value.trim() };
    if (kind === "pause" && !row.title) row.title = "Saisonpause";
    if (f.dataset.id) row.id = f.dataset.id;
    const saved = await S.be.saveRow("calendar_entries", row);
    if (kind === "wettkampf") {
      const ids = [...f.querySelectorAll("[name=inv]:checked")].map(x => x.value);
      const status = {}; f.querySelectorAll("select[name^=st_]").forEach(sel => status[sel.name.slice(3)] = sel.value);
      await S.be.setInvites(saved.id, ids, status);
    }
    await reloadPerf(); closeSheet(); render(); toast("Gespeichert");
  }
};

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
  const canDelete = !self && (isAdmin() || (role() === "trainer" && p.role !== "admin"));
  const roles = isAdmin() ? ["athlete", "trainer", "admin"] : ["athlete", "trainer"];
  const groupOpts = `<option value="">– keine –</option>` + S.groups.map(g => `<option value="${esc(g.id)}" ${g.id === p.plan_group_id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  const info = `<p class="muted small">${roleChip(shownRole(p))} ${S.emails[p.id] ? esc(S.emails[p.id]) : ""}</p>`;
  if (!edit) {
    sheet(`<h3>${esc(p.display_name)}</h3>${info}<p>Trainingsgruppe: <b>${esc(groupName(p.plan_group_id) || "keine")}</b></p>
      <div class="btns"><button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
    return;
  }
  sheet(`<h3>${esc(p.display_name)}</h3>${info}
    <form data-form="member" data-id="${esc(p.id)}">
      <label class="f"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(p.display_name)}"></label>
      ${staffEdit ? `<label class="f"><span>Trainingsgruppe</span><select name="group">${groupOpts}</select><div class="hint">Bestimmt, welches Blatt im Wochenplan zuerst geöffnet wird.</div></label>` : ""}
      ${staffEdit && roles.includes(p.role) ? `<label class="f"><span>Rolle</span><select name="role">${roles.map(r => `<option value="${r}" ${r === p.role ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>
        <div class="hint">Trainer können fast alles: freischalten, Rollen Athlet/Trainer, Pläne, Termine, Absagegründe. Admins zusätzlich: Admin-Rechte vergeben, Backup und Feedback zur App. Admins sind für Athleten unsichtbar.</div></label>` : ""}
      ${staffEdit && p.role !== "athlete" ? `<label class="opt"><input type="checkbox" name="trains" ${trainsP(p) ? "checked" : ""}><span><b>Trainiert selbst mit</b><span class="small muted">Zu-/Absagen, Tests und Statistik wie bei Athleten.</span></span></label>` : ""}
      ${staffEdit && !self ? `<label class="opt"><input type="checkbox" name="approved" ${p.approved ? "checked" : ""}><span><b>Zugang aktiv</b><span class="small muted">Ohne Haken kann sich die Person zwar anmelden, sieht aber nichts.</span></span></label>` : ""}
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div>
    </form>
    ${isStaff() && p.role === "athlete" && p.approved ? `<div class="btns"><button class="btn ghost block" data-act="memberPerf" data-id="${esc(p.id)}">Leistung, Verletzungen &amp; Trainingsbeteiligung</button></div>` : ""}
    ${canDelete ? `<div class="btns"><button class="btn danger block" data-act="deleteMember" data-id="${esc(p.id)}">Konto löschen</button></div>` : ""}`);
}

function absageSheet(sid, uidFor) {
  const s = S.sessions.find(x => x.id === sid), pr = privOf(sid, uidFor);
  const forOther = uidFor !== S.me.id, target = person(uidFor);
  if (isCoach(target)) {
    sheet(`<h3>Nicht da</h3><p class="small muted">${esc(s.title || "Training")} · ${fmtLong(s.session_date)}${forOther ? ` · ${esc(target.display_name)}` : ""}</p>
      <form data-form="absage" data-id="${esc(sid)}" data-user="${esc(uidFor)}" data-coach="1">
        <div class="small muted" style="margin-bottom:6px">Grund (freiwillig)</div>
        <div class="reasons">${COACH_REASONS.map(k => `<label class="opt"><input type="radio" name="reason" value="${k}" ${pr && pr.reason === k ? "checked" : ""}><span><b>${REASONS[k]}</b></span></label>`).join("")}</div>
        <label class="f"><span>Bemerkung (freiwillig)</span><input type="text" name="note" maxlength="300" value="${esc(pr ? pr.note : "")}" placeholder="z. B. Vertretung macht …"></label>
        <p class="small muted">Die Athleten sehen, dass du nicht da bist. Den Grund sehen nur Trainer und Admins.</p>
        <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Eintragen</button></div></form>`);
    return;
  }
  sheet(`<h3>Absagen</h3><p class="small muted">${esc(s.title || "Training")} · ${fmtLong(s.session_date)}${forOther ? ` · für <b>${esc(person(uidFor).display_name)}</b>` : ""}</p>
    <form data-form="absage" data-id="${esc(sid)}" data-user="${esc(uidFor)}">
      <div class="reasons">${ATHLETE_REASONS.map(k => [k, REASONS[k]]).map(([k, l]) => `<label class="opt"><input type="radio" name="reason" value="${k}" required ${pr && pr.reason === k ? "checked" : ""}><span><b>${l}</b>${NEUTRAL_REASONS.includes(k) ? '<span class="small muted">zählt nicht als Fehlen</span>' : ""}</span></label>`).join("")}</div>
      <label class="f"><span>Bemerkung <span class="muted">(bei „Sonstiges“ Pflicht)</span></span><textarea name="note" maxlength="300" rows="2">${esc(pr ? pr.note : "")}</textarea></label>
      <p class="small muted">Den Grund sehen nur Trainer und Admins.</p>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Absagen</button></div></form>`);
}

function sessionSheet(sid, focus) {
  // gewählte Liste merken, damit „Zurück“ aus der Personenansicht dort wieder landet
  focus = focus || (S.sessFocus && S.sessFocus.sid === sid ? S.sessFocus.g : "yes");
  S.sessFocus = { sid, g: focus };
  const s = S.sessions.find(x => x.id === sid); if (!s) return;
  const roster = rosterOf(s), staff = isStaff();
  const groups = { yes: [], no: [], open: [] };
  roster.forEach(p => { const a = attOf(s.id, p.id); groups[a && a.status === "yes" ? "yes" : a && a.status === "no" ? "no" : "open"].push(p); });
  const line = p => {
    const a = attOf(s.id, p.id), pr = privOf(s.id, p.id);
    const mark = a && a.coach_mark ? `<span class="chip ${a.coach_mark === "no_show" ? "off" : ""}">${a.coach_mark === "late" ? "zu spät" : "nicht erschienen"}</span>` : "";
    const flip = staff && flipped(s.id, p.id) ? `<span class="chip" title="Erst zugesagt, dann abgesagt">${ICON.flip} umentschieden</span>` : "";
    const injChip = staff && injuredOn(p.id, s.session_date, null) ? `<span class="chip off">verletzt</span>` : "";
    const reason = staff && pr ? `<span class="meta">${esc(REASONS[pr.reason] || pr.reason)}${pr.note ? " – " + esc(pr.note) : ""}</span>` : "";
    const inner = `<span class="avatar ${p.role}">${esc(initials(p.display_name))}</span><span class="grow"><span class="name">${esc(p.display_name)}</span>${reason}</span>${injChip}${flip}${mark}`;
    return staff ? `<button class="row" data-act="attPerson" data-sid="${esc(s.id)}" data-uid="${esc(p.id)}">${inner}<span class="chev">${ICON.chev}</span></button>` : `<div class="row">${inner}</div>`;
  };
  const LBL = { yes: "Dabei", no: "Abgesagt", open: "Offen" };
  const tabs = `<div class="seg" style="margin:4px 0 10px">${Object.entries(LBL).map(([g, l]) => `<button data-act="sessOpen" data-id="${esc(s.id)}" data-g="${g}" aria-pressed="${focus === g}">${l} · ${groups[g].length}</button>`).join("")}</div>`;
  sheet(`<h3>${esc(s.title || "Training")}</h3>
    <p class="small muted">${fmtLong(s.session_date)}${s.start_time ? " · " + hhmm(s.start_time) + " Uhr" : ""}${s.location ? " · " + esc(s.location) : ""}${s.cancelled ? ' · <span class="chip off">abgesagt</span>' : ""}</p>
    ${tabs}<div class="card flush">${groups[focus].map(line).join("") || `<div class="row muted small">Niemand</div>`}</div>
    ${focus === "no" && staff && groups.no.length ? `<p class="small muted" style="margin:6px 4px 0">Gründe sehen nur Trainer und Admins.</p>` : ""}
    ${staff ? `<div class="btns"><button class="btn ghost" data-act="sessEdit" data-id="${esc(s.id)}">Termin bearbeiten</button>${s.cancelled ? `<button class="btn ghost" data-act="sessCancel" data-id="${esc(s.id)}" data-v="0">Findet doch statt</button>` : pauseOn(s.session_date) ? "" : `<button class="btn ghost" data-act="sessCancel" data-id="${esc(s.id)}" data-v="1">Training fällt aus</button>`}</div>` : ""}
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
    ${!sessOff(s) ? `<div class="btns"><button class="btn ghost" data-act="respFor" data-sid="${esc(sid)}" data-uid="${esc(u)}" data-v="yes">Zusage eintragen</button><button class="btn ghost" data-act="respFor" data-sid="${esc(sid)}" data-uid="${esc(u)}" data-v="no">Absage eintragen</button></div>` : ""}
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

function youtubeId(url) {
  const m = String(url || "").match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
async function exerciseSheet(id, prefillName) {
  const e = id ? S.exercises.find(x => x.id === id) : null;
  const mayEdit = e && isStaff();   // Übungen pflegen nur Trainer/Admins
  if (e && !exerciseSheet.edit) {
    let media = "";
    if (e.video_path) media = `<video controls playsinline preload="metadata" class="exvideo" id="exvideo"></video>`;
    const yt = youtubeId(e.video_url);
    if (yt) media += `<div class="ytwrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}?rel=0&playsinline=1" title="Video: ${esc(e.name)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    else if (e.video_url) media += `<p><a class="btn ghost" href="${esc(e.video_url)}" target="_blank" rel="noopener noreferrer">${ICON.video} Video ansehen</a></p>`;
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
      <label class="f"><span>Video-Link <span class="muted">(am besten YouTube, „nicht gelistet“)</span></span><input type="url" name="video_url" maxlength="500" value="${esc(x.video_url)}" placeholder="https://youtu.be/…">
        <div class="hint">YouTube-Videos werden direkt in der App abgespielt und brauchen keinen Speicher bei uns. „Nicht gelistet“ heißt: nur wer den Link hat, findet das Video.</div></label>
      <label class="f"><span>Kurzvideo hochladen <span class="muted">(max. 50 MB)</span></span><input type="file" name="video" accept="video/mp4,video/quicktime,video/webm,video/*">
        ${e && e.video_path ? `<label class="small"><input type="checkbox" name="removeVideo"> Vorhandenes Video entfernen</label>` : ""}</label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>
    ${e ? `<div class="btns"><button class="btn danger block" data-act="exDelete" data-id="${esc(e.id)}">Übung löschen</button></div>` : ""}`);
}

function itemSheet(text) {
  const ex = findExercise(text);
  if (ex) return exerciseSheet(ex.id);
  sheet(`<h3>${esc(text)}</h3><p class="muted small">Zu dieser Übung gibt es noch keine Erklärung in der Übungssammlung.</p>
    <div class="btns">${isStaff() ? `<button class="btn" data-act="exNew" data-name="${esc(text)}">Erklärung hinzufügen</button>` : ""}<button class="btn ghost" data-act="closeSheet">Schließen</button></div>`);
}

/* ───── Plan-Import ───── */
function planFormatHtml() {
  const R = (cls, label, a, b) => `<tr class="${cls}"><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  return `<h3>So liest die App den Plan</h3><div class="helptext">
  <p><a class="btn" href="vorlage/Wochenplan_Vorlage.xlsx" download>Vorlage herunterladen (.xlsx)</a></p>
  <p class="small muted">Am einfachsten: Vorlage nehmen und nur die Inhalte ändern. Aufbau jeder Spalte von oben nach unten:</p>
  <table class="fmt"><thead><tr><th></th><th>Montag</th><th>Dienstag</th></tr></thead><tbody>
    ${R("r-info", "1 · Ort/Zeit", "<i>leer</i>", "LAA 17:25")}
    ${R("r-title", "2 · Thema", "Kraft Beine", "Sprint")}
    ${R("", "3 · Übung", "Rad", "Einlaufen")}
    ${R("r-det", "Belastung", "Min 10", "800m")}
    ${R("r-gap", "Leerzeile", "", "")}
    ${R("", "Übung", "Kniebeuge", "Beschleunigung")}
    ${R("r-det", "Belastung", "3x5", "5x20m")}
    ${R("", "Übung", "Kastensprünge", "")}
    ${R("r-det", "Belastung", "3x5", "")}</tbody></table>
  <ul class="fmtlist">
    <li><b>Ein Blatt pro Gruppe</b> oder Programm. Der Blattname erscheint in der App.</li>
    <li><b>Zeile 1</b> unter dem Wochentag: Ort und Uhrzeit, oder <i>Pause</i>, <i>Regeneration</i>, <i>Optional</i>. Darf leer bleiben.</li>
    <li><b>Zeile 2:</b> Tagesthema. Steht „Kraft“ darin, zeigt die App Supersätze: zwei Übungen ohne Leerzeile = ein Paar. „Rad“ oder „Einlaufen“ gilt als Aufwärmen.</li>
    <li><b>Danach:</b> jede Übung in eine eigene Zelle, die Belastung <b>direkt darunter</b> (3x5, max, Min 10, P: 6 min …).</li>
    <li><b>Leerzeile</b> = neuer Block. „Alternativ“ in einer eigenen Zeile wird als „oder“ angezeigt.</li>
    <li><b>Abkürzungen:</b> Blatt „Abkürzungen“, Spalte A Kürzel, Spalte B Bedeutung.</li>
  </ul>
  <p class="small muted"><b>Nicht:</b> zwei Tage in einer Spalte, Übung und Belastung nebeneinander, Bilder. Vor dem Speichern zeigt „Vorschau“, wie die App jedes Blatt gelesen hat.</p></div>`;
}
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
        const prev = (r.prev || []).find(x => norm(x.name) === norm(p.name));
        const match = prev ? (prev.group_id ? S.groups.find(g => g.id === prev.group_id) : null) : S.groups.find(g => norm(g.name) === norm(p.name));
        const words = p.name.toLowerCase().split(/[^a-zäöüß]+/).filter(w => w.length >= 3);
        const named = trainees().filter(u => words.includes(firstName(u.display_name).toLowerCase()) || (prev && (prev.user_ids || []).includes(u.id)));
        const alt = !!prev || /altern|reha|verletz|individ/i.test(p.name);
        const days = p.days.filter(d => d.items.length).length, items = p.days.reduce((n, d) => n + d.items.length, 0);
        return `<div class="maprow"><span class="grow"><b>${esc(p.name)}</b><span class="small muted" style="display:block">${days} Tage, ${items} Übungen erkannt${prev ? " · Zuordnung wie bisher" : ""}</span></span>
          <select name="map${i}" aria-label="Trainingsgruppe für ${esc(p.name)}"><option value="">– keine Gruppe –</option>
          ${S.groups.map(g => `<option value="${esc(g.id)}" ${match && match.id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
          <option value="__new" ${match || alt ? "" : "selected"}>+ Neue Gruppe „${esc(p.name)}“</option></select></div>
          <details class="mapmore" ${named.length || (alt && !prev) ? "open" : ""}><summary class="small">Für einzelne Personen${named.length ? ` (${named.length} ${prev ? "zugeordnet" : "erkannt"})` : ""}</summary>
            <div class="checks personlist">${trainees().sort(byName).map(u => `<label><input type="checkbox" name="u${i}" value="${esc(u.id)}" ${named.includes(u) ? "checked" : ""}> ${esc(u.display_name)} <span class="muted small">${esc(groupName(u.plan_group_id) || "")}${currentInjury(u.id) ? " · verletzt" : ""}</span></label>`).join("")}</div></details>
          <details class="mapmore"><summary class="small">Vorschau: so wird das Blatt gelesen</summary><div class="preview">${renderDays(p.days, mondayOf(todayIso()), false)}</div></details>`;
      }).join("")}
      <p class="small"><button type="button" class="linkbtn small" data-act="planFormat">Wie muss der Plan aufgebaut sein?</button></p>
      ${r.extras.filter(x => !/abk/i.test(x.name)).length ? `<p class="small muted" style="margin-top:10px">Nicht übernommen (keine Wochentage): ${r.extras.filter(x => !/abk/i.test(x.name)).map(x => esc(x.name)).join(", ")}</p>` : ""}
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
  planSheet(el) { const p = planForWeek(S.planWeek || mondayOf(todayIso())); if (p) S.sheetChoice[p.id] = el.dataset.id; render(); },
  planFormat() { sheet(planFormatHtml() + `<div class="btns"><button class="btn ghost block" data-act="${IMPORT ? "importBack" : "closeSheet"}">${IMPORT ? "Zurück zum Hochladen" : "Schließen"}</button></div>`); },
  importBack() { importSheet(); },
  sheetAssign(el) {
    const p = planForWeek(S.planWeek || mondayOf(todayIso())), sh = (S.sheetCache[p.id] || []).find(x => x.id === el.dataset.id);
    sheet(`<h3>Blatt zuordnen</h3><p class="small muted">„${esc(sh.name)}“ · ${esc(p.title || "Wochenplan")}</p>
      <form data-form="sheetAssign" data-id="${esc(sh.id)}" data-plan="${esc(p.id)}">
        <label class="f"><span>Trainingsgruppe</span><select name="group"><option value="">– keine –</option>${S.groups.map(g => `<option value="${esc(g.id)}" ${g.id === sh.group_id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
        <div class="small muted" style="margin:4px 0 6px">Zusätzlich für einzelne Personen (z. B. Alternativplan bei Verletzung). Sie sehen dieses Blatt zuerst, bleiben aber in ihrer Trainingsgruppe.</div>
        <div class="checks personlist">${trainees().sort(byName).map(u => `<label><input type="checkbox" name="u" value="${esc(u.id)}" ${(sh.user_ids || []).includes(u.id) ? "checked" : ""}> ${esc(u.display_name)} <span class="muted small">${esc(groupName(u.plan_group_id) || "")}${currentInjury(u.id) ? " · verletzt" : ""}</span></label>`).join("")}</div>
        <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>`);
  },
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
  sessOpen(el) { sessionSheet(el.dataset.id, el.dataset.g); },
  attPerson(el) { attPersonSheet(el.dataset.sid, el.dataset.uid); },
  async setMark(el) {
    await quiet(busy(el.parentElement, async () => { await S.be.setMark(el.dataset.sid, el.dataset.uid, el.dataset.v || null); await loadSessions(); render(); attPersonSheet(el.dataset.sid, el.dataset.uid); }));
  },
  async respFor(el) {
    if (el.dataset.v === "no") return absageSheet(el.dataset.sid, el.dataset.uid);
    await quiet(busy(el.parentElement, async () => { await S.be.respond(el.dataset.sid, el.dataset.uid, "yes"); await loadSessions(); render(); attPersonSheet(el.dataset.sid, el.dataset.uid); }));
  },
  sessNew() { sessionEditSheet({ session_date: todayIso(), title: "Training", location: ((S.settings.session_template || [])[0] || {}).location || "" }); },
  async sessCancel(el) {
    const on = el.dataset.v === "1";
    if (on && !await ask("Training fällt aus?", "Zu- und Absagen werden gesperrt, das Training zählt nicht in die Statistik.", "Fällt aus")) return;
    await quiet(busy(null, async () => { await S.be.saveSession({ id: el.dataset.id, cancelled: on }); closeSheet(); await reloadSessions(); toast(on ? "Training fällt aus" : "Training findet statt"); }));
  },
  sessEdit(el) { sessionEditSheet(S.sessions.find(x => x.id === el.dataset.id)); },
  async sessDelete(el) {
    if (!await ask("Termin löschen?", "Der Termin und alle Zu-/Absagen dazu werden gelöscht. Wenn das Training nur ausfällt, setze lieber den Haken „Training fällt aus“.", "Löschen", true)) return;
    await quiet(busy(null, async () => { await S.be.deleteSession(el.dataset.id); await reloadSessions(); toast("Termin gelöscht"); }));
  },
  showPast(el) { S.showPast = el.dataset.v !== "0"; render(); },
  tplAdd() { $("#tpl-more").insertAdjacentHTML("beforebegin", templateRow({ dow: 2, time: "", location: "" })); },
  tplRemove(el) { el.closest("[data-row]").remove(); },
  // Konto & Team
  async logout() {
    closeSheet();
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
        profiles: S.profiles.map(p => ({ id: p.id, display_name: p.display_name, email: S.emails[p.id] || null, role: p.role, approved: p.approved, plan_group_id: p.plan_group_id, trains: p.trains ?? null })),
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
      zu_und_absagen: mine, testwerte: S.results.filter(r => r.user_id === S.me.id), wettkaempfe: S.comps.filter(c => c.user_id === S.me.id),
      verletzungen: S.injuries.filter(i => i.user_id === S.me.id), normangaben: infoOf(S.me.id), uebungen_von_mir: S.exercises.filter(e => e.created_by === S.me.id), geraete_einstellungen: prefs
    });
  },
  async update() {
    toast("Suche nach neuer Version …");
    try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); } catch {}
    setTimeout(() => location.reload(), 600);
  },
  demoStart() { LS.set("la_mode", "demo"); boot(); },
  demoHintOk() { LS.set("la_demo_hint_seen", true); render(); },
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

Object.assign(actions, perfActions, {
  goTeam() { S.tab = "settings"; S.moreView = "team"; LS.set("la_tab", S.tab); render(); scrollTo(0, 0); },
  account() {
    const demo = S.be.kind === "demo";
    sheet(`<div class="accthead"><span class="avatar ${role()}">${esc(initials(S.me.display_name))}</span><div><h3 style="margin:0">${esc(S.me.display_name)}</h3>
      <div class="small muted">${ROLE_LABEL[role()]}${S.user.email ? " · " + esc(S.user.email) : ""}</div></div></div>
      <div class="btns col"><button class="btn ghost block" data-act="feedback">Feedback geben</button>
      <button class="btn ghost block" data-act="goAccount">Mein Konto bearbeiten</button>
      ${demo ? `<button class="btn ghost block" data-act="demoExit">Demo beenden</button>` : `<button class="btn ghost block" data-act="demoStart">Demo ansehen (du bleibst angemeldet)</button>`}
      ${demo ? "" : `<button class="btn ghost block" data-act="logout">Abmelden</button>`}
      <button class="btn ghost block" data-act="closeSheet">Schließen</button></div>`);
  },
  feedback() { feedbackSheet(); },
  async fbVote(el) {
    const b = (S.fbBoard || []).find(x => x.id === el.dataset.id); if (!b) return;
    await quiet(busy(el, async () => { await S.be.voteFeedback(b.id, !b.voted); await reloadBoard();
      const box = document.getElementById("fb-board"); if (box) box.innerHTML = fbBoardHtml(); else render(); }));
  },
  fbFilter(el) { S.fbFilter = el.dataset.v; render(); },
  async fbStatus(el) { await quiet(busy(null, async () => { await S.be.saveRow("feedback", { id: el.dataset.id, status: el.dataset.v }); await reloadPerf(); render(); })); },
  async fbReply(el) {
    const f = S.feedback.find(x => x.id === el.dataset.id);
    sheet(`<h3>Antwort</h3><p class="pre small">${esc(f.message)}</p><form data-form="fbReply" data-id="${esc(f.id)}">
      <label class="f"><span>Antwort (sieht die Person in ihren Rückmeldungen)</span><textarea name="note" rows="3" maxlength="1000">${esc(f.admin_note)}</textarea></label>
      <label class="opt"><input type="checkbox" name="done" ${f.status === "erledigt" ? "checked" : ""}><span><b>Als erledigt markieren</b></span></label>
      <div class="btns"><button type="button" class="btn ghost" data-act="closeSheet">Abbrechen</button><button class="btn">Speichern</button></div></form>`);
  },
  async fbDelete(el) {
    const f = S.feedback.find(x => x.id === el.dataset.id), own = f.user_id === S.me.id;
    if (!await ask(own ? "Feedback zurückziehen?" : "Feedback löschen?", "Die Nachricht wird gelöscht.", own ? "Zurückziehen" : "Löschen", true)) return own ? feedbackSheet() : undefined;
    await quiet(busy(null, async () => { await S.be.removeRow("feedback", f.id); await reloadPerf(); render(); if (own && !(S.tab === "settings" && S.moreView === "feedback")) feedbackSheet(); }));
  },
  fbExport() {
    download(`feedback_${stamp()}.json`, S.feedback.map(f => ({ datum: f.created_at, von: (person(f.user_id) || {}).display_name || "", art: FB_CAT[f.category], bereich: f.context, nachricht: f.message, status: f.status, antwort: f.admin_note, version: f.app_version, geraet: f.device })));
  },
  goAccount() { closeSheet(); S.tab = "settings"; S.moreView = "settings"; LS.set("la_tab", S.tab); render(); scrollTo(0, 0); },
  coachAway(el) { absageSheet(el.dataset.id, S.me.id); },
  async coachBack(el) { await quiet(busy(el.parentElement, async () => { await S.be.clearResponse(el.dataset.id, S.me.id); await reloadSessions(); toast("Eingetragen: doch da"); })); },
  async weekOpen(el) {
    const open = el.dataset.open === "1";
    if (!open && !await ask("Anmeldung schließen?", "Athleten können für diese Woche dann nicht mehr zu- oder absagen. Bereits abgegebene Antworten bleiben erhalten.", "Schließen", true)) return;
    await quiet(busy(el.parentElement, async () => { await S.be.openWeek(el.dataset.w, open); await reloadSessions(); toast(open ? "Anmeldung geöffnet" : "Anmeldung geschlossen"); }));
  },
  goSeason() { S.tab = "termine"; S.termView = "season"; LS.set("la_tab", S.tab); render(); scrollTo(0, 0); }
});

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
      IMPORT = Object.assign(r, { file: file.name, week: defaultImportWeek(), prev: [] });
      // Zuordnungen des bisher gültigen Plans übernehmen (gleicher Blattname → gleiche Gruppe und Personen)
      const prevPlan = planForWeek(IMPORT.week);
      if (prevPlan) { try { IMPORT.prev = await sheetsOf(prevPlan); } catch { IMPORT.prev = []; } }
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
Object.assign(changes, perfChanges);
const inputs = {
  fbSimilar(el) { S.fbDraft = el.value; const box = document.getElementById("fb-board"); if (box) box.innerHTML = fbBoardHtml(); },
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
    await S.be.upsert("test_types", tables.test_types || []);
    await S.be.upsert("norms", (tables.norms || []).map(n => Object.assign({}, n, { group_id: mapG(n.group_id) })).filter(n => !n.group_id || Object.values(idMap).includes(n.group_id)));
    await S.be.upsert("athlete_info", (tables.athlete_info || []).filter(keepUser).map(i => Object.assign({}, i, { norm_group_ids: (i.norm_group_ids || []).map(mapG).filter(Boolean) })));
    await S.be.upsert("injuries", (tables.injuries || []).filter(keepUser).map(i => fixRef(i, "created_by")));
    await S.be.upsert("test_results", (tables.test_results || []).filter(keepUser).map(r => fixRef(r, "entered_by")));
    await S.be.upsert("calendar_entries", (tables.calendar_entries || []).map(c => fixRef(c, "created_by")));
    await S.be.upsert("competition_results", (tables.competition_results || []).filter(keepUser).map(c => fixRef(c, "entered_by")));
    await S.be.upsert("week_openings", (tables.week_openings || []).map(w => fixRef(w, "opened_by")));
    await S.be.upsert("feedback", (tables.feedback || []).filter(keepUser));
    await S.be.upsert("attendance_weekly", (tables.attendance_weekly || []).filter(keepUser));
    await S.be.upsert("competition_entries", (tables.competition_entries || []).filter(keepUser));
    await S.be.upsert("plan_sheets", (tables.plan_sheets || []).map(s => Object.assign({}, s, { group_id: mapG(s.group_id), user_ids: (s.user_ids || []).filter(u => known.has(u)) })));
  }
  const rows = data.profiles.slice().sort((a, b) => (b.role === "admin") - (a.role === "admin"));
  for (const p of rows) {
    if (!known.has(p.id)) { r.skipped++; continue; }
    const patch = { display_name: p.display_name, plan_group_id: mapG(p.plan_group_id) };
    if ("trains" in p) patch.trains = p.trains;
    if (p.id !== S.me.id) { patch.role = p.role; patch.approved = p.approved; }
    try { await S.be.updateProfile(p.id, patch); r.people++; } catch { r.skipped++; }
  }
  await refresh();
  toast(`Wiederhergestellt: ${r.people} Personen${r.skipped ? `, ${r.skipped} übersprungen (Konto existiert nicht mehr)` : ""}`);
}

const forms = {
  async sheetAssign(f) {
    const ids = [...f.querySelectorAll("[name=u]:checked")].map(x => x.value);
    await S.be.updateSheet(f.dataset.id, { group_id: f.group.value || null, user_ids: ids });
    delete S.sheetCache[f.dataset.plan]; closeSheet(); await sheetsOf(S.plans.find(p => p.id === f.dataset.plan)); render(); toast("Zuordnung gespeichert");
  },
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
  async myname(f) {
    const patch = { display_name: f.name.value.trim() };
    if (f.trains) patch.trains = f.trains.checked;
    await S.be.updateProfile(S.me.id, patch); await refresh(); toast("Gespeichert");
  },
  async myemail(f) {
    const email = f.email.value.trim(); if (email === S.user.email) return;
    await S.be.changeEmail(email); toast("Bestätigungslink an " + email + " geschickt");
  },
  async regauto(f) {
    const mode = (f.querySelector("[name=mode]:checked") || {}).value;
    const v = mode === "manual" ? null : { dow: Number(f.dow.value) || 7, time: f.time.value || "18:00" };
    S.settings = await S.be.updateSettings({ registration_auto: v }); render(); toast("Gespeichert");
  },
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
      if (id === S.me.id && !await ask(`Eigene ${ROLE_LABEL[p.role]}-Rechte abgeben?`, "Du kannst sie dir danach nicht selbst zurückgeben.", "Abgeben", true)) return;
      patch.role = f.role.value;
    }
    if (f.approved && f.approved.checked !== p.approved) patch.approved = f.approved.checked;
    if (f.trains && f.trains.checked !== trainsP(p)) patch.trains = f.trains.checked;
    if (Object.keys(patch).length) { await S.be.updateProfile(id, patch); await refresh(); toast("Gespeichert"); }
    closeSheet();
  },
  async absage(f) {
    const reason = (f.querySelector("[name=reason]:checked") || {}).value || null, note = f.note.value.trim(), coach = f.dataset.coach === "1";
    if (!reason && !coach) return toast("Bitte wähle einen Grund.", "error");
    if (reason === "sonstiges" && !note && !coach) return toast("Bitte beschreibe kurz den Grund.", "error");
    await S.be.respond(f.dataset.id, f.dataset.user, "no", reason, note);
    await loadSessions(); render();
    if (f.dataset.user !== S.me.id) attPersonSheet(f.dataset.id, f.dataset.user); else { closeSheet(); toast(coach ? "Eingetragen: nicht da" : "Abgesagt"); }
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
      const uids = [...f.querySelectorAll(`[name=u${i}]:checked`)].map(x => x.value);
      sheets.push({ name: p.name, group_id: gid, user_ids: uids, sort_order: i + 1, data: { days: p.days } });
    }
    const p0 = r.plans[0];
    await S.be.savePlan({ valid_from: week, title: f.title.value.trim(), season: p0.season || "", goal: p0.goal || "", source_name: r.file, extra_sheets: [] }, sheets);
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

Object.assign(forms, perfForms);

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (el && actions[el.dataset.act] && !el.disabled) { e.preventDefault(); actions[el.dataset.act](el); }
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});
// Kommt die App aus dem Hintergrund zurück (am Handy oft nach Tagen), Daten neu laden –
// sonst sieht man alte Pläne, Zuordnungen und Termine. Nicht, während ein Dialog offen ist.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.user || !S.me || !S.me.approved) return;
  if (Date.now() - (S.loadedAt || 0) < 120000 || document.querySelector("dialog[open]")) return;
  const scroll = window.scrollY;
  refresh().then(() => window.scrollTo(0, scroll)).catch(() => {});
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
// Direkter Demo-Link: …/la-trainingsgruppe/?demo (als Athlet), ?demo=trainer oder ?demo=admin
function demoFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has("demo")) return;
  const who = { trainer: "u-trainer", admin: "u-admin" }[(q.get("demo") || "").toLowerCase()] || "u1";
  LS.set("la_mode", "demo"); LS.set("la_demo_user", who); LS.del("la_demo_hint_seen");
  history.replaceState(null, "", location.pathname + location.hash);
}
async function boot() {
  demoFromUrl();
  applyPrefs();
  closeSheet();
  S.be = null; S.user = null; S.me = null; S.loadError = null;
  const conn = connection();
  if (LS.get("la_mode", null) === "demo") S.be = makeDemoBackend();
  else if (conn) {
    if (!window.supabase) { $("#app").innerHTML = viewMessage("Fehler", "Die Supabase-Bibliothek konnte nicht geladen werden.", `<button class="btn block" data-act="update">Neu laden</button>`); return; }
    try { S.be = makeSupabaseBackend(conn.url, conn.key); }
    catch (e) { LS.del("la_conn"); toast(deErr(e), "error"); render(); return; }
    const be = S.be;
    S.be.onAuth(async (ev, session) => {
      if (S.be !== be) return; // Demo läuft gerade: echte Anmeldung im Hintergrund ignorieren
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
