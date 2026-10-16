"""Siembra y verificación de `comunas` (ÚNICA fuente de CUT de la base) y de los alias de nombre.

Fuentes de la siembra (archivos del repo, que el front sigue leyendo tal cual):
  public/codigos_territoriales.csv   346 comunas (CUT como TEXTO de 5 dígitos)
  public/comunas.geojson             345 polígonos (falta 12202 Antártica); 2 inválidos (13110 y 06204)

Las geometrías entran SOLO por public.set_comuna_geometry(): válidas tal cual; inválidas se reparan con
ST_MakeValid (+ ST_CollectionExtract a polígonos), se guarda la ORIGINAL aparte y se deja registro; si el
área reparada difiere más del umbral configurable (1 %) queda 'needs_review'.

`check` compara la base contra esos archivos para que NO queden dos geometrías comunales divergentes.
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

from .norm import norm

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "public" / "codigos_territoriales.csv"
GEOJSON_PATH = ROOT / "public" / "comunas.geojson"
ALIASES_PATH = Path(__file__).with_name("aliases_minvu.json")
MINVU_SOURCES = ("minvu_cedoc_permisos_anual", "minvu_cedoc_permisos_mensual")


def read_csv(path: Path = CSV_PATH) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    cuts = [r["commune_id"] for r in rows]
    if len(rows) != 346 or len(set(cuts)) != 346:
        raise SystemExit(f"{path}: se esperaban 346 comunas únicas y hay {len(rows)} filas / {len(set(cuts))} CUT")
    bad = [c for c in cuts if len(c) != 5 or not c.isdigit()]
    if bad:
        raise SystemExit(f"{path}: CUT que no son de 5 dígitos: {bad[:5]}")
    return rows


def read_geojson(path: Path = GEOJSON_PATH) -> dict[str, dict]:
    with open(path, encoding="utf-8") as f:
        feats = json.load(f)["features"]
    out = {}
    for ft in feats:
        cut = str(ft["properties"]["codigo_comuna"])
        if len(cut) != 5:
            raise SystemExit(f"{path}: codigo_comuna {cut!r} no es de 5 dígitos (¿se perdió un cero a la izquierda?)")
        out[cut] = ft["geometry"]
    return out


def read_aliases(path: Path = ALIASES_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_SAME_GEOM_SQL = """
select exists (
  select 1 from public.comunas c, (select ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) as g) f
   where c.cut = %s
     and ( (c.geom_original is not null and ST_OrderingEquals(f.g, c.geom_original))
        or (c.geom is not null and c.geom_original is null and ST_OrderingEquals(ST_Multi(f.g), c.geom)) ))
"""


def seed(conn, *, dry_run: bool = False) -> dict:
    csv_rows, geoms, aliases = read_csv(), read_geojson(), read_aliases()
    stats = {"comunas_upserted": 0, "geometries_set": 0, "geometries_unchanged": 0, "aliases_upserted": 0, "results": {}}
    with conn.cursor() as cur:
        for r in csv_rows:
            cur.execute("""insert into public.comunas (cut, name, name_norm, region_cut, region_name, province_cut, province_name)
                           values (%s,%s,%s,%s,%s,%s,%s)
                           on conflict (cut) do update set name = excluded.name, name_norm = excluded.name_norm,
                             region_name = excluded.region_name, province_name = excluded.province_name""",
                        (r["commune_id"], r["commune_name"], norm(r["commune_name"]), r["region_id"], r["region_name"],
                         r["province_id"], r["province_name"]))
            stats["comunas_upserted"] += 1
        extra = set(geoms) - {r["commune_id"] for r in csv_rows}
        if extra:
            raise SystemExit(f"public/comunas.geojson trae CUT que no están en codigos_territoriales.csv: {sorted(extra)}")

        for r in csv_rows:
            cut = r["commune_id"]
            g = geoms.get(cut)
            if g is None:
                cur.execute("select geom_status from public.comunas where cut = %s", (cut,))
                if cur.fetchone()[0] != "absent":
                    res = cur.execute("select public.set_comuna_geometry(%s::char(5), null, 'public/comunas.geojson')", (cut,)).fetchone()[0]
                    stats["results"][cut] = res
                    stats["geometries_set"] += 1
                else:
                    stats["geometries_unchanged"] += 1
                continue
            gj = json.dumps(g)
            if cur.execute(_SAME_GEOM_SQL, (gj, cut)).fetchone()[0]:
                stats["geometries_unchanged"] += 1
                continue
            res = cur.execute("select public.set_comuna_geometry(%s::char(5), ST_GeomFromGeoJSON(%s), 'public/comunas.geojson')", (cut, gj)).fetchone()[0]
            if res["status"] != "ok":
                stats["results"][cut] = res
            stats["geometries_set"] += 1

        for a in aliases:
            for sk in MINVU_SOURCES:
                cur.execute("""insert into public.comuna_name_aliases (source_id, raw_region_norm, raw_name_norm, cut, reason, created_by)
                               select id, %s, %s, %s, %s, 'etl/permisos/seed.py' from public.data_sources where source_key = %s
                               on conflict (source_id, raw_region_norm, raw_name_norm) do update set cut = excluded.cut, reason = excluded.reason""",
                            (norm(a["region_label"]), norm(a["name"]), a["cut"], a["reason"], sk))
                stats["aliases_upserted"] += 1
        cur.execute("select count(*), count(geom) from public.comunas")
        total, with_geom = cur.fetchone()
        stats["db_comunas"], stats["db_with_geom"] = total, with_geom
    if dry_run:
        conn.rollback()
    else:
        conn.commit()
    return stats


def check(conn) -> list[str]:
    """Diferencias entre la base y los archivos del repo. Lista vacía = sin divergencia."""
    csv_rows, geoms = read_csv(), read_geojson()
    problems: list[str] = []
    with conn.cursor() as cur:
        cur.execute("select cut, name, region_cut, province_cut from public.comunas")
        db = {r[0]: r for r in cur.fetchall()}
        fcut = {r["commune_id"]: r for r in csv_rows}
        if set(db) != set(fcut):
            problems.append(f"CUT distintos: solo en la base {sorted(set(db) - set(fcut))[:5]}, solo en el CSV {sorted(set(fcut) - set(db))[:5]}")
        for cut, r in fcut.items():
            d = db.get(cut)
            if d and (d[1] != r["commune_name"] or d[2] != r["region_id"] or d[3] != r["province_id"]):
                problems.append(f"{cut}: nombre/región/provincia difieren (base {d[1:]} vs CSV {r['commune_name'], r['region_id'], r['province_id']})")
        for cut in fcut:
            if cut not in db:
                continue
            g = geoms.get(cut)
            if g is None:
                cur.execute("select geom is null from public.comunas where cut = %s", (cut,))
                if not cur.fetchone()[0]:
                    problems.append(f"{cut}: el GeoJSON no tiene polígono pero la base sí")
            elif not cur.execute(_SAME_GEOM_SQL, (json.dumps(g), cut)).fetchone()[0]:
                problems.append(f"{cut}: la geometría de la base NO coincide con public/comunas.geojson")
        cur.execute("select cut, geom_status from public.comunas where geom_status = 'needs_review'")
        for cut, st in cur.fetchall():
            problems.append(f"{cut}: geometría en {st} (revisión manual pendiente)")
    return problems


if __name__ == "__main__":     # uso rápido sin el CLI
    raise SystemExit("Use: python etl/permisos_comunas.py seed|check")
