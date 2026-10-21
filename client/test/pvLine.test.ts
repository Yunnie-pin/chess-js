/**
 * Lini utama mesin (UCI) → SAN bernomor, dan navigasi momen penting. Murni,
 * diuji tanpa worker.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { formatLine, uciLineToSan } from '../src/engine/pvLine.ts'
import { nearestMoment } from '../src/engine/moveClassify.ts'
import { START_FEN } from '@chess/shared/chess'

/** Sesudah 1. e4 e5 2. Bc4 Nc6 3. Qh5 — Hitam jalan, Qxf7# mengancam. */
const SCHOLAR = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'

test('uciLineToSan: lini biasa dengan skak dan mat', () => {
  assert.deepEqual(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3']), ['e4', 'e5', 'Nf3'])
  // Kalau Hitam membalas Nf6??, Qxf7 langsung mat.
  assert.deepEqual(uciLineToSan(SCHOLAR, ['g8f6', 'h5f7']), ['Nf6', 'Qxf7#'])
})

test('uciLineToSan: rokade, promosi, dan batas jumlah', () => {
  const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
  assert.deepEqual(uciLineToSan(castle, ['e1g1', 'e8c8']), ['O-O', 'O-O-O'])
  const promote = '8/P6k/8/8/8/8/8/K7 w - - 0 1'
  assert.deepEqual(uciLineToSan(promote, ['a7a8n']), ['a8=N'])
  assert.equal(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2).length, 2)
})

test('uciLineToSan: berhenti di token ilegal atau rusak, tidak melempar', () => {
  assert.deepEqual(uciLineToSan(START_FEN, ['e2e4', 'e2e4', 'g1f3']), ['e4'])
  assert.deepEqual(uciLineToSan(START_FEN, ['zz99']), [])
  assert.deepEqual(uciLineToSan(START_FEN, []), [])
})

test('formatLine: nomor langkah dari FEN, "…" bila Hitam mulai', () => {
  assert.equal(formatLine(START_FEN, ['e4', 'e5', 'Nf3']), '1. e4 e5 2. Nf3')
  assert.equal(formatLine(SCHOLAR, ['Nf6', 'Qxf7#']), '3… Nf6 4. Qxf7#')
  assert.equal(formatLine(START_FEN, []), '')
})

test('nearestMoment: hanya kesalahan dan blunder, dua arah, null di ujung', () => {
  const marks = ['best', 'inaccuracy', 'mistake', 'good', 'blunder', null] as const
  assert.equal(nearestMoment(marks, 0, 1), 3)
  assert.equal(nearestMoment(marks, 3, 1), 5)
  assert.equal(nearestMoment(marks, 5, 1), null)
  assert.equal(nearestMoment(marks, 6, -1), 5)
  assert.equal(nearestMoment(marks, 3, -1), null, 'inaccuracy bukan momen penting')
})
