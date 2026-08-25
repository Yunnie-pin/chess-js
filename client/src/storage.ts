/**
 * Akses `localStorage` yang tidak pernah melempar.
 *
 * Mode privat, penyimpanan yang diblokir kebijakan browser, dan lingkungan
 * tanpa DOM (Node saat menjalankan tes) semuanya bisa membuat akses ini gagal —
 * dan semua yang disimpan di sini hanya kenyamanan: nama pemain, token kursi,
 * pilihan bahasa. Tidak ada satu pun yang layak menjatuhkan aplikasi.
 */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* diabaikan dengan sengaja: lihat catatan di atas */
  }
}
