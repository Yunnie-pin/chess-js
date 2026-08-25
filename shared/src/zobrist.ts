/**
 * Tabel Zobrist untuk hashing posisi.
 *
 * Sebelumnya kunci posisi dibuat dengan `board.join(',')` — string 64 elemen,
 * dibangun ulang di setiap `makeMove`. Pengukuran menunjukkan itu memakan ~70%
 * waktu engine. Zobrist menggantinya dengan XOR bilangan: kunci di-update
 * inkremental, jadi ongkosnya O(1) per langkah, bukan O(64).
 *
 * JavaScript cuma punya operasi bitwise 32-bit, jadi kunci 64-bit disimpan
 * sebagai dua bagian (`lo` dan `hi`). Untuk dipakai sebagai kunci `Map`,
 * keduanya digabung jadi satu Number 53-bit — batas integer yang masih presisi.
 */

import type { Piece } from './types.ts'

/** Urutan bidak dalam tabel: 0-5 putih (pnbrqk), 6-11 hitam. */
export const PIECE_INDEX: Record<Piece, number> = {
  wp: 0, wn: 1, wb: 2, wr: 3, wq: 4, wk: 5,
  bp: 6, bn: 7, bb: 8, br: 9, bq: 10, bk: 11
}

/**
 * PRNG deterministik (xorshift32). Sengaja tidak memakai Math.random: nilai
 * hash harus sama di setiap proses, kalau tidak sebuah bug hash cuma muncul
 * sesekali dan mustahil direproduksi.
 */
function xorshift32(seed: number): () => number {
  let x = seed | 0
  return () => {
    x ^= x << 13
    x |= 0
    x ^= x >>> 17
    x ^= x << 5
    x |= 0
    return x
  }
}

const random = xorshift32(0x1a2b3c4d)

const fill = (length: number): Int32Array => {
  const table = new Int32Array(length)
  for (let i = 0; i < length; i++) table[i] = random()
  return table
}

/** 12 jenis bidak × 64 petak. */
export const PIECE_LO = fill(12 * 64)
export const PIECE_HI = fill(12 * 64)

/** Diindeks bitmask hak rokade: wk=1, wq=2, bk=4, bq=8. */
export const CASTLING_LO = fill(16)
export const CASTLING_HI = fill(16)

/**
 * Diindeks file petak en passant, bukan petaknya. Dua posisi yang identik
 * kecuali barisnya tidak akan pernah keduanya punya target en passant, jadi
 * file sudah cukup — dan ini yang dipakai standar FEN juga.
 */
export const EP_FILE_LO = fill(8)
export const EP_FILE_HI = fill(8)

/** Di-XOR saat giliran hitam. */
export const SIDE_LO = random()
export const SIDE_HI = random()

/**
 * Menggabungkan dua bagian 32-bit jadi satu Number yang aman dipakai sebagai
 * kunci Map: 21 bit dari `hi` + 32 bit dari `lo` = 53 bit, tepat di batas
 * `Number.MAX_SAFE_INTEGER`. Lebih dari itu presisinya hilang diam-diam.
 */
export const combineKey = (lo: number, hi: number): number =>
  (hi & 0x1fffff) * 0x100000000 + (lo >>> 0)
