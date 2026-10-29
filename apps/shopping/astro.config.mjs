import alpinejs from '@astrojs/alpinejs';
import AstroPWA from '@vite-pwa/astro';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Caddy serves the build; the service worker build needs the same directory.
const outDir = fileURLToPath(new URL('./dist', import.meta.url));

export default defineConfig({
  output: 'static',
  outDir,
  integrations: [
    alpinejs({ entrypoint: '/src/lib/alpine.ts' }),
    AstroPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Each new version installs and takes over by itself; src/lib/pwa.ts keeps the open page as is.
      registerType: 'autoUpdate',
      // @vite-pwa/astro resolves Astro 7's output to .astro: the paths are set explicitly.
      outDir,
      // src/lib/pwa.ts registers the service worker.
      injectRegister: false,
      manifest: {
        name: 'Spesa',
        short_name: 'Spesa',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#071622',
        theme_color: '#3AA6E8',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globDirectory: outDir,
        globPatterns: ['**/*.{html,css,js,woff2,png,svg}'],
      },
      // Precache both "/lista" and "/lista/" for the list page.
      experimental: { directoryAndTrailingSlashHandler: true },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  vite: {
    server: {
      // The client always talks to its own origin: in development Astro forwards the API to PocketBase.
      proxy: { '/api': 'http://127.0.0.1:8090' },
    },
  },
});
