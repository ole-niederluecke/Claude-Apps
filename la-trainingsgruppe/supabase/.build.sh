#!/bin/sh
# Setzt alles_in_einem.sql aus den Einzeldateien zusammen
cd "$(dirname "$0")"
{ echo "-- Trainingsgruppe App: alle Teile (01–09) in einer Datei"
  echo "-- Einmal komplett im Supabase SQL-Editor ausführen. Geht für die Ersteinrichtung und für jedes Update:"
  echo "-- alle Teile dürfen mehrfach laufen, vorhandene Daten bleiben erhalten."
  echo "-- Diese Datei wird aus 01_…sql bis 09_…sql zusammengesetzt; Änderungen bitte in den Einzeldateien machen."
  for f in 0*.sql; do printf '\n\n-- ═════════════════════════ %s ═════════════════════════\n' "$f"; cat "$f"; done
} > alles_in_einem.sql
