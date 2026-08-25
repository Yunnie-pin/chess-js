import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Server catur saat pengembangan; lihat `server/package.json`. */
const DEV_SERVER = 'http://localhost:8787'

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    /*
     * Kosong berarti "pakai origin yang sama" — klien lalu menyambung ke `/ws`
     * dan proxy di depannya yang meneruskan. Isi VITE_SERVER_URL hanya bila
     * server memang berada di host lain.
     */
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL ?? '')
  },
  server: {
    open: true,
    // Meniru peran nginx saat produksi, supaya jalur `/ws` sama di kedua tempat.
    proxy: {
      '/ws': { target: DEV_SERVER, ws: true, rewriteWsOrigin: true }
    }
  },
  // @chess/shared adalah paket workspace berisi TypeScript mentah, bukan hasil
  // build. Ia harus ikut diproses Vite, bukan diperlakukan sebagai dependensi
  // siap pakai yang di-prebundle.
  optimizeDeps: { exclude: ['@chess/shared'] }
})
