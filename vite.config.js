import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json';
import { resolve } from 'path';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: ['chrome109', 'edge109', 'firefox115'],
    outDir: 'dist/extension',
    rollupOptions: {
      input: {
        // Explicitly bundle the PDF Viewer interface and its dependencies
        viewer: resolve(__dirname, 'extension/viewer/viewer.html'),
      },
    },
  },
});