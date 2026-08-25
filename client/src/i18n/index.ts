/**
 * Lokalisasi sisi klien — Indonesia dan Inggris.
 *
 * Ditulis sendiri, bukan memakai pustaka i18n: yang dibutuhkan aplikasi ini
 * cuma pencarian kunci dan penyulihan `{param}`, sementara paket seperti
 * vue-i18n membawa pemuat pesan, pemformat ICU, dan mode compile-nya sendiri.
 * Sisanya sudah dikerjakan TypeScript — kunci yang tertinggal ketahuan saat
 * typecheck, bukan saat dijalankan.
 *
 * `locale` sengaja sebuah ref di tingkat modul, bukan disuntik lewat `provide`:
 * dengan begitu `t()` bisa dipanggil dari mana saja — termasuk dari composable
 * di luar komponen — dan setiap `computed` yang memanggilnya otomatis ikut
 * berubah begitu bahasa diganti.
 *
 * PENTING: yang diterjemahkan hanya teks yang dilihat pemain. Nilai protokol
 * ('buat-room', 'penonton', 'kondisi', 'galat', …) adalah bagian dari kontrak
 * jaringan; menerjemahkannya akan memutus sambungan dengan server.
 */

import { computed, ref } from 'vue'

import { readStorage, writeStorage } from '../storage.ts'
import { id } from './id.ts'
import { en } from './en.ts'

export type Locale = 'id' | 'en'

/** Bentuk kamus ditentukan oleh kamus Indonesia; lihat catatan di id.ts. */
export type Messages = typeof id
export type MessageKey = keyof Messages

export type TranslateParams = Record<string, string | number>

const DICTIONARIES: Record<Locale, Messages> = { id, en }

export const LOCALES: Locale[] = ['id', 'en']

/** Nama bahasa ditulis dalam bahasanya sendiri, jadi tidak ikut diterjemahkan. */
export const LOCALE_LABELS: Record<Locale, string> = {
  id: 'Indonesia',
  en: 'English'
}

/** Singkatan untuk tombol pemilih bahasa yang sempit. */
export const LOCALE_SHORT: Record<Locale, string> = { id: 'ID', en: 'EN' }

/** Tag BCP 47 untuk `toLocaleString` dan atribut `lang` di <html>. */
export const LOCALE_TAGS: Record<Locale, string> = { id: 'id-ID', en: 'en-US' }

const STORAGE_KEY = 'catur.bahasa'

const isLocale = (value: string | null | undefined): value is Locale =>
  value === 'id' || value === 'en'

/**
 * Pilihan tersimpan menang atas bahasa browser.
 *
 * Deteksi hanya dijalankan di browser: Node punya `navigator.language` sendiri
 * (biasanya 'en-US'), dan membiarkannya ikut menentukan akan membuat tes
 * berpindah bahasa mengikuti mesin yang menjalankannya.
 */
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'id'

  const saved = readStorage(STORAGE_KEY)
  if (isLocale(saved)) return saved

  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0]
    if (isLocale(primary)) return primary
  }
  return 'id'
}

const locale = ref<Locale>(initialLocale())

/** Pembaca yang aman dipakai komponen; penggantian selalu lewat `setLocale`. */
export const currentLocale = computed<Locale>(() => locale.value)

export const localeTag = computed<string>(() => LOCALE_TAGS[locale.value])

/** Menjaga <html lang> ikut bahasa yang dipilih — dibaca pembaca layar dan mesin telusur. */
function syncDocumentLang(value: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = value
}

syncDocumentLang(locale.value)

export function setLocale(next: Locale): void {
  if (next === locale.value) return
  locale.value = next
  writeStorage(STORAGE_KEY, next)
  syncDocumentLang(next)
}

/**
 * Mengambil satu teks, dengan penyulihan `{nama}` bila diberi parameter.
 *
 * Placeholder yang tidak punya pasangan di `params` dibiarkan apa adanya — itu
 * jauh lebih mudah dilacak daripada teks yang diam-diam bolong.
 */
export function t(key: MessageKey, params?: TranslateParams): string {
  const template = DICTIONARIES[locale.value][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  )
}

/** Angka mengikuti bahasa: 1.234 di Indonesia, 1,234 di Inggris. */
export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE_TAGS[locale.value])
}

export function useI18n() {
  return { t, locale: currentLocale, setLocale, localeTag, formatNumber }
}
