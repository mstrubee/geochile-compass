-- ─────────────────────────────────────────────────────────────────────────────
-- RPC público para leer la configuración de mapa en runtime desde el cliente.
-- app_secrets es admin-only (RLS); esta función SECURITY DEFINER expone SOLO la
-- API key de Google Maps (que de todos modos es pública en el navegador,
-- restringida por referrer en Google Cloud). No expone el resto de secrets.
-- Permite registrar/cambiar la key desde el panel admin sin redeploy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_public_map_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'googleMapsKey',
    COALESCE((SELECT value FROM public.app_secrets WHERE key = 'GOOGLE_MAPS_API_KEY' LIMIT 1), '')
  );
$fn$;

REVOKE ALL ON FUNCTION public.get_public_map_config() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_map_config() TO anon, authenticated;
