import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    port: 4320,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4319',
      '/ws': { target: 'ws://localhost:4319', ws: true },
    },
  },
})
