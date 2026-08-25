import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Alamat server multiplayer; ganti lewat VITE_SERVER_URL saat deploy. */
const DEV_SERVER_URL = 'ws://localhost:8787'

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL ?? DEV_SERVER_URL)
  },
  server: { open: true },
  // @chess/shared adalah paket workspace berisi TypeScript mentah, bukan hasil
  // build. Ia harus ikut diproses Vite, bukan diperlakukan sebagai dependensi
  // siap pakai yang di-prebundle.
  optimizeDeps: { exclude: ['@chess/shared'] }
})
