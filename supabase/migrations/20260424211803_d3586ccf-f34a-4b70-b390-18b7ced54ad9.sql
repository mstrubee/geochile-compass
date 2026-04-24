-- Permitir jerarquía ilimitada de carpetas, manteniendo prevención de auto-referencia y de ciclos
CREATE OR REPLACE FUNCTION public.enforce_folder_max_depth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  cur UUID;
  hops INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A folder cannot be its own parent';
  END IF;

  -- Detectar ciclos subiendo por la cadena de padres (límite duro de 1000 saltos)
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Folder hierarchy cannot contain cycles';
    END IF;
    hops := hops + 1;
    IF hops > 1000 THEN
      RAISE EXCEPTION 'Folder hierarchy too deep (>1000 levels)';
    END IF;
    SELECT parent_id INTO cur FROM public.poi_folders WHERE id = cur;
  END LOOP;

  RETURN NEW;
END;
$function$;