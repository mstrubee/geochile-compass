import pytest

from seia import archive


def test_ida_y_vuelta_conserva_los_bytes_exactos():
    pages = [b'{"features": [{"a": 1.0}]}', b'{ "features":  [] }\n con\nsaltos ', "ñandú".encode()]
    meta = {"layer": "dia", "service_count_before": 3}
    m, back = archive.read_archive(archive.build_archive(meta, pages))
    assert back == pages and m == meta


def test_determinista_y_hash_independiente_de_los_metadatos():
    pages = [b"uno", b"dos"]
    a1 = archive.build_archive({"captured_at": "A"}, pages)
    assert a1 == archive.build_archive({"captured_at": "A"}, pages)                    # mismos bytes (mtime = 0)
    assert a1 != archive.build_archive({"captured_at": "B"}, pages)                    # los metadatos sí cambian el archivo…
    assert archive.content_sha256(pages) == archive.content_sha256(list(pages))        # …pero no el hash del contenido
    assert archive.content_sha256(pages) != archive.content_sha256([b"uno", b"tres"])
    assert archive.content_sha256([b"uno", b"dos"]) != archive.content_sha256([b"dos", b"uno"])    # el orden importa


def test_archivo_truncado_o_sin_meta():
    import gzip
    good = archive.build_archive({"x": 1}, [b"abcdef"])
    raw = gzip.decompress(good)
    with pytest.raises(ValueError):
        archive.read_archive(gzip.compress(raw[:-5]))
    with pytest.raises(ValueError):
        archive.read_archive(gzip.compress(b"PAGE 1\nx\n"))
