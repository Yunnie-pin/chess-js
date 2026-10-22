/**
 * Gerbang analisis papan (`useBoardAnalysis`): kapan worker analiser boleh
 * menyala, dan apa yang digambar dari hasilnya. Mesin dan state ulasan
 * disuntik — yang diuji matriks kondisinya, terutama: mesin TIDAK PERNAH
 * menyala selama partai online, apa pun sakelarnya.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'

import {
  SUGGESTION_MIN_DEPTH,
  useBoardAnalysis,
  type UseBoardAnalysisOptions
} from '../src/composables/useBoardAnalysis.ts'
import type { MoveClass } from '../src/engine/moveClassify.ts'
import type { Evaluation } from '../src/engine/stockfishEngine.ts'
import type { ReviewStatus } from '../src/composables/useGameReview.ts'
import type { Color } from '@chess/shared/types'

const FEN_LIVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const FEN_PAST = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const ev = (fen: string, depth: number, moves = [{ from: 52, to: 36 }], cp = 20): Evaluation => ({
  fen,
  cp,
  mate: null,
  depth,
  moves,
  line: []
})

/**
 * Pasang gerbang dengan kondisi bawaan "lawan komputer, giliran pemain, posisi
 * live, semua sakelar mati", lalu biarkan tes mengubah tiap kondisi lewat ref.
 */
function setup() {
  const state = {
    showEvalBar: ref(false),
    showSuggestion: ref(false),
    isOnline: ref(false),
    vsComputer: ref(true),
    analysing: ref(false),
    isLive: ref(true),
    canPlay: ref<Color | null>('w'),
    displayedFen: ref(FEN_LIVE),
    displayPly: ref(1),
    lastMoveTo: ref<number | undefined>(36),
    marks: ref<(MoveClass | null)[]>([]),
    reviewStatus: ref<ReviewStatus>('idle'),
    reviewScores: ref<(Evaluation | undefined)[]>([]),
    cache: new Map<string, Evaluation>()
  }
  const analysed: string[] = []
  const remembered: Evaluation[] = []
  let stops = 0
  let report: (evaluation: Evaluation) => void = () => {}

  const review = {
    status: state.reviewStatus,
    scores: state.reviewScores,
    cachedEvaluation: (fen: string) => state.cache.get(fen),
    remember: (evaluation: Evaluation) => remembered.push(evaluation)
  } as unknown as UseBoardAnalysisOptions['review']

  const scope = effectScope()
  const gate = scope.run(() =>
    useBoardAnalysis({
      ...state,
      review,
      analyse: (fen, onUpdate) => {
        analysed.push(fen)
        report = onUpdate
      },
      stop: () => stops++
    })
  )!
  return {
    state,
    gate,
    analysed,
    remembered,
    /** Kabar dari "mesin" untuk FEN yang terakhir diminta. */
    report: (evaluation: Evaluation) => report(evaluation),
    stops: () => stops,
    dispose: () => scope.stop()
  }
}

test('semua sakelar mati → mesin tidak menyala sama sekali', () => {
  const { gate, analysed, dispose } = setup()
  assert.equal(gate.analysisFen.value, null)
  assert.deepEqual(analysed, [])
  dispose()
})

test('ONLINE: mesin tidak pernah menyala, sekalipun kedua sakelar menyala', async () => {
  const { state, gate, analysed, dispose } = setup()
  state.isOnline.value = true
  state.vsComputer.value = false
  state.showEvalBar.value = true
  state.showSuggestion.value = true
  await nextTick()
  for (const isLive of [true, false]) {
    state.isLive.value = isLive
    await nextTick()
    assert.equal(gate.analysisFen.value, null)
    assert.equal(gate.evalBarVisible.value, false)
  }
  assert.deepEqual(analysed, [], 'menganalisis selama partai online sama dengan curang')
  dispose()
})

test('bilah evaluasi: lawan komputer menganalisis posisi live, termasuk giliran bot', async () => {
  const { state, gate, analysed, dispose } = setup()
  state.showEvalBar.value = true
  state.canPlay.value = null // bot sedang berpikir
  await nextTick()
  assert.equal(gate.evalBarVisible.value, true)
  assert.equal(gate.analysisFen.value, FEN_LIVE)
  assert.deepEqual(analysed, [FEN_LIVE])
  dispose()
})

test('bilah evaluasi: dua pemain tidak; partai impor ya', async () => {
  const { state, gate, dispose } = setup()
  state.showEvalBar.value = true
  state.vsComputer.value = false
  await nextTick()
  assert.equal(gate.evalBarVisible.value, false, 'dua pemain di satu papan tanpa bilah')
  state.analysing.value = true
  await nextTick()
  assert.equal(gate.evalBarVisible.value, true, 'partai impor memang untuk dianalisis')
  dispose()
})

test('panah saja: giliran lawan di posisi live dijeda; menelusuri riwayat tetap dianalisis', async () => {
  const { state, gate, stops, dispose } = setup()
  state.showSuggestion.value = true
  await nextTick()
  assert.equal(gate.analysisFen.value, FEN_LIVE, 'giliran pemain: dianalisis')

  state.canPlay.value = null
  await nextTick()
  assert.equal(gate.analysisFen.value, null, 'giliran bot: panahnya toh disembunyikan')
  assert.ok(stops() > 0, 'pencarian yang jalan dihentikan')

  state.isLive.value = false
  state.displayedFen.value = FEN_PAST
  await nextTick()
  assert.equal(gate.analysisFen.value, FEN_PAST, 'menelusuri riwayat = alat review')
  dispose()
})

test('panah saja: partai impor dianalisis di posisi live walau tak ada yang boleh jalan', async () => {
  const { state, gate, dispose } = setup()
  state.showSuggestion.value = true
  state.vsComputer.value = false
  state.analysing.value = true
  state.canPlay.value = null
  await nextTick()
  assert.equal(gate.analysisFen.value, FEN_LIVE)
  dispose()
})

test('hasil mesin: ditampilkan, diingat untuk ulasan, panah hanya bila segar dan cukup dalam', async () => {
  const { state, gate, remembered, report, dispose } = setup()
  state.showSuggestion.value = true
  await nextTick()
  const three = [
    { from: 52, to: 36 },
    { from: 51, to: 35 },
    { from: 62, to: 45 }
  ]

  report(ev(FEN_LIVE, SUGGESTION_MIN_DEPTH - 1, three))
  assert.deepEqual(gate.suggestionArrows.value, [], 'belum cukup dalam')
  report(ev(FEN_LIVE, SUGGESTION_MIN_DEPTH, three))
  assert.equal(gate.suggestionArrows.value.length, 3, 'MultiPV penuh di luar ulasan')
  assert.equal(gate.shownEvaluation.value?.depth, SUGGESTION_MIN_DEPTH)
  assert.equal(remembered.length, 2)

  state.reviewStatus.value = 'done'
  assert.equal(gate.suggestionArrows.value.length, 1, 'selama ulasan: satu panah saja')

  state.displayedFen.value = FEN_PAST // hasil tadi jadi basi untuk posisi ini
  assert.deepEqual(gate.suggestionArrows.value, [])
  dispose()
})

test('evaluasi tampil: cache yang lebih dalam menang atas hasil live yang baru mulai', async () => {
  const { state, gate, report, dispose } = setup()
  state.showEvalBar.value = true
  await nextTick()
  state.cache.set(FEN_LIVE, ev(FEN_LIVE, 14, undefined, 55))
  report(ev(FEN_LIVE, 3, undefined, -10))
  assert.equal(gate.shownEvaluation.value?.cp, 55, 'kedalaman 3 kalah dari cache kedalaman 14')
  report(ev(FEN_LIVE, 16, undefined, 40))
  assert.equal(gate.shownEvaluation.value?.cp, 40, 'live yang sudah lebih dalam menang')
  dispose()
})

test('ulasan: langkah salah → satu panah "yang seharusnya" + badge, tanpa peduli sakelar panah', () => {
  const { state, gate, dispose } = setup()
  const better = { from: 62, to: 45 }
  state.displayPly.value = 2
  state.lastMoveTo.value = 28
  state.marks.value = ['best', 'blunder']
  state.reviewScores.value = [undefined, ev(FEN_PAST, 14, [better])]

  assert.deepEqual(gate.suggestionArrows.value, [better], 'sakelar panah mati pun tetap tampil')
  assert.deepEqual(gate.boardMoveBadge.value, { square: 28, cls: 'blunder' })

  state.displayPly.value = 1 // langkah 'best': badge ya, panah "seharusnya" tidak
  state.lastMoveTo.value = 36
  assert.deepEqual(gate.boardMoveBadge.value, { square: 36, cls: 'best' })
  assert.deepEqual(gate.suggestionArrows.value, [])

  state.displayPly.value = 0 // posisi awal: tidak ada langkah
  assert.equal(gate.boardMoveBadge.value, null)
  dispose()
})

test('scope berakhir (komponen dilepas) → pencarian dihentikan', () => {
  const { stops, dispose } = setup()
  const before = stops()
  dispose()
  assert.equal(stops(), before + 1)
})
