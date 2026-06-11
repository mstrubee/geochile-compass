/**
 * exportPOI.ts
 * ─────────────
 * Utilidades para exportar POIs de la Red Comercial Nacional a CSV o KML.
 * Soporta filtro por categoría y opcionalmente por marca.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ComercialCategoria, ComercialPOI } from "@/types/comercial";

const PAGE = 1000;

// ── Fetch ─────────────────────────────────────────────────────────────────────

/** Descarga TODOS los POIs de una categoría (y opcionalmente marca) sin límite de paginación. */
export async function fetchPOIsForExport(
  categoria: ComercialCategoria,
  marca?: string | null,
): Promise<ComercialPOI[]> {
  const all: ComercialPOI[] = [];
  let from = 0;

  while (true) {
    let q = supabase
      .from("comercio_poi")
      .select(
        "id,nombre,marca,marca_estandar,categoria,subcategoria,cadena," +
        "direccion,comuna,region,latitud,longitud",
      )
      .eq("categoria", categoria)
      .eq("eliminado", false)
      .range(from, from + PAGE - 1)
      .order("id");

    if (marca) q = q.eq("marca_estandar", marca);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...(data as unknown as ComercialPOI[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

/** Dispara la descarga de un Blob en el navegador. */
function triggerDownload(content: string, filename: string, mime: string) {
  // BOM UTF-8 para que Excel abra el CSV en codificación correcta
  const bom = mime.startsWith("text/csv") ? "﻿" : "";
  const blob = new Blob([bom + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Genera un slug de nombre de archivo limpio. */
export function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // quitar acentos
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function escCsv(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCSV(pois: ComercialPOI[], filename: string) {
  const HEADERS = [
    "nombre", "marca_estandar", "categoria", "subcategoria", "cadena",
    "direccion", "comuna", "region", "latitud", "longitud",
  ];

  const rows = pois.map((p) =>
    [
      p.nombre, p.marca_estandar, p.categoria, p.subcategoria, p.cadena,
      p.direccion, p.comuna, p.region, p.latitud, p.longitud,
    ].map(escCsv).join(","),
  );

  triggerDownload(
    [HEADERS.join(","), ...rows].join("\r\n"),
    filename,
    "text/csv;charset=utf-8;",
  );
}

// ── KML ───────────────────────────────────────────────────────────────────────

function escXml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function downloadKML(pois: ComercialPOI[], docName: string, filename: string) {
  const placemarks = pois
    .map((p) => {
      const desc = [
        p.marca_estandar ? `<b>Marca:</b> ${escXml(p.marca_estandar)}` : null,
        `<b>Categoría:</b> ${escXml(p.categoria)}`,
        p.direccion ? `<b>Dirección:</b> ${escXml(p.direccion)}` : null,
        p.comuna ? `<b>Comuna:</b> ${escXml(p.comuna)}` : null,
        p.region ? `<b>Región:</b> ${escXml(p.region)}` : null,
      ]
        .filter(Boolean)
        .join("<br/>");

      return [
        "  <Placemark>",
        `    <name>${escXml(p.nombre)}</name>`,
        `    <description><![CDATA[${desc}]]></description>`,
        "    <Point>",
        `      <coordinates>${p.longitud},${p.latitud},0</coordinates>`,
        "    </Point>",
        "  </Placemark>",
      ].join("\n");
    })
    .join("\n");

  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    `    <name>${escXml(docName)}</name>`,
    placemarks,
    "  </Document>",
    "</kml>",
  ].join("\n");

  triggerDownload(kml, filename, "application/vnd.google-earth.kml+xml");
}
