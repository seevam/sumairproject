import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/

// Mirrors the production routing from the repo-root vercel.json, where /api is
// served by the Python service on the same origin. Keeping dev and preview
// identical to production means same-origin sync is exercised locally too.
const apiProxy = {
  '/api': {
    target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:5000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
