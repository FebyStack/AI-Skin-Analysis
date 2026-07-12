import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { registerServiceWorker } from "./pwa/register-sw";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

// Initialize background model updates in production only
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  void import('@/pwa/init-model-updates').then((m) => m.initModelUpdates(''));
}
