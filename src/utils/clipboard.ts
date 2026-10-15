/**
 * Copia texto al portapapeles. Usa la API moderna y, si el navegador la bloquea (página sin
 * permiso o sin HTTPS), cae a un `textarea` temporal. Devuelve si se pudo copiar, para que la
 * pantalla pueda ofrecer copiarlo a mano en vez de fallar en silencio.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // se intenta el plan B
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};
