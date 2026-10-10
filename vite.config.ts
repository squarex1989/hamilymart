import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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
