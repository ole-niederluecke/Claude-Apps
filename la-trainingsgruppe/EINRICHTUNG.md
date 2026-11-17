# Trainingsgruppe – Einrichtung

Die App läuft wie die Darts-App über GitHub Pages. Damit alle dieselben Daten sehen, braucht sie zusätzlich eine kleine Datenbank bei **Supabase** (kostenlos, Server in Frankfurt). Die Einrichtung dauert etwa 15 Minuten und ist nur einmal nötig.

Ohne Einrichtung lässt sich alles im **Demo-Modus** ausprobieren. Der läuft nur auf dem eigenen Gerät und nutzt Beispielpersonen.

## 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen.
2. **New project**: Name z. B. `trainingsgruppe`, Region **Central EU (Frankfurt)**, ein sicheres Datenbank-Passwort vergeben und gut aufheben.

## 2. Datenbank einrichten
1. Links **SQL Editor** öffnen und **New query** wählen.
2. Den kompletten Inhalt von [`supabase/01_grundlage.sql`](supabase/01_grundlage.sql) einfügen und auf **Run** klicken.
   Damit entstehen die Tabellen, Rollen und Rechte-Regeln. Das Skript darf auch mehrfach laufen.

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
| Freigeschaltete Mitglieder sehen | ✓ | ✓ | ✓ |
| E-Mail-Adressen sehen | | ✓ | ✓ |
| Konten freischalten / sperren, neue ablehnen | | ✓ | ✓ |
| Athleten einer Trainingsgruppe zuordnen | | ✓ | ✓ |
| Trainingsgruppen anlegen, umbenennen, sortieren | | ✓ | ✓ |
| Plan-Sichtbarkeit („alle sehen alles“ / „nur eigener Plan“) | | ✓ | ✓ |
| Rollen vergeben, Teamname, Konten löschen | | | ✓ |
| Backup herunterladen / wiederherstellen | | | ✓ |

Die Rechte werden in der Datenbank selbst geprüft, nicht nur in der App. Wer also nicht berechtigt ist, kann auch mit technischen Tricks nichts ändern. Es muss außerdem immer mindestens einen Admin geben.

## Gut zu wissen
- **Pausierung:** Kostenlose Supabase-Projekte pausieren nach etwa 7 Tagen ohne Nutzung (z. B. in den Ferien). Dann im Supabase-Dashboard auf **Restore** klicken. Daten gehen dabei nicht verloren.
- **Backups:** Die kostenlose Supabase-Stufe macht keine automatischen Backups. Lade deshalb regelmäßig unter **Einstellungen → Admin → Backup herunterladen** eine Sicherung herunter.
- **Updates:** Unter **Einstellungen → Version → Aktualisieren** lädt die App die neueste Version.
