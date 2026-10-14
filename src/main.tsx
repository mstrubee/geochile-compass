import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyStoredOverrides } from "./services/communeDataService";
import { ensureIdbMigrated, migrateLocalStorageKeys } from "./utils/storageMigration";

// Claves `lovable.*` → `geochile.*`. La de localStorage es síncrona y tiene que
// ir ANTES de leer los overrides; la de IndexedDB corre en paralelo y poiCache
// la espera antes de tocar su caché.
migrateLocalStorageKeys();
void ensureIdbMigrated();

// Aplica overrides demográficos guardados antes de montar la app, así
// los componentes leen COMMUNES ya con los valores actualizados.
applyStoredOverrides();

createRoot(document.getElementById("root")!).render(<App />);
