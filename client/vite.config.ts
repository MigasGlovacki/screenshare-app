import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  const { PORT = '3000' } = loadEnv(mode, root, 'PORT')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/socket.io': { target: `http://127.0.0.1:${PORT}`, ws: true },
      },
    },
  }
})
