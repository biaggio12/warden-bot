/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Polling avoids depending on inotify (bind mounts that emit no events, or
    // hosts with a low fs.inotify.max_user_instances).
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true', interval: 500 },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
