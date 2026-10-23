import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Fonts are bundled so the app looks the same offline and on every PC.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-ext-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-ext-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-ext-700.css";
import "@fontsource/jetbrains-mono/latin-800.css";
import "@fontsource/jetbrains-mono/latin-ext-800.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
