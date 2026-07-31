-- El geocodificador de direcciones pasó de Mapbox a Nominatim (OpenStreetMap):
-- Mapbox solo es gratis para geocodificación "temporal" (no se puede guardar
-- el resultado); guardar coordenadas permanentemente requiere su plan pago
-- ("Permanent Geocoding", sin nivel gratuito). Nominatim es gratis, sin
-- cuenta, y permite guardar los resultados (de hecho lo exige). Se quita el
-- slot del secret que ya no se usa.
delete from public.app_secrets where key = 'MAPBOX_ACCESS_TOKEN';
