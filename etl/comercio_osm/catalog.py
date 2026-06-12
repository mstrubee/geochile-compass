"""
catalog.py — Catálogo maestro de marcas comerciales chilenas.

Estructura de cada entrada:
  {
    "marca_estandar": str,   # Nombre canónico que se guarda en la DB
    "categoria":      str,   # supermercado | farmacia | combustible | ...
    "subcategoria":   str,   # hipermercado | express | mayorista | ATM | ...
    "cadena":         str,   # holding/grupo: WalmartChile, Cencosud, SMU ...
    "color":          str,   # HEX para visualización
    "icon":           str,   # Emoji representativo
  }

Estrategia de búsqueda (apply_catalog):
  1. Buscar en brand_tag  (OSM tag "brand")
  2. Buscar en operator   (OSM tag "operator")
  3. Buscar en name       (OSM tag "name")
  Para cada candidato: primero coincidencia exacta, luego substring.
  Las reglas más específicas (más largas) van PRIMERO.
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# Tipo de entrada en el catálogo
# ─────────────────────────────────────────────────────────────────────────────
BrandEntry = dict  # {marca_estandar, categoria, subcategoria, cadena, color, icon}


def _entry(
    marca_estandar: str,
    categoria: str,
    subcategoria: str = "",
    cadena: str = "",
    color: str = "#6B7280",
    icon: str = "📍",
) -> BrandEntry:
    return {
        "marca_estandar": marca_estandar,
        "categoria":      categoria,
        "subcategoria":   subcategoria,
        "cadena":         cadena,
        "color":          color,
        "icon":           icon,
    }


# ─────────────────────────────────────────────────────────────────────────────
# REGLAS ORDENADAS (más específicas primero para evitar falsos positivos)
# Clave: texto en MINÚSCULAS tal como puede aparecer en brand/operator/name OSM
# ─────────────────────────────────────────────────────────────────────────────
_BRAND_RULES: list[tuple[str, BrandEntry]] = [

    # ─── SUPERMERCADOS ────────────────────────────────────────────────────────

    # Walmart Chile / Lider (variantes, más específicas primero)
    ("express de lider",    _entry("Lider Express",  "supermercado", "express",      "WalmartChile", "#0046AD", "🛒")),
    ("express de líder",    _entry("Lider Express",  "supermercado", "express",      "WalmartChile", "#0046AD", "🛒")),
    ("express lider",       _entry("Lider Express",  "supermercado", "express",      "WalmartChile", "#0046AD", "🛒")),
    ("express líder",       _entry("Lider Express",  "supermercado", "express",      "WalmartChile", "#0046AD", "🛒")),
    ("hiper lider",         _entry("Lider",          "supermercado", "hipermercado", "WalmartChile", "#0046AD", "🛒")),
    ("hiperlider",          _entry("Lider",          "supermercado", "hipermercado", "WalmartChile", "#0046AD", "🛒")),
    ("super lider",         _entry("Lider",          "supermercado", "supermercado", "WalmartChile", "#0046AD", "🛒")),
    ("superlider",          _entry("Lider",          "supermercado", "supermercado", "WalmartChile", "#0046AD", "🛒")),
    ("lider",               _entry("Lider",          "supermercado", "supermercado", "WalmartChile", "#0046AD", "🛒")),
    ("líder",               _entry("Lider",          "supermercado", "supermercado", "WalmartChile", "#0046AD", "🛒")),
    ("walmart",             _entry("Lider",          "supermercado", "hipermercado", "WalmartChile", "#0046AD", "🛒")),

    # Cencosud
    ("jumbo",               _entry("Jumbo",          "supermercado", "hipermercado", "Cencosud",     "#E31837", "🛒")),
    ("santa isabel",        _entry("Santa Isabel",   "supermercado", "supermercado", "Cencosud",     "#EF4444", "🛒")),
    ("acuenta",             _entry("Acuenta",        "supermercado", "mayorista",    "Cencosud",     "#F59E0B", "🛒")),
    ("disco",               _entry("Disco",          "supermercado", "supermercado", "Cencosud",     "#EF4444", "🛒")),

    # SMU
    ("mayorista 10",        _entry("Mayorista 10",   "supermercado", "mayorista",    "SMU",          "#1D4ED8", "🛒")),
    ("alvi",                _entry("Alvi",           "supermercado", "mayorista",    "SMU",          "#16A34A", "🛒")),
    ("unimarc",             _entry("Unimarc",        "supermercado", "supermercado", "SMU",          "#0284C7", "🛒")),
    ("super 10",            _entry("Super 10",       "supermercado", "supermercado", "SMU",          "#0369A1", "🛒")),
    ("super10",             _entry("Super 10",       "supermercado", "supermercado", "SMU",          "#0369A1", "🛒")),

    # Falabella (Tottus)
    ("tottus",              _entry("Tottus",         "supermercado", "hipermercado", "Falabella",    "#E11D48", "🛒")),

    # Independientes / otros
    ("el dorado",           _entry("El Dorado",      "supermercado", "supermercado", "",             "#EAB308", "🛒")),
    ("montserrat",          _entry("Montserrat",     "supermercado", "supermercado", "",             "#6B7280", "🛒")),
    ("supercentro",         _entry("Supercentro",    "supermercado", "supermercado", "",             "#6B7280", "🛒")),
    ("super centro",        _entry("Supercentro",    "supermercado", "supermercado", "",             "#6B7280", "🛒")),

    # ─── CONVENIENCIAS ────────────────────────────────────────────────────────
    ("oxxo",                _entry("OXXO",           "conveniencia", "conveniencia", "FEMSA",        "#E31837", "🏪")),
    ("upa",                 _entry("Upa",            "conveniencia", "conveniencia", "",             "#F59E0B", "🏪")),
    ("spid",                _entry("Spid",           "conveniencia", "conveniencia", "",             "#3B82F6", "🏪")),
    ("pronto copec",        _entry("Pronto Copec",   "conveniencia", "conveniencia", "Copec",        "#E31837", "🏪")),
    ("shell heliós",        _entry("Shell Heliós",   "conveniencia", "conveniencia", "Shell",        "#FFCC00", "🏪")),
    ("shell helios",        _entry("Shell Heliós",   "conveniencia", "conveniencia", "Shell",        "#FFCC00", "🏪")),

    # ─── FARMACIAS ────────────────────────────────────────────────────────────
    ("farmacia cruz verde",  _entry("Cruz Verde",    "farmacia",     "farmacia",     "Cruz Verde",   "#00A651", "💊")),
    ("cruz verde",           _entry("Cruz Verde",    "farmacia",     "farmacia",     "Cruz Verde",   "#00A651", "💊")),
    ("farmacia salcobrand",  _entry("Salcobrand",    "farmacia",     "farmacia",     "Salcobrand",   "#E31837", "💊")),
    ("salcobrand",           _entry("Salcobrand",    "farmacia",     "farmacia",     "Salcobrand",   "#E31837", "💊")),
    ("farmacias ahumada",    _entry("Ahumada",       "farmacia",     "farmacia",     "FarmaciasAhumada", "#005BA1", "💊")),
    ("farmacia ahumada",     _entry("Ahumada",       "farmacia",     "farmacia",     "FarmaciasAhumada", "#005BA1", "💊")),
    ("ahumada",              _entry("Ahumada",       "farmacia",     "farmacia",     "FarmaciasAhumada", "#005BA1", "💊")),
    ("fasa",                 _entry("Ahumada",       "farmacia",     "farmacia",     "FarmaciasAhumada", "#005BA1", "💊")),  # nombre anterior
    ("dr. simi",             _entry("Dr. Simi",      "farmacia",     "farmacia",     "Similares",    "#FF6B35", "💊")),
    ("dr simi",              _entry("Dr. Simi",      "farmacia",     "farmacia",     "Similares",    "#FF6B35", "💊")),
    ("doctor simi",          _entry("Dr. Simi",      "farmacia",     "farmacia",     "Similares",    "#FF6B35", "💊")),
    ("farmacia similares",   _entry("Dr. Simi",      "farmacia",     "farmacia",     "Similares",    "#FF6B35", "💊")),
    ("dr. ahorro",           _entry("Dr. Ahorro",    "farmacia",     "farmacia",     "",             "#F59E0B", "💊")),
    ("dr ahorro",            _entry("Dr. Ahorro",    "farmacia",     "farmacia",     "",             "#F59E0B", "💊")),
    ("knop labomed",         _entry("Knop Labomed",  "farmacia",     "farmacia",     "Knop",         "#4F46E5", "💊")),
    ("knop",                 _entry("Knop Labomed",  "farmacia",     "farmacia",     "Knop",         "#4F46E5", "💊")),
    ("farmacenter",          _entry("Farmacenter",   "farmacia",     "farmacia",     "",             "#6B7280", "💊")),
    ("pharmacenter",         _entry("Farmacenter",   "farmacia",     "farmacia",     "",             "#6B7280", "💊")),
    ("farmashop",            _entry("Farmashop",     "farmacia",     "farmacia",     "",             "#6B7280", "💊")),

    # ─── COMBUSTIBLES ─────────────────────────────────────────────────────────
    ("copec",                _entry("Copec",         "combustible",  "gasolinera",   "Copec",        "#E31837", "⛽")),
    ("shell",                _entry("Shell",         "combustible",  "gasolinera",   "Shell",        "#F59E0B", "⛽")),
    ("aramco",               _entry("Aramco",        "combustible",  "gasolinera",   "Aramco",       "#00843D", "⛽")),
    ("esmax",                _entry("Aramco",        "combustible",  "gasolinera",   "Aramco",       "#00843D", "⛽")),  # nombre anterior
    ("total",                _entry("Aramco",        "combustible",  "gasolinera",   "Aramco",       "#00843D", "⛽")),  # nombre anterior anterior
    ("petrobras",            _entry("Petrobras",     "combustible",  "gasolinera",   "Petrobras",    "#FFCC00", "⛽")),
    ("puma energy",          _entry("Puma",          "combustible",  "gasolinera",   "Puma",         "#0284C7", "⛽")),
    ("puma",                 _entry("Puma",          "combustible",  "gasolinera",   "Puma",         "#0284C7", "⛽")),
    ("terpel",               _entry("Terpel",        "combustible",  "gasolinera",   "Terpel",       "#EF4444", "⛽")),
    ("axion",                _entry("Axion",         "combustible",  "gasolinera",   "Axion",        "#6B7280", "⛽")),
    ("gulf",                 _entry("Gulf",          "combustible",  "gasolinera",   "Gulf",         "#F59E0B", "⛽")),
    ("gas sur",              _entry("Gas Sur",       "combustible",  "gasolinera",   "",             "#6B7280", "⛽")),

    # ─── MEJORAMIENTO DEL HOGAR ───────────────────────────────────────────────
    ("sodimac homecenter",  _entry("Sodimac",        "mejoramiento_hogar", "gran_superficie", "Falabella", "#F5821F", "🔨")),
    ("sodimac constructor", _entry("Sodimac",        "mejoramiento_hogar", "gran_superficie", "Falabella", "#F5821F", "🔨")),
    ("sodimac",             _entry("Sodimac",        "mejoramiento_hogar", "gran_superficie", "Falabella", "#F5821F", "🔨")),
    ("easy",                _entry("Easy",           "mejoramiento_hogar", "gran_superficie", "Cencosud",  "#E31837", "🔨")),
    ("construmart",         _entry("Construmart",    "mejoramiento_hogar", "gran_superficie", "",          "#0066CC", "🔨")),
    ("ferretería mts",      _entry("Red MTS",        "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("ferreteria mts",      _entry("Red MTS",        "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("mts ferretería",      _entry("Red MTS",        "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("mts ferreteria",      _entry("Red MTS",        "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("mts",                 _entry("Red MTS",        "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("volter",              _entry("Volter",         "mejoramiento_hogar", "ferreteria",      "RedMTS",    "#7C3AED", "🔨")),
    ("imperial",            _entry("Imperial",       "mejoramiento_hogar", "ferreteria",      "",          "#B45309", "🔨")),
    ("chilemat",            _entry("Chilemat",       "mejoramiento_hogar", "ferreteria",      "",          "#D97706", "🔨")),
    ("ferrosur",            _entry("Ferrosur",       "mejoramiento_hogar", "ferreteria",      "",          "#6B7280", "🔨")),
    ("bix",                 _entry("BIX",            "mejoramiento_hogar", "ferreteria",      "",          "#1D4ED8", "🔨")),
    ("casaideas",           _entry("Casaideas",      "mejoramiento_hogar", "deco_hogar",      "",          "#EC4899", "🏠")),
    ("rosen",               _entry("Rosen",          "mejoramiento_hogar", "muebles",         "",          "#8B5CF6", "🛋️")),
    ("ashley furniture",    _entry("Ashley Furniture","mejoramiento_hogar","muebles",         "Ashley",    "#6B7280", "🛋️")),
    ("abastible",           _entry("Abastible",      "mejoramiento_hogar", "gas",             "Abastible", "#F59E0B", "🔥")),
    ("homecenter",          _entry("Sodimac",        "mejoramiento_hogar", "gran_superficie", "Falabella", "#F5821F", "🔨")),

    # ─── RETAIL DEPARTAMENTAL ─────────────────────────────────────────────────
    ("falabella",           _entry("Falabella",      "retail_departamental", "departamental", "Falabella", "#006633", "🛍️")),
    ("paris",               _entry("Paris",          "retail_departamental", "departamental", "Cencosud",  "#003DA5", "🛍️")),
    ("ripley",              _entry("Ripley",         "retail_departamental", "departamental", "Ripley",    "#6F2C91", "🛍️")),
    ("hites",               _entry("Hites",          "retail_departamental", "departamental", "",          "#005F9E", "🛍️")),
    ("la polar",            _entry("La Polar",       "retail_departamental", "departamental", "",          "#FF6B00", "🛍️")),
    ("lapolar",             _entry("La Polar",       "retail_departamental", "departamental", "",          "#FF6B00", "🛍️")),
    ("johnson's",           _entry("Johnson's",      "retail_departamental", "departamental", "",          "#E11D48", "🛍️")),
    ("johnsons",            _entry("Johnson's",      "retail_departamental", "departamental", "",          "#E11D48", "🛍️")),
    ("johnson",             _entry("Johnson's",      "retail_departamental", "departamental", "",          "#E11D48", "🛍️")),
    ("corona",              _entry("Corona",         "retail_departamental", "departamental", "",          "#B45309", "🛍️")),
    ("tricot",              _entry("Tricot",         "retail_departamental", "ropa",          "",          "#0369A1", "🛍️")),
    ("preunic",             _entry("Preunic",        "retail_departamental", "departamental", "",          "#0284C7", "🛍️")),
    ("miniso",              _entry("Miniso",         "retail_departamental", "bazar",         "Miniso",    "#E31837", "🛍️")),
    ("infanti",             _entry("Infanti",        "retail_departamental", "bebes",         "",          "#60A5FA", "🍼")),
    ("bata",                _entry("Bata",           "retail_departamental", "calzado",       "Bata",      "#D97706", "👟")),
    ("skechers",            _entry("Skechers",       "retail_departamental", "calzado",       "Skechers",  "#111827", "👟")),
    ("nike",                _entry("Nike",           "retail_departamental", "calzado",       "Nike",      "#111827", "👟")),
    ("abc din",             _entry("ABC Din",        "retail_departamental", "ropa",          "",          "#6B7280", "🛍️")),
    ("abcdin",              _entry("ABC Din",        "retail_departamental", "ropa",          "",          "#6B7280", "🛍️")),
    ("zara",                _entry("Zara",           "retail_departamental", "ropa",          "Inditex",   "#111827", "🛍️")),
    ("h&m",                 _entry("H&M",            "retail_departamental", "ropa",          "HM",        "#E31837", "🛍️")),
    ("h & m",               _entry("H&M",            "retail_departamental", "ropa",          "HM",        "#E31837", "🛍️")),

    # ─── BANCOS ───────────────────────────────────────────────────────────────
    ("banco de chile",                _entry("Banco de Chile",  "banco",  "banco",       "BancoChile",  "#E31837", "🏦")),
    ("banco chile",                   _entry("Banco de Chile",  "banco",  "banco",       "BancoChile",  "#E31837", "🏦")),
    ("bancoestado",                   _entry("BancoEstado",     "banco",  "banco",       "BancoEstado", "#003DA5", "🏦")),
    ("banco estado",                  _entry("BancoEstado",     "banco",  "banco",       "BancoEstado", "#003DA5", "🏦")),
    ("banco del estado de chile",     _entry("BancoEstado",     "banco",  "banco",       "BancoEstado", "#003DA5", "🏦")),
    ("caja vecina",                   _entry("BancoEstado",     "banco",  "atm",         "BancoEstado", "#003DA5", "🏦")),
    ("serviestado",                   _entry("BancoEstado",     "banco",  "atm",         "BancoEstado", "#003DA5", "🏦")),
    ("banco santander",               _entry("Santander",       "banco",  "banco",       "Santander",   "#E31837", "🏦")),
    ("santander",                     _entry("Santander",       "banco",  "banco",       "Santander",   "#E31837", "🏦")),
    ("banco de crédito e inversiones",_entry("BCI",             "banco",  "banco",       "BCI",         "#005BA1", "🏦")),
    ("banco de credito e inversiones",_entry("BCI",             "banco",  "banco",       "BCI",         "#005BA1", "🏦")),
    ("banco bci",                     _entry("BCI",             "banco",  "banco",       "BCI",         "#005BA1", "🏦")),
    ("bci",                           _entry("BCI",             "banco",  "banco",       "BCI",         "#005BA1", "🏦")),
    ("banco itaú",                    _entry("Itaú",            "banco",  "banco",       "Itaú",        "#F7931E", "🏦")),
    ("banco itau",                    _entry("Itaú",            "banco",  "banco",       "Itaú",        "#F7931E", "🏦")),
    ("itaú",                          _entry("Itaú",            "banco",  "banco",       "Itaú",        "#F7931E", "🏦")),
    ("itau",                          _entry("Itaú",            "banco",  "banco",       "Itaú",        "#F7931E", "🏦")),
    ("corpbanca",                     _entry("Itaú",            "banco",  "banco",       "Itaú",        "#F7931E", "🏦")),  # fusionado con Itaú
    ("scotiabank",                    _entry("Scotiabank",      "banco",  "banco",       "Scotiabank",  "#E31837", "🏦")),
    ("banco bilbao vizcaya",          _entry("BBVA",            "banco",  "banco",       "BBVA",        "#004481", "🏦")),
    ("bbva",                          _entry("BBVA",            "banco",  "banco",       "BBVA",        "#004481", "🏦")),
    ("banco security",                _entry("Security",        "banco",  "banco",       "Security",    "#0369A1", "🏦")),
    ("security",                      _entry("Security",        "banco",  "banco",       "Security",    "#0369A1", "🏦")),
    ("banco consorcio",               _entry("Consorcio",       "banco",  "banco",       "Consorcio",   "#16A34A", "🏦")),
    ("consorcio",                     _entry("Consorcio",       "banco",  "banco",       "Consorcio",   "#16A34A", "🏦")),
    ("banco bice",                    _entry("BICE",            "banco",  "banco",       "BICE",        "#1D4ED8", "🏦")),
    ("bice",                          _entry("BICE",            "banco",  "banco",       "BICE",        "#1D4ED8", "🏦")),
    ("coopeuch",                      _entry("Coopeuch",        "banco",  "cooperativa", "Coopeuch",    "#15803D", "🏦")),
    ("oriencoop",                     _entry("Oriencoop",       "banco",  "cooperativa", "",            "#15803D", "🏦")),
    ("banco falabella",               _entry("Banco Falabella", "banco",  "banco",       "Falabella",   "#006633", "🏦")),
    ("banco ripley",                  _entry("Banco Ripley",    "banco",  "banco",       "Ripley",      "#6F2C91", "🏦")),
    ("banco internacional",           _entry("Banco Internacional","banco","banco",      "",            "#6B7280", "🏦")),
    ("servipag",                      _entry("Servipag",        "banco",  "servicio",    "Servipag",    "#6B7280", "🏦")),
    ("cajero automático",             _entry("ATM",             "banco",  "atm",         "",            "#6B7280", "🏦")),
    ("cajero automatico",             _entry("ATM",             "banco",  "atm",         "",            "#6B7280", "🏦")),
    ("redbanc",                       _entry("Redbanc",         "banco",  "atm",         "Redbanc",     "#6B7280", "🏦")),

    # ─── RESTAURANTES — Cadenas internacionales ───────────────────────────────
    ("mcdonald's",          _entry("McDonald's",    "restaurante", "comida_rapida", "McDonald's",  "#FFC72C", "🍔")),
    ("mcdonalds",           _entry("McDonald's",    "restaurante", "comida_rapida", "McDonald's",  "#FFC72C", "🍔")),
    ("mcdonald",            _entry("McDonald's",    "restaurante", "comida_rapida", "McDonald's",  "#FFC72C", "🍔")),
    ("burger king",         _entry("Burger King",   "restaurante", "comida_rapida", "Burger King", "#FF8C00", "🍔")),
    ("kfc",                 _entry("KFC",           "restaurante", "comida_rapida", "KFC",         "#E31837", "🍗")),
    ("kentucky fried",      _entry("KFC",           "restaurante", "comida_rapida", "KFC",         "#E31837", "🍗")),
    ("starbucks",           _entry("Starbucks",     "restaurante", "cafeteria",     "Starbucks",   "#00704A", "☕")),
    ("subway",              _entry("Subway",        "restaurante", "comida_rapida", "Subway",      "#009639", "🥪")),
    ("pizza hut",           _entry("Pizza Hut",     "restaurante", "pizzeria",      "Pizza Hut",   "#E31837", "🍕")),
    ("pizza hut chile",     _entry("Pizza Hut",     "restaurante", "pizzeria",      "Pizza Hut",   "#E31837", "🍕")),
    ("dominó",              _entry("Dominó",        "restaurante", "comida_rapida", "Dominó",      "#E31837", "🌭")),
    ("domino",              _entry("Dominó",        "restaurante", "comida_rapida", "Dominó",      "#E31837", "🌭")),
    ("papa john's",         _entry("Papa John's",   "restaurante", "pizzeria",      "Papa John's", "#006633", "🍕")),
    ("papa johns",          _entry("Papa John's",   "restaurante", "pizzeria",      "Papa John's", "#006633", "🍕")),
    ("telepizza",           _entry("Telepizza",     "restaurante", "pizzeria",      "Telepizza",   "#E31837", "🍕")),
    ("dunkin' donuts",      _entry("Dunkin'",       "restaurante", "cafeteria",     "Dunkin'",     "#FF6600", "🍩")),
    ("dunkin donuts",       _entry("Dunkin'",       "restaurante", "cafeteria",     "Dunkin'",     "#FF6600", "🍩")),
    ("dunkin",              _entry("Dunkin'",       "restaurante", "cafeteria",     "Dunkin'",     "#FF6600", "🍩")),

    # ─── RESTAURANTES — Cadenas chilenas ──────────────────────────────────────
    ("little caesars",      _entry("Little Caesars","restaurante", "pizzeria",      "LittleCaesars","#FF6900", "🍕")),
    ("carl's jr",           _entry("Carl's Jr.",    "restaurante", "comida_rapida", "CarlsJr",     "#E31837", "🍔")),
    ("carls jr",            _entry("Carl's Jr.",    "restaurante", "comida_rapida", "CarlsJr",     "#E31837", "🍔")),
    ("under pizza",         _entry("Under Pizza",   "restaurante", "pizzeria",      "UnderPizza",  "#111827", "🍕")),
    ("doggis",              _entry("Doggis",        "restaurante", "comida_rapida", "Doggis",      "#E31837", "🌭")),
    ("juan maestro",        _entry("Juan Maestro",  "restaurante", "comida_rapida", "JuanMaestro", "#F59E0B", "🌭")),
    ("tarragona",           _entry("Tarragona",     "restaurante", "comida_rapida", "Tarragona",   "#B45309", "🌭")),
    ("nuria",               _entry("Nuria",         "restaurante", "cafeteria",     "Nuria",       "#A78BFA", "☕")),
    ("castaño",             _entry("Castaño",       "restaurante", "cafeteria",     "",            "#B45309", "☕")),
    ("california kitchen",  _entry("California Kitchen","restaurante","restaurante","",            "#6B7280", "🍽️")),
    ("la vaca",             _entry("La Vaca",       "restaurante", "restaurante",   "",            "#E31837", "🍽️")),
    ("el rancho",           _entry("El Rancho",     "restaurante", "restaurante",   "",            "#B45309", "🍽️")),
    ("pollo feliz",         _entry("Pollo Feliz",   "restaurante", "comida_rapida", "PolloFeliz",  "#EAB308", "🍗")),
    ("bravissimo",          _entry("Bravissimo",    "restaurante", "comida_rapida", "",            "#E31837", "🍕")),

    # ─── CENTROS COMERCIALES ──────────────────────────────────────────────────
    ("mall plaza",          _entry("Mall Plaza",    "centro_comercial", "mall",  "MallPlaza",   "#C41230", "🏬")),
    ("cenco mall",          _entry("Cenco Mall",    "centro_comercial", "mall",  "Cencosud",    "#003DA5", "🏬")),
    ("cencosud shopping",   _entry("Cenco Mall",    "centro_comercial", "mall",  "Cencosud",    "#003DA5", "🏬")),
    ("vivo",                _entry("Vivo",          "centro_comercial", "mall",  "VivoMall",    "#E31837", "🏬")),
    ("open plaza",          _entry("Open Plaza",    "centro_comercial", "mall",  "OpenPlaza",   "#0046AD", "🏬")),
    ("espacio urbano",      _entry("Espacio Urbano","centro_comercial", "strip", "EspacioUrbano","#F59E0B", "🏬")),
    ("arauco",              _entry("Arauco",        "centro_comercial", "mall",  "InmobiliáriaArauco","#1D4ED8","🏬")),
    ("costanera center",    _entry("Costanera Center","centro_comercial","mall", "InmobiliáriaArauco","#1D4ED8","🏬")),
    ("strip center",        _entry("Strip Center",  "centro_comercial", "strip", "",            "#6B7280", "🏬")),
]

# ─────────────────────────────────────────────────────────────────────────────
# Índice rápido por clave exacta (más rápido que iterar la lista)
# ─────────────────────────────────────────────────────────────────────────────
_EXACT: dict[str, BrandEntry] = {k.lower(): v for k, v in _BRAND_RULES}


def lookup(text: str) -> BrandEntry | None:
    """
    Busca una entrada en el catálogo dado un texto libre.
    1. Coincidencia exacta (O(1))
    2. Subcadena: la regla más larga que aparezca dentro del texto
    Devuelve None si no hay match.
    """
    if not text:
        return None
    lower = text.lower().strip()

    # 1. Exacta
    if lower in _EXACT:
        return _EXACT[lower]

    # 2. Subcadena — la más larga que esté contenida en el texto
    best_key: str | None = None
    best_len  = 0
    for key, entry in _BRAND_RULES:
        if key in lower and len(key) > best_len:
            best_key = key
            best_len = len(key)

    if best_key is not None:
        return _EXACT[best_key]

    return None


def apply_catalog(tags: dict) -> BrandEntry | None:
    """
    Dado el diccionario de tags OSM de un elemento, busca la marca en el
    catálogo probando los campos en orden de prioridad:
      brand → operator → name → brand:en → brand:es
    """
    for field in ("brand", "operator", "name", "brand:en", "brand:es", "official_name"):
        val = tags.get(field, "")
        if val:
            result = lookup(val)
            if result:
                return result
    return None


def all_entries() -> list[tuple[str, BrandEntry]]:
    """Devuelve la lista completa de reglas (para poblar brand_catalog en la DB)."""
    return _BRAND_RULES


# ─────────────────────────────────────────────────────────────────────────────
# Inyección de reglas desde la DB (Piece 2)
# ─────────────────────────────────────────────────────────────────────────────

def override_with_db(db_rows: list[dict]) -> int:
    """
    Recibe filas de brand_catalog (activo=True) y las antepone a las reglas
    Python para que tengan prioridad durante la normalización.

    Cada fila debe tener al menos:
      raw_name, marca_estandar, categoria
    Opcionales:
      subcategoria, color_hex, icon_emoji

    Devuelve el número de reglas DB cargadas.
    """
    global _BRAND_RULES, _EXACT

    if not db_rows:
        return 0

    db_rules: list[tuple[str, BrandEntry]] = []
    for row in db_rows:
        raw = (row.get("raw_name") or "").strip()
        if not raw:
            continue
        entry: BrandEntry = {
            "marca_estandar": row.get("marca_estandar") or raw,
            "categoria":      row.get("categoria") or "",
            "subcategoria":   row.get("subcategoria") or "",
            "cadena":         "",
            "color":          row.get("color_hex")   or "#6B7280",
            "icon":           row.get("icon_emoji")  or "📍",
        }
        db_rules.append((raw.lower(), entry))

    if not db_rules:
        return 0

    # DB primero → mayor prioridad en substring matching
    _BRAND_RULES = db_rules + _BRAND_RULES
    # Reconstruir índice exacto (DB sobrescribe Python si hay colisión de clave)
    _EXACT = {k.lower(): v for k, v in _BRAND_RULES}

    return len(db_rules)
