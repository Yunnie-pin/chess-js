/**
 * Gerbang analisis papan: KAPAN worker analiser boleh menilai posisi, dan apa
 * yang digambar dari hasilnya — bilah evaluasi, panah saran, panah "langkah
 * yang seharusnya", dan badge label ulasan. Dulu semuanya computed di
 * `App.vue` yang tak pernah dites, padahal inilah bagian dengan cabang paling
 * banyak — dan salah satunya menjaga agar mesin tidak menyala selama partai
 * online (yang sama dengan curang).
 *
 * Semua masukan berupa getter supaya tes bisa menyetel tiap kondisi langsung;
 * mesinnya disuntik (bawaannya worker analiser di `stockfishEngine.ts`).
 */

import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import type { Color, Square } from '@chess/shared/types'
import type { MoveClass } from '../engine/moveClassify.ts'
import {
  analysePosition,
  stopAnalysis,
  type Evaluation
} from '../engine/stockfishEngine.ts'
import type { GameReviewState } from './useGameReview.ts'

type Arrow = { from: Square; to: Square }

export interface UseBoardAnalysisOptions {
  /** Sakelar pengguna. */
  showEvalBar: MaybeRefOrGetter<boolean>
  showSuggestion: MaybeRefOrGetter<boolean>
  isOnline: MaybeRefOrGetter<boolean>
  /** Benar-benar melawan bot sekarang (bukan sekadar mode-nya — partai impor bukan). */
  vsComputer: MaybeRefOrGetter<boolean>
  /** Partai impor di fase `analysis`. */
  analysing: MaybeRefOrGetter<boolean>
  /** Yang tampil adalah posisi sekarang, bukan penelusuran riwayat. */
  isLive: MaybeRefOrGetter<boolean>
  /** Warna yang boleh digerakkan pemain sekarang, atau null. */
  canPlay: MaybeRefOrGetter<Color | null>
  /** FEN posisi yang SEDANG tampil (ditelusuri atau sekarang). */
  displayedFen: MaybeRefOrGetter<string>
  /** Ply yang sedang tampil (0 = posisi awal). */
  displayPly: MaybeRefOrGetter<number>
  /** Petak tujuan langkah yang sedang tampil — tempat badge ulasan. */
  lastMoveTo: MaybeRefOrGetter<Square | undefined>
  /** Label ulasan per ply (indeks 0 = ply 1); kosong selama belum diulas. */
  marks: MaybeRefOrGetter<readonly (MoveClass | null)[]>
  review: Pick<GameReviewState, 'status' | 'scores' | 'cachedEvaluation' | 'remember'>
  /** Disuntik tes; bawaannya worker analiser. */
  analyse?: (fen: string, onUpdate: (evaluation: Evaluation) => void) => void
  stop?: () => void
}

/** Kedalaman minimal sebelum panah saran ditampilkan — supaya tidak lompat-lompat sebelum mengendap. */
export const SUGGESTION_MIN_DEPTH = 6

export function useBoardAnalysis(options: UseBoardAnalysisOptions) {
  const analyse = options.analyse ?? analysePosition
  const stop = options.stop ?? stopAnalysis
  const { review } = options
  const get = <T>(source: MaybeRefOrGetter<T>) => toValue(source)

  /** Bilah evaluasi: lawan komputer atau partai impor, dan hanya bila sakelarnya sendiri menyala. */
  const evalBarVisible = computed(
    () => get(options.showEvalBar) && (get(options.vsComputer) || get(options.analysing))
  )
  /** Panah saran: kedua mode lokal, tidak pernah online. */
  const suggestionEnabled = computed(() => get(options.showSuggestion) && !get(options.isOnline))

  /**
   * FEN yang benar-benar dikirim ke analiser — atau null untuk menjedanya.
   *
   * Online: tidak pernah, selama partai berjalan. Ulasan pasca-partai online
   * tidak lewat jalur ini (antrean ulasan punya pintunya sendiri), jadi di sini
   * cukup: bilah evaluasi dan panah saran memang mati di mode online.
   *
   * Kalau cuma panah saran yang dipakai (bilah evaluasi mati), giliran LAWAN
   * di posisi live tidak dianalisis: panahnya toh disembunyikan, dan worker
   * langkah bot sudah menghabiskan satu inti. Menelusuri riwayat tetap
   * dianalisis — di sanalah panah saran jadi alat review — begitu pula partai
   * impor, yang tidak punya "giliran lawan".
   */
  const analysisFen = computed<string | null>(() => {
    if (!evalBarVisible.value && !suggestionEnabled.value) return null
    const opponentsTurnLive =
      get(options.isLive) && get(options.canPlay) === null && !get(options.analysing)
    if (!evalBarVisible.value && opponentsTurnLive) return null
    return get(options.displayedFen)
  })

  const evaluation = ref<Evaluation | null>(null)

  watch(
    analysisFen,
    (fen) => {
      if (fen) {
        analyse(fen, (result) => {
          evaluation.value = result
          review.remember(result)
        })
      } else {
        stop()
        evaluation.value = null
      }
    },
    { immediate: true }
  )
  onScopeDispose(() => stop())

  /**
   * Evaluasi yang ditampilkan: hasil live bila sudah untuk posisi ini dan
   * setidaknya sedalam yang tersimpan; selain itu hasil tersimpan (dari ulasan
   * atau kunjungan sebelumnya), supaya menelusuri partai yang sudah diulas
   * langsung menampilkan angka tanpa menunggu mesin mulai dari kedalaman 1.
   */
  const shownEvaluation = computed<Evaluation | null>(() => {
    const fen = get(options.displayedFen)
    const live = evaluation.value
    const cached = review.cachedEvaluation(fen)
    if (live && live.fen === fen && (!cached || live.depth >= cached.depth)) return live
    return cached ?? live
  })

  /** Label ulasan langkah yang sedang tampil, atau null. */
  const displayedMark = computed<MoveClass | null>(() => {
    const ply = get(options.displayPly)
    return ply > 0 ? (get(options.marks)[ply - 1] ?? null) : null
  })

  /**
   * Langkah terbaik di posisi SEBELUM langkah yang sedang tampil, bila langkah
   * itu diberi label ?!, ?, atau ??. Digambar di papan sesudah langkahnya —
   * sorotan langkah terakhir menunjukkan apa yang dimainkan, panahnya apa yang
   * seharusnya. Tidak ikut sakelar panah saran: pemain sendiri yang meminta ulasan.
   */
  const reviewBetterMove = computed<Arrow | null>(() => {
    const mark = displayedMark.value
    if (!mark || mark === 'best' || mark === 'good') return null
    return review.scores.value[get(options.displayPly) - 1]?.moves[0] ?? null
  })

  /**
   * Badge label ulasan di papan, ditempel di petak tujuan langkah yang sedang
   * tampil (untuk rokade: petak raja). Kosong sebelum ulasan berjalan.
   */
  const boardMoveBadge = computed<{ square: Square; cls: MoveClass } | null>(() => {
    const cls = displayedMark.value
    const square = get(options.lastMoveTo)
    return cls && square !== undefined ? { square, cls } : null
  })

  /**
   * Panah di papan. Ulasan berbicara lebih dulu: di langkah yang salah, satu-
   * satunya panah adalah langkah yang seharusnya. Selain itu panah saran
   * (MultiPV, terurut dari terbaik): live hanya saat giliran pihak yang boleh
   * digerakkan; menelusuri riwayat untuk siapa pun yang jalan. Hasil yang basi
   * (`fen` tak cocok) atau belum cukup dalam dibuang.
   */
  const suggestionArrows = computed<Arrow[]>(() => {
    if (reviewBetterMove.value) return [reviewBetterMove.value]
    if (!suggestionEnabled.value) return []
    if (get(options.isLive) && get(options.canPlay) === null && !get(options.analysing)) return []
    const result = shownEvaluation.value
    if (!result || result.fen !== get(options.displayedFen) || result.depth < SUGGESTION_MIN_DEPTH) {
      return []
    }
    // Selama ulasan, papan dibuat setenang mungkin: satu panah saja, bukan tiga.
    return review.status.value === 'idle' ? result.moves : result.moves.slice(0, 1)
  })

  return {
    evalBarVisible,
    analysisFen,
    shownEvaluation,
    reviewBetterMove,
    boardMoveBadge,
    suggestionArrows
  }
}
