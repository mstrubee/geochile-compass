import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { ArrowLeft } from "lucide-react";
import { GeminiKeysAdminSection } from "@/components/admin/GeminiKeysAdminSection";

const GeminiKeysAdminPage = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) { navigate("/auth"); return; }
    if (!roleLoading && user && !isAdmin) { navigate("/"); return; }
  }, [user, isAdmin, authLoading, roleLoading, navigate]);

  if (authLoading || roleLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando…</div>;
  }

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl p-6">
        <button onClick={() => navigate("/admin/capas")} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver a Admin
        </button>
        <h1 className="mb-4 font-display text-2xl font-semibold">Gemini API Keys</h1>
        <GeminiKeysAdminSection />
      </div>
    </div>
  );
};

export default GeminiKeysAdminPage;
