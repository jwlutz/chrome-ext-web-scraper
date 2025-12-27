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

      // Ensure icons directory exists
      const iconsDir = resolve(distDir, 'icons');
      if (!existsSync(iconsDir)) {
        mkdirSync(iconsDir, { recursive: true });
      }

      // Copy manifest.json
      copyFileSync(
        resolve(extDir, 'manifest.json'),
        resolve(distDir, 'manifest.json')
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
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Put each entry in its own directory
          if (chunkInfo.name === 'content') return 'content/index.js';
          if (chunkInfo.name === 'background') return 'background/index.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
    // Don't minify for easier debugging in Phase 1
    minify: false,
    sourcemap: true,
  },
  plugins: [copyExtensionAssets()],
});
