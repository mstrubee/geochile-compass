import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save, Shield, ShieldOff, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { SECTIONS, type SectionKey } from "@/config/sections";

type SectionPerm = { view: boolean; edit: boolean };
type PermMap = Partial<Record<SectionKey, SectionPerm>>;

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissions: PermMap;
}

interface AdminUser {
  user_id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
}

interface Assignment {
  id: string;
  user_id: string;
  custom_role_id: string;
}

export const UsersAdminSection = () => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [newRoleName, setNewRoleName] = useState("");
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  // Crear usuario
  const [nuEmail, setNuEmail] = useState("");
  const [nuPass, setNuPass] = useState("");
  const [nuRole, setNuRole] = useState<string>("none"); // "none" | "admin" | <custom_role_id>
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [u, r, a] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase.from("custom_roles").select("*").order("name"),
      supabase.from("user_role_assignments").select("*"),
    ]);
    if (u.error) toast.error(`Usuarios: ${u.error.message}`);
    if (r.error) toast.error(`Roles: ${r.error.message}`);
    if (a.error) toast.error(`Asignaciones: ${a.error.message}`);
    setUsers((u.data as AdminUser[]) ?? []);
    setRoles(((r.data as Array<{ id: string; name: string; description: string | null; permissions: PermMap }>) ?? []).map((x) => ({
      ...x,
      permissions: (x.permissions ?? {}) as PermMap,
    })));
    setAssignments((a.data as Assignment[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assignmentsByUser = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!map.has(a.user_id)) map.set(a.user_id, new Set());
      map.get(a.user_id)!.add(a.custom_role_id);
    }
    return map;
  }, [assignments]);

  const createUser = async () => {
    const email = nuEmail.trim();
    if (!email || nuPass.length < 6) {
      toast.error("Email y contraseña (mínimo 6 caracteres) requeridos");
      return;
    }
    setCreating(true);
    const { error } = await (supabase as any).rpc("admin_create_user", {
      p_email: email,
      p_password: nuPass,
      p_make_admin: nuRole === "admin",
      p_custom_role_id: nuRole !== "none" && nuRole !== "admin" ? nuRole : null,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Usuario ${email} creado`);
    setNuEmail("");
    setNuPass("");
    setNuRole("none");
    void refresh();
  };

  const createRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    const { error } = await supabase.from("custom_roles").insert({ name, permissions: {} });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewRoleName("");
    toast.success(`Rol "${name}" creado`);
    void refresh();
  };

  const deleteRole = async (id: string, name: string) => {
    if (!confirm(`Eliminar el rol "${name}"? Se quitará de todos los usuarios asignados.`)) return;
    const { error } = await supabase.from("custom_roles").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rol eliminado");
    void refresh();
  };

  const saveRole = async (role: CustomRole) => {
    setSavingRoleId(role.id);
    const { error } = await supabase
      .from("custom_roles")
      .update({
        name: role.name.trim(),
        description: role.description,
        permissions: role.permissions,
      })
      .eq("id", role.id);
    setSavingRoleId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rol guardado");
    setEditingRole(null);
    void refresh();
  };

  const toggleAdmin = async (u: AdminUser) => {
    if (u.is_admin) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", u.user_id)
        .eq("role", "admin");
      if (error) return toast.error(error.message);
      toast.success(`${u.email} ya no es admin`);
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: u.user_id, role: "admin" });
      if (error) return toast.error(error.message);
      toast.success(`${u.email} ahora es admin`);
    }
    void refresh();
  };

  const toggleAssignment = async (userId: string, roleId: string, currentlyAssigned: boolean) => {
    if (currentlyAssigned) {
      const { error } = await supabase
        .from("user_role_assignments")
        .delete()
        .eq("user_id", userId)
        .eq("custom_role_id", roleId);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("user_role_assignments")
        .insert({ user_id: userId, custom_role_id: roleId });
      if (error) return toast.error(error.message);
    }
    void refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Crear usuario */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-surface/40 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">Crear usuario</h3>
        <p className="text-xs text-muted-foreground">
          Solo el administrador crea cuentas. El usuario entra con el email y la contraseña que definas aquí.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            placeholder="email@ejemplo.com"
            value={nuEmail}
            onChange={(e) => setNuEmail(e.target.value)}
            className="h-9 max-w-[240px]"
          />
          <Input
            type="text"
            placeholder="Contraseña (mín. 6)"
            value={nuPass}
            onChange={(e) => setNuPass(e.target.value)}
            className="h-9 max-w-[200px] font-mono"
          />
          <Select value={nuRole} onValueChange={setNuRole}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin rol (usuario básico)</SelectItem>
              <SelectItem value="admin">Administrador</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={createUser} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Crear usuario
          </Button>
        </div>
      </div>

      {/* Roles */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Roles personalizados</h3>
        <div className="flex gap-2">
          <Input
            placeholder="Nombre del rol (ej: Analista comercial)"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createRole()}
          />
          <Button onClick={createRole}>
            <Plus className="h-4 w-4" /> Crear rol
          </Button>
        </div>

        {roles.length === 0 ? (
          <p className="rounded-md border border-border/40 bg-muted/30 p-3 text-xs text-muted-foreground">
            Aún no hay roles personalizados. Crea uno arriba para empezar.
          </p>
        ) : (
          <div className="space-y-2">
            {roles.map((role) => {
              const isEditing = editingRole?.id === role.id;
              const draft = isEditing ? editingRole! : role;
              return (
                <div key={role.id} className="rounded-lg border border-border/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    {isEditing ? (
                      <Input
                        value={draft.name}
                        onChange={(e) => setEditingRole({ ...draft, name: e.target.value })}
                        className="h-8 max-w-[220px]"
                      />
                    ) : (
                      <h4 className="font-medium">{role.name}</h4>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {Object.entries(role.permissions).filter(([, v]) => v?.view).length} secciones visibles
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void saveRole(draft)}
                            disabled={savingRoleId === role.id}
                          >
                            <Save className="h-4 w-4" /> Guardar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingRole(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingRole({ ...role, permissions: { ...role.permissions } })}
                          >
                            Editar permisos
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => void deleteRole(role.id, role.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="overflow-hidden rounded-md border border-border/40">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="p-2 text-left">Sección</th>
                            <th className="p-2 text-center w-20">Ver</th>
                            <th className="p-2 text-center w-20">Editar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {SECTIONS.map((s) => {
                            const p = draft.permissions[s.key] ?? { view: false, edit: false };
                            return (
                              <tr key={s.key} className="border-t border-border/40">
                                <td className="p-2">
                                  <div>{s.label}</div>
                                  <div className="text-xs text-muted-foreground">{s.description}</div>
                                </td>
                                <td className="p-2 text-center">
                                  <Checkbox
                                    checked={p.view}
                                    onCheckedChange={(c) => {
                                      const view = !!c;
                                      setEditingRole({
                                        ...draft,
                                        permissions: {
                                          ...draft.permissions,
                                          [s.key]: { view, edit: view ? p.edit : false },
                                        },
                                      });
                                    }}
                                  />
                                </td>
                                <td className="p-2 text-center">
                                  {s.supportsEdit ? (
                                    <Checkbox
                                      checked={p.edit}
                                      disabled={!p.view}
                                      onCheckedChange={(c) => {
                                        setEditingRole({
                                          ...draft,
                                          permissions: {
                                            ...draft.permissions,
                                            [s.key]: { view: p.view, edit: !!c },
                                          },
                                        });
                                      }}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Usuarios */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Usuarios registrados ({users.length})
        </h3>
        <div className="overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left w-32">Admin</th>
                <th className="p-2 text-left">Roles asignados</th>
                <th className="p-2 text-left w-48">Asignar rol</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const userRoleIds = assignmentsByUser.get(u.user_id) ?? new Set<string>();
                const assignedRoles = roles.filter((r) => userRoleIds.has(r.id));
                const availableRoles = roles.filter((r) => !userRoleIds.has(r.id));
                return (
                  <tr key={u.user_id} className="border-t border-border/40 align-top">
                    <td className="p-2">
                      <div className="font-medium">{u.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant={u.is_admin ? "destructive" : "outline"}
                        onClick={() => void toggleAdmin(u)}
                      >
                        {u.is_admin ? (
                          <>
                            <ShieldOff className="h-4 w-4" /> Quitar
                          </>
                        ) : (
                          <>
                            <Shield className="h-4 w-4" /> Hacer admin
                          </>
                        )}
                      </Button>
                    </td>
                    <td className="p-2">
                      {u.is_admin ? (
                        <span className="text-xs text-muted-foreground">
                          Admin (acceso total)
                        </span>
                      ) : assignedRoles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Sin roles</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {assignedRoles.map((r) => (
                            <button
                              key={r.id}
                              onClick={() => void toggleAssignment(u.user_id, r.id, true)}
                              className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs hover:border-destructive hover:text-destructive"
                              title="Quitar rol"
                            >
                              {r.name} ×
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {!u.is_admin && availableRoles.length > 0 && (
                        <Select
                          value=""
                          onValueChange={(rid) => void toggleAssignment(u.user_id, rid, false)}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="+ asignar rol" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableRoles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                <UserPlus className="mr-1 inline h-3 w-3" /> {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
