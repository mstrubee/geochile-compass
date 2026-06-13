#!/usr/bin/env python3
"""
kml_to_csv.py — Convierte KML con capas de marcas a registros comercio_poi.

Cada carpeta KML = una marca. Todos los POIs van a categoria "automotriz".
Uso:
  python -m etl.comercio_google.kml_to_csv \
      --kml /ruta/GPlanet.kml /ruta/Servitecas.kml \
      --output /ruta/automotriz.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import xml.etree.ElementTree as ET
from pathlib import Path

KML_NS = "http://www.opengis.net/kml/2.2"

IGNORAR_CARPETAS = {"directorio mayo", "gpwn", "serviteca"}

MARCA_NORMALIZADA: dict[str, str] = {
    "good year":   "Goodyear",
    "good yaer":   "Goodyear",
    "goodyear":    "Goodyear",
    "lub - copec": "Lub Copec",
    "lub":         "Lub Copec",
    "mtc":         "MTC",
    "mtc ":        "MTC",
    "shell helix": "Shell Helix",
    "bosch":       "Bosch Car Service",
    "del pacifico":"Del Pacífico",
    "leon":        "León",
    "autoplanet":  "AutoPlanet",
    "agroplanet":  "Agroplanet",
    "otras":       "Serviteca",
}

FIELDNAMES = [
    "osm_id", "nombre", "marca", "marca_estandar",
    "categoria", "subcategoria", "cadena",
    "direccion", "comuna", "region",
    "latitud", "longitud", "fuente",
]


def _norm_key(text: str) -> str:
    return text.strip().lower()


def _marca_std(folder_name: str) -> str:
    key = _norm_key(folder_name)
    return MARCA_NORMALIZADA.get(key, folder_name.strip().title())


def _parse_coords(coords_text: str) -> tuple[float, float] | None:
    parts = coords_text.strip().split(",")
    if len(parts) < 2:
        return None
    try:
        lng, lat = float(parts[0]), float(parts[1])
        return lat, lng
    except ValueError:
        return None


def _make_id(lat: float, lng: float, marca: str) -> str:
    raw = f"{lat:.6f}_{lng:.6f}_{marca}"
    return "kml_" + hashlib.md5(raw.encode()).hexdigest()[:12]


def _clean_desc(text: str | None) -> str | None:
    if not text:
        return None
    clean = re.sub(r"<[^>]+>", "", text).strip()
    clean = re.sub(r"\s+", " ", clean)
    return clean or None


def parse_kml(path: Path) -> list[dict]:
    tree = ET.parse(path)
    root = tree.getroot()
    ns = {"k": KML_NS}
    records: list[dict] = []

    for folder in root.findall(".//k:Folder", ns):
        fname_el = folder.find("k:name", ns)
        if fname_el is None:
            continue
        folder_name = fname_el.text or ""
        if _norm_key(folder_name) in IGNORAR_CARPETAS:
            continue

        marca_est = _marca_std(folder_name)

        for pm in folder.findall("k:Placemark", ns):
            coords_el = pm.find(".//k:Point/k:coordinates", ns)
            if coords_el is None:
                continue
            coords = _parse_coords(coords_el.text or "")
            if not coords:
                continue
            lat, lng = coords

            name_el = pm.find("k:name", ns)
            nombre = (name_el.text or "").strip() if name_el is not None else ""

            desc_el = pm.find("k:description", ns)
            direccion = _clean_desc(desc_el.text if desc_el is not None else None)

            records.append({
                "osm_id":         _make_id(lat, lng, marca_est),
                "nombre":         nombre or marca_est,
                "marca":          nombre or marca_est,
                "marca_estandar": marca_est,
                "categoria":      "automotriz",
                "subcategoria":   marca_est,
                "cadena":         marca_est,
                "direccion":      direccion,
                "comuna":         None,
                "region":         None,
                "latitud":        round(lat, 7),
                "longitud":       round(lng, 7),
                "fuente":         "kml",
            })

    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kml",    nargs="+", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    all_records: list[dict] = []
    seen_ids: set[str] = set()

    for kml_path in args.kml:
        recs = parse_kml(kml_path)
        for r in recs:
            if r["osm_id"] not in seen_ids:
                seen_ids.add(r["osm_id"])
                all_records.append(r)
        print(f"{kml_path.name}: {len(recs)} POIs")

    from collections import Counter
    by_marca = Counter(r["subcategoria"] for r in all_records)
    print(f"\nTotal: {len(all_records)} POIs únicos\n")
    print("Por marca (subcategoría):")
    for m, n in sorted(by_marca.items(), key=lambda x: -x[1]):
        print(f"  {m:<30} {n:>4}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_records)
    print(f"\nCSV exportado: {args.output}")


if __name__ == "__main__":
    main()
