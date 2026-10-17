"""Genera los fixtures de etl/proyectos/tests/fixtures a partir de la carpeta que deja `python etl/proyectos_probe.py`
(sondeo REAL del 2026-10-17). Son RECORTES de datos reales de los servicios del INE y del SEA, sin modificar.

    python etl/proyectos/tests/make_fixtures.py <carpeta_del_sondeo>
"""
import json
import sys
from pathlib import Path

# cupo por archivo del sondeo (para que cada recorte traiga años, precisiones y tipologías variados)
QUOTA = {"ine_pe": [50, 40, 40, 50, 40, 40, 40], "ine_crf": [80, 60, 60], "seia_eia": [32, 98], "seia_dia": [100, 40]}
SOURCES = {
    "ine_pe": ["sample_ine_pe_2019.geojson", "sample_ine_pe_2012.geojson", "sample_ine_pe_2021.geojson", "sample_ine_pe_2024.geojson",
               "sample_ine_pe_precision_baja.geojson", "sample_ine_pe_precision_nula.geojson", "sample_ine_pe.geojson"],
    "ine_crf": ["sample_ine_crf.geojson", "sample_ine_crf_2015.geojson", "sample_ine_crf_2024.geojson"],
    "seia_eia": ["sample_seia_eia_inmobiliarios.geojson", "sample_seia_eia.geojson"],
    "seia_dia": ["sample_seia_dia_inmobiliarios.geojson", "sample_seia_dia.geojson"],
}
LAYER_OF = {"ine_pe": "ine_pe", "ine_crf": "ine_crf", "seia_eia": "seia_eia", "seia_dia": "seia_dia"}


def main(probe_dir: str) -> None:
    probe = Path(probe_dir)
    out = Path(__file__).resolve().parent / "fixtures"
    report = json.loads((probe / "probe.json").read_text(encoding="utf-8"))
    for key, files in SOURCES.items():
        seen, feats = set(), []
        for fn, quota in zip(files, QUOTA[key]):
            taken = 0
            for f in json.loads((probe / fn).read_text(encoding="utf-8"))["features"]:
                oid = f["properties"]["OBJECTID"]
                if oid not in seen and taken < quota:
                    seen.add(oid)
                    feats.append(f)
                    taken += 1
        feats.sort(key=lambda f: f["properties"]["OBJECTID"])
        (out / f"{key}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        meta = report["capas"][LAYER_OF[key]]["meta"]
        (out / f"meta_{key}.json").write_text(json.dumps({k: meta.get(k) for k in ("name", "geometryType", "maxRecordCount", "editingInfo", "fields", "currentVersion")},
                                                         ensure_ascii=False, indent=1), encoding="utf-8")
        print(key, len(feats))


if __name__ == "__main__":
    main(sys.argv[1])
