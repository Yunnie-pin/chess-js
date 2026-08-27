/**
 * Sakelar bantuan bermain (petunjuk langkah, premove, batalkan langkah, bilah
 * evaluasi) — semuanya bertahan antar kunjungan lewat `localStorage`.
 *
 * Sama seperti pilihan bahasa dan nama pemain, ini cuma kenyamanan: disimpan
 * lewat `storage.ts` yang tidak pernah melempar, dan kalau `localStorage` tidak
 * tersedia (mode privat, tes di Node) nilainya kembali ke bawaan tanpa ribut.
 *
 * Ref-nya di tingkat modul — satu aplikasi, satu salinan — persis pola yang
 * dipakai `i18n/index.ts` untuk bahasa. `App.vue` yang membagikannya: `showHints`
 * dan `showEvalBar` dibaca langsung, `premoveEnabled`/`undoEnabled` diteruskan
 * ke composable permainan supaya aturannya ditegakkan di model, bukan di tombol.
 */
import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { readStorage, writeStorage } from './storage.ts'

const KEY_PREFIX = 'catur.'

/**
 * Ref boolean yang membaca nilai awalnya dari `localStorage` dan menuliskannya
 * kembali setiap kali berubah. Tulisannya `flush: 'sync'` supaya perubahan
 * tidak hilang kalau tab ditutup tepat setelah sakelar dipencet.
 */
function persistedFlag(name: string, fallback: boolean): Ref<boolean> {
  const key = KEY_PREFIX + name
  const saved = readStorage(key)
  const state = ref(saved === null ? fallback : saved === '1')
  watch(state, (value) => writeStorage(key, value ? '1' : '0'), { flush: 'sync' })
  return state
}

export const showHints = persistedFlag('petunjuk', true)
export const premoveEnabled = persistedFlag('premove', true)
export const undoEnabled = persistedFlag('undo', true)
export const showEvalBar = persistedFlag('bilah-evaluasi', false)
