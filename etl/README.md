# AGROPLANET ETL — Score Comunal Nacional

Pipeline Python que genera el score territorial AGROPLANET (0–100) por comuna.

## Setup

```bash
cd etl/
pip install -r requirements.txt
```

---

## Fuentes de datos

### Automáticas (el script las descarga solo)

| Fuente | Archivo en cache | Origen |
|--------|-----------------|--------|
| Catastro Frutícola 2025 | `data/catastro_fruticola_2025.csv` | datos.odepa.gob.cl |
| ODEPA Cultivos Regional 2025 | `data/odepa_cultivos_regional_2025.xls` | bibliotecadigital.odepa.gob.cl |

### Manuales — Censo Agropecuario 2021 (INE)

El Censo 2021 requiere descarga manual. Seguir estos pasos:

1. Ir a **https://www.ine.gob.cl/censoagropecuario**
2. Sección "Resultados del VIII Censo Agropecuario y Forestal"
3. Descargar las siguientes tablas y **renombrarlas** exactamente así en `etl/data/`:

| Tabla a buscar en INE | Guardar como |
|----------------------|-------------|
| Maquinaria y equipos agrícolas (por comuna) | `censo2021_maquinaria.xlsx` |
| Explotaciones por tramos de superficie y comuna | `censo2021_explotaciones.xlsx` |
| Superficie sembrada/plantada por cultivo y comuna | `censo2021_cultivos.xlsx` |

> Los archivos INE suelen llamarse "Cuadro_XX_Nombre_Tabla.xlsx".
> Renombrarlos según la tabla anterior antes de ejecutar el script.

---

## Ejecución

### Solo generar CSV (sin cargar a Supabase)

```bash
python agroplanet_etl.py
```

Output: `output/agroplanet_comunas.csv`

### Con carga automática a Supabase

```bash
# Requiere service_role key (NO la anon key)
VITE_SUPABASE_URL=https://XXXX.supabase.co \
SUPABASE_SERVICE_KEY=eyJhbGci... \
python agroplanet_etl.py
```

> La `VITE_SUPABASE_URL` está en el `.env` del proyecto.
> La `SUPABASE_SERVICE_KEY` está en Supabase → Project Settings → API → service_role.

---

## Antes de ejecutar: crear tablas en Supabase

Correr los SQL en el editor de Supabase **en este orden**:

```
sql/01_create_tables.sql   ← crear tablas (una vez)
sql/02_seed_model_config.sql ← cargar pesos v1.0 (una vez)
```

---

## Output esperado

```
output/
├── agroplanet_comunas.csv   ← 346 comunas con scores y variables
└── etl.log                  ← log completo de la ejecución
```

Columnas principales del CSV:

| Columna | Descripción |
|---------|-------------|
| `cut` | CUT code 5 dígitos (ej: "07301") |
| `nombre` | Nombre oficial INE |
| `score_combined` | Score final 0-100 (60% grandes + 40% INDAP) |
| `score_grandes` | Score segmento grandes fundos |
| `score_indap` | Score segmento agricultores medianos |
| `quintil_combined` | Quintil nacional 1-5 (5 = mayor potencial) |

---

## Variables del modelo

| Variable | Fuente | Peso grandes | Peso INDAP |
|----------|--------|-------------|------------|
| `tractores_x100ha` | Censo 2021 | 30% | 35% |
| `ha_frutales_riego` | Catastro 2025 | 20% | 10% |
| `ha_cereales_oleaginosas` | Censo 2021 + factor ODEPA | 15% | 30% |
| `pct_predios_grandes` | Censo 2021 | 20% | 5% |
| `num_explot_medianas` | Censo 2021 | 5% | 15% |
| `diversidad_especies` | Catastro 2025 | 5% | 0% |
| `ha_suelo_clase_I_II` | CIREN (opcional) | 5% | 5% |

Los pesos se actualizarán automáticamente a v2.0 cuando se carguen ventas reales
y se calibre el modelo con Ridge regression.

---

## Estructura de archivos

```
etl/
├── agroplanet_etl.py          ← pipeline principal
├── requirements.txt
├── README.md
├── sql/
│   ├── 01_create_tables.sql   ← DDL Supabase
│   └── 02_seed_model_config.sql ← pesos v1.0
├── data/                      ← archivos descargados (no en git)
│   ├── catastro_fruticola_2025.csv
│   ├── censo2021_maquinaria.xlsx
│   ├── censo2021_explotaciones.xlsx
│   ├── censo2021_cultivos.xlsx
│   └── odepa_cultivos_regional_2025.xls
└── output/                    ← resultados (no en git)
    ├── agroplanet_comunas.csv
    └── etl.log
```
