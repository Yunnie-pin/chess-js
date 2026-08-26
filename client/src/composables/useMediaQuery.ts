/**
 * Sebuah media query sebagai nilai reaktif.
 *
 * Ada karena satu hal yang tidak bisa diselesaikan dari CSS: `display: none`
 * menyembunyikan gambar, tapi tidak mencegahnya diunduh. Untuk elemen yang
 * hanya muncul di sebagian ukuran layar, ambangnya harus bisa dibaca dari sisi
 * JS juga — lihat `OpponentPortrait.vue`.
 */

import { onScopeDispose, ref, type Ref } from 'vue'

export function useMediaQuery(query: string): Ref<boolean> {
  // Tes berjalan di Node, tanpa window sama sekali.
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const matches = ref(false)
  if (!supported) return matches

  const list = window.matchMedia(query)
  matches.value = list.matches

  const onChange = (event: MediaQueryListEvent): void => {
    matches.value = event.matches
  }
  list.addEventListener('change', onChange)
  onScopeDispose(() => list.removeEventListener('change', onChange))

  return matches
}
