#!/usr/bin/env python3
"""
reclasificar_csv.py — Re-procesa el CSV de extracción con el catálogo actualizado.

Lee el CSV generado por el ETL, re-aplica el catálogo vigente a cada fila,
filtra solo las cadenas reconocidas (marca_estandar != "Otros"), y exporta
un CSV limpio listo para subir a Supabase.

Uso:
  python -m etl.comercio_google.reclasificar_csv \
      --input /ruta/comercio_google_extract.csv \
      --output /ruta/cadenas_clasificadas.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from etl.comercio_osm import catalog

FIELDNAMES = [
    "osm_id", "nombre", "marca", "marca_estandar",
    "categoria", "subcategoria", "cadena",
    "direccion", "comuna", "region",
    "latitud", "longitud", "fuente",
]


def reclasificar(input_path: Path, output_path: Path) -> None:
    with open(input_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    resultado: list[dict] = []
    stats: Counter = Counter()

    for row in rows:
        nombre = row.get("nombre", "").strip()
        tags = {"name": nombre, "brand": nombre}
        entry = catalog.apply_catalog(tags)

        if not entry:
            stats["sin_match"] += 1
            continue

        stats[entry["categoria"]] += 1
        resultado.append({
            "osm_id":         row["osm_id"],
            "nombre":         nombre or None,
            "marca":          nombre or None,
            "marca_estandar": entry["marca_estandar"],
            "categoria":      entry["categoria"],
            "subcategoria":   entry.get("subcategoria") or None,
            "cadena":         entry.get("cadena") or None,
            "direccion":      row.get("direccion") or None,
            "comuna":         row.get("comuna") or None,
            "region":         row.get("region") or None,
            "latitud":        row.get("latitud"),
            "longitud":       row.get("longitud"),
            "fuente":         "google",
        })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(resultado)

    print(f"Total input:   {len(rows):>6}")
    print(f"Sin match:     {stats['sin_match']:>6}  (genéricos — excluidos)")
    print(f"Cadenas:       {len(resultado):>6}")
    print()
    print("Por categoría:")
    for cat, n in sorted(stats.items(), key=lambda x: -x[1]):
        if cat != "sin_match":
            print(f"  {cat:<30} {n:>5}")
    print(f"\nCSV exportado: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    reclasificar(args.input, args.output)


if __name__ == "__main__":
    main()
