/**
 * Tes kamus dan penerjemah.
 *
 * Kunci yang tertinggal sudah dijaga TypeScript — `en` bertipe `Messages`, jadi
 * kamus yang tidak lengkap gagal saat `npm run typecheck`. Yang TIDAK bisa
 * dilihat TypeScript adalah isi teksnya: terjemahan yang menjatuhkan `{winner}`
 * tetap sebuah string yang sah, dan bugnya baru muncul sebagai kalimat bolong di
 * layar pemain. Itu yang diperiksa di sini.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { LOCALES, setLocale, t, formatNumber } from '../src/i18n/index.ts'
import { id } from '../src/i18n/id.ts'
import { en } from '../src/i18n/en.ts'

const DICTIONARIES = { id, en }

/** Semua penanda `{nama}` di dalam sebuah teks, terurut agar bisa dibandingkan. */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

test.afterEach(() => setLocale('id'))

test('kedua kamus punya kunci yang sama persis', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(id).sort())
})

test('tidak ada teks yang kosong', () => {
  for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.ok(value.trim().length > 0, `${locale}: kunci "${key}" kosong`)
    }
  }
})

test('penanda {…} sama di semua bahasa', () => {
  for (const key of Object.keys(id) as (keyof typeof id)[]) {
    assert.deepEqual(
      placeholders(en[key]),
      placeholders(id[key]),
      `kunci "${key}": penanda tidak cocok antara id dan en`
    )
  }
})

test('menerjemahkan sesuai bahasa yang dipilih', () => {
  setLocale('id')
  assert.equal(t('color.w'), 'Putih')
  setLocale('en')
  assert.equal(t('color.w'), 'White')
})

test('menyulih penanda dengan parameter', () => {
  setLocale('en')
  assert.equal(t('status.checkmateWin', { winner: 'White' }), 'Checkmate — White wins')
})

test('penanda tanpa pasangan dibiarkan apa adanya', () => {
  // Lebih mudah dilacak daripada kalimat yang diam-diam bolong.
  setLocale('en')
  assert.equal(t('status.checkmateWin', { salah: 'x' }), 'Checkmate — {winner} wins')
})

test('urutan nama bidak dan warna mengikuti bahasanya', () => {
  const parts = { piece: 'Queen', color: 'White' }
  setLocale('id')
  assert.equal(t('piece.ariaLabel', { piece: 'Menteri', color: 'Putih' }), 'Menteri Putih')
  setLocale('en')
  assert.equal(t('piece.ariaLabel', parts), 'White Queen')
})

test('angka diformat mengikuti bahasa', () => {
  setLocale('id')
  assert.equal(formatNumber(1234567), '1.234.567')
  setLocale('en')
  assert.equal(formatNumber(1234567), '1,234,567')
})

test('setiap kode galat protokol punya teksnya', () => {
  // Kalau server menambah kode baru, yang gagal harus tes ini — bukan pemain
  // yang melihat kotak galat kosong.
  const codes = [
    'room-tidak-ada',
    'room-penuh',
    'bukan-giliran',
    'langkah-tidak-sah',
    'bukan-pemain',
    'permainan-usai',
    'pesan-tidak-dikenal',
    'versi-protokol'
  ] as const

  for (const locale of LOCALES) {
    setLocale(locale)
    for (const code of codes) {
      assert.ok(t(`error.${code}`).length > 0, `${locale}: galat "${code}" tidak punya teks`)
    }
  }
})
