import alpinejs from '@astrojs/alpinejs';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  integrations: [alpinejs({ entrypoint: '/src/lib/alpine.ts' })],
  // The Spesa runs on 4321.
  server: { port: 4322 },
  vite: {
    server: {
      // The client always talks to its own origin: in development Astro forwards the API to PocketBase.
      proxy: { '/api': 'http://127.0.0.1:8090' },
    },
  },
});
