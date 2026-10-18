#!/usr/bin/env bash
# Reproduce, en una sesión nueva, el entorno de pruebas de «Inteligencia territorial de salud» y confirma la LÍNEA BASE de main.
#
#   bash etl/salud/dev_env.sh                # prepara lo que falte (idempotente) y corre la línea base
#   bash etl/salud/dev_env.sh --skip-check   # solo prepara
#   bash etl/salud/dev_env.sh --reset-dbs    # recrea las 3 bases de prueba desde cero
#
# Qué hace (cada paso se salta si ya está hecho):
#   1. PostGIS por apt con fuentes https TEMPORALES y el proxy del entorno solo por línea de comandos (NO toca /etc/apt).
#   2. Clúster Postgres local FUERA del repo (por defecto /var/tmp/geochile-pgtest, puerto 5433).
#   3. venv FUERA del repo (por defecto /var/tmp/geochile-venv) con etl/requirements.txt.
#   4. `npm install --no-save` (`npm ci` falla en main: package-lock desincronizado, DISENO de permisos §12). No escribe package*.json.
#   5. Tres bases *test* con stub + migraciones + comunas sembradas (etl/permisos_comunas.py seed).
#   6. Corre los comandos de la línea base y compara los números. Sale con código 1 si algo no coincide o si cambió un archivo versionado.
#
# Nunca desactiva TLS ni quita HTTPS_PROXY: solo anula NO_PROXY en el comando de pip/npm/apt que lo necesita.
# No imprime variables de entorno ni credenciales. Variables opcionales: SALUD_PGDIR, SALUD_PGPORT, SALUD_VENV, SALUD_FORCE_APT=1.
# SALUD_EXTERNAL_PG=1: usa un PostgreSQL+PostGIS que YA corre en 127.0.0.1:$SALUD_PGPORT (p. ej. el docker compose del plan B,
# docs/salud/planb/docker-compose.yml) y se salta los pasos 1 y 2. Requiere psql/pg_isready en el PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGDIR="${SALUD_PGDIR:-/var/tmp/geochile-pgtest}"
PGPORT="${SALUD_PGPORT:-5433}"
VENV="${SALUD_VENV:-/var/tmp/geochile-venv}"
PGVER="$(ls /usr/lib/postgresql 2>/dev/null | sort -n | tail -1 || true)"; PGVER="${PGVER:-16}"
PGBIN="/usr/lib/postgresql/${PGVER}/bin"
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres)
SKIP_CHECK=0; RESET_DBS=0
for a in "$@"; do case "$a" in --skip-check) SKIP_CHECK=1;; --reset-dbs) RESET_DBS=1;; *) echo "opción desconocida: $a" >&2; exit 2;; esac; done

# LÍNEA BASE (medida en main, commit 9026d67). Un PR no puede empeorarla; si cambia, se actualiza AQUÍ y se explica en el PR.
BASE_VITEST_TESTS=472; BASE_VITEST_FILES=34
BASE_PERMISOS_PASS=43; BASE_PERMISOS_SKIP=4; BASE_PROYECTOS_PASS=45
BASE_SQL_P12=92; BASE_SQL_PARTE4_GEO=111; BASE_SQL_PARTE4_NODES=7

log() { printf '\n== %s\n' "$*"; }
need_root() { [ "$(id -u)" = 0 ] || { echo "este paso necesita root (apt/initdb como postgres)" >&2; exit 1; }; }
as_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$*"; else sudo -u postgres sh -c "$*"; fi; }
no_proxy_bypass() { env -u NO_PROXY -u no_proxy -u npm_config_noproxy "$@"; }   # solo para el comando que lo necesita

# ---------------------------------------------------------------------------------------------------------------- 1. PostGIS
ensure_postgis() {
  log "1. PostGIS (postgresql-${PGVER}-postgis-3)"
  if [ -n "${SALUD_EXTERNAL_PG:-}" ]; then echo "SALUD_EXTERNAL_PG=1: se usa el PostgreSQL ya levantado; paso omitido"; return; fi
  if dpkg -s "postgresql-${PGVER}-postgis-3" >/dev/null 2>&1 && [ -z "${SALUD_FORCE_APT:-}" ]; then echo "ya instalado"; return; fi
  need_root
  local tmp codename proxy; tmp="$(mktemp -d)"; codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  mkdir -p "$tmp/parts"
  cat > "$tmp/ubuntu.sources" <<EOF
Types: deb
URIs: https://archive.ubuntu.com/ubuntu/
Suites: ${codename} ${codename}-updates ${codename}-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://security.ubuntu.com/ubuntu/
Suites: ${codename}-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
  proxy="${HTTPS_PROXY:-DIRECT}"
  local opts=(-o "Dir::Etc::sourcelist=$tmp/ubuntu.sources" -o "Dir::Etc::sourceparts=$tmp/parts" -o "Acquire::https::Proxy=$proxy" -o "Acquire::http::Proxy=DIRECT")
  apt-get "${opts[@]}" update
  DEBIAN_FRONTEND=noninteractive apt-get "${opts[@]}" install -y --no-install-recommends "postgresql-${PGVER}-postgis-3"
  rm -rf "$tmp"
}

# ---------------------------------------------------------------------------------------------------------------- 2. clúster
ensure_cluster() {
  log "2. Clúster Postgres en $PGDIR (puerto $PGPORT)"
  if [ -n "${SALUD_EXTERNAL_PG:-}" ]; then
    command -v psql >/dev/null && command -v pg_isready >/dev/null || { echo "faltan psql/pg_isready en el PATH" >&2; exit 1; }
    pg_isready -h 127.0.0.1 -p "$PGPORT" || { echo "no hay PostgreSQL en 127.0.0.1:$PGPORT (¿docker compose up -d --wait?)" >&2; exit 1; }
    "${PSQL[@]}" -d postgres -Atc "select 'PostGIS disponible: ' || default_version from pg_available_extensions where name = 'postgis'" | grep -q PostGIS || { echo "ese PostgreSQL no tiene la extensión postgis" >&2; exit 1; }
    return
  fi
  [ -x "$PGBIN/initdb" ] || { echo "falta $PGBIN/initdb (¿postgresql-${PGVER} instalado?)" >&2; exit 1; }
  need_root
  case "$PGDIR" in "$ROOT"*) echo "el clúster NO puede vivir dentro del repo: $PGDIR" >&2; exit 1;; esac
  mkdir -p "$PGDIR"; chown postgres:postgres "$PGDIR"; chmod 700 "$PGDIR"
  [ -f "$PGDIR/data/PG_VERSION" ] || as_postgres "$PGBIN/initdb -D $PGDIR/data -A trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
    as_postgres "$PGBIN/pg_ctl -D $PGDIR/data -l $PGDIR/pg.log -o '-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGDIR' -w start" >/dev/null
  fi
  pg_isready -h 127.0.0.1 -p "$PGPORT"
}

# ---------------------------------------------------------------------------------------------------------------- 3. Python
ensure_venv() {
  log "3. venv Python en $VENV"
  case "$VENV" in "$ROOT"*) echo "el venv NO puede vivir dentro del repo: $VENV" >&2; exit 1;; esac
  [ -x "$VENV/bin/python" ] || python3 -m venv --system-site-packages "$VENV"
  local stamp="$VENV/.requirements.sha256" want; want="$(sha256sum "$ROOT/etl/requirements.txt" | cut -d' ' -f1)"
  if [ "$(cat "$stamp" 2>/dev/null || true)" = "$want" ] && "$VENV/bin/python" -c 'import pytest, psycopg, shapely, openpyxl' 2>/dev/null; then echo "dependencias al día"; return; fi
  no_proxy_bypass "$VENV/bin/pip" install -q -r "$ROOT/etl/requirements.txt"
  echo "$want" > "$stamp"
}

# ---------------------------------------------------------------------------------------------------------------- 4. Node
ensure_node() {
  log "4. node_modules (npm install --no-save)"
  local stamp="$ROOT/node_modules/.salud-lock.sha256" want; want="$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)"
  if [ -x "$ROOT/node_modules/.bin/vitest" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$want" ]; then echo "node_modules al día"; return; fi
  (cd "$ROOT" && no_proxy_bypass npm install --no-save >/dev/null)
  echo "$want" > "$stamp"
}

# ---------------------------------------------------------------------------------------------------------------- 5. bases
db_ready() { [ "$("${PSQL[@]}" -d "$1" -Atc 'select count(*) from public.comunas' 2>/dev/null || echo 0)" = 346 ]; }
build_db() {   # build_db <nombre> <migraciones...>
  local db="$1"; shift
  "${PSQL[@]}" -d postgres -q -c "drop database if exists $db" -c "create database $db" 2>&1 | grep -v NOTICE || true
  "${PSQL[@]}" -d "$db" -q -v ON_ERROR_STOP=1 -c 'create extension if not exists postgis' -f "$ROOT/supabase/tests/permits_stub_esquema_minimo.sql" >/dev/null 2>&1
  for m in "$@"; do "${PSQL[@]}" -d "$db" -q -v ON_ERROR_STOP=1 -1 -f "$m" >/dev/null 2>&1 || { echo "FALLA la migración $m en $db" >&2; exit 1; }; done   # -1: las migraciones necesitan transacción
  SUPABASE_DB_URL="postgresql://postgres@127.0.0.1:$PGPORT/$db" PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" -B "$ROOT/etl/permisos_comunas.py" seed >/dev/null
  db_ready "$db" || { echo "la siembra de comunas en $db no dejó 346 comunas" >&2; exit 1; }
}
ensure_dbs() {
  log "5. Bases de prueba (stub + migraciones + comunas)"
  local all=("$ROOT"/supabase/migrations/2026102*.sql)                                  # 7 migraciones: partes 1, 2, 3 y 4
  local p12=("$ROOT/supabase/migrations/20261020120000_permits_provenance.sql" "$ROOT/supabase/migrations/20261020120100_building_permit_statistics.sql")
  for spec in "geochile_test:all" "geochile_sql_test:all" "geochile_p12_test:p12"; do
    local db="${spec%%:*}" set="${spec##*:}"
    if [ "$RESET_DBS" = 0 ] && db_ready "$db"; then echo "$db: lista (346 comunas)"; continue; fi
    echo "$db: construyendo…"; if [ "$set" = all ]; then build_db "$db" "${all[@]}"; else build_db "$db" "${p12[@]}"; fi
  done
}

# ---------------------------------------------------------------------------------------------------------------- 6. línea base
FAILS=0
cmp_eq() { # cmp_eq <suite> <obtenido> <esperado>
  if [ "$2" = "$3" ]; then printf '  OK     %-34s %s\n' "$1" "$2"; else printf '  FALLA  %-34s obtenido=%s esperado=%s\n' "$1" "$2" "$3"; FAILS=$((FAILS+1)); fi
}
sql_ok() { # sql_ok <db> <archivo> -> nº de aserciones 'ok' (0 si el archivo falla)
  local out; out="$("${PSQL[@]}" -d "$1" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/$2" 2>&1)" || { echo 0; return; }
  grep -c 'NOTICE:  ok ' <<<"$out" || true
}
run_baseline() {
  log "6. Línea base de main"
  cd "$ROOT"
  local out
  out="$(VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=dummy-key npm test 2>&1 || true)"     # variables FALSAS solo en este comando
  cmp_eq "Vitest (tests)" "$(grep -oE 'Tests +[0-9]+ passed' <<<"$out" | grep -oE '[0-9]+' | head -1)" "$BASE_VITEST_TESTS"
  cmp_eq "Vitest (archivos)" "$(grep -oE 'Test Files +([0-9]+ failed \| )?[0-9]+ passed' <<<"$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')" "$BASE_VITEST_FILES"
  local url="postgresql://postgres@127.0.0.1:$PGPORT/geochile_test" pyout
  pyout="$(TEST_DATABASE_URL="$url" PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" -m pytest etl/permisos/tests -q -p no:cacheprovider 2>&1 || true)"
  cmp_eq "pytest etl/permisos (pasan)" "$(grep -oE '[0-9]+ passed' <<<"$pyout" | grep -oE '[0-9]+')" "$BASE_PERMISOS_PASS"
  cmp_eq "pytest etl/permisos (omitidos)" "$(grep -oE '[0-9]+ skipped' <<<"$pyout" | grep -oE '[0-9]+' || echo 0)" "$BASE_PERMISOS_SKIP"
  pyout="$(TEST_DATABASE_URL="$url" PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" -m pytest etl/proyectos/tests -q -p no:cacheprovider 2>&1 || true)"
  cmp_eq "pytest etl/proyectos (pasan)" "$(grep -oE '[0-9]+ passed' <<<"$pyout" | grep -oE '[0-9]+')" "$BASE_PROYECTOS_PASS"
  cmp_eq "SQL permits_stats.test (base 1+2)" "$(sql_ok geochile_p12_test permits_stats.test.sql)" "$BASE_SQL_P12"
  cmp_eq "SQL parte4_geo.test" "$(sql_ok geochile_sql_test parte4_geo.test.sql)" "$BASE_SQL_PARTE4_GEO"
  cmp_eq "SQL parte4_nodes.test" "$(sql_ok geochile_sql_test parte4_nodes.test.sql)" "$BASE_SQL_PARTE4_NODES"
  # no forman parte de la línea base de main; se informan aparte
  if [ -d etl/salud/tests ]; then
    pyout="$(PYTHONDONTWRITEBYTECODE=1 "$VENV/bin/python" -m pytest etl/salud/tests -q -p no:cacheprovider 2>&1 || true)"
    printf '  INFO   %-34s %s\n' "pytest etl/salud (nuevo)" "$(tail -1 <<<"$pyout")"
  fi
  echo "  (SQL api_quota, layer_nodes, layer_nodes_edit, layer_import, legacy_retired: NO corren en local; ver docs/salud/HALLAZGOS_FASE0.md §8)"
  local dirty; dirty="$(git status --short | grep -v '^??' || true)"
  if [ -n "$dirty" ]; then echo "  FALLA  hay archivos versionados modificados:"; echo "$dirty"; FAILS=$((FAILS+1)); else echo "  OK     git: ningún archivo versionado cambió"; fi
}

ensure_postgis; ensure_cluster; ensure_venv; ensure_node; ensure_dbs
if [ "$SKIP_CHECK" = 0 ]; then run_baseline; [ "$FAILS" = 0 ] && echo -e "\nLÍNEA BASE: todo coincide." || { echo -e "\nLÍNEA BASE: $FAILS diferencia(s)."; exit 1; }; else echo -e "\nEntorno listo (sin comprobar la línea base)."; fi
