import test from 'node:test'
import assert from 'node:assert/strict'

import { algebraic, fileOf, fromAlgebraic, isLightSquare, rankOf } from '../src/chess.ts'

test('petak sudut berwarna sesuai papan sungguhan', () => {
  assert.equal(isLightSquare(fromAlgebraic('a8')), true)
  assert.equal(isLightSquare(fromAlgebraic('h8')), false)
  assert.equal(isLightSquare(fromAlgebraic('a1')), false)
  assert.equal(isLightSquare(fromAlgebraic('h1')), true, 'h1 selalu terang')
  assert.equal(isLightSquare(fromAlgebraic('e4')), true)
  assert.equal(isLightSquare(fromAlgebraic('d4')), false)
})

test('tidak ada dua petak bertetangga yang sewarna', () => {
  for (let square = 0; square < 64; square++) {
    const rank = rankOf(square)
    const file = fileOf(square)
    if (file < 7) {
      assert.notEqual(
        isLightSquare(square),
        isLightSquare(square + 1),
        `${algebraic(square)} dan tetangga kanannya sewarna`
      )
    }
    if (rank < 7) {
      assert.notEqual(
        isLightSquare(square),
        isLightSquare(square + 8),
        `${algebraic(square)} dan tetangga bawahnya sewarna`
      )
    }
  }
})

test('papan terbagi rata 32 terang dan 32 gelap', () => {
  const light = Array.from({ length: 64 }, (_, square) => square).filter(isLightSquare)
  assert.equal(light.length, 32)
})

test('indeks petak dan notasi saling konsisten', () => {
  for (let square = 0; square < 64; square++) {
    assert.equal(fromAlgebraic(algebraic(square)), square)
  }
  // Tata letak papan: indeks 0 di kiri atas (a8), indeks 63 di kanan bawah (h1).
  assert.equal(algebraic(0), 'a8')
  assert.equal(algebraic(7), 'h8')
  assert.equal(algebraic(56), 'a1')
  assert.equal(algebraic(63), 'h1')
})
