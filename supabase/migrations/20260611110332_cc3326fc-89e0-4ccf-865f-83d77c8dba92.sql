CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.brand_catalog (
    id              SERIAL       PRIMARY KEY,
    raw_name        TEXT         NOT NULL,
    marca_estandar  TEXT         NOT NULL,
    categoria       TEXT         NOT NULL,
    subcategoria    TEXT,
    color_hex       TEXT         DEFAULT '#6B7280',
    icon_emoji      TEXT         DEFAULT '📍',
    activo          BOOLEAN      DEFAULT TRUE,
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_catalog_raw_lower
    ON public.brand_catalog (LOWER(raw_name));

CREATE TABLE IF NOT EXISTS public.comercio_poi (
    id                  BIGSERIAL    PRIMARY KEY,
    osm_id              TEXT         NOT NULL,
    osm_type            TEXT         NOT NULL  CHECK (osm_type IN ('node','way','relation')),
    nombre              TEXT,
    marca               TEXT,
    marca_estandar      TEXT,
    categoria           TEXT         NOT NULL,
    subcategoria        TEXT,
    cadena              TEXT,
    direccion           TEXT,
    comuna              TEXT,
    region              TEXT,
    codigo_region       TEXT,
    latitud             DOUBLE PRECISION,
    longitud            DOUBLE PRECISION,
    geom                GEOMETRY(Point, 4326),
    tags                JSONB        DEFAULT '{}',
    fuente              TEXT         DEFAULT 'osm',
    osm_version         INTEGER,
    fecha_actualizacion TIMESTAMPTZ  DEFAULT NOW(),
    fecha_creacion      TIMESTAMPTZ  DEFAULT NOW(),
    eliminado           BOOLEAN      DEFAULT FALSE,
    fecha_eliminacion   TIMESTAMPTZ,
    UNIQUE (osm_id)
);
CREATE INDEX IF NOT EXISTS idx_cpoi_geom            ON public.comercio_poi USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_cpoi_categoria       ON public.comercio_poi (categoria)              WHERE NOT eliminado;
CREATE INDEX IF NOT EXISTS idx_cpoi_marca_estandar  ON public.comercio_poi (marca_estandar)         WHERE NOT eliminado;
CREATE INDEX IF NOT EXISTS idx_cpoi_cat_marca       ON public.comercio_poi (categoria, marca_estandar) WHERE NOT eliminado;
CREATE INDEX IF NOT EXISTS idx_cpoi_osm_id          ON public.comercio_poi (osm_id);
CREATE INDEX IF NOT EXISTS idx_cpoi_comuna          ON public.comercio_poi (comuna)                 WHERE NOT eliminado;
CREATE INDEX IF NOT EXISTS idx_cpoi_region          ON public.comercio_poi (region)                 WHERE NOT eliminado;
CREATE INDEX IF NOT EXISTS idx_cpoi_nombre_trgm     ON public.comercio_poi USING GIN (nombre gin_trgm_ops) WHERE NOT eliminado;

CREATE TABLE IF NOT EXISTS public.comercio_poi_sync_log (
    id                      SERIAL       PRIMARY KEY,
    sync_start              TIMESTAMPTZ  DEFAULT NOW(),
    sync_end                TIMESTAMPTZ,
    registros_nuevos        INTEGER      DEFAULT 0,
    registros_actualizados  INTEGER      DEFAULT 0,
    registros_eliminados    INTEGER      DEFAULT 0,
    registros_sin_cambio    INTEGER      DEFAULT 0,
    total_osm_features      INTEGER      DEFAULT 0,
    error                   TEXT,
    status                  TEXT         DEFAULT 'running'
        CHECK (status IN ('running','ok','error'))
);

GRANT SELECT ON public.brand_catalog          TO anon, authenticated;
GRANT SELECT ON public.comercio_poi           TO anon, authenticated;
GRANT SELECT ON public.comercio_poi_sync_log  TO anon, authenticated;
GRANT ALL    ON public.brand_catalog          TO service_role;
GRANT ALL    ON public.comercio_poi           TO service_role;
GRANT ALL    ON public.comercio_poi_sync_log  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.brand_catalog_id_seq         TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.comercio_poi_id_seq          TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.comercio_poi_sync_log_id_seq TO service_role;

ALTER TABLE public.comercio_poi          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_catalog         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comercio_poi_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_comercio_poi"   ON public.comercio_poi;
DROP POLICY IF EXISTS "read_brand_catalog"  ON public.brand_catalog;
DROP POLICY IF EXISTS "read_sync_log"       ON public.comercio_poi_sync_log;

CREATE POLICY "read_comercio_poi"  ON public.comercio_poi          FOR SELECT USING (true);
CREATE POLICY "read_brand_catalog" ON public.brand_catalog         FOR SELECT USING (true);
CREATE POLICY "read_sync_log"      ON public.comercio_poi_sync_log FOR SELECT USING (true);

CREATE OR REPLACE VIEW public.v_supermercados       AS SELECT * FROM public.comercio_poi WHERE categoria = 'supermercado'         AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_farmacias           AS SELECT * FROM public.comercio_poi WHERE categoria = 'farmacia'             AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_combustibles        AS SELECT * FROM public.comercio_poi WHERE categoria = 'combustible'          AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_bancos              AS SELECT * FROM public.comercio_poi WHERE categoria = 'banco'                AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_retail              AS SELECT * FROM public.comercio_poi WHERE categoria = 'retail_departamental' AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_mejoramiento_hogar  AS SELECT * FROM public.comercio_poi WHERE categoria = 'mejoramiento_hogar'   AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_restaurantes        AS SELECT * FROM public.comercio_poi WHERE categoria = 'restaurante'          AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_conveniencias       AS SELECT * FROM public.comercio_poi WHERE categoria = 'conveniencia'         AND NOT eliminado;
CREATE OR REPLACE VIEW public.v_centros_comerciales AS SELECT * FROM public.comercio_poi WHERE categoria = 'centro_comercial'     AND NOT eliminado;

CREATE OR REPLACE VIEW public.v_resumen_comercial AS
    SELECT categoria, marca_estandar, region, COUNT(*) AS total_locales
      FROM public.comercio_poi
     WHERE NOT eliminado AND marca_estandar IS NOT NULL
     GROUP BY categoria, marca_estandar, region
     ORDER BY categoria, total_locales DESC;

CREATE OR REPLACE FUNCTION public.fn_participacion_marcas(
    p_categoria TEXT, p_region TEXT DEFAULT NULL
)
RETURNS TABLE (marca_estandar TEXT, total_locales BIGINT, pct_participacion NUMERIC)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH totales AS (
        SELECT cp.marca_estandar, COUNT(*) AS n
          FROM public.comercio_poi cp
         WHERE cp.categoria = p_categoria AND NOT cp.eliminado
           AND cp.marca_estandar IS NOT NULL
           AND (p_region IS NULL OR cp.region = p_region)
         GROUP BY cp.marca_estandar
    ),
    gran_total AS (SELECT SUM(n) AS total FROM totales)
    SELECT t.marca_estandar, t.n,
           ROUND(t.n * 100.0 / NULLIF(gt.total, 0), 2)
      FROM totales t, gran_total gt
     ORDER BY t.n DESC;
$$;

CREATE OR REPLACE FUNCTION public.fn_pois_cercanos(
    p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION,
    p_radio_m INTEGER DEFAULT 3000,
    p_categoria TEXT DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,
    p_limite INTEGER DEFAULT 50
)
RETURNS TABLE (
    id BIGINT, nombre TEXT, marca_estandar TEXT, categoria TEXT,
    distancia_m DOUBLE PRECISION, latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION, direccion TEXT, comuna TEXT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT p.id, p.nombre, p.marca_estandar, p.categoria,
        ROUND(ST_Distance(
            p.geom::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        )::NUMERIC, 1)::DOUBLE PRECISION AS distancia_m,
        p.latitud, p.longitud, p.direccion, p.comuna
      FROM public.comercio_poi p
     WHERE NOT p.eliminado
       AND (p_categoria IS NULL OR p.categoria = p_categoria)
       AND (p_marca     IS NULL OR p.marca_estandar = p_marca)
       AND ST_DWithin(
             p.geom::geography,
             ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
             p_radio_m)
     ORDER BY 5
     LIMIT p_limite;
$$;

GRANT SELECT ON public.v_supermercados, public.v_farmacias, public.v_combustibles,
                public.v_bancos, public.v_retail, public.v_mejoramiento_hogar,
                public.v_restaurantes, public.v_conveniencias, public.v_centros_comerciales,
                public.v_resumen_comercial
    TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_participacion_marcas(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pois_cercanos(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TEXT, TEXT, INTEGER) TO anon, authenticated;
