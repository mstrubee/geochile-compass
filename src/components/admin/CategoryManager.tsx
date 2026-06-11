/**
 * CategoryManager.tsx
 * ────────────────────
 * Gestión de categorías de la Red Comercial Nacional.
 * - Crear / editar / eliminar categorías
 * - Reordenar con drag-and-drop (HTML5 nativo)
 * - Toggle activo/inactivo
 */

import { useRef, useState } from "react";
import {
  GripVertical, Plus, Pencil, Trash2, Check, X,
  ToggleLeft, ToggleRight, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComercialCategorias, type CategoriaEntry, type CategoriaInsert } from "@/hooks/useComercialCategorias";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componente: fila de categoría
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
  cat:          CategoriaEntry;
  isDragging:   boolean;
  isOver:       boolean;
  onDragStart:  () => void;
  onDragOver:   (e: React.DragEvent) => void;
  onDrop:       () => void;
  onDragEnd:    () => void;
  onUpdate:     (id: number, patch: Partial<CategoriaInsert>) => Promise<boolean>;
  onRemove:     (id: number) => Promise<boolean>;
  onToggle:     (id: number, activo: boolean) => Promise<boolean>;
}

const CatRow = ({
  cat, isDragging, isOver,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onUpdate, onRemove, onToggle,
}: RowProps) => {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState<Partial<CategoriaInsert>>({});
  const [confirm, setConfirm] = useState(false);

  const startEdit = () => {
    setDraft({ label_es: cat.label_es, icon_emoji: cat.icon_emoji, color_hex: cat.color_hex });
    setEditing(true);
  };
  const save = async () => {
    const ok = await onUpdate(cat.id, draft);
    if (ok) setEditing(false);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[12px] transition-all select-none",
        isDragging  ? "opacity-40 border-dashed border-border" : "border-transparent",
        isOver      ? "border-primary/60 bg-primary/5"         : "bg-surface-2/30 hover:bg-surface-2/60",
      ].join(" ")}
    >
      {/* Drag handle */}
      <GripVertical className="h-3.5 w-3.5 flex-shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing" />

      {editing ? (
        <>
          {/* Emoji */}
          <Input
            value={draft.icon_emoji ?? ""}
            onChange={e => setDraft(p => ({ ...p, icon_emoji: e.target.value }))}
            className="h-7 w-12 text-center text-[15px]"
            maxLength={4}
          />
          {/* Color */}
          <input
            type="color"
            value={draft.color_hex ?? "#6B7280"}
            onChange={e => setDraft(p => ({ ...p, color_hex: e.target.value }))}
            className="h-7 w-9 cursor-pointer rounded border border-border/40"
          />
          {/* Label */}
          <Input
            value={draft.label_es ?? ""}
            onChange={e => setDraft(p => ({ ...p, label_es: e.target.value }))}
            className="h-7 flex-1 text-[12px]"
            placeholder="Nombre de categoría"
          />
          <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={save}>
            <Check className="h-3.5 w-3.5 text-green-500" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </>
      ) : (
        <>
          {/* Vista */}
          <span className="text-[16px] flex-shrink-0">{cat.icon_emoji}</span>
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: cat.color_hex }}
          />
          <span className="flex-1 truncate font-medium">{cat.label_es}</span>
          <code className="text-[10px] text-muted-foreground flex-shrink-0">{cat.key}</code>

          {/* Acciones */}
          <Button
            size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0"
            onClick={() => onToggle(cat.id, !cat.activo)}
            title={cat.activo ? "Desactivar" : "Activar"}
          >
            {cat.activo
              ? <ToggleRight className="h-3.5 w-3.5 text-green-500" />
              : <ToggleLeft  className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={startEdit}>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          {confirm ? (
            <>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(cat.id)}>
                <Check className="h-3 w-3 text-red-500" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirm(false)}>
                <X className="h-3 w-3 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={() => setConfirm(true)}>
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
            </Button>
          )}
        </>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_FORM: CategoriaInsert = { key: "", label_es: "", icon_emoji: "📍", color_hex: "#6B7280" };

export const CategoryManager = () => {
  const { categorias, loading, saving, reload, insert, update, remove, toggleActivo, reorder } =
    useComercialCategorias(false); // incluir inactivas para admin

  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState<CategoriaInsert>({ ...EMPTY_FORM });

  // Drag-and-drop state
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const handleDragStart = (i: number) => { dragIdx.current = i; };
  const handleDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (overIdx !== i) setOverIdx(i);
  };
  const handleDrop = (targetIdx: number) => {
    const srcIdx = dragIdx.current;
    if (srcIdx === null || srcIdx === targetIdx) return;
    const next = [...categorias];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(targetIdx, 0, moved);
    reorder(next);
    dragIdx.current = null;
    setOverIdx(null);
  };
  const handleDragEnd = () => {
    dragIdx.current = null;
    setOverIdx(null);
  };

  const handleAdd = async () => {
    if (!form.key.trim() || !form.label_es.trim()) return;
    const ok = await insert(form);
    if (ok) { setForm({ ...EMPTY_FORM }); setShowForm(false); }
  };

  return (
    <div className="flex flex-col gap-2 p-1">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-muted-foreground">
          Arrastra para reordenar · {categorias.length} categorías
        </p>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* Lista drag-and-drop */}
      <div className="space-y-1">
        {categorias.map((cat, i) => (
          <CatRow
            key={cat.id}
            cat={cat}
            isDragging={dragIdx.current === i}
            isOver={overIdx === i}
            onDragStart={() => handleDragStart(i)}
            onDragOver={e => handleDragOver(e, i)}
            onDrop={() => handleDrop(i)}
            onDragEnd={handleDragEnd}
            onUpdate={update}
            onRemove={remove}
            onToggle={toggleActivo}
          />
        ))}
      </div>

      {/* Formulario nueva categoría */}
      {showForm ? (
        <div className="mt-2 rounded-lg border border-border/50 bg-surface-2/30 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-foreground">Nueva categoría</p>
          <div className="flex gap-2">
            <Input
              value={form.icon_emoji ?? ""}
              onChange={e => setForm(p => ({ ...p, icon_emoji: e.target.value }))}
              className="h-8 w-14 text-center text-[16px]"
              placeholder="📍"
              maxLength={4}
            />
            <input
              type="color"
              value={form.color_hex ?? "#6B7280"}
              onChange={e => setForm(p => ({ ...p, color_hex: e.target.value }))}
              className="h-8 w-10 cursor-pointer rounded border border-border/40"
            />
            <Input
              value={form.label_es}
              onChange={e => setForm(p => ({ ...p, label_es: e.target.value }))}
              className="h-8 flex-1 text-[12px]"
              placeholder="Nombre visible (ej: Veterinarias)"
            />
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={form.key}
              onChange={e => setForm(p => ({ ...p, key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
              className="h-8 flex-1 font-mono text-[11px]"
              placeholder="clave_interna (ej: veterinaria)"
            />
            <p className="text-[10px] text-muted-foreground">clave única, sin espacios</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd} disabled={saving || !form.key.trim() || !form.label_es.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Crear categoría
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline" size="sm"
          onClick={() => setShowForm(true)}
          className="mt-1 w-full gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva categoría
        </Button>
      )}

      <p className="px-1 text-[10px] text-muted-foreground">
        La clave interna debe coincidir con el valor <code>categoria</code> en la tabla <code>comercio_poi</code>.
        Nuevas categorías requieren también agregar los tags OSM correspondientes al ETL.
      </p>
    </div>
  );
};
