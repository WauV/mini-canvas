import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "../app/globals.css";

import { MiniCanvas } from "../app/MiniCanvas";

const root = document.getElementById("mini-canvas-root");

if (!root) {
  throw new Error("Mini Canvas Widget 缺少挂载节点");
}

createRoot(root).render(
  <StrictMode>
    <MiniCanvas hostMode="widget" />
  </StrictMode>,
);
