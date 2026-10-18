/**
 * Convención de migraciones y rollbacks (supabase/README.md):
 *  - los `down` NUNCA van en supabase/migrations/ (`supabase db push` los trataría como otra migración);
 *  - toda migración con versión >= 20261101000000 tiene su rollback en supabase/rollbacks/ con la misma versión y nombre.
 * No se tocan las migraciones anteriores a esa versión.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).sort();
const ROLLBACKS = readdirSync(resolve(ROOT, "supabase/rollbacks")).sort();
const FIRST_GOVERNED = "20261101000000";

describe("convención de migraciones y rollbacks", () => {
  it("ningún `down` vive en supabase/migrations/", () => {
    expect(MIGRATIONS.filter((f) => /_down\.sql$/i.test(f))).toEqual([]);
  });

  it("todo lo que hay en supabase/migrations/ es una migración con versión de 14 dígitos", () => {
    expect(MIGRATIONS.filter((f) => !/^\d{14}_.+\.sql$/.test(f))).toEqual([]);
  });

  it("cada migración >= 20261101000000 tiene su rollback <versión>_<nombre>_down.sql en supabase/rollbacks/", () => {
    const governed = MIGRATIONS.filter((f) => f.slice(0, 14) >= FIRST_GOVERNED);
    expect(governed.length).toBeGreaterThan(0);
    const missing = governed.filter((f) => !existsSync(resolve(ROOT, "supabase/rollbacks", f.replace(/\.sql$/, "_down.sql"))));
    expect(missing).toEqual([]);
  });

  it("cada rollback >= 20261101000000 corresponde a una migración existente y se llama *_down.sql", () => {
    const governed = ROLLBACKS.filter((f) => f.slice(0, 14) >= FIRST_GOVERNED);
    expect(governed.filter((f) => !/_down\.sql$/.test(f))).toEqual([]);
    const orphans = governed.filter((f) => !MIGRATIONS.includes(f.replace(/_down\.sql$/, ".sql")));
    expect(orphans).toEqual([]);
  });
});
