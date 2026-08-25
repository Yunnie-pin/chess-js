/**
 * Menerapkan tema lawan ke dokumen.
 *
 * Variabelnya dipasang di `<html>`, bukan lewat `:style` pada elemen akar
 * aplikasi, karena latar halaman (pendar hangat di puncak) digambar di `body` —
 * di luar jangkauan komponen mana pun. Satu tempat untuk keduanya lebih mudah
 * ditelusuri daripada setengah di sini, setengah di sana.
 *
 * Nama variabelnya sama persis dengan yang didefinisikan di `assets/main.css`;
 * yang di sini menimpanya saat berjalan. Nilai bawaan di CSS tetap ditulis
 * lengkap supaya halaman tidak pernah bergantung pada JavaScript untuk terlihat
 * benar — tema Mari di CSS dan tema Mari di sini memang sengaja kembar.
 */

import type { OpponentTheme } from './opponents.ts'

/** Menghitung nilai rgb(...) transparan dari sebuah warna heksa. */
function alpha(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgb(${r} ${g} ${b} / ${amount})`
}

/**
 * Bentuk akhir tema sebagai pasangan nama-variabel dan nilainya.
 *
 * Dipisah dari pemasangannya supaya bisa diperiksa tes tanpa perlu DOM.
 */
export function themeVariables(theme: OpponentTheme): Record<string, string> {
  return {
    '--accent': theme.accent,
    '--accent-hover': theme.accentHover,
    '--accent-soft': alpha(theme.accent, 0.14),
    '--on-accent': theme.onAccent,
    '--orange': theme.secondary,
    '--gold-text': theme.accentHover,
    '--square-light': theme.squareLight,
    '--square-dark': theme.squareDark,
    /* Sorotan memakai nada kedua: aksennya sendiri akan hilang di atas petak
       yang sudah sewarna dengannya. */
    '--highlight-last': alpha(theme.secondary, 0.5),
    '--highlight-selected': alpha(theme.accent, 0.45),
    '--glow': theme.glow
  }
}

export function applyTheme(theme: OpponentTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeVariables(theme))) {
    root.style.setProperty(name, value)
  }
}
