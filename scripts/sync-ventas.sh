#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Carga el Excel de ventas desde tu computador a Supabase.
#
# Uso:
#   ./scripts/sync-ventas.sh /ruta/al/archivo.xlsx            # carga de verdad
#   ./scripts/sync-ventas.sh /ruta/al/archivo.xlsx --dry-run  # solo revisa
#
# Las credenciales se leen de .env.sync (en la raíz del repo, NO se commitea).
# Ese archivo debe tener:
#   SUPABASE_URL=https://xxxx.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...
#
# Si además dejas VENTAS_FILE=/ruta/al/archivo.xlsx en .env.sync, puedes correr
# el script sin argumentos — así lo usa la tarea agendada de macOS.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

ENV_FILE="$REPO_DIR/.env.sync"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE con las credenciales." >&2
  echo "Créalo con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver docs/sync-ventas-local.md)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${SUPABASE_URL:?Falta SUPABASE_URL en .env.sync}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Falta SUPABASE_SERVICE_ROLE_KEY en .env.sync}"

# Primer argumento = ruta del archivo; si no viene, se usa VENTAS_FILE del .env.
FILE="${1:-${VENTAS_FILE:-}}"
if [[ -z "$FILE" ]]; then
  echo "Indica el archivo: ./scripts/sync-ventas.sh /ruta/al/archivo.xlsx" >&2
  echo "(o define VENTAS_FILE en .env.sync)" >&2
  exit 1
fi
shift || true

if [[ ! -f "$FILE" ]]; then
  echo "No existe el archivo: $FILE" >&2
  exit 1
fi

echo "Cargando: $FILE"
exec npm run --silent sync:ventas -- --file "$FILE" "$@"
