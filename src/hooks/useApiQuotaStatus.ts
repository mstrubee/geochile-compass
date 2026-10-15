/**
 * useApiQuotaStatus
 * ──────────────────
 * Estado de cuota (consumo / límite) de cada API de Google, leído del servidor.
 * Se refresca al montar, cuando cualquier consumo avisa (QUOTA_CHANGED_EVENT, con debounce)
 * y cada minuto (otros usuarios también consumen).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiQuotaStatus, QUOTA_CHANGED_EVENT, type QuotaStatus } from "@/services/apiQuotaService";

export function useApiQuotaStatus(pollMs = 60_000) {
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getApiQuotaStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la cuota");
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChanged = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 1500);
    };
    window.addEventListener(QUOTA_CHANGED_EVENT, onChanged);
    const iv = setInterval(refresh, pollMs);
    return () => {
      window.removeEventListener(QUOTA_CHANGED_EVENT, onChanged);
      clearInterval(iv);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, pollMs]);

  return { status, error, refresh };
}
