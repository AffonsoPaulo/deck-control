import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/app.css";

// galeria dos componentes, só no npm run dev (#...&dev=components); fica fora do build
const Gallery = import.meta.env.DEV ? lazy(() => import("@/dev/Gallery").then((m) => ({ default: m.Gallery }))) : null;
const showGallery = Gallery !== null && new URLSearchParams(window.location.hash.slice(1)).get("dev") === "components";

const root = document.getElementById("root");
if (!root) throw new Error("#root não existe no index.html");
createRoot(root).render(
  <StrictMode>
    {showGallery && Gallery ? (
      <Suspense>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
