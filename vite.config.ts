import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { thumbnailExportPlugin } from "./dev/thumbnail-export-plugin";
export default defineConfig({
  plugins: [react(), thumbnailExportPlugin()],
  server: { port: 5173, strictPort: false },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "three";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "react";
        },
      },
    },
    chunkSizeWarningLimit: 750,
  },
});
