#!/usr/bin/env python3
"""Genera los fixtures REALES recortados a partir de los dos XLSX originales de MINVU CEDOC.

No son datos sintéticos: son los valores originales, sin modificar. Se recorta por COLUMNAS (se conservan
todas las filas: 'Total País', subtotales regionales, las 367 filas de comuna y las notas), así los cuadres
con 'Total País' siguen valiendo en cada columna elegida.

  python etl/permisos/tests/make_fixtures.py --annual <anual.xlsx> --monthly <mensual.xlsx>

Originales (publicados el 2026-09-11):
  anual   SHA-256 158af0e4af401a909b6d30dfb4860b1f77c7a608c35c67d42a0bb2503b4705b7
  mensual SHA-256 5f9a63ac993ea217aa4495224d54d29713dc5ebb787704fe211b7d575bd94e6c
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).parent / "fixtures"
SHEETS = ("número_total", "m2_total", "número_departamentos", "m2_departamentos", "número_casas", "m2_casas")
FIRST_DATA_ROW, LAST_COMUNA_ROW = 8, 393          # Total País .. última comuna (los originales)
NOTE_ROWS = (395, 396, 397, 398)
EXPECTED_SHA = {"anual": "158af0e4af401a909b6d30dfb4860b1f77c7a608c35c67d42a0bb2503b4705b7",
                "mensual": "5f9a63ac993ea217aa4495224d54d29713dc5ebb787704fe211b7d575bd94e6c"}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def columns(ws):
    """-> [(col, year, month|None, header_text)] según las filas 6 y 7 del original."""
    out, year, text = [], None, ""
    for c in range(3, ws.max_column + 1):
        h, m = ws.cell(6, c).value, ws.cell(7, c).value
        if h is not None:
            year, text = int(re.match(r"\s*(\d{4})", str(h)).group(1)), str(h)
        if m is None and h is None:
            continue
        out.append((c, year, None if m is None else str(m), text))
    return out


def build(src, dst, keep, junk_row=None):
    wb_in = openpyxl.load_workbook(src, data_only=True)
    wb_out = openpyxl.Workbook()
    wb_out.remove(wb_out.active)
    for name in SHEETS:
        ws_i, ws_o = wb_in[name], wb_out.create_sheet(name)
        cols = [x for x in columns(ws_i) if keep(x)]
        # encabezado: año (con su marca) en la primera columna de su bloque; meses en la fila 7
        ws_o.cell(6, 1, ws_i.cell(6, 1).value); ws_o.cell(6, 2, ws_i.cell(6, 2).value)
        seen_year = None
        for j, (c, y, m, text) in enumerate(cols, start=3):
            if y != seen_year:
                ws_o.cell(6, j, ws_i.cell(6, c).value if ws_i.cell(6, c).value is not None else text)
                seen_year = y
            if m is not None:
                ws_o.cell(7, j, m)
        for r in range(FIRST_DATA_ROW, LAST_COMUNA_ROW + 1):
            for col in (1, 2):
                ws_o.cell(r, col, ws_i.cell(r, col).value)
            for j, (c, *_rest) in enumerate(cols, start=3):
                ws_o.cell(r, j, ws_i.cell(r, c).value)
        first_note_col = None
        for r in NOTE_ROWS:
            ws_o.cell(r, 2, ws_i.cell(r, 2).value)
            for c in range(3, ws_i.max_column + 1):
                v = ws_i.cell(r, c).value
                if isinstance(v, str):
                    ws_o.cell(r, 3, v)          # el texto de la nota va en la primera columna de datos
                    break
        if junk_row and name == "m2_casas":
            ws_o.cell(junk_row, 1, None)       # fuerza la 'dimensión basura' (65.536 filas) del original
            ws_o.cell(junk_row, 2, " ")
    wb_out.properties.modified = wb_in.properties.modified
    wb_out.properties.creator = wb_in.properties.creator
    wb_out.save(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--annual", required=True)
    ap.add_argument("--monthly", required=True)
    a = ap.parse_args()
    for k, p in (("anual", a.annual), ("mensual", a.monthly)):
        if sha(p) != EXPECTED_SHA[k]:
            sys.exit(f"El SHA-256 del archivo {k} no es el esperado ({EXPECTED_SHA[k]}): ¿es otra publicación?")
    HERE.mkdir(exist_ok=True)
    # anual: años 2002, 2003, 2017, 2018, 2024, 2025 + los 7 meses de 2026
    build(a.annual, HERE / "minvu_anual_recorte.xlsx",
          lambda x: (x[2] is None and x[1] in (2002, 2003, 2017, 2018, 2024, 2025)) or (x[2] is not None and x[1] == 2026))
    # mensual: todos los meses de 2017, 2018, 2024, 2025 y 2026 (ene-jul)
    build(a.monthly, HERE / "minvu_mensual_recorte.xlsx", lambda x: x[1] in (2017, 2018, 2024, 2025, 2026), junk_row=65536)
    for p in sorted(HERE.glob("*.xlsx")):
        print(p.name, p.stat().st_size, "bytes", sha(p))


if __name__ == "__main__":
    main()
