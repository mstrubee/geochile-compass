import sys
from pathlib import Path

import pytest

ETL = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ETL))
sys.dont_write_bytecode = True

from permisos import seed as seedmod                              # noqa: E402
from permisos.parse_minvu import Resolver, parse                  # noqa: E402
from permisos.xlsx_reader import read_workbook                    # noqa: E402

FIX = Path(__file__).parent / "fixtures"
ANUAL = FIX / "minvu_anual_recorte.xlsx"
MENSUAL = FIX / "minvu_mensual_recorte.xlsx"


@pytest.fixture(scope="session")
def comunas():
    return [{"cut": r["commune_id"], "name": r["commune_name"], "region_cut": r["region_id"]} for r in seedmod.read_csv()]


@pytest.fixture(scope="session")
def aliases():
    return seedmod.read_aliases()


@pytest.fixture(scope="session")
def resolver(comunas, aliases):
    return Resolver(comunas, aliases)


@pytest.fixture(scope="session")
def annual(resolver):
    sheets, meta = read_workbook(str(ANUAL))
    return parse(sheets, resolver)


@pytest.fixture(scope="session")
def monthly(resolver):
    sheets, meta = read_workbook(str(MENSUAL))
    return parse(sheets, resolver)


@pytest.fixture
def fresh_sheets():
    """Hojas recién leídas (mutables) para casos negativos."""
    def _read(path):
        return read_workbook(str(path))[0]
    return _read


def col_of(parsed, key):
    return next(c.col for c in parsed.cols if c.key == key)
