/**
 * BrandCatalogManager.tsx
 * ────────────────────────
 * Panel admin para gestionar el catálogo de marcas de la Red Comercial OSM.
 *
 * Funciones:
 *  • Ver y buscar todas las reglas de normalización (raw_name → marca_estandar)
 *  • Agregar marcas individuales con formulario
 *  • Quick-add bulk: pegar varios nombres en un textarea
 *  • Editar inline cualquier campo
 *  • Eliminar con confirmación
 *  • Toggle activo/inactivo por fila
 *  • Filtro por categoría
 */

import { useState, useMemo } from "react";
import {
  Plus, Search, Trash2, Pencil, Check, X, ChevronDown,
  Package, Loader2, Upload, ToggleLeft, ToggleRight,
} from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useBrandCatalog, type BrandEntry, type BrandInsert } from "@/hooks/useBrandCatalog";
import { COMERCIAL_LAYER_META } from "@/types/comercial";
import type { ComercialCategoria } from "@/types/comercial";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIAS = Object.keys(COMERCIAL_LAYER_META) as ComercialCategoria[];

const CAT_LABEL: Record<string, string> = {
  supermercado:         "🛒 Supermercados",
  conveniencia:         "🏪 Conveniencia",
  farmacia:             "💊 Farmacias",
  combustible:          "⛽ Combustible",
  mejoramiento_hogar:   "🔨 Mejoramiento hogar",
  retail_departamental: "🛍️ Retail departamental",
  banco:                "🏦 Bancos / ATM",
  restaurante:          "🍽️ Restaurantes",
  centro_comercial:     "🏬 Centros comerciales",
};

const DEFAULT_FORM: BrandInsert = {
  raw_name:       "",
  marca_estandar: "",
  categoria:      "supermercado",
  subcategoria:   null,
  color_hex:      "#6B7280",
  icon_emoji:     "📍",
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componente: fila de la tabla
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
  entry:         BrandEntry;
  onUpdate:      (id: number, patch: Partial<BrandInsert>) => Promise<boolean>;
  onRemove:      (id: number) => Promise<boolean>;
  onToggle:      (id: number, activo: boolean) => Promise<boolean>;
}

const BrandRow = ({ entry, onUpdate, onRemove, onToggle }: RowProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<Partial<BrandInsert>>({});
  const [confirm, setConfirm] = useState(false);

  const startEdit = () => {
    setDraft({
      raw_name:       entry.raw_name,
      marca_estandar: entry.marca_estandar,
      categoria:      entry.categoria,
      subcategoria:   entry.subcategoria ?? "",
      color_hex:      entry.color_hex ?? "#6B7280",
      icon_emoji:     entry.icon_emoji ?? "📍",
    });
    setEditing(true);
  };

  const save = async () => {
    const ok = await onUpdate(entry.id, draft);
    if (ok) setEditing(false);
  };

  const catMeta = COMERCIAL_LAYER_META[entry.categoria as ComercialCategoria];

  return (
    <tr className={["border-b border-border/30 text-[12px] transition-colors", !entry.activo ? "opacity-40" : ""].join(" ")}>
      {editing ? (
        <>
          <td className="py-1 pr-2">
            <Input
              value={draft.raw_name ?? ""}
              onChange={e => setDraft(p => ({ ...p, raw_name: e.target.value }))}
              className="h-7 text-[12px]"
            />
          </td>
          <td className="py-1 pr-2">
            <Input
              value={draft.marca_estandar ?? ""}
              onChange={e => setDraft(p => ({ ...p, marca_estandar: e.target.value }))}
              className="h-7 text-[12px]"
            />
          </td>
          <td className="py-1 pr-2">
            <Select
              value={draft.categoria}
              onValueChange={v => setDraft(p => ({ ...p, categoria: v }))}
            >
              <SelectTrigger className="h-7 text-[12px] w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map(c => (
                  <SelectItem key={c} value={c} className="text-[12px]">{CAT_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </td>
          <td className="py-1 pr-2">
            <Input
              value={draft.icon_emoji ?? ""}
              onChange={e => setDraft(p => ({ ...p, icon_emoji: e.target.value }))}
              className="h-7 w-14 text-center text-[14px]"
            />
          </td>
          <td className="py-1 pr-2">
            <input
              type="color"
              value={draft.color_hex ?? "#6B7280"}
              onChange={e => setDraft(p => ({ ...p, color_hex: e.target.value }))}
              className="h-7 w-10 cursor-pointer rounded border border-border/40"
            />
          </td>
          <td className="py-1">
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={save}>
                <Check className="h-3.5 w-3.5 text-green-500" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="py-1.5 pr-2 font-mono text-[11px] text-muted-foreground">{entry.raw_name}</td>
          <td className="py-1.5 pr-2 font-medium">{entry.marca_estandar}</td>
          <td className="py-1.5 pr-2">
            <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: catMeta?.color + "22", color: catMeta?.color }}>
              {CAT_LABEL[entry.categoria] ?? entry.categoria}
            </span>
          </td>
          <td className="py-1.5 pr-2 text-center text-[15px]">{entry.icon_emoji ?? "📍"}</td>
          <td className="py-1.5 pr-2">
            <span
              className="inline-block h-4 w-6 rounded border border-border/30"
              style={{ background: entry.color_hex ?? "#6B7280" }}
            />
          </td>
          <td className="py-1.5">
            <div className="flex gap-0.5">
              <Button
                size="icon" variant="ghost" className="h-6 w-6"
                onClick={() => onToggle(entry.id, !entry.activo)}
                title={entry.activo ? "Desactivar" : "Activar"}
              >
                {entry.activo
                  ? <ToggleRight className="h-3.5 w-3.5 text-green-500" />
                  : <ToggleLeft  className="h-3.5 w-3.5 text-muted-foreground" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={startEdit}>
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </Button>
              {confirm ? (
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(entry.id)}>
                    <Check className="h-3 w-3 text-red-500" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirm(false)}>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirm(true)}>
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                </Button>
              )}
            </div>
          </td>
        </>
      )}
    </tr>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
}

export const BrandCatalogManager = ({ open, onOpenChange }: Props) => {
  // Filtros
  const [search,   setSearch]   = useState("");
  const [catFilter,setCatFilter]= useState<string>("all");

  // Formulario agregar
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState<BrandInsert>({ ...DEFAULT_FORM });

  // Bulk import
  const [showBulk, setShowBulk]   = useState(false);
  const [bulkText, setBulkText]   = useState("");
  const [bulkCat,  setBulkCat]    = useState<string>("supermercado");
  const [bulkMarca,setBulkMarca]  = useState("");

  const { entries, loading, saving, insert, update, remove, bulkInsert, toggleActivo } =
    useBrandCatalog(catFilter === "all" ? null : catFilter);

  // Filtrado client-side
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return entries;
    return entries.filter(
      e =>
        e.raw_name.toLowerCase().includes(q) ||
        e.marca_estandar.toLowerCase().includes(q),
    );
  }, [entries, search]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.raw_name.trim() || !form.marca_estandar.trim()) return;
    const ok = await insert(form);
    if (ok) { setForm({ ...DEFAULT_FORM }); setShowForm(false); }
  };

  const handleBulkImport = async () => {
    const lines = bulkText
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
    if (!lines.length || !bulkMarca.trim()) return;

    const meta = COMERCIAL_LAYER_META[bulkCat as ComercialCategoria];
    const rows: BrandInsert[] = lines.map(raw => ({
      raw_name:       raw,
      marca_estandar: bulkMarca.trim(),
      categoria:      bulkCat,
      color_hex:      meta?.color ?? "#6B7280",
      icon_emoji:     meta?.icon  ?? "📍",
    }));

    const ok = await bulkInsert(rows);
    if (ok) { setBulkText(""); setBulkMarca(""); setShowBulk(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Catálogo de Marcas OSM"
      description="Reglas de normalización de nombres de marcas para la Red Comercial Nacional"
      icon={Package}
      size="5xl"
      contentClassName="p-0"
      footer={
        <div className="flex items-center justify-between w-full gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} / {entries.length} entradas
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulk(v => !v)}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Import rápido
            </Button>
            <Button size="sm" onClick={() => setShowForm(v => !v)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Agregar marca
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-0 h-[65vh]">

        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="flex gap-2 px-4 py-3 border-b border-border/30 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-[12px]"
            />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="h-8 w-52 text-[12px]">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">Todas las categorías</SelectItem>
              {CATEGORIAS.map(c => (
                <SelectItem key={c} value={c} className="text-[12px]">{CAT_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Formulario agregar ────────────────────────────────────────── */}
        {showForm && (
          <div className="px-4 py-3 border-b border-border/30 bg-surface-2/40 flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-32">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Nombre en OSM (raw)</label>
              <Input value={form.raw_name} onChange={e => setForm(p => ({ ...p, raw_name: e.target.value }))} className="h-7 text-[12px] mt-0.5" placeholder="ej: Walmart Express" />
            </div>
            <div className="flex-1 min-w-32">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Marca normalizada</label>
              <Input value={form.marca_estandar} onChange={e => setForm(p => ({ ...p, marca_estandar: e.target.value }))} className="h-7 text-[12px] mt-0.5" placeholder="ej: Walmart" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Categoría</label>
              <Select value={form.categoria} onValueChange={v => {
                const m = COMERCIAL_LAYER_META[v as ComercialCategoria];
                setForm(p => ({ ...p, categoria: v, color_hex: m?.color ?? p.color_hex, icon_emoji: m?.icon ?? p.icon_emoji }));
              }}>
                <SelectTrigger className="h-7 text-[12px] w-44 mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIAS.map(c => <SelectItem key={c} value={c} className="text-[12px]">{CAT_LABEL[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-12">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Emoji</label>
              <Input value={form.icon_emoji ?? ""} onChange={e => setForm(p => ({ ...p, icon_emoji: e.target.value }))} className="h-7 text-[13px] text-center mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Color</label>
              <input type="color" value={form.color_hex ?? "#6B7280"} onChange={e => setForm(p => ({ ...p, color_hex: e.target.value }))} className="h-7 w-10 rounded border border-border/40 cursor-pointer mt-0.5 block" />
            </div>
            <div className="flex gap-1">
              <Button size="sm" onClick={handleAdd} disabled={saving || !form.raw_name.trim() || !form.marca_estandar.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}

        {/* ── Bulk import ───────────────────────────────────────────────── */}
        {showBulk && (
          <div className="px-4 py-3 border-b border-border/30 bg-amber-500/5 flex flex-wrap gap-3 items-start">
            <div className="flex-1 min-w-48">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Nombres en OSM (uno por línea)</label>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={3}
                className="mt-0.5 w-full rounded-md border border-border/40 bg-surface/60 px-2 py-1 text-[12px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={"Walmart Express\nWalmart Vecino\nWal-Mart"}
              />
            </div>
            <div className="flex flex-col gap-2 min-w-40">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">→ Marca normalizada</label>
                <Input value={bulkMarca} onChange={e => setBulkMarca(e.target.value)} className="h-7 text-[12px] mt-0.5" placeholder="ej: Walmart" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Categoría</label>
                <Select value={bulkCat} onValueChange={setBulkCat}>
                  <SelectTrigger className="h-7 text-[12px] mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIAS.map(c => <SelectItem key={c} value={c} className="text-[12px]">{CAT_LABEL[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex gap-1 mt-auto">
                <Button size="sm" onClick={handleBulkImport} disabled={saving || !bulkText.trim() || !bulkMarca.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                  Importar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowBulk(false)}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <p className="w-full text-[10px] text-amber-600 dark:text-amber-400">
              💡 Todos los nombres se mapearán a la misma "Marca normalizada". Útil para variantes de un mismo local (Express, Vecino, etc.)
            </p>
          </div>
        )}

        {/* ── Tabla ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-[13px]">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando catálogo…
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-surface/95 backdrop-blur-sm border-b border-border/40">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Nombre OSM (raw)</th>
                  <th className="px-2 py-2 text-left font-medium">Marca estándar</th>
                  <th className="px-2 py-2 text-left font-medium">Categoría</th>
                  <th className="px-2 py-2 text-center font-medium">Icon</th>
                  <th className="px-2 py-2 text-left font-medium">Color</th>
                  <th className="px-4 py-2 text-left font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-[13px] text-muted-foreground">
                      {search ? "Sin resultados para esa búsqueda" : "Catálogo vacío"}
                    </td>
                  </tr>
                ) : (
                  filtered.map(entry => (
                    <BrandRow
                      key={entry.id}
                      entry={entry}
                      onUpdate={update}
                      onRemove={remove}
                      onToggle={toggleActivo}
                    />
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppDialog>
  );
};
