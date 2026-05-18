import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTerritorialLayers } from "@/hooks/useTerritorialLayers";
import {
  ALL_ROLES,
  DEFAULT_GROUP_ROLES,
  ROLE_LABELS,
  ROLE_WEIGHTS,
  fetchFolderLayerRoles,
  saveFolderLayerRoles,
  type TerritorialRole,
} from "@/services/folderLayerRolesService";

interface Props {
  folderId: string;
}

export const TerritorialRolesTab = ({ folderId }: Props) => {
  const { groups, layers, loading: layersLoading } = useTerritorialLayers();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Estado en memoria
  const [groupRoles, setGroupRoles] = useState<Record<string, TerritorialRole>>({});
  const [layerOverrides, setLayerOverrides] = useState<Record<string, TerritorialRole>>({});

  // Cargar roles existentes + aplicar defaults
  useEffect(() => {
    if (!folderId || layersLoading) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchFolderLayerRoles(folderId);
        if (cancel) return;
        const gr: Record<string, TerritorialRole> = {};
        const lo: Record<string, TerritorialRole> = {};
        // defaults para todas las categorías
        for (const g of groups) {
          gr[g.id] = DEFAULT_GROUP_ROLES[g.slug] ?? "irrelevante";
        }
        for (const r of rows) {
          if (r.group_id) gr[r.group_id] = r.role;
          else if (r.layer_id) lo[r.layer_id] = r.role;
        }
        setGroupRoles(gr);
        setLayerOverrides(lo);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error cargando roles");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [folderId, groups, layersLoading]);

  const layersByGroup = useMemo(() => {
    const m = new Map<string, typeof layers>();
    for (const l of layers) {
      if (!m.has(l.group_id)) m.set(l.group_id, []);
      m.get(l.group_id)!.push(l);
    }
    return m;
  }, [layers]);

  const toggleExpand = (id: string) =>
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setGroupRole = (groupId: string, role: TerritorialRole) => {
    setGroupRoles((p) => ({ ...p, [groupId]: role }));
  };

  const setLayerRole = (layerId: string, role: TerritorialRole | null) => {
    setLayerOverrides((p) => {
      const n = { ...p };
      if (role === null) delete n[layerId];
      else n[layerId] = role;
      return n;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = [
        ...Object.entries(groupRoles).map(([group_id, role]) => ({ group_id, role })),
        ...Object.entries(layerOverrides).map(([layer_id, role]) => ({ layer_id, role })),
      ];
      await saveFolderLayerRoles(folderId, rows);
      toast.success(
        "Roles guardados. El próximo recálculo de features usará la nueva configuración. Ejecutá \"Calcular features territoriales\" para actualizar.",
        { duration: 7000 },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    const gr: Record<string, TerritorialRole> = {};
    for (const g of groups) gr[g.id] = DEFAULT_GROUP_ROLES[g.slug] ?? "irrelevante";
    setGroupRoles(gr);
    setLayerOverrides({});
  };

  if (loading || layersLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando capas…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-2/40 p-3 text-[11px] text-muted-foreground">
        Asigná un rol a cada categoría. Click <ChevronRight className="inline h-3 w-3" /> para
        personalizar capas individuales. Pesos fijos: Competencia {ROLE_WEIGHTS.competencia},
        Complementario {ROLE_WEIGHTS.complementario}, Ancla {ROLE_WEIGHTS.ancla}, Irrelevante se
        ignora.
      </div>

      <div className="space-y-1">
        {groups.map((g) => {
          const groupRole = groupRoles[g.id] ?? "irrelevante";
          const isOpen = expanded.has(g.id);
          const groupLayers = layersByGroup.get(g.id) ?? [];
          return (
            <div key={g.id} className="rounded-md border border-border/40 bg-surface-2/40">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleExpand(g.id)}
                  className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
                  disabled={groupLayers.length === 0}
                >
                  {groupLayers.length === 0 ? (
                    <span className="h-3 w-3" />
                  ) : isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <div className="flex-1 text-[12px] font-medium">
                  {g.name}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    ({groupLayers.length})
                  </span>
                </div>
                <RoleSelect
                  value={groupRole}
                  onChange={(r) => setGroupRole(g.id, r)}
                />
              </div>

              {isOpen && groupLayers.length > 0 && (
                <div className="border-t border-border/30 px-2 py-1.5">
                  {groupLayers.map((l) => {
                    const override = layerOverrides[l.id];
                    const effective = override ?? groupRole;
                    return (
                      <div
                        key={l.id}
                        className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-3/40"
                      >
                        <span className="ml-6 flex-1 truncate text-[11px]">
                          {l.name}
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({l.feature_count})
                          </span>
                        </span>
                        <RoleSelect
                          value={effective}
                          placeholder={override ? undefined : `Hereda: ${ROLE_LABELS[groupRole]}`}
                          onChange={(r) =>
                            r === groupRole ? setLayerRole(l.id, null) : setLayerRole(l.id, r)
                          }
                          inherited={!override}
                        />
                        {override && (
                          <button
                            type="button"
                            onClick={() => setLayerRole(l.id, null)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                            title="Volver a heredar"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        <Button variant="ghost" size="sm" onClick={handleResetDefaults}>
          <RotateCcw className="mr-1.5 h-3 w-3" /> Restaurar defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3 w-3" />
          )}
          Guardar roles
        </Button>
      </div>
    </div>
  );
};

interface RoleSelectProps {
  value: TerritorialRole;
  onChange: (r: TerritorialRole) => void;
  placeholder?: string;
  inherited?: boolean;
}

const RoleSelect = ({ value, onChange, placeholder, inherited }: RoleSelectProps) => (
  <Select value={value} onValueChange={(v) => onChange(v as TerritorialRole)}>
    <SelectTrigger
      className={`h-7 w-[160px] text-[11px] ${inherited ? "italic text-muted-foreground" : ""}`}
    >
      <SelectValue placeholder={placeholder}>
        {inherited && placeholder ? placeholder : ROLE_LABELS[value]}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      {ALL_ROLES.map((r) => (
        <SelectItem key={r} value={r} className="text-[11px]">
          {ROLE_LABELS[r]}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
