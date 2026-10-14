import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DONE_FLAG,
  ensureIdbMigrated,
  migrateIdbKeys,
  migrateLocalStorageKeys,
  type IdbLike,
} from "@/utils/storageMigration";

/** Storage en memoria con la posibilidad de hacer fallar escrituras (cuota). */
class MemStorage implements Storage {
  private m = new Map<string, string>();
  failSetFor = new Set<string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failSetFor.has(k)) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
  keysList() {
    return [...this.m.keys()].sort();
  }
}

class MemIdb implements IdbLike {
  data = new Map<IDBValidKey, unknown>();
  failSetFor = new Set<IDBValidKey>();
  keys = async () => [...this.data.keys()];
  get = async (k: IDBValidKey) => this.data.get(k);
  set = async (k: IDBValidKey, v: unknown) => {
    if (this.failSetFor.has(k)) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  };
  del = async (k: IDBValidKey) => {
    this.data.delete(k);
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("migrateLocalStorageKeys", () => {
  it("mueve lovable.* a geochile.*, borra la vieja y no toca claves ajenas", () => {
    const s = new MemStorage();
    s.setItem("lovable.communeOverrides.v1", '{"x":1}');
    s.setItem("territorial_visible_v2", "[]");

    const r = migrateLocalStorageKeys(s);

    expect(r.moved).toBe(1);
    expect(s.getItem("geochile.communeOverrides.v1")).toBe('{"x":1}');
    expect(s.getItem("lovable.communeOverrides.v1")).toBeNull();
    expect(s.getItem("territorial_visible_v2")).toBe("[]");
    expect(s.getItem(DONE_FLAG)).toBe("1");
  });

  it("si la clave nueva ya existe, gana la nueva y se descarta la vieja", () => {
    const s = new MemStorage();
    s.setItem("lovable.communeOverrides.v1", "viejo");
    s.setItem("geochile.communeOverrides.v1", "nuevo");

    const r = migrateLocalStorageKeys(s);

    expect(r.skippedExisting).toBe(1);
    expect(s.getItem("geochile.communeOverrides.v1")).toBe("nuevo");
    expect(s.getItem("lovable.communeOverrides.v1")).toBeNull();
  });

  it("es idempotente: tras la marca no vuelve a escanear", () => {
    const s = new MemStorage();
    s.setItem("lovable.a", "1");
    migrateLocalStorageKeys(s);

    s.setItem("lovable.b", "2");
    const r = migrateLocalStorageKeys(s);

    expect(r).toEqual({ moved: 0, skippedExisting: 0, droppedCache: 0, failed: 0 });
    expect(s.getItem("lovable.b")).toBe("2");
  });

  it("ante un fallo deja la clave vieja intacta, no marca y reintenta en la próxima carga", () => {
    const s = new MemStorage();
    s.setItem("lovable.communeOverrides.v1", "datos del usuario");
    s.failSetFor.add("geochile.communeOverrides.v1");

    const r1 = migrateLocalStorageKeys(s);
    expect(r1.failed).toBe(1);
    expect(s.getItem("lovable.communeOverrides.v1")).toBe("datos del usuario");
    expect(s.getItem(DONE_FLAG)).toBeNull();

    s.failSetFor.clear();
    const r2 = migrateLocalStorageKeys(s);
    expect(r2.moved).toBe(1);
    expect(s.getItem("geochile.communeOverrides.v1")).toBe("datos del usuario");
    expect(s.getItem(DONE_FLAG)).toBe("1");
  });

  it("no revienta si localStorage no está disponible", () => {
    const broken = {
      get length(): number {
        throw new Error("denegado");
      },
      getItem() {
        throw new Error("denegado");
      },
    } as unknown as Storage;
    expect(() => migrateLocalStorageKeys(broken)).not.toThrow();
  });
});

describe("migrateIdbKeys", () => {
  const uid = "u1";

  it("mueve las 4 claves de la caché de POIs, incluido un valor null", async () => {
    const idb = new MemIdb();
    idb.data.set(`lovable.cache.pois.${uid}`, { rows: [1], at: 1 });
    idb.data.set(`lovable.cache.trashed.${uid}`, { rows: [], at: 1 });
    idb.data.set(`lovable.cache.pois.lastSyncAt.${uid}`, null);
    idb.data.set(`lovable.cache.folders.${uid}`, { rows: [2], at: 1 });

    const r = await migrateIdbKeys(idb);

    expect(r.moved).toBe(4);
    expect(idb.data.get(`geochile.cache.pois.${uid}`)).toEqual({ rows: [1], at: 1 });
    expect(idb.data.get(`geochile.cache.pois.lastSyncAt.${uid}`)).toBeNull();
    expect([...idb.data.keys()].some((k) => String(k).startsWith("lovable."))).toBe(false);
    expect(idb.data.get(DONE_FLAG)).toBe(true);
  });

  it("conserva la clave nueva si ya existe y descarta la vieja", async () => {
    const idb = new MemIdb();
    idb.data.set(`lovable.cache.folders.${uid}`, "viejo");
    idb.data.set(`geochile.cache.folders.${uid}`, "nuevo");

    const r = await migrateIdbKeys(idb);

    expect(r.skippedExisting).toBe(1);
    expect(idb.data.get(`geochile.cache.folders.${uid}`)).toBe("nuevo");
    expect(idb.data.has(`lovable.cache.folders.${uid}`)).toBe(false);
  });

  it("sin cuota, una caché se descarta (se regenera) y no cuenta como fallo", async () => {
    const idb = new MemIdb();
    idb.data.set(`lovable.cache.pois.${uid}`, { rows: [1], at: 1 });
    idb.failSetFor.add(`geochile.cache.pois.${uid}`);

    const r = await migrateIdbKeys(idb);

    expect(r.droppedCache).toBe(1);
    expect(r.failed).toBe(0);
    expect(idb.data.has(`lovable.cache.pois.${uid}`)).toBe(false);
    expect(idb.data.get(DONE_FLAG)).toBe(true);
  });

  it("sin cuota, una clave que NO es caché se conserva y se reintenta", async () => {
    const idb = new MemIdb();
    idb.data.set("lovable.userdata.x", "importante");
    idb.failSetFor.add("geochile.userdata.x");

    const r = await migrateIdbKeys(idb);

    expect(r.failed).toBe(1);
    expect(idb.data.get("lovable.userdata.x")).toBe("importante");
    expect(idb.data.has(DONE_FLAG)).toBe(false);
  });

  it("ignora claves que no son string y no vuelve a correr tras la marca", async () => {
    const idb = new MemIdb();
    idb.data.set(42, "numérica");
    await migrateIdbKeys(idb);
    expect(idb.data.get(42)).toBe("numérica");

    idb.data.set("lovable.cache.pois.u2", { rows: [] });
    const r = await migrateIdbKeys(idb);
    expect(r.moved).toBe(0);
    expect(idb.data.has("lovable.cache.pois.u2")).toBe(true);
  });
});

describe("ensureIdbMigrated", () => {
  it("comparte una sola promesa y nunca rechaza (jsdom no tiene IndexedDB)", async () => {
    const a = ensureIdbMigrated();
    expect(ensureIdbMigrated()).toBe(a);
    await expect(a).resolves.toMatchObject({ failed: expect.any(Number) });
  });
});
