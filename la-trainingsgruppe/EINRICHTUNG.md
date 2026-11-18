# LT DSHS Köln – Einrichtung

Kurzanleitung für die einmalige Einrichtung. Das ausführliche Handbuch (Rollen, Abläufe, Datenschutz) steht in der App unter **Mehr → Einstellungen → Admin → Admin-Handbuch** und ist nur für Admins sichtbar.

## 1. Datenbank (Supabase)
Im Supabase-Projekt links **SQL Editor → New query** öffnen. Die Dateien aus `supabase/` der Reihe nach einfügen und jeweils auf **Run** klicken:

1. `01_grundlage.sql`
2. `02_plan_termine.sql`
3. `03_leistung.sql`
4. `04_anmeldung.sql`
5. `05_feedback.sql`
6. `06_planzuordnung_statistik.sql`
7. `07_wettkampfmeldung.sql`

Alle Skripte dürfen auch mehrfach laufen. Kommt mit einem Update eine neue Datei dazu, wird sie **vor** dem Mergen genauso ausgeführt.

## 2. Anmeldung einstellen
Unter **Authentication**:
- **Sign In / Providers → Email:** „Confirm email“ ausschalten (empfohlen) und speichern.
- **URL Configuration:** als *Site URL* und unter *Redirect URLs* `https://ole-niederluecke.github.io/Claude-Apps/la-trainingsgruppe/` eintragen.

## 3. App verbinden
In `config.js` stehen die Project URL und der publishable/anon Key. Beide sind öffentlich und dürfen ins Repo. Der **secret/service_role Key** gehört nie hierher.

## 4. Erstes Konto
Das erste registrierte Konto wird automatisch Admin. Danach registrieren sich Trainer und Athleten selbst und werden in der App unter **Mehr → Team** freigeschaltet.
