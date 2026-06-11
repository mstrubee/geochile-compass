/**
 * TerritorialLayerManagerDialog
 * ─────────────────────────────
 * Dialog ADMIN para gestionar capas territoriales:
 *  • Tab "Organizar"        — drag & drop reorder, mover entre grupos, fusionar, renombrar, crear grupo
 *  • Tab "Actualizar CSV"   — reemplazar los features de una capa desde CSV
 *  • Tab "Iconos y colores" — personalizar ícono y color por grupo y por capa
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  GripVertical, Merge, Pencil, Plus, Trash2, Upload, Check, X,
  RefreshCw, ChevronDown, ChevronRight, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";
import type { TerritorialGroup, TerritorialLayer } from "@/types/territorial";
import {
  reorderLayersInGroup,
  moveLayerToGroup,
  reorderGroups,
  mergeLayers,
  replaceFeaturesFromCsv,
  updateLayerStyle,
  updateGroupStyle,
  renameLayer,
  renameGroup,
  createGroup,
  deleteLayer,
  deleteGroup,
  type CsvFeatureRow,
} from "@/services/territorialLayerAdmin";

// ── Emojis / íconos preset ────────────────────────────────────────────────────

const ICON_PRESETS = [
  "🔧","🔩","⚙️","🛞","🔋","⛽","🚗","🏎","🚕","🚙","🛻","🚐","🚌","🏍",
  "🚑","🚒","🚛","🚚","🏁","📍","⭐","🏪","🏬","🏢","🏭","📦","🔴","🟡",
  "🟢","🔵","⚪","🟠","🟣","⚫","🟤","🏆","⚠️","✅","❌","🔑",
];

// ── Colores preset ────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  "#F59E0B","#EF4444","#3B82F6","#10B981","#8B5CF6",
  "#EC4899","#06B6D4","#F97316","#14B8A6","#6B7280",
  "#1E40AF","#065F46","#7C3AED","#B45309","#BE185D",
];

// ── Mini componentes de UI ────────────────────────────────────────────────────

const ColorDot = ({
  color,
  onClick,
}: {
  color: string | null;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="h-5 w-5 flex-shrink-0 rounded-full border border-white/20 shadow-sm transition-transform hover:scale-110"
    style={{ background: color || "#6B7280" }}
    title="Editar color"
  />
);

const ColorPicker = ({
  current,
  onSelect,
  onClose,
}: {
  current: string | null;
  onSelect: (c: string) => void;
  onClose: () => void;
}) => (
  <div className="z-50 rounded-xl border border-border bg-surface-1 p-3 shadow-xl">
    <div className="mb-2 flex flex-wrap gap-1.5">
      {COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => { onSelect(c); onClose(); }}
          className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            background: c,
            borderColor: current === c ? "#fff" : "transparent",
          }}
        />
      ))}
    </div>
    <div className="flex items-center gap-1">
      <Input
        className="h-7 w-24 px-1 text-xs"
        defaultValue={current || ""}
        placeholder="#hexcode"
        maxLength={7}
        onBlur={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { onSelect(e.target.value); onClose(); } }}
      />
      <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

const IconPicker = ({
  current,
  onSelect,
  onClose,
}: {
  current: string | null;
  onSelect: (i: string | null) => void;
  onClose: () => void;
}) => (
  <div className="z-50 rounded-xl border border-border bg-surface-1 p-3 shadow-xl">
    <div className="mb-2 flex flex-wrap gap-1">
      <button
        type="button"
        onClick={() => { onSelect(null); onClose(); }}
        className={`h-8 w-8 rounded-lg text-xs border transition-colors hover:bg-surface-2 ${!current ? "border-primary" : "border-border"}`}
        title="Sin ícono (círculo)"
      >
        ●
      </button>
      {ICON_PRESETS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => { onSelect(emoji); onClose(); }}
          className={`h-8 w-8 rounded-lg text-base transition-colors hover:bg-surface-2 ${current === emoji ? "border-2 border-primary" : "border border-border"}`}
        >
          {emoji}
        </button>
      ))}
    </div>
    <div className="flex items-center gap-1">
      <Input
        className="h-7 flex-1 px-1 text-xs"
        defaultValue={current || ""}
        placeholder="URL o emoji personalizado"
        onBlur={(e) => { if (e.target.value) { onSelect(e.target.value); onClose(); } }}
      />
      <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

// ── Tab 1: Organizar ──────────────────────────────────────────────────────────

type EditingName = { kind: "group" | "layer"; id: string; value: string } | null;

const OrganizeTab = ({
  groups,
  layers,
  onRefresh,
}: {
  groups: TerritorialGroup[];
  layers: TerritorialLayer[];
  onRefresh: () => void;
}) => {
  const [localGroups, setLocalGroups]   = useState<TerritorialGroup[]>([]);
  const [localLayers, setLocalLayers]   = useState<TerritorialLayer[]>([]);
  const [selected,    setSelected]      = useState<Set<string>>(new Set());
  const [editing,     setEditing]       = useState<EditingName>(null);
  const [expanded,    setExpanded]      = useState<Set<string>>(new Set(groups.map((g) => g.id)));
  const [dragInfo,    setDragInfo]      = useState<{
    type: "layer" | "group";
    id: string;
    srcGroupId?: string;
  } | null>(null);
  const [dragOverId,  setDragOverId]    = useState<string | null>(null);
  const [mergeTarget, setMergeTarget]   = useState<string>("");
  const [busy,        setBusy]          = useState(false);

  useEffect(() => { setLocalGroups([...groups]); }, [groups]);
  useEffect(() => { setLocalLayers([...layers]); }, [layers]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDragStart = (
    type: "layer" | "group",
    id: string,
    srcGroupId?: string,
  ) => setDragInfo({ type, id, srcGroupId });

  const handleDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    setDragOverId(overId);
  };

  const handleLayerDrop = async (targetGroupId: string, beforeLayerId?: string) => {
    if (!dragInfo || dragInfo.type !== "layer") return;
    const { id: layerId, srcGroupId } = dragInfo;
    setDragInfo(null);
    setDragOverId(null);

    const sameGroup = srcGroupId === targetGroupId;
    let newGroupLayers = localLayers.filter((l) => l.group_id === targetGroupId);

    if (!sameGroup) {
      // Mover entre grupos
      const maxOrder = newGroupLayers.reduce((m, l) => Math.max(m, l.order_index), -1);
      const updatedLayer = { ...localLayers.find((l) => l.id === layerId)!, group_id: targetGroupId, order_index: maxOrder + 1 };
      setLocalLayers((prev) => prev.map((l) => l.id === layerId ? updatedLayer : l));
      setBusy(true);
      try {
        await moveLayerToGroup(layerId, targetGroupId, maxOrder);
        toast.success("Capa movida");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      } finally { setBusy(false); onRefresh(); }
      return;
    }

    // Reordenar dentro del grupo
    const movedLayer = localLayers.find((l) => l.id === layerId);
    if (!movedLayer) return;
    newGroupLayers = newGroupLayers.filter((l) => l.id !== layerId);
    if (beforeLayerId) {
      const idx = newGroupLayers.findIndex((l) => l.id === beforeLayerId);
      newGroupLayers.splice(idx, 0, movedLayer);
    } else {
      newGroupLayers.push(movedLayer);
    }
    const reordered = newGroupLayers.map((l, i) => ({ ...l, order_index: i }));
    setLocalLayers((prev) => {
      const otherLayers = prev.filter((l) => l.group_id !== targetGroupId);
      return [...otherLayers, ...reordered];
    });
    setBusy(true);
    try {
      await reorderLayersInGroup(reordered.map((l) => l.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reordenar");
    } finally { setBusy(false); }
  };

  const handleGroupDrop = async (beforeGroupId?: string) => {
    if (!dragInfo || dragInfo.type !== "group") return;
    const { id: groupId } = dragInfo;
    setDragInfo(null);
    setDragOverId(null);
    let ordered = localGroups.filter((g) => g.id !== groupId);
    const moved = localGroups.find((g) => g.id === groupId)!;
    if (beforeGroupId) {
      const idx = ordered.findIndex((g) => g.id === beforeGroupId);
      ordered.splice(idx, 0, moved);
    } else {
      ordered.push(moved);
    }
    setLocalGroups(ordered);
    setBusy(true);
    try {
      await reorderGroups(ordered.map((g) => g.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reordenar grupos");
    } finally { setBusy(false); }
  };

  // ── Fusionar ──────────────────────────────────────────────────────────────

  const doMerge = async () => {
    if (selected.size < 2 || !mergeTarget) return;
    const target = mergeTarget;
    const sources = [...selected].filter((id) => id !== target);
    setBusy(true);
    try {
      await mergeLayers(sources, target);
      setSelected(new Set());
      setMergeTarget("");
      toast.success(`${sources.length} capa(s) fusionada(s)`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al fusionar");
    } finally { setBusy(false); }
  };

  // ── Renombrar ─────────────────────────────────────────────────────────────

  const commitRename = async () => {
    if (!editing || !editing.value.trim()) { setEditing(null); return; }
    setBusy(true);
    try {
      if (editing.kind === "group") {
        await renameGroup(editing.id, editing.value.trim());
        setLocalGroups((prev) => prev.map((g) => g.id === editing.id ? { ...g, name: editing.value.trim() } : g));
      } else {
        await renameLayer(editing.id, editing.value.trim());
        setLocalLayers((prev) => prev.map((l) => l.id === editing.id ? { ...l, name: editing.value.trim() } : l));
      }
      toast.success("Renombrado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al renombrar");
    } finally { setBusy(false); setEditing(null); }
  };

  // ── Eliminar ─────────────────────────────────────────────────────────────

  const doDeleteLayer = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar la capa "${name}" y todos sus features? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await deleteLayer(id);
      setLocalLayers((prev) => prev.filter((l) => l.id !== id));
      toast.success(`Capa "${name}" eliminada`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    } finally { setBusy(false); }
  };

  const doDeleteGroup = async (id: string, name: string) => {
    const layerCount = localLayers.filter((l) => l.group_id === id).length;
    if (!confirm(`¿Eliminar el grupo "${name}" con ${layerCount} capas? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await deleteGroup(id);
      setLocalGroups((prev) => prev.filter((g) => g.id !== id));
      setLocalLayers((prev) => prev.filter((l) => l.group_id !== id));
      toast.success(`Grupo "${name}" eliminado`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar grupo");
    } finally { setBusy(false); }
  };

  // ── Crear grupo ───────────────────────────────────────────────────────────

  const doCreateGroup = async () => {
    const name = window.prompt("Nombre del nuevo grupo:");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const maxOrder = localGroups.reduce((m, g) => Math.max(m, g.order_index), -1);
      await createGroup(name.trim(), "#6B7280", null, maxOrder + 1);
      toast.success(`Grupo "${name.trim()}" creado`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear grupo");
    } finally { setBusy(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedLayers = localLayers.filter((l) => selected.has(l.id));
  const selectedForMerge = selectedLayers.length >= 2;

  return (
    <div className="flex flex-col gap-3">
      {/* Barra de fusión flotante */}
      {selectedForMerge && (
        <div className="flex items-center gap-2 rounded-xl border border-brand-blue/30 bg-brand-blue/10 px-3 py-2 text-sm">
          <Merge className="h-4 w-4 text-brand-blue" />
          <span className="flex-1 text-xs">
            {selectedLayers.length} capas seleccionadas — fusionar en:
          </span>
          <select
            className="rounded-lg border border-border bg-surface-1 px-2 py-1 text-xs"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
          >
            <option value="">— Destino —</option>
            {selectedLayers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            disabled={!mergeTarget || busy}
            onClick={doMerge}
          >
            Fusionar
          </Button>
          <button type="button" onClick={() => { setSelected(new Set()); setMergeTarget(""); }}>
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      )}

      {/* Lista de grupos */}
      {localGroups.map((group) => {
        const groupLayers = localLayers
          .filter((l) => l.group_id === group.id)
          .sort((a, b) => a.order_index - b.order_index);
        const isExpanded = expanded.has(group.id);

        return (
          <div
            key={group.id}
            className={[
              "rounded-xl border transition-colors",
              dragOverId === group.id ? "border-brand-blue bg-brand-blue/5" : "border-border bg-surface-1",
            ].join(" ")}
            onDragOver={(e) => { e.preventDefault(); setDragOverId(group.id); }}
            onDrop={() => handleLayerDrop(group.id)}
          >
            {/* Header del grupo */}
            <div className="flex items-center gap-2 px-3 py-2">
              {/* Drag handle del grupo */}
              <div
                draggable
                onDragStart={() => handleDragStart("group", group.id)}
                className="cursor-grab text-muted-foreground hover:text-foreground"
                title="Arrastrar para reordenar grupo"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(`before_group_${group.id}`); }}
                onDrop={(e) => { e.stopPropagation(); handleGroupDrop(group.id); }}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ background: group.color || "#F59E0B" }}
              />

              {/* Nombre editable */}
              {editing?.kind === "group" && editing.id === group.id ? (
                <Input
                  autoFocus
                  className="h-6 flex-1 text-xs"
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }}
                  onBlur={commitRename}
                />
              ) : (
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-medium"
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(group.id) ? n.delete(group.id) : n.add(group.id); return n; })}
                >
                  {group.name}
                  <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                    {groupLayers.length} capas
                  </span>
                </button>
              )}

              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setEditing({ kind: "group", id: group.id, value: group.name })}
                title="Renombrar grupo"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="text-destructive/60 hover:text-destructive"
                onClick={() => doDeleteGroup(group.id, group.name)}
                title="Eliminar grupo"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(group.id) ? n.delete(group.id) : n.add(group.id); return n; })}>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>

            {/* Sub-capas */}
            {isExpanded && (
              <div className="border-t border-border px-2 pb-2 pt-1">
                {groupLayers.length === 0 && (
                  <p className="px-2 py-1 text-[11px] text-text-muted">Sin capas.</p>
                )}
                {groupLayers.map((layer) => (
                  <div
                    key={layer.id}
                    draggable
                    onDragStart={() => handleDragStart("layer", layer.id, group.id)}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(layer.id); }}
                    onDrop={(e) => { e.stopPropagation(); handleLayerDrop(group.id, layer.id); }}
                    className={[
                      "mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                      dragOverId === layer.id ? "bg-brand-blue/10" : "hover:bg-surface-2/60",
                    ].join(" ")}
                  >
                    {/* Checkbox selección fusión */}
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-border"
                      checked={selected.has(layer.id)}
                      onChange={() => toggleSelect(layer.id)}
                    />
                    {/* Drag handle */}
                    <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground" />

                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ background: layer.color || group.color || "#F59E0B" }}
                    />

                    {/* Nombre editable */}
                    {editing?.kind === "layer" && editing.id === layer.id ? (
                      <Input
                        autoFocus
                        className="h-5 flex-1 text-xs"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span className="flex-1 text-xs">{layer.name}</span>
                    )}

                    <span className="font-mono text-[10px] text-text-muted">{layer.feature_count} pts</span>

                    {/* Grupo destino (mover) */}
                    <select
                      className="h-5 rounded border border-border bg-surface-1 px-1 text-[10px]"
                      value={layer.group_id}
                      title="Mover a grupo"
                      onChange={async (e) => {
                        const newGroupId = e.target.value;
                        if (newGroupId === layer.group_id) return;
                        const maxOrder = localLayers
                          .filter((l) => l.group_id === newGroupId)
                          .reduce((m, l) => Math.max(m, l.order_index), -1);
                        setBusy(true);
                        try {
                          await moveLayerToGroup(layer.id, newGroupId, maxOrder);
                          setLocalLayers((prev) => prev.map((l) => l.id === layer.id ? { ...l, group_id: newGroupId, order_index: maxOrder + 1 } : l));
                          toast.success("Capa movida");
                        } catch (er) {
                          toast.error(er instanceof Error ? er.message : "Error");
                        } finally { setBusy(false); }
                      }}
                    >
                      {localGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing({ kind: "layer", id: layer.id, value: layer.name })}
                      title="Renombrar capa"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="text-destructive/60 hover:text-destructive"
                      onClick={() => doDeleteLayer(layer.id, layer.name)}
                      title="Eliminar capa"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Crear grupo */}
      <button
        type="button"
        onClick={doCreateGroup}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        Crear grupo nuevo
      </button>
    </div>
  );
};

// ── Tab 2: Actualizar desde CSV ───────────────────────────────────────────────

const CSV_SEPARATORS = [",", ";", "\t", "|"];

const detectSeparator = (firstLine: string): string => {
  const counts = CSV_SEPARATORS.map((s) => ({ sep: s, n: firstLine.split(s).length }));
  return counts.sort((a, b) => b.n - a.n)[0].sep;
};

const parseCsvContent = (content: string): { headers: string[]; rows: string[][] } => {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = detectSeparator(lines[0]);
  const parseRow = (line: string) => {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === sep && !inQuotes) { result.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
};

const LAT_COLS  = ["lat", "latitude", "latitud", "y", "lat_decimal", "latdecimal"];
const LNG_COLS  = ["lng", "lon", "longitude", "longitud", "x", "lng_decimal", "lon_decimal", "long"];
const NAME_COLS = ["name", "nombre", "title", "titulo", "descripcion", "description", "label", "etiqueta"];

const detectCol = (headers: string[], candidates: string[]): string | null =>
  headers.find((h) => candidates.includes(h.toLowerCase().trim())) ?? null;

const CsvUpdateTab = ({
  groups,
  layers,
  onRefresh,
}: {
  groups: TerritorialGroup[];
  layers: TerritorialLayer[];
  onRefresh: () => void;
}) => {
  const [selectedLayerId, setSelectedLayerId] = useState<string>("");
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [latCol,   setLatCol]   = useState<string>("");
  const [lngCol,   setLngCol]   = useState<string>("");
  const [nameCol,  setNameCol]  = useState<string>("");
  const [busy,     setBusy]     = useState(false);
  const [filename, setFilename] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const parsed = parseCsvContent(content);
      setCsvData(parsed);
      setLatCol(detectCol(parsed.headers, LAT_COLS) || "");
      setLngCol(detectCol(parsed.headers, LNG_COLS) || "");
      setNameCol(detectCol(parsed.headers, NAME_COLS) || "");
    };
    reader.readAsText(file, "utf-8");
  };

  const doReplace = async () => {
    if (!selectedLayerId || !csvData || !latCol || !lngCol) return;
    const layer = layers.find((l) => l.id === selectedLayerId);
    if (!confirm(
      `¿Reemplazar los ${layer?.feature_count ?? "?"} puntos de "${layer?.name}" con ${csvData.rows.length} filas del CSV?\n\nEsta acción no se puede deshacer.`,
    )) return;

    const latIdx  = csvData.headers.indexOf(latCol);
    const lngIdx  = csvData.headers.indexOf(lngCol);
    const nameIdx = nameCol ? csvData.headers.indexOf(nameCol) : -1;

    const rows: CsvFeatureRow[] = [];
    for (const row of csvData.rows) {
      const lat = parseFloat(row[latIdx]);
      const lng = parseFloat(row[lngIdx]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      const name = nameIdx >= 0 ? (row[nameIdx] || "") : "";
      const properties: Record<string, unknown> = {};
      csvData.headers.forEach((h, i) => {
        if (i !== latIdx && i !== lngIdx) properties[h] = row[i];
      });
      rows.push({ lat, lng, name, properties });
    }

    setBusy(true);
    try {
      const n = await replaceFeaturesFromCsv(selectedLayerId, rows);
      toast.success(`${n} puntos cargados en "${layer?.name}"`);
      setCsvData(null);
      setFilename("");
      if (fileRef.current) fileRef.current.value = "";
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reemplazar");
    } finally { setBusy(false); }
  };

  const validRows = csvData
    ? csvData.rows.filter((r) => {
        const li = csvData.headers.indexOf(latCol);
        const lo = csvData.headers.indexOf(lngCol);
        return li >= 0 && lo >= 0 && !isNaN(parseFloat(r[li])) && !isNaN(parseFloat(r[lo]));
      }).length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de capa */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Capa a actualizar
        </label>
        <select
          className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-sm"
          value={selectedLayerId}
          onChange={(e) => setSelectedLayerId(e.target.value)}
        >
          <option value="">— Seleccionar capa —</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {layers
                .filter((l) => l.group_id === g.id)
                .sort((a, b) => a.order_index - b.order_index)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.feature_count} pts)
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Upload CSV */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Archivo CSV
        </label>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface-2/50 px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
          <Upload className="h-6 w-6" />
          {filename ? (
            <span className="font-medium text-foreground">{filename}</span>
          ) : (
            <span>Arrastrar CSV aquí o hacer clic</span>
          )}
          <span className="text-[11px]">Separadores soportados: , ; Tab |</span>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={onFileChange} />
        </label>
      </div>

      {/* Configurar columnas */}
      {csvData && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Columna latitud *", value: latCol, set: setLatCol },
              { label: "Columna longitud *", value: lngCol, set: setLngCol },
              { label: "Columna nombre", value: nameCol, set: setNameCol },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
                <select
                  className="w-full rounded-lg border border-border bg-surface-1 px-2 py-1 text-xs"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                >
                  <option value="">— Auto —</option>
                  {csvData.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Vista previa */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Vista previa (5 primeras filas) — {validRows} de {csvData.rows.length} filas válidas
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-surface-2">
                    {csvData.headers.slice(0, 6).map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-medium">
                        {h}
                        {h === latCol && <span className="ml-1 text-brand-green">✓lat</span>}
                        {h === lngCol && <span className="ml-1 text-brand-blue">✓lng</span>}
                        {h === nameCol && <span className="ml-1 text-yellow-500">✓nom</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvData.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-surface-1" : "bg-surface-2/50"}>
                      {row.slice(0, 6).map((cell, j) => (
                        <td key={j} className="max-w-[120px] truncate px-2 py-1">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Advertencia + botón confirmar */}
          <div className="flex items-start gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              Se eliminarán <strong>todos los puntos existentes</strong> de la capa y se cargarán los {validRows} del CSV.
            </p>
          </div>

          <Button
            onClick={doReplace}
            disabled={busy || !selectedLayerId || !latCol || !lngCol || validRows === 0}
            variant="destructive"
            className="gap-2"
          >
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Reemplazar {validRows} puntos
          </Button>
        </>
      )}
    </div>
  );
};

// ── Tab 3: Iconos y colores ───────────────────────────────────────────────────

type StyleMap = {
  groups: Record<string, { icon: string | null; color: string | null }>;
  layers: Record<string, { icon: string | null; color: string | null }>;
};

const StylesTab = ({
  groups,
  layers,
  onRefresh,
}: {
  groups: TerritorialGroup[];
  layers: TerritorialLayer[];
  onRefresh: () => void;
}) => {
  const [styles, setStyles] = useState<StyleMap>({ groups: {}, layers: {} });
  const [picker, setPicker] = useState<{
    kind: "group" | "layer";
    id: string;
    type: "color" | "icon";
    pos: { x: number; y: number };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const gs: StyleMap["groups"] = {};
    groups.forEach((g) => { gs[g.id] = { icon: g.icon, color: g.color }; });
    const ls: StyleMap["layers"] = {};
    layers.forEach((l) => { ls[l.id] = { icon: l.icon, color: l.color }; });
    setStyles({ groups: gs, layers: ls });
    setDirty(false);
  }, [groups, layers]);

  const setGroupStyle = (id: string, key: "icon" | "color", val: string | null) => {
    setStyles((prev) => ({ ...prev, groups: { ...prev.groups, [id]: { ...prev.groups[id], [key]: val } } }));
    setDirty(true);
  };
  const setLayerStyle = (id: string, key: "icon" | "color", val: string | null) => {
    setStyles((prev) => ({ ...prev, layers: { ...prev.layers, [id]: { ...prev.layers[id], [key]: val } } }));
    setDirty(true);
  };

  const doSave = async () => {
    setBusy(true);
    try {
      const ops = [
        ...Object.entries(styles.groups).map(([id, s]) => updateGroupStyle(id, s)),
        ...Object.entries(styles.layers).map(([id, s]) => updateLayerStyle(id, s)),
      ];
      await Promise.all(ops);
      toast.success("Estilos guardados");
      setDirty(false);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar estilos");
    } finally { setBusy(false); }
  };

  const closePicker = () => setPicker(null);

  const openPicker = (
    kind: "group" | "layer",
    id: string,
    type: "color" | "icon",
    e: React.MouseEvent,
  ) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicker({ kind, id, type, pos: { x: rect.left, y: rect.bottom + 4 } });
  };

  const handleStyleSelect = (val: string | null) => {
    if (!picker) return;
    if (picker.type === "color") {
      picker.kind === "group"
        ? setGroupStyle(picker.id, "color", val)
        : setLayerStyle(picker.id, "color", val);
    } else {
      picker.kind === "group"
        ? setGroupStyle(picker.id, "icon", val)
        : setLayerStyle(picker.id, "icon", val);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Grupos */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grupos</p>
      {groups.map((g) => {
        const s = styles.groups[g.id] ?? { icon: g.icon, color: g.color };
        return (
          <div key={g.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2">
            <ColorDot color={s.color} onClick={(e: React.MouseEvent) => openPicker("group", g.id, "color", e)} />
            <span className="flex-1 text-sm font-medium">{g.name}</span>
            <button
              type="button"
              onClick={(e) => openPicker("group", g.id, "icon", e)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-base transition-colors hover:border-primary"
              title="Editar ícono del grupo"
            >
              {s.icon || "●"}
            </button>
          </div>
        );
      })}

      {/* Capas */}
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capas</p>
      {groups.map((g) => {
        const gLayers = layers
          .filter((l) => l.group_id === g.id)
          .sort((a, b) => a.order_index - b.order_index);
        if (gLayers.length === 0) return null;
        return (
          <div key={g.id} className="rounded-xl border border-border bg-surface-1">
            <p className="border-b border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{g.name}</p>
            {gLayers.map((l) => {
              const s = styles.layers[l.id] ?? { icon: l.icon, color: l.color };
              return (
                <div key={l.id} className="flex items-center gap-3 px-3 py-2">
                  <ColorDot color={s.color || g.color} onClick={(e: React.MouseEvent) => openPicker("layer", l.id, "color", e)} />
                  <span className="flex-1 text-xs">{l.name}</span>
                  <span className="font-mono text-[10px] text-text-muted">{l.feature_count} pts</span>
                  <button
                    type="button"
                    onClick={(e) => openPicker("layer", l.id, "icon", e)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-base transition-colors hover:border-primary"
                    title="Editar ícono de la capa"
                  >
                    {s.icon || "●"}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Guardar */}
      <Button onClick={doSave} disabled={busy || !dirty} className="mt-2 gap-2">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {dirty ? "Guardar cambios de estilos" : "Sin cambios"}
      </Button>

      {/* Picker flotante */}
      {picker && (
        <>
          <div className="fixed inset-0 z-[1190]" onClick={closePicker} />
          <div
            className="fixed z-[1200]"
            style={{ left: Math.min(picker.pos.x, window.innerWidth - 280), top: picker.pos.y }}
          >
            {picker.type === "color" ? (
              <ColorPicker
                current={picker.kind === "group" ? styles.groups[picker.id]?.color || null : styles.layers[picker.id]?.color || null}
                onSelect={handleStyleSelect}
                onClose={closePicker}
              />
            ) : (
              <IconPicker
                current={picker.kind === "group" ? styles.groups[picker.id]?.icon || null : styles.layers[picker.id]?.icon || null}
                onSelect={handleStyleSelect}
                onClose={closePicker}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ── Dialog principal ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export const TerritorialLayerManagerDialog = ({ open, onClose }: Props) => {
  const { groups, layers, loading, refresh } = useTerritorialLayers();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="z-[1100] flex h-[85vh] max-h-[700px] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            ⚙️ Gestionar capas territoriales
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <Tabs defaultValue="organize" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-5 mt-3 shrink-0 grid w-auto grid-cols-3">
              <TabsTrigger value="organize">Organizar</TabsTrigger>
              <TabsTrigger value="csv">Actualizar CSV</TabsTrigger>
              <TabsTrigger value="styles">Iconos y colores</TabsTrigger>
            </TabsList>

            <TabsContent value="organize" className="flex-1 overflow-y-auto px-5 pb-5 pt-3">
              <OrganizeTab groups={groups} layers={layers} onRefresh={refresh} />
            </TabsContent>

            <TabsContent value="csv" className="flex-1 overflow-y-auto px-5 pb-5 pt-3">
              <CsvUpdateTab groups={groups} layers={layers} onRefresh={refresh} />
            </TabsContent>

            <TabsContent value="styles" className="flex-1 overflow-y-auto px-5 pb-5 pt-3">
              <StylesTab groups={groups} layers={layers} onRefresh={refresh} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
