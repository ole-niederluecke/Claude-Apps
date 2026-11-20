#!/bin/sh
# Setzt alles_in_einem_vNN.sql aus den Einzeldateien zusammen.
# Bei jeder Änderung an einer SQL-Datei: SQL_VERSION um 1 erhöhen und in app.js REQUIRED_SQL anpassen.
SQL_VERSION=10
cd "$(dirname "$0")"
rm -f alles_in_einem.sql alles_in_einem_v*.sql
out="alles_in_einem_v$SQL_VERSION.sql"
{ echo "-- Trainingsgruppe App: Datenbank, Stand $SQL_VERSION (alle Teile 01–09 in einer Datei)"
  echo "-- Einmal komplett im Supabase SQL-Editor ausführen. Geht für die Ersteinrichtung und für jedes Update:"
  echo "-- alle Teile dürfen mehrfach laufen, vorhandene Daten bleiben erhalten."
  echo "-- Diese Datei wird aus 01_…sql bis 09_…sql zusammengesetzt; Änderungen bitte in den Einzeldateien machen."
  for f in 0*.sql; do printf '\n\n-- ═════════════════════════ %s ═════════════════════════\n' "$f"; cat "$f"; done
  printf '\n\n-- ═════════════════════════ Stand ═════════════════════════\n'
  echo "-- Die App liest diese Nummer und zeigt dem Admin, wenn ein Update fehlt."
  echo "create or replace function public.sql_version() returns int language sql immutable as \$\$ select $SQL_VERSION \$\$;"
  echo "grant execute on function public.sql_version() to anon, authenticated;"
} > "$out"
echo "$out"
