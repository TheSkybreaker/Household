import alpinejs from '@astrojs/alpinejs';
import AstroPWA from '@vite-pwa/astro';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// PocketBase serves the build from its pb_public directory.
const outDir = fileURLToPath(new URL('../../backend/pb_public', import.meta.url));

export default defineConfig({
  output: 'static',
  outDir,
  integrations: [
    alpinejs({ entrypoint: '/src/lib/alpine.ts' }),
    AstroPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // @vite-pwa/astro resolves Astro 7's output to .astro: the paths are set explicitly.
      outDir,
      // src/lib/pwa.ts registers the service worker, to show the update toast.
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
