# LT DSHS Köln – Einrichtung

Kurzanleitung für die einmalige Einrichtung. Das ausführliche Handbuch (Rollen, Abläufe, Datenschutz) steht in der App unter **Mehr → Einstellungen → Verwaltung → Handbuch** und ist für Trainer und Admins sichtbar.

## 1. Datenbank (Supabase)
Im Supabase-Projekt links **SQL Editor → New query** öffnen, den kompletten Inhalt von `supabase/alles_in_einem_vNN.sql` (aktuell `alles_in_einem_v10.sql`) einfügen und auf **Run** klicken. Fertig.

Das gilt auch für **jedes Update**: Kommt eine neue Version, einfach wieder die Datei `alles_in_einem_vNN.sql` mit der neuen Nummer komplett ausführen, und zwar **vor** dem Mergen. Die Datei darf beliebig oft laufen. Vorhandene Daten, eigene Tests und Normen bleiben erhalten.

Die Einzeldateien `01_…sql` bis `09_…sql` enthalten dasselbe, nur aufgeteilt nach Themen. Man braucht sie nicht einzeln auszuführen.

## 2. Anmeldung einstellen
Unter **Authentication**:
- **Sign In / Providers → Email:** „Confirm email“ ausschalten (empfohlen) und speichern.
- **URL Configuration:** als *Site URL* und unter *Redirect URLs* `https://ole-niederluecke.github.io/Claude-Apps/la-trainingsgruppe/` eintragen.

## 3. App verbinden
In `config.js` stehen die Project URL und der publishable/anon Key. Beide sind öffentlich und dürfen ins Repo. Der **secret/service_role Key** gehört nie hierher.

## 4. Erstes Konto
Das erste registrierte Konto wird automatisch Admin. Danach registrieren sich Trainer und Athleten selbst und werden in der App unter **Mehr → Team** freigeschaltet.

Admins sind für Athleten unsichtbar und zählen nicht in der Statistik. Wer als Admin auch selbst trainiert, legt ein zweites Konto als Athlet an. Jede E-Mail-Adresse geht nur einmal, bei Gmail landet `name+athlet@gmail.com` aber im selben Postfach wie `name@gmail.com`. Das Passwort darf gleich sein. Das neue Konto dann mit dem Admin-Konto freischalten.

## Demo für andere
Wer die App erst ausprobieren soll, bekommt diesen Link. Er öffnet sofort die Demo mit ausgedachten Daten, ohne Konto:

- als Athlet: `https://ole-niederluecke.github.io/Claude-Apps/la-trainingsgruppe/?demo`
- als Trainer: `…/la-trainingsgruppe/?demo=trainer`

Alles, was man in der Demo ändert, bleibt nur auf dem eigenen Gerät.
