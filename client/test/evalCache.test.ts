/**
 * Cache analisis per posisi: kunci tanpa penghitung langkah, yang dangkal
 * tidak menimpa yang dalam, dan LRU membuang yang paling lama tak disentuh.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createEvalCache, positionKey } from '../src/engine/evalCache.ts'
import type { Evaluation } from '../src/engine/stockfishEngine.ts'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const ev = (fen: string, depth: number, cp = 0): Evaluation => ({ fen, cp, mate: null, depth, moves: [], line: [] })

/** FEN unik per indeks — cukup berbeda di field papan. */
const fenAt = (i: number): string => `${i}/8/8/8/8/8/8/8 w - - 0 1`

test('positionKey: penghitung half/fullmove diabaikan', () => {
  assert.equal(
    positionKey(START),
    positionKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 12 40')
  )
  assert.notEqual(positionKey(START), positionKey(START.replace(' w ', ' b ')))
})

test('set/get: transposisi berbagi entri', () => {
  const cache = createEvalCache()
  cache.set(ev(START, 16, 20))
  assert.equal(cache.get(START.replace(' 0 1', ' 4 7'))?.cp, 20)
  assert.equal(cache.size, 1)
})

test('set: hasil dangkal tidak menimpa yang lebih dalam', () => {
  const cache = createEvalCache()
  cache.set(ev(START, 16, 20))
  cache.set(ev(START, 8, -50))
  assert.equal(cache.get(START)?.cp, 20)
  cache.set(ev(START, 18, 35))
  assert.equal(cache.get(START)?.cp, 35)
})

test('LRU: yang paling lama tak disentuh dibuang duluan', () => {
  const cache = createEvalCache(2)
  cache.set(ev(fenAt(1), 10))
  cache.set(ev(fenAt(2), 10))
  cache.get(fenAt(1)) // sentuh 1 → 2 jadi yang tertua
  cache.set(ev(fenAt(3), 10))
  assert.equal(cache.size, 2)
  assert.ok(cache.get(fenAt(1)))
  assert.equal(cache.get(fenAt(2)), undefined)
  assert.ok(cache.get(fenAt(3)))
})

test('clear mengosongkan semuanya', () => {
  const cache = createEvalCache()
  cache.set(ev(START, 10))
  cache.clear()
  assert.equal(cache.size, 0)
  assert.equal(cache.get(START), undefined)
})
