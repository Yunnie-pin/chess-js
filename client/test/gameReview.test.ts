/**
 * Ulasan pasca-partai lewat composable-nya, dengan analiser palsu yang
 * disuntikkan — Node tidak punya Worker/WASM. Yang diuji alur statusnya
 * (idle → running → done, batal, reset saat riwayat berubah) dan pemakaian
 * cache, bukan kekuatan mesin.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'

import { useGameReview, type UseGameReviewOptions } from '../src/composables/useGameReview.ts'
import { createEvalCache } from '../src/engine/evalCache.ts'
import type { Evaluation } from '../src/engine/stockfishEngine.ts'
import { Position, START_FEN, fromAlgebraic } from '@chess/shared/chess'

const at = fromAlgebraic

/** Partai pendek: 1. e4 e5 2. Qh5 Nc6 — FEN tiap posisi + langkahnya. */
function game(uci: [string, string][]): { fens: string[]; moves: { from: number; to: number }[] } {
  const position = new Position(START_FEN)
  const fens = [position.fen()]
  const moves: { from: number; to: number }[] = []
  for (const [from, to] of uci) {
    const move = position.legalMoves().find((m) => m.from === at(from) && m.to === at(to))
    assert.ok(move, `${from}${to} harus legal`)
    position.makeMove(move)
    fens.push(position.fen())
    moves.push({ from: move.from, to: move.to })
  }
  return { fens, moves }
}

const SHORT = game([
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['d1', 'h5'],
  ['b8', 'c6']
])

/**
 * Analiser palsu: skor tetap 0, langkah terbaik = langkah yang dimainkan
 * berikutnya (jadi semua langkah 'best'). Mencatat FEN yang diminta.
 * `hold` menahan penyelesaian sampai dilepas, untuk menguji status 'running'.
 */
function fakeAnalyser(options: { hold?: boolean } = {}) {
  const requested: string[][] = []
  let release: () => void = () => {}
  let cancelled = 0
  const analyseGame: NonNullable<UseGameReviewOptions['analyseGame']> = (fens, onResult) => {
    requested.push([...fens])
    const finish = () =>
      fens.forEach((fen, i) => {
        const index = SHORT.fens.indexOf(fen)
        const best = SHORT.moves[index]
        const evaluation: Evaluation = { fen, cp: 0, mate: null, depth: 20, moves: best ? [best] : [], line: [] }
        onResult(i, evaluation)
      })
    if (!options.hold) {
      finish()
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      release = () => {
        finish()
        resolve()
      }
    })
  }
  return {
    requested,
    release: () => release(),
    get cancelled() {
      return cancelled
    },
    options: { analyseGame, cancelGameAnalysis: () => cancelled++ } satisfies UseGameReviewOptions
  }
}

function inScope<T>(make: () => T): { value: T; stop: () => void } {
  const scope = effectScope()
  const value = scope.run(make) as T
  return { value, stop: () => scope.stop() }
}

test('ulasan: idle → done, semua langkah dinilai, akurasi per warna', async () => {
  const fake = fakeAnalyser()
  const { value: review, stop } = inScope(() => useGameReview(SHORT.fens, SHORT.moves, fake.options))
  // Dibaca lewat fungsi: `assert.equal(x.value, null)` mempersempit tipe
  // `x.value` ke null untuk sisa tes, padahal nilainya berubah sesudah start().
  const current = () => review.review.value
  assert.equal(review.status.value, 'idle')
  assert.equal(current(), null, 'label tidak boleh tampil sebelum diminta')

  await review.start()
  assert.equal(review.status.value, 'done')
  assert.deepEqual(review.progress.value, { done: 5, total: 5 })
  const result = current()
  assert.ok(result)
  assert.deepEqual(
    result.plies.map((ply) => ply?.cls),
    ['best', 'best', 'best', 'best']
  )
  assert.ok(result.accuracy.w !== null && result.accuracy.w > 99)
  assert.equal(result.counts.b.best, 2)
  stop()
})

test('ulasan: posisi yang sudah di cache tidak dianalisis ulang', async () => {
  const fake = fakeAnalyser()
  const cache = createEvalCache()
  const first = inScope(() => useGameReview(SHORT.fens, SHORT.moves, { ...fake.options, cache }))
  await first.value.start()
  first.stop()

  const second = inScope(() => useGameReview(SHORT.fens, SHORT.moves, { ...fake.options, cache }))
  await second.value.start()
  assert.equal(fake.requested.length, 1, 'ulasan kedua seharusnya tidak memanggil mesin')
  assert.equal(second.value.status.value, 'done')
  second.stop()
})

test('ulasan: batal kembali ke idle dan hasil yang datang belakangan dibuang', async () => {
  const fake = fakeAnalyser({ hold: true })
  const { value: review, stop } = inScope(() => useGameReview(SHORT.fens, SHORT.moves, fake.options))
  const pending = review.start()
  assert.equal(review.status.value, 'running')

  review.cancel()
  assert.equal(review.status.value, 'idle')
  assert.equal(fake.cancelled, 1)

  fake.release()
  await pending
  assert.equal(review.status.value, 'idle', 'ulasan yang sudah dibatalkan tidak boleh jadi done')
  assert.equal(review.progress.value.done, 0)
  stop()
})

test('ulasan: riwayat berubah → reset ke idle', async () => {
  const fake = fakeAnalyser()
  const fens = ref(SHORT.fens)
  const moves = ref(SHORT.moves)
  const { value: review, stop } = inScope(() => useGameReview(fens, moves, fake.options))
  await review.start()
  assert.equal(review.status.value, 'done')

  // Undo satu langkah.
  fens.value = SHORT.fens.slice(0, -1)
  moves.value = SHORT.moves.slice(0, -1)
  await nextTick()
  assert.equal(review.status.value, 'idle')
  assert.equal(review.review.value, null)
  stop()
})

test('remember: hasil live dangkal diabaikan, yang dalam masuk cache', () => {
  const fake = fakeAnalyser()
  const { value: review, stop } = inScope(() => useGameReview(SHORT.fens, SHORT.moves, fake.options))
  const fen = SHORT.fens[0]
  review.remember({ fen, cp: 10, mate: null, depth: 5, moves: [], line: [] })
  assert.equal(review.cachedEvaluation(fen), undefined)
  review.remember({ fen, cp: 25, mate: null, depth: 16, moves: [], line: [] })
  assert.equal(review.cachedEvaluation(fen)?.cp, 25)
  stop()
})
