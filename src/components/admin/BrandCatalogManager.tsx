/**
 * BrandCatalogManager.tsx
 * ────────────────────────
 * Panel admin con dos pestañas:
 *  • Marcas  — CRUD de reglas de normalización + thumbnail upload
 *  • Categorías — gestión drag-and-drop de categorías OSM
 */

import { useRef, useState, useMemo } from "react";
import {
  Plus, Search, Trash2, Pencil, Check, X,
  Package, Loader2, Upload, ToggleLeft, ToggleRight, RefreshCw,
  ImageIcon, Tags,
} from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBrandCatalog, type BrandEntry, type BrandInsert } from "@/hooks/useBrandCatalog";
import { useComercialCategorias } from "@/hooks/useComercialCategorias";
import { COMERCIAL_LAYER_META } from "@/types/comercial";
import { CategoryManager } from "./CategoryManager";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componente: fila de la tabla de marcas
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
  entry:    BrandEntry;
  catLabel: (key: string) => string;
  catColor: (key: string) => string;
  onUpdate: (id: number, patch: Partial<BrandInsert>) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
  onToggle: (id: number, activo: boolean) => Promise<boolean>;
  catOptions: { key: string; label: string }[];
}

const BrandRow = ({ entry, catLabel, catColor, onUpdate, onRemove, onToggle, catOptions }: RowProps) => {
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState<Partial<BrandInsert>>({});
  const [confirm,   setConfirm]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft({
      raw_name:       entry.raw_name,
      marca_estandar: entry.marca_estandar,
      categoria:      entry.categoria,
      subcategoria:   entry.subcategoria ?? "",
      color_hex:      entry.color_hex   ?? "#6B7280",
      icon_emoji:     entry.icon_emoji  ?? "📍",
    });
    setEditing(true);
  };
  const save = async () => { if (await onUpdate(entry.id, draft)) setEditing(false); };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext  = file.name.split(".").pop() ?? "png";
    const slug = entry.raw_name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const path = `${entry.id}-${slug}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("brand-logos")
      .upload(path, file, { upsert: true });
    if (upErr) { toast.error("Upload fallido: " + upErr.message); setUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("brand-logos").getPublicUrl(path);
    await onUpdate(entry.id, { logo_url: publicUrl });
    setUploading(false);
    // reset input so same file can be re-uploaded
    e.target.value = "";
  };

  const color = catColor(entry.categoria);

  return (
    <tr className={["border-b border-border/30 text-[12px] transition-colors", !entry.activo ? "opacity-40" : ""].join(" ")}>
      {editing ? (
        <>
          <td className="py-1 px-2">
            <Input value={draft.raw_name ?? ""} onChange={e => setDraft(p => ({ ...p, raw_name: e.target.value }))} className="h-7 text-[12px]" />
          </td>
          <td className="py-1 pr-2">
            <Input value={draft.marca_estandar ?? ""} onChange={e => setDraft(p => ({ ...p, marca_estandar: e.target.value }))} className="h-7 text-[12px]" />
          </td>
          <td className="py-1 pr-2">
            <Select value={draft.categoria} onValueChange={v => setDraft(p => ({ ...p, categoria: v }))}>
              <SelectTrigger className="h-7 text-[12px] w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {catOptions.map(c => <SelectItem key={c.key} value={c.key} className="text-[12px]">{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </td>
          <td className="py-1 pr-2">
            <Input value={draft.icon_emoji ?? ""} onChange={e => setDraft(p => ({ ...p, icon_emoji: e.target.value }))} className="h-7 w-14 text-center text-[14px]" />
          </td>
          <td className="py-1 pr-2">
            <input type="color" value={draft.color_hex ?? "#6B7280"} onChange={e => setDraft(p => ({ ...p, color_hex: e.target.value }))} className="h-7 w-10 cursor-pointer rounded border border-border/40" />
          </td>
          {/* Logo col — no editable en modo edit, se maneja por upload */}
          <td className="py-1 pr-2" />
          <td className="py-1">
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={save}><Check className="h-3.5 w-3.5 text-green-500" /></Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5 text-muted-foreground" /></Button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="py-1.5 pl-4 pr-2 font-mono text-[11px] text-muted-foreground">{entry.raw_name}</td>
          <td className="py-1.5 pr-2 font-medium">{entry.marca_estandar}</td>
          <td className="py-1.5 pr-2">
            <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: color + "22", color }}>
              {catLabel(entry.categoria)}
            </span>
          </td>
          <td className="py-1.5 pr-2 text-center text-[15px]">{entry.icon_emoji ?? "📍"}</td>
          <td className="py-1.5 pr-2">
            <span className="inline-block h-4 w-6 rounded border border-border/30" style={{ background: entry.color_hex ?? "#6B7280" }} />
          </td>
          {/* Logo / thumbnail */}
          <td className="py-1.5 pr-2">
            <div className="flex items-center gap-1">
              {entry.logo_url
                ? <img src={entry.logo_url} alt="" className="h-6 w-6 rounded object-contain border border-border/20" />
                : <span className="text-[13px] opacity-30"><ImageIcon className="h-4 w-4" /></span>
              }
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              <Button
                size="icon" variant="ghost" className="h-5 w-5"
                onClick={() => fileRef.current?.click()}
                title="Subir logo (PNG/JPG/WebP)"
              >
                {uploading
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <Upload className="h-2.5 w-2.5 text-muted-foreground" />}
              </Button>
            </div>
          </td>
          <td className="py-1.5 pr-4">
            <div className="flex gap-0.5">
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onToggle(entry.id, !entry.activo)} title={entry.activo ? "Desactivar" : "Activar"}>
                {entry.activo ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={startEdit}><Pencil className="h-3 w-3 text-muted-foreground" /></Button>
              {confirm ? (
                <>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(entry.id)}><Check className="h-3 w-3 text-red-500" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirm(false)}><X className="h-3 w-3 text-muted-foreground" /></Button>
                </>
              ) : (
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirm(true)}><Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" /></Button>
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

const DEFAULT_FORM: BrandInsert = {
  raw_name: "", marca_estandar: "", categoria: "supermercado",
  subcategoria: null, color_hex: "#6B7280", icon_emoji: "📍",
};

export const BrandCatalogManager = ({ open, onOpenChange }: Props) => {
  const [tab, setTab] = useState<"marcas" | "categorias">("marcas");

  // ── Marcas ────────────────────────────────────────────────────────────────
  const [search,    setSearch]    = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState<BrandInsert>({ ...DEFAULT_FORM });
  const [showBulk,  setShowBulk]  = useState(false);
  const [bulkText,  setBulkText]  = useState("");
  const [bulkCat,   setBulkCat]   = useState<string>("supermercado");
  const [bulkMarca, setBulkMarca] = useState("");
  const [syncing,   setSyncing]   = useState(false);

  const { entries, loading, saving, insert, update, remove, bulkInsert, toggleActivo } =
    useBrandCatalog(catFilter === "all" ? null : catFilter);

  // Categorías (para selector en formularios y etiquetas en tabla)
  const { categorias: dbCategorias } = useComercialCategorias(false);
  const catOptions = useMemo(() => {
    if (dbCategorias.length) return dbCategorias.map(c => ({ key: c.key, label: `${c.icon_emoji} ${c.label_es}` }));
    return Object.entries(COMERCIAL_LAYER_META).map(([k, v]) => ({ key: k, label: `${v.icon} ${v.label}` }));
  }, [dbCategorias]);

  const catLabel = (key: string) => catOptions.find(c => c.key === key)?.label ?? key;
  const catColor = (key: string) => {
    const db = dbCategorias.find(c => c.key === key);
    if (db) return db.color_hex;
    return COMERCIAL_LAYER_META[key]?.color ?? "#6B7280";
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return entries;
    return entries.filter(e =>
      e.raw_name.toLowerCase().includes(q) ||
      e.marca_estandar.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const handleAdd = async () => {
    if (!form.raw_name.trim() || !form.marca_estandar.trim()) return;
    if (await insert(form)) { setForm({ ...DEFAULT_FORM }); setShowForm(false); }
  };

  const handleBulkImport = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length || !bulkMarca.trim()) return;
    const meta = catColor(bulkCat);
    const rows: BrandInsert[] = lines.map(raw => ({
      raw_name:       raw,
      marca_estandar: bulkMarca.trim(),
      categoria:      bulkCat,
      color_hex:      meta,
      icon_emoji:     catOptions.find(c => c.key === bulkCat)?.label.split(" ")[0] ?? "📍",
    }));
    if (await bulkInsert(rows)) { setBulkText(""); setBulkMarca(""); setShowBulk(false); }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("trigger-sync");
      if (error) throw error;
      const msg = (data as { message?: string })?.message ?? "Sync disparado";
      toast.success(msg, { description: "El workflow de GitHub Actions está en cola. Tarda ~10 min." });
    } catch (err: unknown) {
      toast.error("Error al disparar sync", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Admin · Red Comercial Nacional"
      description="Gestión de marcas, categorías y sincronización OSM"
      icon={Package}
      size="5xl"
      contentClassName="p-0"
      footer={
        <div className="flex items-center justify-between w-full gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            {tab === "marcas" && (
              <span className="text-[11px] text-muted-foreground">{filtered.length} / {entries.length} entradas</span>
            )}
            <Button
              variant="outline" size="sm" onClick={handleTriggerSync} disabled={syncing}
              title="Dispara GitHub Action para resincronizar POIs desde OpenStreetMap"
              className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-400 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncing ? "Disparando…" : "Sincronizar OSM"}
            </Button>
          </div>
          {tab === "marcas" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowBulk(v => !v)}>
                <Upload className="h-3.5 w-3.5 mr-1.5" /> Import rápido
              </Button>
              <Button size="sm" onClick={() => setShowForm(v => !v)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar marca
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="flex flex-col h-[65vh]">

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex border-b border-border/40 px-4 pt-2 gap-1">
          {(["marcas", "categorias"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                tab === t
                  ? "bg-surface text-foreground border border-b-0 border-border/40"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "marcas"
                ? <><Package className="h-3.5 w-3.5" /> Marcas</>
                : <><Tags className="h-3.5 w-3.5" /> Categorías</>
              }
            </button>
          ))}
        </div>

        {/* ══════════════════ TAB: CATEGORÍAS ═══════════════════════════════ */}
        {tab === "categorias" && (
          <div className="flex-1 overflow-auto p-4">
            <CategoryManager />
          </div>
        )}

        {/* ══════════════════ TAB: MARCAS ═══════════════════════════════════ */}
        {tab === "marcas" && (
          <>
            {/* Toolbar */}
            <div className="flex gap-2 px-4 py-3 border-b border-border/30 flex-wrap">
              <div className="relative flex-1 min-w-40">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Buscar por nombre…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-[12px]" />
              </div>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-8 w-52 text-[12px]"><SelectValue placeholder="Todas las categorías" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[12px]">Todas las categorías</SelectItem>
                  {catOptions.map(c => <SelectItem key={c.key} value={c.key} className="text-[12px]">{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Formulario agregar */}
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
                    const c = catColor(v);
                    setForm(p => ({ ...p, categoria: v, color_hex: c }));
                  }}>
                    <SelectTrigger className="h-7 text-[12px] w-44 mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>{catOptions.map(c => <SelectItem key={c.key} value={c.key} className="text-[12px]">{c.label}</SelectItem>)}</SelectContent>
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

            {/* Bulk import */}
            {showBulk && (
              <div className="px-4 py-3 border-b border-border/30 bg-amber-500/5 flex flex-wrap gap-3 items-start">
                <div className="flex-1 min-w-48">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Nombres en OSM (uno por línea)</label>
                  <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={3}
                    className="mt-0.5 w-full rounded-md border border-border/40 bg-surface/60 px-2 py-1 text-[12px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={"Walmart Express\nWalmart Vecino\nWal-Mart"} />
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
                      <SelectContent>{catOptions.map(c => <SelectItem key={c.key} value={c.key} className="text-[12px]">{c.label}</SelectItem>)}</SelectContent>
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
                  💡 Todos los nombres se mapearán a la misma marca normalizada. Útil para variantes del mismo local.
                </p>
              </div>
            )}

            {/* Tabla */}
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
                      <th className="px-2 py-2 text-center font-medium">Logo</th>
                      <th className="px-4 py-2 text-left font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-[13px] text-muted-foreground">
                          {search ? "Sin resultados para esa búsqueda" : "Catálogo vacío"}
                        </td>
                      </tr>
                    ) : (
                      filtered.map(entry => (
                        <BrandRow
                          key={entry.id}
                          entry={entry}
                          catLabel={catLabel}
                          catColor={catColor}
                          catOptions={catOptions}
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
          </>
        )}
      </div>
    </AppDialog>
  );
};
