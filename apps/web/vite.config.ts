import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Test-write mode deliberately uses a separate loopback API, never the
// owner's OIDC pilot on port 3001. The default remains read-only.
const isolatedLab = process.env.VITE_PLANTOPS_ENABLE_REPORTS === 'isolated-test'
const apiTarget = isolatedLab ? 'http://127.0.0.1:3002' : 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Only for Vite development. Production must use an audited HTTPS reverse proxy.
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        rewrite: (path: string) => path.replace(/^\/api(?=\/)/, ''),
      },
      // OAuth provider must return to the SAME Vite origin, so /?source=api
      // opens the React workspace and host-bound cookies survive the callback.
      '/auth/oidc': {
        target: apiTarget,
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
