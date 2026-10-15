/**
 * useGoogleMapsKey
 * ─────────────────
 * Entrega la clave de Google Maps cargada en runtime (desde app_secrets vía RPC),
 * con fallback inmediato al valor de build. Comparte una única carga (cache en
 * runtimeConfig), así que múltiples componentes no disparan llamadas repetidas.
 */
import { useEffect, useState } from "react";
import { getGoogleMapsKeySync, loadGoogleMapsKey } from "@/services/runtimeConfig";

export function useGoogleMapsKey(): string {
  const [key, setKey] = useState<string>(getGoogleMapsKeySync());

  useEffect(() => {
    let alive = true;
    loadGoogleMapsKey().then((k) => { if (alive) setKey(k); });
    return () => { alive = false; };
  }, []);

  return key;
}
