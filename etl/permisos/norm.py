"""Normalización de nombres y etiquetas. Es la MISMA función que usa el sembrado de `comunas.name_norm`."""
from __future__ import annotations

import re
import unicodedata

_APOS = "’‘´`"


def norm(value: object) -> str:
    """minúsculas, sin tildes, apóstrofes unificados, espacios colapsados. No hace nada "difuso"."""
    s = unicodedata.normalize("NFKD", str(value))
    s = "".join(c for c in s if not unicodedata.combining(c))
    for ch in _APOS:
        s = s.replace(ch, "'")
    return re.sub(r"\s+", " ", s).strip().lower()


# Etiqueta de REGIÓN que usa el archivo MINVU (normalizada) -> código de región CUT (2 dígitos).
# Explícito y auditable: si el archivo trae una etiqueta que no está aquí, la carga se detiene.
REGION_LABELS: dict[str, str] = {
    norm("Arica y Parinacota"): "15",
    norm("Tarapacá"): "01",
    norm("Antofagasta"): "02",
    norm("Atacama"): "03",
    norm("Coquimbo"): "04",
    norm("Valparaíso"): "05",
    norm("Metropolitana"): "13",
    norm("O'Higgins"): "06",
    norm("Maule"): "07",
    norm("Ñuble"): "16",
    norm("Ñuble (ex-Biobío)"): "16",
    norm("Biobío"): "08",
    norm("La Araucanía"): "09",
    norm("Los Ríos"): "14",
    norm("Los Lagos"): "10",
    norm("Aysén"): "11",
    norm("Magallanes"): "12",
}

NUBLE_LABEL = norm("Ñuble")
NUBLE_EX_BIOBIO_LABEL = norm("Ñuble (ex-Biobío)")

MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
         "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}
