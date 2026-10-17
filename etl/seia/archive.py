"""Archivo ORIGINAL de una captura del SEIA: los bytes de cada página tal como los entregó el servicio.

Formato (gzip determinista, mtime = 0):
    META <n>\n<n bytes de JSON>\n
    PAGE <n>\n<n bytes: la respuesta HTTP tal cual>\n   (una por página, en orden)

El SHA-256 del snapshot es el de las PÁGINAS (`content_sha256`), no el del archivo comprimido: el archivo lleva
metadatos de captura (fecha, conteos) que cambian en cada corrida, y recargar el mismo contenido debe ser idempotente.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json


def content_sha256(pages: list[bytes]) -> str:
    h = hashlib.sha256()
    for p in pages:
        h.update(p)
    return h.hexdigest()


def build_archive(meta: dict, pages: list[bytes]) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=6) as gz:
        m = json.dumps(meta, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        gz.write(b"META %d\n" % len(m) + m + b"\n")
        for p in pages:
            gz.write(b"PAGE %d\n" % len(p) + p + b"\n")
    return buf.getvalue()


def read_archive(data: bytes) -> tuple[dict, list[bytes]]:
    raw = gzip.decompress(data)
    pos, meta, pages = 0, None, []
    while pos < len(raw):
        nl = raw.index(b"\n", pos)
        kind, _, n = raw[pos:nl].partition(b" ")
        size = int(n)
        body = raw[nl + 1: nl + 1 + size]
        if len(body) != size or raw[nl + 1 + size: nl + 2 + size] != b"\n":
            raise ValueError("archivo truncado o con formato inválido")
        pos = nl + 2 + size
        if kind == b"META":
            meta = json.loads(body)
        elif kind == b"PAGE":
            pages.append(body)
        else:
            raise ValueError(f"bloque desconocido: {kind!r}")
    if meta is None:
        raise ValueError("el archivo no trae META")
    return meta, pages
