/**
 * scripts/drive-client.ts
 * ──────────────────────
 * Cliente mínimo de Google Drive para la sincronización automática.
 *
 * Autentica con una cuenta de servicio firmando un JWT con `node:crypto`
 * (RS256) y canjeándolo por un access token. Se hace a mano en vez de traer
 * `googleapis` porque esa librería son ~50 MB de dependencias para las dos
 * llamadas que necesitamos (metadata + descarga), y este script corre en CI
 * donde el tiempo de instalación cuenta.
 *
 * Alcance pedido: drive.readonly — el script solo LEE el archivo, nunca
 * escribe en Drive.
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const base64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const readServiceAccount = (): ServiceAccount => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON");
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("El JSON de la cuenta de servicio no tiene client_email / private_key");
  }
  // GitHub Secrets suele guardar los saltos de línea escapados.
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Access token de la cuenta de servicio (cacheado mientras siga vigente). */
const getAccessToken = async (): Promise<string> => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const sa = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    signature = base64url(signer.sign(sa.private_key));
  } catch (e) {
    // El error crudo de OpenSSL ("DECODER routines::unsupported") no le dice
    // nada a nadie. Este es EL error típico de configuración: el private_key
    // del secret quedó truncado, sin los saltos de línea, o sin las líneas
    // BEGIN/END.
    throw new Error(
      "No se pudo firmar con la private_key de la cuenta de servicio. " +
        "Revisa que el secret GOOGLE_SERVICE_ACCOUNT_JSON tenga el JSON COMPLETO " +
        "descargado de Google Cloud (incluyendo las líneas -----BEGIN PRIVATE KEY----- " +
        `y -----END PRIVATE KEY-----). Detalle técnico: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const assertion = `${header}.${claims}.${signature}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(`No se pudo obtener el token de Google (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
};

export interface DriveFileMeta {
  id: string;
  name: string;
  /** ISO 8601. Es el detector de cambios: si no varió, no hay nada que procesar. */
  modifiedTime: string;
  mimeType: string;
  size?: string;
}

/** Metadata del archivo, sin descargarlo. */
export const getDriveFileMeta = async (fileId: string): Promise<DriveFileMeta> => {
  const token = await getAccessToken();
  const url = `${DRIVE_API}/${fileId}?fields=id,name,modifiedTime,mimeType,size&supportsAllDrives=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 404) {
      throw new Error(
        `Drive devolvió 404 para el archivo ${fileId}. Revisa que el ID sea correcto y que la carpeta esté compartida con el email de la cuenta de servicio.`,
      );
    }
    throw new Error(`Drive falló al leer la metadata (${resp.status}): ${body}`);
  }
  return (await resp.json()) as DriveFileMeta;
};

// Google Sheets nativo no se descarga: se exporta. Si el usuario deja el
// archivo como Sheet en vez de .xlsx, esto lo convierte al vuelo.
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Descarga el archivo como bytes. Exporta a .xlsx si es un Google Sheet nativo. */
export const downloadDriveFile = async (fileId: string): Promise<Uint8Array> => {
  const token = await getAccessToken();
  const meta = await getDriveFileMeta(fileId);

  const url =
    meta.mimeType === GOOGLE_SHEET_MIME
      ? `${DRIVE_API}/${fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
      : `${DRIVE_API}/${fileId}?alt=media&supportsAllDrives=true`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    throw new Error(`Drive falló al descargar (${resp.status}): ${await resp.text()}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
};
