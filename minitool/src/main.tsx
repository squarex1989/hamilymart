import "./lib/runtime-compat";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadDraftSession } from "./lib/draft-session";
import { initLayoutCompatibility } from "./lib/layout-compat";
import "./styles.css";

initLayoutCompatibility();
const container = document.getElementById("root")!;
container.textContent = "正在读取本地搭配…";

async function start() {
  const startup = await loadDraftSession();
  createRoot(container).render(
    <React.StrictMode>
      <App startup={startup} />
    </React.StrictMode>,
  );
}

void start().catch(() => {
  container.textContent = "搭配暂时无法启动，请关闭后重新打开。原存档未被修改。";
});
