import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import fs from 'fs';
import path from 'path';

// Load manifest.json dynamically from root or ./extension
function loadManifest() {
  const possiblePaths = [
    path.resolve(__dirname, 'manifest.json'),
    path.resolve(__dirname, 'extension/manifest.json')
  ];

  for (const manifestPath of possiblePaths) {
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
  }

  throw new Error('Could not find manifest.json in root or ./extension directory.');
}

const manifest = loadManifest();

// Vite plugin to ensure Firefox AMO compliance for Manifest V3 background scripts
function fixFirefoxManifest() {
  let outDir = 'dist/extension';

  return {
    name: 'fix-firefox-manifest',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir || 'dist/extension';
    },
    closeBundle() {
      const manifestPath = path.resolve(outDir, 'manifest.json');

      if (fs.existsSync(manifestPath)) {
        try {
          const distManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

          if (distManifest.background && distManifest.background.service_worker) {
            // Copy compiled service_worker path into scripts array for Firefox MV3 Event Pages
            distManifest.background.scripts = [distManifest.background.service_worker];

            fs.writeFileSync(manifestPath, JSON.stringify(distManifest, null, 2), 'utf-8');
            console.log(`\n[Patens Build] ✅ Firefox background.scripts fallback injected into ${path.relative(process.cwd(), manifestPath)}!\n`);
          }
        } catch (err) {
          console.error('[Patens Build] ❌ Failed to patch manifest for Firefox:', err);
        }
      }
    }
  };
}

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true
  },
  plugins: [
    crx({ manifest }),
    fixFirefoxManifest()
  ]
});