/**
 * Klasifikasi langkah + akurasi: dua evaluasi mesin → label dan angka. Logika
 * murni, jadi diuji langsung tanpa worker maupun komponen.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyMove,
  gameAccuracy,
  moveAccuracy,
  reviewGame,
  whiteWinChance,
  winChanceLoss,
  type Score
} from '../src/engine/moveClassify.ts'

// Giliran saja yang dibaca dari FEN; papannya tidak relevan bagi rumus ini.
const W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

const cp = (value: number, fen: string): Score => ({ cp: value, mate: null, fen })
const mate = (value: number, fen: string): Score => ({ cp: null, mate: value, fen })

test('whiteWinChance: imbang 0.5, mat paksa pasti, mat 0 dibaca dari giliran', () => {
  assert.equal(whiteWinChance(cp(0, W)), 0.5)
  assert.equal(whiteWinChance(mate(3, W)), 1)
  assert.equal(whiteWinChance(mate(-2, B)), 0)
  // Sudah mat dan Hitam yang jalan → Hitam yang kalah.
  assert.equal(whiteWinChance(mate(0, B)), 1)
  assert.equal(whiteWinChance(mate(0, W)), 0)
  assert.equal(whiteWinChance({ cp: null, mate: null, fen: W }), 0.5)
})

test('whiteWinChance: tanpa penjepit dan simetris', () => {
  assert.ok(whiteWinChance(cp(2000, W)) > 0.99)
  const up = whiteWinChance(cp(250, W))
  const down = whiteWinChance(cp(-250, W))
  assert.ok(Math.abs(up + down - 1) < 1e-12)
})

test('classifyMove: ambang dari sudut Putih', () => {
  assert.equal(classifyMove(cp(0, W), cp(-30, B)), 'good')
  assert.equal(classifyMove(cp(0, W), cp(-100, B)), 'inaccuracy')
  assert.equal(classifyMove(cp(0, W), cp(-150, B)), 'mistake')
  assert.equal(classifyMove(cp(0, W), cp(-300, B)), 'blunder')
})

test('classifyMove: pihak yang melangkah dibaca dari FEN sebelum langkah', () => {
  // Hitam melangkah dan evaluasi naik untuk Putih — itu kerugian bagi Hitam.
  assert.equal(classifyMove(cp(0, B), cp(300, W)), 'blunder')
  // Evaluasi yang sama, tapi Putih yang melangkah — malah bagus.
  assert.equal(classifyMove(cp(0, W), cp(300, B)), 'good')
})

test('classifyMove: langkah teratas mesin selalu best', () => {
  assert.equal(classifyMove(cp(0, W), cp(-300, B), true), 'best')
})

test('classifyMove: membuang mat paksa, dan memberi mat', () => {
  // Punya mat dalam 3, malah cuma unggul +4 — peluang menang anjlok.
  assert.equal(classifyMove(mate(3, W), cp(400, B)), 'blunder')
  // Langkah yang memberi mat: posisi sesudahnya `mate 0` dengan Hitam jalan.
  assert.equal(winChanceLoss(mate(1, W), mate(0, B)), 0)
  // Berjalan ke mat paksa lawan.
  assert.equal(classifyMove(cp(0, W), mate(2, B)), 'good')
  assert.equal(classifyMove(cp(0, W), mate(-2, B)), 'blunder')
})

test('winChanceLoss: evaluasi yang naik tidak jadi kerugian negatif', () => {
  assert.equal(winChanceLoss(cp(0, W), cp(200, B)), 0)
})

test('moveAccuracy: tanpa kerugian ≈ 100, blunder jatuh tajam, tetap di 0..100', () => {
  assert.ok(moveAccuracy(cp(50, W), cp(50, B)) > 99.9)
  const blunder = moveAccuracy(cp(0, W), cp(-300, B))
  assert.ok(blunder > 25 && blunder < 40, `blunder = ${blunder}`)
  assert.equal(moveAccuracy(mate(1, W), mate(-1, B)), 0)
})

test('gameAccuracy: kosong null, sempurna 100, satu langkah 0% menyeret ke bawah', () => {
  assert.equal(gameAccuracy([]), null)
  assert.equal(gameAccuracy([100, 100, 100]), 100)
  const mixed = gameAccuracy([100, 0])
  assert.ok(mixed !== null && mixed < 50 && mixed > 20, `mixed = ${mixed}`)
})

test('reviewGame: label per ply, best dari lini teratas, warna dari FEN', () => {
  const e2e4 = { from: 52, to: 36 }
  const e7e5 = { from: 12, to: 28 }
  const result = reviewGame(
    [
      { ...cp(20, W), moves: [e2e4] },
      { ...cp(20, B), moves: [{ from: 1, to: 18 }] },
      { ...cp(320, W), moves: [] }
    ],
    [e2e4, e7e5]
  )
  assert.deepEqual(
    result.plies.map((ply) => ply?.cls),
    ['best', 'blunder']
  )
  assert.equal(result.counts.w.best, 1)
  assert.equal(result.counts.b.blunder, 1)
  assert.ok(result.accuracy.w! > result.accuracy.b!)
})

test('reviewGame: posisi yang belum dinilai → null, warna tanpa langkah → akurasi null', () => {
  // Partai yang dimulai giliran Hitam; posisi sesudahnya belum ada skornya.
  const result = reviewGame([{ ...cp(0, B), moves: [] }, undefined], [{ from: 12, to: 28 }])
  assert.deepEqual(result.plies, [null])
  assert.equal(result.accuracy.b, null)
  assert.equal(result.accuracy.w, null)
})
