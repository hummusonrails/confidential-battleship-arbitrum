import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // Relative asset paths, so the build works from any subpath (GitHub Pages serves it under /<repo>/).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' }, exclude: ['tfhe'] },
});
