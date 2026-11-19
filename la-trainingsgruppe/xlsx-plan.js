// Liest .xlsx-Dateien (ohne fremde Bibliothek) und erkennt die Struktur eines Wochenplans.
// Läuft im Browser und in Node (für Tests). Benötigt DecompressionStream (alle aktuellen Browser).
(function (root) {
  "use strict";

  /* ───────── ZIP ───────── */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Die Datei ist keine gültige Excel-Datei (.xlsx).");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {}, dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
      const start = off + 30 + lnlen + lelen;
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: n => n in files,
      async text(n) {
        const f = files[n]; if (!f) return null;
        const raw = f.method === 0 ? f.data : f.method === 8 ? await inflateRaw(f.data) : null;
        if (!raw) throw new Error("Nicht unterstütztes Kompressionsverfahren in der Datei.");
        return dec.decode(raw);
      }
    };
  }

  /* ───────── XML (maschinell erzeugt, daher reichen einfache Muster) ───────── */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const unxml = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
  const attr = (tag, name) => { const m = tag.match(new RegExp("\\s" + name + '="([^"]*)"')); return m ? unxml(m[1]) : null; };
  const texts = xml => { let out = ""; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (_, t) => { out += unxml(t); }); return out; };

  function colIndex(ref) { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

  const TIME_IDS = new Set([18, 19, 20, 21, 45, 46, 47]), DATE_IDS = new Set([14, 15, 16, 17, 22]);
  function fmtNumber(v) {
    const n = Number(Number(v).toPrecision(12));
    return String(n).replace(".", ",");
  }
  function fmtTime(v) {
    const total = Math.round((Number(v) % 1) * 24 * 60);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }
  function fmtDate(v) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v) * 86400000));
    return String(d.getUTCDate()).padStart(2, "0") + "." + String(d.getUTCMonth() + 1).padStart(2, "0") + "." + d.getUTCFullYear();
  }

  async function readXlsx(buf) {
    const z = await unzip(buf);
    if (!z.has("xl/workbook.xml")) throw new Error("Die Datei ist keine Excel-Arbeitsmappe. Bitte als .xlsx speichern bzw. exportieren.");
    const wb = await z.text("xl/workbook.xml");
    const rels = (await z.text("xl/_rels/workbook.xml.rels")) || "";
    const relMap = {};
    rels.replace(/<Relationship\b[^>]*>/g, t => { relMap[attr(t, "Id")] = attr(t, "Target"); });
    const shared = [];
    const ss = await z.text("xl/sharedStrings.xml");
    if (ss) ss.replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(texts(si)); });
    // Zahlenformate: welche Stil-Indizes sind Uhrzeiten / Datumswerte?
    const styleKind = [];
    const st = await z.text("xl/styles.xml");
    if (st) {
      const custom = {};
      st.replace(/<numFmt\b[^>]*>/g, t => { custom[attr(t, "numFmtId")] = attr(t, "formatCode") || ""; });
      const xfs = (st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ""])[1];
      xfs.replace(/<xf\b[^>]*>/g, t => {
        const id = Number(attr(t, "numFmtId") || 0), code = (custom[id] || "").toLowerCase().replace(/"[^"]*"|\[[^\]]*\]/g, "");
        let kind = "";
        if (TIME_IDS.has(id) || (/[hs]/.test(code) && !/[dy]/.test(code))) kind = "time";
        else if (DATE_IDS.has(id) || /[dy]/.test(code)) kind = "date";
        styleKind.push(kind);
      });
    }
    const sheets = [];
    const tags = wb.match(/<sheet\b[^>]*>/g) || [];
    for (const t of tags) {
      const name = attr(t, "name"), rid = attr(t, "r:id");
      let target = relMap[rid] || "";
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const xml = await z.text(target);
      if (!xml) continue;
      const rows = [];
      xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, a, inner) => {
        const ref = attr(" " + a, "r"); if (!ref || inner == null) return;
        const r = Number(ref.match(/\d+/)[0]) - 1, c = colIndex(ref);
        const type = attr(" " + a, "t"), s = Number(attr(" " + a, "s") || 0);
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/), v = vm ? unxml(vm[1]) : null;
        let out = "";
        if (type === "s") out = shared[Number(v)] ?? "";
        else if (type === "inlineStr") out = texts(inner);
        else if (type === "str" || type === "e") out = v ?? "";
        else if (type === "b") out = v === "1" ? "WAHR" : "FALSCH";
        else if (v != null && v !== "") out = styleKind[s] === "time" ? fmtTime(v) : styleKind[s] === "date" ? fmtDate(v) : fmtNumber(v);
        out = String(out).replace(/\s+$/g, "").replace(/^\s+/g, "");
        if (!out) return;
        (rows[r] = rows[r] || [])[c] = out;
      });
      const width = Math.max(0, ...rows.filter(Boolean).map(r => r.length));
      const grid = [];
      for (let i = 0; i < rows.length; i++) { const r = rows[i] || []; grid.push(Array.from({ length: width }, (_, j) => r[j] || "")); }
      while (grid.length && grid[grid.length - 1].every(x => !x)) grid.pop();
      sheets.push({ name: name.trim(), rows: grid });
    }
    return sheets;
  }

  /* ───────── Plan-Struktur ───────── */
  const DAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"];
  const dayOf = s => { const t = String(s || "").trim().toLowerCase().replace(/[.:]/g, ""); const i = DAYS.findIndex(d => t === d || (t.length >= 2 && d.startsWith(t) && t.length <= 3)); return i; };
  const TIME_RE = /\b\d{1,2}[:.]\d{2}\b/;
  const STATUS_RE = /^(pause|regeneration|optional|frei|ruhetag)\b/i;

  // Zeilen, die eine Belastungsangabe zur Übung darüber sind (3x5, max, Min 10, P: 6 min, Jungs 7,4-7,6s …)
  function isDetail(s) {
    const t = s.trim();
    // Übungen, die mit einer Zahl beginnen: "5er Hop", "10er SPL", "30m fliegend", "60m Hürden"
    if (/^\d+er\b/i.test(t) || /^\d+\s?m\s+(fliegend|aus|sprint|steigerung|tief|hürde|huerde|start)/i.test(t)) return false;
    // Nummerierte Übung: "1b. Drop Jump", "2a) Kniebeuge"
    if (/^\d+[a-z][.)]\s*[a-zäöüß]{3,}/i.test(t)) return false;
    if (/^(\d|\(|min\b|max\b|p\s*[:.]|sp\s*[:.]|sp\s+\d|i\.\s*\d|ggf\b|je\b|pro\b|ca\.?\s*\d)/i.test(t)) return true;
    // Zielzeiten/Abstände: "Jungs 7,4-7,6s", "Name/ Name: 26-29s", "Abstände Eng (1,7-1,8m)"
    const numeric = /\d+[,.]\d+/.test(t) || /\d\s*s\b/.test(t);
    if (numeric && t.length <= 60 && (/^(jungs|mädels|maedels|männer|frauen|alle|abstände|zeiten|ziel)/i.test(t) || /:/.test(t))) return true;
    if (/^\d{1,2}:\d{2}$/.test(t)) return true;
    return false;
  }

  function structureSheet(sheet) {
    const rows = sheet.rows;
    let hr = -1, cols = {};
    for (let r = 0; r < Math.min(rows.length, 30) && hr < 0; r++) {
      const found = {};
      rows[r].forEach((v, c) => { const d = dayOf(v); if (d >= 0 && !(d in found)) found[d] = c; });
      if (Object.keys(found).length >= 4) { hr = r; cols = found; }
    }
    if (hr < 0) return { kind: "extra", name: sheet.name, rows };
    // Kopf: Saison, Gruppe, Ziel
    const head = [];
    for (let r = 0; r < hr; r++) rows[r].forEach(v => { if (v) head.push(v); });
    let goal = "", season = head[0] || "";
    const zi = head.findIndex(v => /^ziel\s*:?$/i.test(v) || /^ziel\s*:/i.test(v));
    if (zi >= 0) {
      const own = head[zi].replace(/^ziel\s*:?\s*/i, "");
      goal = [own, ...head.slice(zi + 1)].filter(Boolean).join(" · ");
      if (zi === 0) season = "";
    }
    const subtitle = head.slice(1, zi >= 0 ? zi : head.length).join(" · ");
    const days = [];
    // Gibt es eine Zeile für Ort/Uhrzeit/Status direkt unter den Wochentagen?
    const TIME_OR_STATUS = v => v && (TIME_RE.test(v) || STATUS_RE.test(v));
    const hasInfoRow = Object.values(cols).some(c => TIME_OR_STATUS((rows[hr + 1] || [])[c]));
    for (let d = 0; d < 7; d++) {
      const c = cols[d];
      const day = { day: d, info: "", title: "", titleDetails: [], items: [] };
      if (c == null) { days.push(day); continue; }
      const cells = [];
      for (let r = hr + 1; r < rows.length; r++) cells.push({ r, v: (rows[r][c] || "").trim() });
      // Zeile direkt unter dem Wochentag: Ort/Uhrzeit oder Status; die Zeile darunter: Tagesthema.
      // Steht in der Themenzeile nichts, hat der Tag kein Thema (bzw. der Status „Pause“/„Regeneration“ ist das Thema).
      let i = 0;
      const first = cells[0] && cells[0].v, second = cells[1] && cells[1].v;
      const infoLike = v => v && (TIME_RE.test(v) || STATUS_RE.test(v) || /^[A-ZÄÖÜ]{2,5}\b/.test(v) && v.length <= 25);
      if (first && infoLike(first) && (second || hasInfoRow)) {
        day.info = first; i = 1;
        if (!second && hasInfoRow) { if (STATUS_RE.test(first)) { day.title = first; day.info = ""; } i = 2; }
      } else if (!first) {
        i = 1;
        if (hasInfoRow && !second) i = 2;
      }
      if (!day.title && i <= 1) {
        while (i < cells.length && !cells[i].v) i++;
        if (i < cells.length && !isDetail(cells[i].v)) { day.title = cells[i].v; i++; }
      }
      let cur = null, gap = false;
      for (; i < cells.length; i++) {
        const v = cells[i].v;
        if (!v) { gap = true; continue; }
        if (v.length < 2 && !/\d/.test(v)) continue;   // verirrte Einzelbuchstaben
        if (cur && isDetail(v)) { cur.details.push(v); }
        else if (!cur && day.title && isDetail(v)) { (day.titleDetails = day.titleDetails || []).push(v); }
        else { cur = { text: v.replace(/\s*:\s*$/, ""), details: [] }; if (gap && day.items.length) cur.gap = true; day.items.push(cur); }
        gap = false;
      }
      days.push(day);
    }
    return { kind: "plan", name: sheet.name, season, subtitle, goal, days };
  }

  async function parsePlanFile(buf) {
    const sheets = await readXlsx(buf);
    const out = { plans: [], extras: [] };
    for (const s of sheets) {
      if (!s.rows.length) continue;
      if (/^(anleitung|hinweise?|readme|info)$/i.test(s.name.trim())) continue;   // Erklärblatt der Vorlage
      const st = structureSheet(s);
      (st.kind === "plan" ? out.plans : out.extras).push(st);
    }
    if (!out.plans.length) throw new Error("In der Datei wurde kein Wochenplan gefunden (eine Zeile mit Montag … Sonntag).");
    return out;
  }

  // Abkürzungsblatt → [{abbreviation, name}]
  function abbreviationsFrom(extra) {
    const list = [];
    for (const r of extra.rows) {
      const [a, b] = [r[0] || "", r[1] || ""];
      if (a && b && a.length <= 30 && b.length > a.length) list.push({ abbreviation: a.trim(), name: b.trim() });
    }
    return list;
  }

  const api = { readXlsx, structureSheet, parsePlanFile, abbreviationsFrom, isDetail };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.XlsxPlan = api;
})(typeof self !== "undefined" ? self : this);
