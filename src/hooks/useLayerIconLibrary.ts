import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteLibraryIcon, listLibraryIcons, uploadLibraryIcons, type UploadReport } from "@/services/layerIconLibrary";

export const LAYER_ICON_LIBRARY_QUERY_KEY = ["layer-icon-library"] as const;

/** Biblioteca compartida de íconos PNG: la misma para toda carpeta o capa. */
export const useLayerIconLibrary = () => {
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: LAYER_ICON_LIBRARY_QUERY_KEY }),
    [queryClient],
  );

  const query = useQuery({
    queryKey: LAYER_ICON_LIBRARY_QUERY_KEY,
    queryFn: listLibraryIcons,
    staleTime: 60_000,
  });

  const upload = useMutation<UploadReport, Error, File[]>({
    mutationFn: uploadLibraryIcons,
    onSuccess: refresh,
  });

  const remove = useMutation<void, Error, string>({
    mutationFn: deleteLibraryIcon,
    onSuccess: refresh,
  });

  return {
    icons: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    upload,
    remove,
  };
};
