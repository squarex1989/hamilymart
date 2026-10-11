import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root, base: './', publicDir: false,
  resolve: { alias: [{ find: /^three$/, replacement: path.resolve(root, '../node_modules/three/src/Three.js') }] },
  plugins: [react(), {
    name: 'minitool-disable-unsupported-xr',
    transform(_source, id) {
      if (id.endsWith('/renderers/webxr/WebXRManager.js')) return readFileSync(path.join(root, 'build/disabled-xr.ts'), 'utf8');
    },
  }],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist', emptyOutDir: true, target: ['es2017', 'chrome61'], cssTarget: 'chrome61', sourcemap: false,
    minify: 'esbuild', cssCodeSplit: false,
    lib: { entry: path.join(root, 'src/main.tsx'), name: 'HamilyMartMini', formats: ['iife'], fileName: () => 'app.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 1600,
  },
});
