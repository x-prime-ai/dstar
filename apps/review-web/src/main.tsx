import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("DSTAR review root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
