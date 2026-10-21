/**
 * Ulasan pasca-partai: menilai setiap posisi partai dengan worker analisis,
 * lalu merangkumnya jadi label per langkah + akurasi per pemain.
 *
 * Hasil tiap posisi masuk ke cache per FEN, jadi mengulas ulang (atau mengulas
 * partai yang berbagi pembukaan yang sama) hanya menganalisis posisi yang
 * belum pernah dinilai. Label baru ditampilkan setelah pemain sendiri menekan
 * "Ulas partai" — cache dari partai lama tidak boleh membocorkan "itu blunder"
 * di tengah partai yang sedang berjalan.
 */

import { computed, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { createEvalCache, type EvalCache } from '../engine/evalCache.ts'
import { reviewGame, type GameReview } from '../engine/moveClassify.ts'
import {
  REVIEW_DEPTH,
  analyseGame as analyseGameWithStockfish,
  cancelGameAnalysis as cancelStockfishGameAnalysis,
  type Evaluation
} from '../engine/stockfishEngine.ts'

export type ReviewStatus = 'idle' | 'running' | 'done'

export interface UseGameReviewOptions {
  /** Disuntik tes — Node tidak punya Worker/WASM. Bawaannya worker analisis Stockfish. */
  analyseGame?: (
    fens: readonly string[],
    onResult: (index: number, evaluation: Evaluation) => void
  ) => Promise<void>
  cancelGameAnalysis?: () => void
  /** Bawaannya satu cache untuk seluruh umur composable. */
  cache?: EvalCache
}

/**
 * @param fens  posisi partai: indeks 0 = posisi awal, indeks i = sesudah i ply.
 * @param moves langkah yang dimainkan; panjangnya `fens.length - 1`.
 */
export function useGameReview(
  fens: MaybeRefOrGetter<readonly string[]>,
  moves: MaybeRefOrGetter<readonly { from: number; to: number }[]>,
  options: UseGameReviewOptions = {}
) {
  const analyseGame = options.analyseGame ?? analyseGameWithStockfish
  const cancelGameAnalysis = options.cancelGameAnalysis ?? cancelStockfishGameAnalysis
  const cache = options.cache ?? createEvalCache()

  const status = ref<ReviewStatus>('idle')
  const progress = shallowRef({ done: 0, total: 0 })
  /** Cache bukan objek reaktif — penghitung ini yang jadi dependensi `computed`. */
  const cacheVersion = ref(0)
  /** Naik tiap ulasan dimulai/dibatalkan, supaya ulasan lama yang selesai belakangan tidak menimpa status. */
  let run = 0

  const isFresh = (evaluation: Evaluation | undefined): boolean =>
    evaluation !== undefined && evaluation.depth >= REVIEW_DEPTH

  async function start(): Promise<void> {
    if (status.value === 'running') return
    const token = ++run
    const positions = [...toValue(fens)]
    const missing = positions.filter((fen) => !isFresh(cache.get(fen)))
    progress.value = { done: positions.length - missing.length, total: positions.length }
    if (missing.length === 0) {
      status.value = 'done'
      return
    }
    status.value = 'running'
    await analyseGame(missing, (_index, evaluation) => {
      if (token !== run) return
      cache.set(evaluation)
      cacheVersion.value++
      progress.value = { done: progress.value.done + 1, total: progress.value.total }
    })
    if (token === run && status.value === 'running') status.value = 'done'
  }

  function cancel(): void {
    if (status.value !== 'running') return
    run++
    cancelGameAnalysis()
    status.value = 'idle'
  }

  /** Riwayat berubah (langkah baru, undo, permainan baru) — ulasan lama tidak berlaku lagi. */
  watch(
    () => toValue(fens).join('|'),
    () => {
      cancel()
      status.value = 'idle'
    }
  )

  onScopeDispose(cancel)

  /**
   * Rangkuman partai. Sudah terisi sebagian selama ulasan berjalan — posisi
   * dinilai berurutan, jadi label langkah muncul dari awal partai ke ujung.
   */
  /** Evaluasi tiap posisi partai (indeks = posisi); kosong selama belum diulas. */
  const scores = computed<(Evaluation | undefined)[]>(() => {
    if (status.value === 'idle') return []
    cacheVersion.value
    return toValue(fens).map((fen) => cache.get(fen))
  })

  const review = computed<GameReview | null>(() =>
    status.value === 'idle' ? null : reviewGame(scores.value, toValue(moves))
  )

  /** Evaluasi tersimpan untuk sebuah posisi — supaya bilah evaluasi bisa langsung tampil tanpa menunggu mesin. */
  function cachedEvaluation(fen: string): Evaluation | undefined {
    cacheVersion.value
    return cache.get(fen)
  }

  /**
   * Simpan hasil analisis live juga — sama berharganya dengan hasil ulasan,
   * asal sudah sedalam ulasan. Kabar dangkal dari kedalaman awal tidak
   * disimpan: label langkah akan ikut berkedip setiap kali mesin baru mulai.
   */
  function remember(evaluation: Evaluation): void {
    if (evaluation.depth < REVIEW_DEPTH) return
    const before = cache.get(evaluation.fen)
    cache.set(evaluation)
    if (cache.get(evaluation.fen) !== before) cacheVersion.value++
  }

  return { status, progress, scores, review, start, cancel, cachedEvaluation, remember }
}

export type GameReviewState = ReturnType<typeof useGameReview>
