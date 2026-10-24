import { defineConfig } from 'vite';

export default defineConfig({
  worker: {
    format: 'es'
  },
  server: {
    port: 3000,
    host: true
  }
});
