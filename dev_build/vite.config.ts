import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Custom plugin to copy static assets after build
function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const extDir = resolve(__dirname, 'extension');

      // Ensure directories exist
      const dirs = ['popup', 'icons'];
      dirs.forEach(dir => {
        const targetDir = resolve(distDir, dir);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }
      });

      // Copy manifest.json
      copyFileSync(
        resolve(extDir, 'manifest.json'),
        resolve(distDir, 'manifest.json')
      );

      // Copy popup HTML and CSS
      copyFileSync(
        resolve(extDir, 'popup/popup.html'),
        resolve(distDir, 'popup/popup.html')
      );
      copyFileSync(
        resolve(extDir, 'popup/popup.css'),
        resolve(distDir, 'popup/popup.css')
      );

      // Copy icons
      const iconSizes = ['16', '48', '128'];
      iconSizes.forEach(size => {
        const iconPath = resolve(extDir, `icons/icon${size}.png`);
        if (existsSync(iconPath)) {
          copyFileSync(iconPath, resolve(distDir, `icons/icon${size}.png`));
        }
      });

      console.log('[Vite] Extension assets copied to dist/');
    }
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'extension/content/index.ts'),
        background: resolve(__dirname, 'extension/background/index.ts'),
        popup: resolve(__dirname, 'extension/popup/popup.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Put each entry in its own directory
          if (chunkInfo.name === 'content') return 'content/index.js';
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'popup') return 'popup/popup.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Chrome extensions need IIFE format for content scripts
        format: 'es',
      },
    },
    // Don't minify for easier debugging in Phase 1
    minify: false,
    sourcemap: true,
  },
  plugins: [copyExtensionAssets()],
});
