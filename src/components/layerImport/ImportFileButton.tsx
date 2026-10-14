import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LAYER_TREE_QUERY_KEY, useLayerTreeData } from "@/hooks/useLayerTree";
import { TERRITORIAL_LAYERS_QUERY_KEY } from "@/hooks/useTerritorialLayers";
import { IMPORT_ACCEPT, importFormatOf } from "@/utils/importParser";
import { ImportWizard } from "./ImportWizard";

type ButtonProps = Pick<ComponentProps<typeof Button>, "variant" | "size" | "className" | "title">;

/**
 * Botón "elegir un archivo" que abre el asistente de importación. Es la entrada única para quien
 * no está en el panel de capas (administración, catálogo de marcas): el asistente es el mismo.
 */
export const ImportFileButton = ({ children, ...button }: ButtonProps & { children: ReactNode }) => {
  const queryClient = useQueryClient();
  // Los nodos del árbol sirven para elegir el destino dentro del asistente.
  const { data: tree } = useLayerTreeData();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ file: File; nonce: number } | null>(null);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        aria-label="Archivo a importar"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (!importFormatOf(f.name)) {
            toast.error("Formato no soportado", { description: "Usa un archivo KMZ, KML, GeoJSON, CSV o HTML." });
            return;
          }
          setImporting({ file: f, nonce: Date.now() });
        }}
      />
      <Button {...button} onClick={() => input.current?.click()}>
        {children}
      </Button>
      {importing && (
        <ImportWizard
          key={importing.nonce}
          file={importing.file}
          nodes={tree?.nodes ?? []}
          onClose={() => setImporting(null)}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: LAYER_TREE_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: TERRITORIAL_LAYERS_QUERY_KEY });
          }}
        />
      )}
    </>
  );
};
