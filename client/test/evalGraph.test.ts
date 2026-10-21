/**
 * Geometri grafik evaluasi: skala x/y, pemutusan ruas di posisi yang belum
 * dinilai, path tertutup untuk area, dan crosshair yang menempel ke posisi.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  areaPath,
  graphSegments,
  indexAtX,
  linePath,
  xAt,
  yAt
} from '../src/components/evalGraph.ts'

test('xAt/yAt: ujung kiri-kanan, imbang di tengah, Putih menang di atas', () => {
  assert.equal(xAt(0, 5), 0)
  assert.equal(xAt(4, 5), GRAPH_WIDTH)
  assert.equal(xAt(0, 1), GRAPH_WIDTH / 2)
  assert.equal(yAt(0.5), GRAPH_HEIGHT / 2)
  assert.equal(yAt(1), 0)
  assert.equal(yAt(0), GRAPH_HEIGHT)
})

test('graphSegments: null memutus garis, tidak ditarik lurus', () => {
  const segments = graphSegments([0.5, 0.6, null, 0.4, 0.3])
  assert.deepEqual(
    segments.map((s) => s.map((p) => p.index)),
    [
      [0, 1],
      [3, 4]
    ]
  )
  assert.deepEqual(graphSegments([null, null]), [])
})

test('linePath/areaPath: area menutup ke dasar grafik', () => {
  const [segment] = graphSegments([0.5, 1])
  assert.equal(linePath(segment), `M0 45 L${GRAPH_WIDTH} 0`)
  assert.equal(areaPath(segment), `M0 45 L${GRAPH_WIDTH} 0 L${GRAPH_WIDTH} ${GRAPH_HEIGHT} L0 ${GRAPH_HEIGHT} Z`)
  assert.equal(areaPath(segment, 'b'), `M0 45 L${GRAPH_WIDTH} 0 L${GRAPH_WIDTH} 0 L0 0 Z`)
  assert.equal(areaPath([]), '')
})

test('indexAtX: menempel ke posisi terdekat dan dijepit', () => {
  assert.equal(indexAtX(0, 11), 0)
  assert.equal(indexAtX(GRAPH_WIDTH, 11), 10)
  assert.equal(indexAtX(GRAPH_WIDTH * 0.34, 11), 3)
  assert.equal(indexAtX(-20, 11), 0)
  assert.equal(indexAtX(GRAPH_WIDTH + 20, 11), 10)
  assert.equal(indexAtX(100, 1), 0)
})
