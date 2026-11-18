# LT DSHS Köln – Einrichtung

Die App läuft wie die Darts-App über GitHub Pages. Damit alle dieselben Daten sehen, braucht sie zusätzlich eine kleine Datenbank bei **Supabase** (kostenlos, Server in Frankfurt). Die Einrichtung dauert etwa 15 Minuten und ist nur einmal nötig.

Ohne Einrichtung lässt sich alles im **Demo-Modus** ausprobieren. Der läuft nur auf dem eigenen Gerät und nutzt Beispielpersonen.

## 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen.
2. **New project**: Name z. B. `trainingsgruppe`, Region **Central EU (Frankfurt)**, ein sicheres Datenbank-Passwort vergeben und gut aufheben.

## 2. Datenbank einrichten
Links **SQL Editor** öffnen und **New query** wählen. Dort nacheinander ausführen:
1. Den kompletten Inhalt von [`supabase/01_grundlage.sql`](supabase/01_grundlage.sql) einfügen und auf **Run** klicken. Das legt Konten, Rollen und Rechte an.
2. Danach in einer neuen Abfrage [`supabase/02_plan_termine.sql`](supabase/02_plan_termine.sql) einfügen und auf **Run** klicken. Das legt Wochenpläne, Übungssammlung, Termine, Zu-/Absagen und den Speicher für Übungsvideos an.
3. Danach [`supabase/03_leistung.sql`](supabase/03_leistung.sql) genauso ausführen. Das legt Testwochen, Normen, Verletzungen, Wettkampfergebnisse und den Saisonkalender an. Die Tests aus der Testwoche und die Gruppenvoraussetzungen (30m fliegend, 80m, 300m, Standweitsprung) sind schon eingetragen.

Beide Skripte dürfen auch mehrfach laufen. Kommen später neue Teile dazu (`03_…`), werden sie genauso ausgeführt.

## 3. Anmeldung einstellen
Unter **Authentication**:
- **Sign In / Providers → Email**: **Confirm email ausschalten** (empfohlen).
  Neue Konten muss ohnehin ein Trainer oder Admin freischalten. Außerdem darf der kostenlose Supabase-Mailversand nur wenige Mails pro Stunde verschicken. Die Bestätigungsmails würden diese Grenze schnell aufbrauchen und dann fehlen, wenn jemand sein Passwort vergessen hat.
- **URL Configuration**:
  - *Site URL*: `https://ole-niederluecke.github.io/Claude-Apps/la-trainingsgruppe/`
  - *Redirect URLs*: dieselbe Adresse hinzufügen.
  Dorthin führen die Links in den Mails zum Zurücksetzen des Passworts.

## 4. App verbinden
Unter **Project Settings → API** (bzw. **API Keys**) stehen:
- **Project URL**, z. B. `https://abcdxyz.supabase.co`
- **anon / publishable key**, ein langer Schlüssel

Beide Werte in [`config.js`](config.js) eintragen (oder Claude schicken, dann trägt Claude sie ein). Sie sind öffentlich und dürfen ins Repo, denn geschützt werden die Daten durch die Regeln aus Schritt 2.
**Den `service_role`- bzw. `secret`-Schlüssel niemals weitergeben oder eintragen.**

## 5. Erste Anmeldung
1. **Du registrierst dich als Erste/r.** Das erste Konto wird automatisch **Admin**. Das sollte direkt nach Schritt 4 passieren, bevor jemand anderes den Link bekommt.
2. Danach registrieren sich Trainer und Athleten selbst über den Link zur App.
3. Neue Konten erscheinen unter **Team → Wartet auf Freischaltung**. Dort schaltest du sie frei und ordnest sie einer Trainingsgruppe zu.
4. Deinem Trainer gibst du unter **Team → Name antippen → Rolle** die Rolle **Trainer**.

## Rollen
| | Athlet | Trainer | Admin |
|---|:-:|:-:|:-:|
| Eigenes Profil, Darstellung, Passwort | ✓ | ✓ | ✓ |
| Wochenplan ansehen (je nach Einstellung alle Blätter oder nur das eigene) | ✓ | ✓ | ✓ |
| Zu- und Absagen für sich selbst | ✓ | ✓ | ✓ |
| Sehen, wer zu- oder abgesagt hat | ✓ | ✓ | ✓ |
| Übungen anlegen, eigene bearbeiten | ✓ | ✓ | ✓ |
| Absagegründe und Verlauf (wer hat sich umentschieden) sehen | | ✓ | ✓ |
| „Zu spät“ / „nicht erschienen“ markieren, für andere zu-/absagen | | ✓ | ✓ |
| Wochenplan hochladen, Termine anlegen/absagen, feste Trainingstage | | ✓ | ✓ |
| Alle Übungen bearbeiten und löschen | | ✓ | ✓ |
| Eigene Testwerte sehen, Krafttests selbst eintragen | ✓ | ✓ | ✓ |
| Eigene Wettkampfergebnisse eintragen, Ergebnisse der Gruppe sehen | ✓ | ✓ | ✓ |
| Saisonkalender (Phasen, Wettkämpfe, Testwochen) ansehen | ✓ | ✓ | ✓ |
| Sprint- und Sprungtests eintragen, alle Testwerte sehen | | ✓ | ✓ |
| Statistik: Trainingsbeteiligung und Normabgleich aller Athleten | | ✓ | ✓ |
| Normen und Tests pflegen, Geschlecht/Gruppen für Normen setzen | | ✓ | ✓ |
| Verletzungen eintragen (befreit von Training und/oder Tests) | | ✓ | ✓ |
| Saisonkalender pflegen | | ✓ | ✓ |
| Freigeschaltete Mitglieder sehen | ✓ | ✓ | ✓ |
| E-Mail-Adressen sehen | | ✓ | ✓ |
| Konten freischalten / sperren, neue ablehnen | | ✓ | ✓ |
| Athleten einer Trainingsgruppe zuordnen | | ✓ | ✓ |
| Trainingsgruppen anlegen, umbenennen, sortieren | | ✓ | ✓ |
| Plan-Sichtbarkeit („alle sehen alles“ / „nur eigener Plan“) | | ✓ | ✓ |
| Rollen vergeben, Teamname, Konten löschen | | | ✓ |
| Backup herunterladen / wiederherstellen | | | ✓ |

Die Rechte werden in der Datenbank selbst geprüft, nicht nur in der App. Wer also nicht berechtigt ist, kann auch mit technischen Tricks nichts ändern. Es muss außerdem immer mindestens einen Admin geben.

## Wochenplan hochladen
- In Excel als `.xlsx` speichern, in Numbers über **Ablage → Exportieren → Excel**.
- In der App unter **Plan → Neuen Plan hochladen** die Datei wählen, die Woche festlegen und jedem Blatt eine Trainingsgruppe zuordnen. Für neue Blätter (z. B. Alternativpläne) kann direkt eine neue Gruppe angelegt werden.
- Erkannt wird jedes Blatt mit einer Zeile „Montag … Sonntag“. Darunter stehen pro Tag Ort und Uhrzeit, das Tagesthema und die Übungen, jeweils mit der Belastung in der Zeile darunter.
- Ein Blatt „Abkürzungen“ wird in die Übungssammlung übernommen. Weitere Blätter (Übungen, Turnhalle …) erscheinen unter dem Plan.
- Ein Plan gilt ab seiner Woche, bis ein neuerer hochgeladen wird. Ältere Pläne stehen im **Archiv**.

## Testwochen und Normen
- Unter **Leistung → Eintragen** wählt der Trainer Test und Datum und trägt die Werte der ganzen Gruppe in einem Rutsch ein. Zeiten über 60 s gehen als `1:52,30`, beim 5er Hop links und rechts getrennt (es zählt das bessere Bein).
- Krafttests (1RM in kg, bei Klimmzug und Dips das Zusatzgewicht) trägt jeder unter **Leistung → Meine Werte** selbst ein.
- Normen gelten je Geschlecht und auf Wunsch nur für eine Trainingsgruppe. Wer in Kurz- und Langsprint mittrainiert, bekommt im Athletenprofil (Leistung → Übersicht → Name) beide Gruppen. Dort steht auch, ob die Normen der Jungs oder Mädels gelten.
- Verletzungen trägt der Trainer im Athletenprofil ein und legt jeweils fest, ob sie von der Trainingsbeteiligung und/oder von den Tests befreien.

## Gut zu wissen
- **Videos:** Kurzvideos zu Übungen bis 50 MB. Die kostenlose Supabase-Stufe hat 1 GB Speicher, das reicht für einige Dutzend kurze Clips. Alternativ geht ein Link zu YouTube oder Instagram. Videos sind nicht im Backup enthalten.
- **Pausierung:** Kostenlose Supabase-Projekte pausieren nach etwa 7 Tagen ohne Nutzung (z. B. in den Ferien). Dann im Supabase-Dashboard auf **Restore** klicken. Daten gehen dabei nicht verloren.
- **Backups:** Die kostenlose Supabase-Stufe macht keine automatischen Backups. Lade deshalb regelmäßig unter **Einstellungen → Admin → Backup herunterladen** eine Sicherung herunter.
- **Updates:** Unter **Einstellungen → Version → Aktualisieren** lädt die App die neueste Version.
