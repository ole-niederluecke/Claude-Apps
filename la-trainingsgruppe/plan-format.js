// Bringt die Belastungsangaben aus dem Excel-Plan in eine einheitliche, gut lesbare Form.
// Aus den Zeilen unter einer Übung („3x5 p.S“, „P: 6 min“, „Jungs 7,4-7,6s“, „1) Einwurf“ …) wird:
//   main    – der Umfang, groß rechts neben der Übung (z. B. „3 × 5“, „5 × 20 m“, „10 min“, „Max“)
//   tags    – kurze Zusätze als Chips (pro Seite, I.2, Gehpause …)
//   rest    – Pausen (Pause 6 min, Serienpause 10 min)
//   targets – Zielzeiten/-werte je Gruppe oder Person (Jungs → 7,4–7,6 s)
//   steps   – nummerierte Teilübungen
//   notes   – alles Übrige, unverändert
// Läuft im Browser und in Node (für Tests).
(function (root) {
  "use strict";

  const UNIT = "(?:m|km|s|sek|min|kg|cm|wdh|x)";
  // Zahlen, Bereiche und Malzeichen vereinheitlichen
  function tidy(t) {
    return String(t).replace(/\s+/g, " ").trim()
      .replace(/(\d)\s*[x×]\s*(?=\d)/gi, "$1 × ")                // 3x5 → 3 × 5
      .replace(/(\d)\s*[x×](?=\s|$)/gi, "$1 ×")                  // 3x → 3 ×
      .replace(/(\d)\s*-\s*(?=\d)/g, "$1–")                       // 7,4-7,6 → 7,4–7,6
      .replace(/(\d)\s*(m|km|s|min|kg|cm)\b/gi, (m, d, u) => d + " " + u.toLowerCase())   // 20m → 20 m
      .replace(/(\d)\s*(sek)\b/gi, "$1 s")
      .replace(/(\d)\s*'(?!')/g, "$1 min").replace(/(\d)\s*(''|")/g, "$1 s")              // 5' → 5 min, 30'' → 30 s
      .replace(/\s*\/\s*/g, "/");
  }
  // „2 × 5 60 m“ → „2 × 5 × 60 m“ (Serien × Läufe × Strecke)
  const joinSeries = t => t.replace(/^(\d+ × \d+) (\d+(?:[.,]\d+)? (?:m|km))\b/, "$1 × $2");

  function takeRest(line, rest) {
    // SP: 10 / P: 8/6 / P 6 min / P: GP / SP 3min
    return line.replace(/\b(SP|P)\s*[:.]?\s*(GP\b\.?|[\d,./–]+(?:\s*(?:min|s))?)/g, (m, k, v) => {
      v = v.trim().replace(/\.$/, "");
      if (/^GP/i.test(v)) rest.push((k === "SP" ? "Serienpause" : "Pause") + ": Gehpause");
      else rest.push((k === "SP" ? "Serienpause " : "Pause ") + (/(min|s)$/.test(v) ? v : v + " min"));
      return " ";
    });
  }

  const GROUP_RE = /^(jungs|mädels|maedels|männer|frauen|mädchen|alle|m|w)\b/i;
  const looksTarget = v => /\d+[,.]\d|\d\s*s\b|\d\s*kg\b|\(\s*\d/.test(v);

  // „Jungs 15 kg Mädels 5–10 kg“ in einer Zeile → zwei Zielwerte
  function inlineTargets(text, targets) {
    const re = /\b(jungs|mädels|maedels|männer|frauen)\s*:?\s*([\d,.–/ ]+\s*(?:kg|s|m|cm)?)/gi;
    const found = [...text.matchAll(re)];
    if (!found.length) return text;
    const rest = text.replace(re, " ").replace(/[\s()]+/g, " ").trim();
    if (rest) return text;
    found.forEach(m => targets.push({ who: m[1].replace(/^maedels$/i, "Mädels").replace(/^./, c => c.toUpperCase()), value: m[2].trim() }));
    return "";
  }
  const INT_RE = /\s*\bI\.\s?(\d)(\.?\s*langsam)?\b/g;
  const intTag = (d, l) => "Intensität " + d + (l ? " (langsam)" : "");

  function formatRx(details, name) {
    const out = { main: "", tags: [], rest: [], targets: [], steps: [], notes: [] };
    const lines = (details || []).map(String).filter(s => s.trim());
    // Umfang im Übungsnamen („Rumpfstabi 3x45s“, „Treppensprünge 3x“)
    let title = String(name || "").trim();
    const inName = title.match(/^(.*?[A-Za-zÄÖÜäöüß.)])\s+(\d+\s*[x×]\s*[\d,.]*\s*(?:m|s|min|cm|kg)?|\d+\s*[x×])$/i);
    if (inName && !/^\d/.test(inName[1])) { title = inName[1]; out.main = joinSeries(tidy(inName[2])); }
    title = title.replace(INT_RE, (m, d, l) => { out.tags.push(intTag(d, l)); return ""; }).trim();

    for (let raw of lines) {
      let line = tidy(raw);
      // Nummerierte Teilübung: „1) Einwurf“, „2 Kurzer Fuß“
      const st = line.match(/^(\d{1,2})[).]\s*(\D.*)$/) || (out.steps.length && line.match(/^(\d)\s+([A-ZÄÖÜ][a-zäöüß].*)$/));
      if (st) { out.steps.push(st[2].trim()); continue; }
      // Ziel je Gruppe/Person: „Jungs 7,4–7,6 s“, „Jungs(14,0–14.4)“, „Emma/Esther: 26–29 s“
      const grp = line.match(/^([A-ZÄÖÜa-zäöüß]+(?:\/[A-ZÄÖÜ][a-zäöüß]+)*)\s*[:(]?\s*(.+?)\)?$/);
      if (grp && (GROUP_RE.test(grp[1]) || /\//.test(grp[1]) || /:/.test(line)) && looksTarget(grp[2]) && !/^(sp|p)$/i.test(grp[1])) {
        const label = grp[1].replace(/^maedels$/i, "Mädels").replace(/^./, c => c.toUpperCase());
        const val = grp[2].replace(/^(mädels|jungs)\s*:\s*/i, "").replace(/^\(|\)$/g, "").trim();
        out.targets.push({ who: label, value: /\d$/.test(val) && /[,.]\d/.test(val) && !/kg|m\b/.test(val) ? val + " s" : val });
        continue;
      }
      line = takeRest(line, out.rest);
      line = line.replace(/\bp\.?\s?S\.?(?=\s|$)/g, () => { out.tags.push("pro Seite"); return " "; })
                 .replace(INT_RE, (m, d, l) => { out.tags.push(intTag(d, l)); return " "; })
                 .replace(/\bGP\b\.?/g, () => { out.tags.push("Gehpause"); return " "; })
                 .replace(/\bZWL\b/g, () => { out.tags.push("Zugwiderstand"); return " "; })
                 .replace(/\(\s*\/\s*/g, "(").replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
      if (!line) continue;
      // Zielzeiten ohne Gruppe: „20,6/27,5/45,5“
      if (/^\(?[\d,./– ]+\)?$/.test(line) && /\d,\d|\d\.\d/.test(line) && (out.main || out.rest.length)) { out.targets.push({ who: "Ziel", value: line.replace(/[()]/g, "") + " s" }); continue; }
      // Zeit „0:15“ → 15 min, „Min 10“ → mind. 10 min
      line = line.replace(/^0:(\d{2})$/, (m, mm) => Number(mm) + " min")
                 .replace(/^min\.?\s*(\d+)(?:\s*min)?\b/i, "mind. $1 min")
                 .replace(/^max\.?$/i, "Max");
      // „3 ×“ allein (Versuche) ergänzt den Umfang: „max“ + „3x“ → „3 × Max“
      if (/^\d+ ×$/.test(line)) { out.main = out.main ? line + " " + out.main : line; continue; }
      const vol = line.match(/^(\d+ × [a-zäöüß][a-zäöüß/]{1,19}$|(?:mind\. )?\d[\d,./–]*(?: × [\d,./–+]+)*(?: [\d,./–]+)?(?: (?:m|km|s|min|kg|cm|wdh))?|Max)(?:\s+(.*))?$/i);
      if (vol && !out.main) {
        out.main = joinSeries(vol[1]);
        if (vol[2]) {
          // Rest der Zeile: Einheit „Würfe“, Hinweis in Klammern …
          const rest = inlineTargets(vol[2].replace(/^\((.*)\)$/, "$1"), out.targets);
          if (!rest) continue;
          if (/^[a-zäöüß]+$/i.test(rest) && rest.length <= 12) out.main += " " + rest; else out.notes.push(rest);
        }
        continue;
      }
      line = inlineTargets(line, out.targets);
      if (line) out.notes.push(line.replace(/^\((.*)\)$/, "$1"));
    }
    // Hürdenhöhen: „76/76/84/84“ → „Höhen: 76/76/84/84 cm“
    if (/hürde/i.test(title)) out.notes = out.notes.map(n => /^\d{2,3}(\/\d{2,3})+$/.test(n) ? "Höhen: " + n + " cm" : n);
    out.tags = [...new Set(out.tags)];
    out.title = title;
    return out;
  }

  const api = { formatRx, tidy };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlanFormat = api;
})(typeof self !== "undefined" ? self : this);
