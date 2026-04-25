import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyStoredOverrides } from "./services/communeDataService";

// Aplica overrides demográficos guardados antes de montar la app, así
// los componentes leen COMMUNES ya con los valores actualizados.
applyStoredOverrides();

createRoot(document.getElementById("root")!).render(<App />);
