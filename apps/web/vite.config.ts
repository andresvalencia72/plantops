import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Only for Vite development. Production must use an audited HTTPS reverse proxy.
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        rewrite: (path: string) => path.replace(/^\/api(?=\/)/, ''),
      },
      // OAuth provider must return to the SAME Vite origin, so /?source=api
      // opens the React workspace and host-bound cookies survive the callback.
      '/auth/oidc': {
        target: 'http://127.0.0.1:3001',
      },
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
