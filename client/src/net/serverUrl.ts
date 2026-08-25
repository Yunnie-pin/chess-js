/**
 * Menentukan alamat WebSocket server catur.
 *
 * Secara bawaan klien menyambung ke `/ws` pada origin yang sama, dan reverse
 * proxy di depannya (nginx saat memakai Docker, dev server Vite saat
 * pengembangan) yang meneruskannya ke server. Ini disengaja: kalau alamat
 * server dibakar ke dalam bundel, satu image Docker hanya bisa dipakai untuk
 * satu domain — setiap lingkungan harus di-build ulang.
 *
 * `VITE_SERVER_URL` tetap tersedia sebagai penimpa, untuk kasus server memang
 * berada di host yang berbeda dari kliennya.
 */
export function resolveServerUrl(): string {
  if (__SERVER_URL__) return __SERVER_URL__

  // Halaman yang disajikan lewat https wajib memakai wss, bukan ws.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
