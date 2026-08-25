/**
 * Transposition table.
 *
 * Posisi yang sama sering dicapai lewat urutan langkah berbeda — 1.Nf3 Nf6 2.Nc3
 * dan 1.Nc3 Nf6 2.Nf3 berakhir identik. Tanpa tabel ini, tiap jalur dihitung
 * ulang dari nol. Dengan Zobrist, keduanya punya kunci yang sama, jadi hasilnya
 * bisa dipakai lagi.
 *
 * Disimpan dalam typed array paralel, bukan array objek: ratusan ribu objek per
 * pencarian akan membebani garbage collector persis di jalur terpanas.
 */

import type { PromotionType } from './types.ts'

export const TT_EXACT = 0
/** Skor sesungguhnya minimal segini — hasil pemangkasan beta. */
export const TT_LOWER = 1
/** Skor sesungguhnya maksimal segini — tidak ada langkah yang melewati alpha. */
export const TT_UPPER = 2

/**
 * 2^18 entri ≈ 4,5 MB. Sengaja tidak lebih besar: AI berjalan di Web Worker
 * yang juga hidup di ponsel, dan tabel raksasa di sana lebih banyak ruginya.
 */
const BITS = 18
const SIZE = 1 << BITS
const MASK = SIZE - 1

/** Penanda slot kosong; kedalaman asli tidak pernah negatif. */
const EMPTY = -128

const keyLo = new Int32Array(SIZE)
const keyHi = new Int32Array(SIZE)
const depths = new Int8Array(SIZE).fill(EMPTY)
const flags = new Int8Array(SIZE)
const scores = new Int32Array(SIZE)
const fromSquares = new Int8Array(SIZE)
const toSquares = new Int8Array(SIZE)
const promotions = new Int8Array(SIZE)

const PROMO_CODES: (PromotionType | null)[] = [null, 'q', 'r', 'b', 'n']
const promoCode = (promotion: PromotionType | null): number =>
  promotion === null ? 0 : PROMO_CODES.indexOf(promotion)

export interface TTHit {
  depth: number
  flag: number
  score: number
  /** Langkah terbaik yang pernah ditemukan di posisi ini; -1 bila tidak ada. */
  from: number
  to: number
  promotion: PromotionType | null
}

const slot = (lo: number): number => lo & MASK

export function ttProbe(lo: number, hi: number): TTHit | null {
  const index = slot(lo)
  // Kunci lengkap 64-bit diperiksa, bukan cuma indeksnya: dua posisi berbeda
  // bisa jatuh ke slot yang sama, dan memakai hasil yang salah jauh lebih buruk
  // daripada sekadar kehilangan cache hit.
  if (depths[index] === EMPTY || keyLo[index] !== lo || keyHi[index] !== hi) return null
  return {
    depth: depths[index],
    flag: flags[index],
    score: scores[index],
    from: fromSquares[index],
    to: toSquares[index],
    promotion: PROMO_CODES[promotions[index]] ?? null
  }
}

export function ttStore(
  lo: number,
  hi: number,
  depth: number,
  flag: number,
  score: number,
  from: number,
  to: number,
  promotion: PromotionType | null
): void {
  const index = slot(lo)
  // Depth-preferred: hasil pencarian dalam jauh lebih mahal dibuat ulang
  // daripada yang dangkal, kecuali slotnya memang milik posisi ini.
  const occupied = depths[index] !== EMPTY
  const samePosition = keyLo[index] === lo && keyHi[index] === hi
  if (occupied && !samePosition && depths[index] > depth) return

  keyLo[index] = lo
  keyHi[index] = hi
  depths[index] = depth
  flags[index] = flag
  scores[index] = score
  fromSquares[index] = from
  toSquares[index] = to
  promotions[index] = promoCode(promotion)
}

export function ttClear(): void {
  depths.fill(EMPTY)
}

/** Berapa persen tabel yang terisi — untuk mengukur, bukan dipakai search. */
export function ttFill(): number {
  let used = 0
  for (let i = 0; i < SIZE; i++) if (depths[i] !== EMPTY) used++
  return used / SIZE
}
