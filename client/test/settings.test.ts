/**
 * Sakelar bantuan bermain yang bertahan di `localStorage`.
 *
 * Node tidak punya `localStorage`, jadi tesnya menaruh tiruan seadanya SEBELUM
 * meng-import modulnya — `settings.ts` membaca nilai awalnya saat dimuat, jadi
 * tiruannya harus sudah terpasang lebih dulu (karena itu `import()` dinamis).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key)
}

// Satu kunci sudah tersimpan, satu belum — untuk menguji kedua jalur sekaligus.
store.set('catur.bilah-evaluasi', '1')
store.set('catur.premove', '0')

const { showHints, premoveEnabled, undoEnabled, showEvalBar, showSuggestion } = await import(
  '../src/settings.ts'
)

test('nilai awal dibaca dari localStorage, sisanya jatuh ke bawaan', () => {
  assert.equal(showEvalBar.value, true, 'tersimpan "1"')
  assert.equal(premoveEnabled.value, false, 'tersimpan "0"')
  assert.equal(undoEnabled.value, true, 'belum tersimpan → bawaan')
  assert.equal(showHints.value, true, 'belum tersimpan → bawaan')
  assert.equal(showSuggestion.value, false, 'belum tersimpan → bawaan (mati)')
})

test('mengubah sakelar langsung menulis ke localStorage', () => {
  undoEnabled.value = false
  assert.equal(store.get('catur.undo'), '0')

  showHints.value = false
  assert.equal(store.get('catur.petunjuk'), '0')

  showEvalBar.value = false
  assert.equal(store.get('catur.bilah-evaluasi'), '0')
})
