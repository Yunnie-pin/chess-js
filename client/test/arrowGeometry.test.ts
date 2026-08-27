/**
 * Geometri panah/cincin anotasi — fungsi murni, jadi diuji langsung dengan
 * angka acuan, sama seperti `evalScale.test.ts` dan tes kontras tema.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { fromAlgebraic } from '@chess/shared/chess'
import {
  ARROW_METRICS,
  arrowOutline,
  isKnightShape,
  markRing,
  squareCenter
} from '../src/components/arrowGeometry.ts'

const sq = fromAlgebraic

/** Jarak dua titik — untuk asersi lebar pita. */
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

const near = (a: number, b: number, eps = 0.01): boolean => Math.abs(a - b) <= eps

test('squareCenter: pojok dan tengah papan, satuan viewBox 0-100', () => {
  assert.deepEqual(squareCenter(sq('a8'), 'w'), { x: 6.25, y: 6.25 })
  assert.deepEqual(squareCenter(sq('h1'), 'w'), { x: 93.75, y: 93.75 })
  assert.deepEqual(squareCenter(sq('e2'), 'w'), { x: 56.25, y: 81.25 })
  assert.deepEqual(squareCenter(sq('e4'), 'w'), { x: 56.25, y: 56.25 })
})

test('squareCenter: papan dibalik = cermin titik terhadap (50, 50)', () => {
  assert.deepEqual(squareCenter(sq('a8'), 'b'), { x: 93.75, y: 93.75 })
  assert.deepEqual(squareCenter(sq('e4'), 'b'), { x: 43.75, y: 43.75 })
})

test('isKnightShape: hanya pola (1,2)', () => {
  assert.equal(isKnightShape(sq('g1'), sq('f3')), true)
  assert.equal(isKnightShape(sq('b1'), sq('c3')), true)
  assert.equal(isKnightShape(sq('e2'), sq('e4')), false)
  assert.equal(isKnightShape(sq('a1'), sq('h8')), false)
})

test('arrowOutline lurus: 7 titik, bidang tertutup, kepala lebih lebar dari batang', () => {
  const pts = arrowOutline({ from: sq('e2'), to: sq('e4') }, 'w')
  assert.equal(pts.length, 7)
  assert.notDeepEqual(pts[0], pts[6], 'polygon: titik pertama ≠ terakhir')

  // Ujung berhenti `tipGap` sebelum titik tengah e4.
  const tip = pts[3]
  assert.ok(near(tip.x, 56.25) && near(tip.y, 56.25 + ARROW_METRICS.tipGap))

  // Lebar tegak lurus: batang di leher (titik 2↔6), pangkal kepala (titik 3↔5).
  assert.ok(near(dist(pts[1], pts[5]), ARROW_METRICS.shaftWidth))
  assert.ok(near(dist(pts[2], pts[4]), ARROW_METRICS.headWidth))

  // Simetris terhadap sumbu panah (x = 56.25).
  assert.ok(near(pts[0].x - 56.25, 56.25 - pts[6].x))
})

test('arrowOutline kuda: 9 titik, siku, ujung di petak tujuan', () => {
  const pts = arrowOutline({ from: sq('g1'), to: sq('f3') }, 'w')
  assert.equal(pts.length, 9)
  const tip = pts[4]
  // f3 = (68.75, 68.75); ujung mundur `tipGap` menuju tekukan (ke kanan).
  assert.ok(near(tip.x, 68.75 + ARROW_METRICS.tipGap) && near(tip.y, 68.75))
})

test('arrowOutline: papan dibalik = tiap titik dicermin terhadap (50, 50)', () => {
  for (const move of [
    { from: sq('e2'), to: sq('e4') },
    { from: sq('g1'), to: sq('f3') }
  ]) {
    const white = arrowOutline(move, 'w')
    const black = arrowOutline(move, 'b')
    assert.equal(white.length, black.length)
    white.forEach((p, i) => {
      assert.ok(near(black[i].x, 100 - p.x) && near(black[i].y, 100 - p.y))
    })
  }
})

test('markRing: cincin terletak di dalam petaknya', () => {
  const ring = markRing(sq('d4'), 'w')
  const center = squareCenter(sq('d4'), 'w')
  assert.deepEqual({ cx: ring.cx, cy: ring.cy }, { cx: center.x, cy: center.y })
  assert.ok(ring.r < 6.25, 'jari-jari < setengah petak, jadi tidak melewati tepi')
})
