/**
 * Cache hasil analisis per posisi. Ulasan pasca-partai menganalisis tiap posisi
 * sekali; sesudahnya menelusuri riwayat cukup membaca dari sini, tanpa
 * menyalakan mesin lagi. Logika murni — tidak tahu-menahu soal worker.
 */

import type { Evaluation } from './stockfishEngine.ts'

/**
 * Kunci = empat field pertama FEN (papan, giliran, rokade, en passant). Dua
 * penghitung terakhir dibuang: posisi yang sama lewat urutan langkah berbeda
 * (transposisi) atau di nomor langkah berbeda tetap dinilai sama oleh mesin.
 */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export interface EvalCache {
  get(fen: string): Evaluation | undefined
  /** Simpan, kecuali yang sudah ada lebih dalam — hasil dangkal tidak menimpa yang matang. */
  set(evaluation: Evaluation): void
  clear(): void
  readonly size: number
}

/**
 * Batas entri: satu partai panjang ~200 ply, jadi 1000 cukup untuk beberapa
 * partai sekaligus tanpa membiarkan memori tumbuh selamanya. Yang dibuang
 * duluan adalah yang paling lama tidak disentuh (LRU — urutan sisip `Map`).
 */
export function createEvalCache(limit = 1000): EvalCache {
  const entries = new Map<string, Evaluation>()

  return {
    get(fen) {
      const key = positionKey(fen)
      const hit = entries.get(key)
      if (hit) {
        // Sentuh: pindah ke ujung supaya tidak jadi korban LRU berikutnya.
        entries.delete(key)
        entries.set(key, hit)
      }
      return hit
    },
    set(evaluation) {
      const key = positionKey(evaluation.fen)
      const existing = entries.get(key)
      if (existing && existing.depth > evaluation.depth) return
      entries.delete(key)
      entries.set(key, evaluation)
      if (entries.size > limit) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    }
  }
}
