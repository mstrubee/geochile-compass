import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const storage = vi.hoisted(() => ({
  uploads: [] as { path: string; type: string | undefined; upsert: boolean | undefined }[],
  failFor: null as string | null,
  existing: [] as { name: string }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string, _blob: Blob, opts: { contentType?: string; upsert?: boolean }) => {
          if (storage.failFor && path.startsWith(storage.failFor)) return { error: { message: "boom" } };
          storage.uploads.push({ path, type: opts.contentType, upsert: opts.upsert });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/layer-icons/${path}` } }),
        list: async () => ({ data: storage.existing, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  },
}));

import { listLibraryIcons, MAX_ICON_BYTES, MAX_ICONS_PER_UPLOAD, uploadLibraryIcons } from "@/services/layerIconLibrary";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = (extra = 8) => new Uint8Array([...PNG_HEAD, ...new Array<number>(extra).fill(1)]);
const png = (name: string, bytes: BlobPart = pngBytes()) => new File([bytes], name, { type: "image/png" });

beforeEach(() => {
  storage.uploads = [];
  storage.failFor = null;
  storage.existing = [];
});

describe("uploadLibraryIcons", () => {
  it("sube un PNG con nombre limpio, sufijo propio y sin pisar los existentes", async () => {
    const r = await uploadLibraryIcons([png("Farmacia Cruz Verde (1).png")]);
    expect(r.rejected).toEqual([]);
    expect(r.uploaded).toHaveLength(1);
    expect(storage.uploads[0].path).toMatch(/^farmacia-cruz-verde-1-[a-z0-9]{6}\.png$/);
    expect(storage.uploads[0]).toMatchObject({ type: "image/png", upsert: false });
    expect(r.uploaded[0].url).toBe(`https://cdn.test/layer-icons/${storage.uploads[0].path}`);
    expect(r.uploaded[0].label).toBe("farmacia-cruz-verde-1");
  });

  it("sube varios PNG a la vez; dos con el mismo nombre no chocan", async () => {
    const r = await uploadLibraryIcons([png("a.png"), png("a.png"), png("b.png")]);
    expect(r.uploaded).toHaveLength(3);
    expect(new Set(storage.uploads.map((u) => u.path)).size).toBe(3);
  });

  it("rechaza lo que no es PNG aunque tenga extensión .png, o que pesa de más", async () => {
    const fake = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "foto.png", { type: "image/png" });
    const jpg = new File([pngBytes()], "foto.jpg", { type: "image/jpeg" });
    const big = png("grande.png", pngBytes(MAX_ICON_BYTES));
    const r = await uploadLibraryIcons([fake, jpg, big, png("ok.png")]);
    expect(r.uploaded).toHaveLength(1);
    expect(r.rejected.map((x) => [x.name, x.reason])).toEqual([
      ["foto.png", "El archivo no es un PNG válido"],
      ["foto.jpg", "No es PNG"],
      ["grande.png", "Pesa más de 512 KB"],
    ]);
  });

  it("abre un ZIP y sube solo sus PNG, ignorando __MACOSX, ocultos y otros formatos", async () => {
    const zip = new JSZip();
    zip.file("iconos/banco.png", pngBytes());
    zip.file("iconos/super.png", pngBytes());
    zip.file("__MACOSX/iconos/._banco.png", pngBytes());
    zip.file("iconos/.oculto.png", pngBytes());
    zip.file("iconos/leeme.txt", "hola");
    const file = new File([await zip.generateAsync({ type: "blob" })], "paquete.zip", { type: "application/zip" });

    const r = await uploadLibraryIcons([file, png("suelto.png")]);
    expect(r.uploaded.map((u) => u.label).sort()).toEqual(["banco", "suelto", "super"]);
    expect(r.rejected).toEqual([{ name: "paquete.zip › iconos/leeme.txt", reason: "No es PNG" }]);
  });

  it("avisa si el ZIP no trae PNG o está dañado", async () => {
    const empty = new JSZip();
    empty.file("a.txt", "x");
    const noPng = new File([await empty.generateAsync({ type: "blob" })], "vacio.zip");
    const broken = new File([new Uint8Array([1, 2, 3])], "roto.zip");
    const r = await uploadLibraryIcons([noPng, broken]);
    expect(r.uploaded).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["No es PNG", "El ZIP no tiene archivos PNG", "No se pudo abrir el ZIP"]);
  });

  it("si un archivo falla en el servidor, informa y sigue con el resto", async () => {
    storage.failFor = "malo-";
    const r = await uploadLibraryIcons([png("malo.png"), png("bueno.png")]);
    expect(r.uploaded.map((u) => u.label)).toEqual(["bueno"]);
    expect(r.rejected).toEqual([{ name: "malo.png", reason: "boom" }]);
  });

  it("corta en el tope de íconos por vez", async () => {
    const files = Array.from({ length: MAX_ICONS_PER_UPLOAD + 2 }, (_, i) => png(`i${i}.png`));
    const r = await uploadLibraryIcons(files);
    expect(r.uploaded).toHaveLength(MAX_ICONS_PER_UPLOAD);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toContain(String(MAX_ICONS_PER_UPLOAD));
  });
});

describe("listLibraryIcons", () => {
  it("lista solo los PNG del bucket con su URL pública", async () => {
    storage.existing = [{ name: "banco-abc123.png" }, { name: ".emptyFolderPlaceholder" }, { name: "super-zzz999.PNG" }];
    const icons = await listLibraryIcons();
    expect(icons.map((i) => [i.path, i.label])).toEqual([
      ["banco-abc123.png", "banco"],
      ["super-zzz999.PNG", "super"],
    ]);
    expect(icons[0].url).toBe("https://cdn.test/layer-icons/banco-abc123.png");
  });
});
