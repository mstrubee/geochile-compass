ALTER TABLE public.territorial_source_files
ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT 'html'
CHECK (file_type IN ('html','geojson','kml','kmz'));