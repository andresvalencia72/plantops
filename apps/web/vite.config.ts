import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// An authenticated build is deliberately opt-in and remains read-only.
// Reject unknown choices or lab writes in the standalone application.
const configuredSurface = process.env.VITE_PLANTOPS_APP_SURFACE
if (configuredSurface && !['demo', 'authenticated'].includes(configuredSurface)) {
  throw new Error('VITE_PLANTOPS_APP_SURFACE must be demo or authenticated')
}
if (configuredSurface === 'authenticated' &&
    process.env.VITE_PLANTOPS_ENABLE_REPORTS === 'isolated-test') {
  throw new Error('Authenticated surface cannot enable isolated write fixtures')
}

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
