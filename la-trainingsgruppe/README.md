# LT DSHS Köln – Trainingsgruppe

App für die Leichtathletik-Trainingsgruppe des Leichtathletik-Teams DSHS Köln.

- **Öffnen:** `https://ole-niederluecke.github.io/Claude-Apps/la-trainingsgruppe/`
- **Einrichtung** (Supabase-Datenbank, einmalig): siehe [`EINRICHTUNG.md`](EINRICHTUNG.md). Ohne Einrichtung gibt es einen Demo-Modus.

## Funktionen
- Konten mit den Rollen Admin, Trainer und Athlet; neue Mitglieder werden freigeschaltet
- Wochenplan-Import aus Excel (.xlsx) mit Archiv; jeder sieht zuerst das Blatt seiner Trainingsgruppe
- Übungssammlung mit Abkürzungen, Beschreibungen und Kurzvideos
- Termine mit Zu- und Absagen; Absagegrund und Verlauf nur für Trainer und Admins
- Testwochen mit Verlauf, Gruppennormen je Geschlecht und Trainingsgruppe, Verletzungsstatus
- Statistik für Trainer: Trainingsbeteiligung und Normabgleich pro Athlet
- Wettkampfergebnisse mit Bestleistungen und Saisonkalender mit Periodisierung
- Hell/Dunkel, Schriftgröße, Backup und Wiederherstellung

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Seitengerüst und Gestaltung |
| `app.js` | App-Logik (Ansichten, Rechte in der Oberfläche, Supabase- und Demo-Anbindung) |
| `xlsx-plan.js` | Liest Excel-Dateien und erkennt die Struktur des Wochenplans |
| `config.js` | Verbindung zum Supabase-Projekt (URL und öffentlicher Schlüssel) |
| `supabase/*.sql` | Datenbank: Tabellen, Rechte-Regeln, Funktionen (der Reihe nach ausführen) |
| `vendor/` | Supabase-Bibliothek (lokal eingebunden) |
| `sw.js` | Offline-Cache der App-Hülle |
| `logo.png`, `icon-*.png`, `apple-touch-icon.png`, `manifest.webmanifest` | Vereinslogo, App-Symbol und Installation |
