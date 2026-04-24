import { Clock, Hexagon, FileUp, LogIn, LogOut, User as UserIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface HeaderProps {
  mode: "none" | "isochrone" | "microzone";
  onToggleIsochrone: () => void;
  onToggleMicrozone: () => void;
}

export const Header = ({ mode, onToggleIsochrone, onToggleMicrozone }: HeaderProps) => {
  const { user } = useAuth();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
    else toast.success("Sesión cerrada");
  };

  return (
    <header className="z-[1000] flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-border/60 bg-surface/80 px-4 backdrop-blur-2xl backdrop-saturate-150">
      <h1 className="whitespace-nowrap font-display text-[16px] font-semibold tracking-tight text-foreground">
        Geo<span className="text-primary">Planet</span>
      </h1>

      <span className="rounded-full border border-border/60 bg-surface-2/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        SIG v3.0
      </span>

      <span className="flex items-center gap-1.5 rounded-full bg-brand-green/10 px-2 py-0.5 font-mono text-[10px] text-brand-green">
        <span className="h-1.5 w-1.5 animate-blink rounded-full bg-brand-green" />
        OSM Live
      </span>

      <span className="hidden whitespace-nowrap text-[12px] text-muted-foreground md:inline">
        Chile · Santiago RM
      </span>

      <div className="flex-1" />

      <button
        onClick={onToggleIsochrone}
        className={[
          "whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium transition-all",
          mode === "isochrone"
            ? "bg-iso-1 text-background shadow-apple-sm"
            : "bg-surface-2/60 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
        ].join(" ")}
      >
        <Clock className="mr-1 inline h-3 w-3" /> Isócronas
      </button>

      <button
        onClick={onToggleMicrozone}
        className={[
          "whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium transition-all",
          mode === "microzone"
            ? "bg-brand-purple text-background shadow-apple-sm"
            : "bg-surface-2/60 text-muted-foreground hover:bg-surface-3 hover:text-foreground",
        ].join(" ")}
      >
        <Hexagon className="mr-1 inline h-3 w-3" /> Microzona
      </button>

      <button className="whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground shadow-apple-sm transition-colors hover:bg-primary/90">
        <FileUp className="mr-1 inline h-3 w-3" /> Archivo
      </button>

      {user ? (
        <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-2/60 px-2.5 py-1 text-[11px] text-muted-foreground">
          <UserIcon className="h-3 w-3" />
          <span className="max-w-[160px] truncate" title={user.email ?? ""}>
            {user.email}
          </span>
          <button
            onClick={handleSignOut}
            className="ml-1 rounded-full p-0.5 text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <Link
          to="/auth"
          className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border/60 bg-surface-2/60 px-3 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-3"
        >
          <LogIn className="h-3 w-3" /> Entrar
        </Link>
      )}
    </header>
  );
};
