/**
 * Matematika bilah evaluasi: angka mesin → bagian bilah + teks. Logika murni,
 * jadi diuji langsung tanpa memuat komponennya.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { formatEval, whiteShare } from '../src/engine/evalScale.ts'

test('posisi imbang mengisi bilah tepat separuh', () => {
  assert.equal(whiteShare({ cp: 0, mate: null, depth: 20 }), 0.5)
  assert.equal(whiteShare(null), 0.5)
  assert.equal(whiteShare({ cp: null, mate: null, depth: 0 }), 0.5)
})

test('keunggulan Putih menaikkan bagiannya, keunggulan Hitam menurunkannya', () => {
  const white = whiteShare({ cp: 300, mate: null, depth: 20 })
  const black = whiteShare({ cp: -300, mate: null, depth: 20 })
  assert.ok(white > 0.5 && white < 1)
  assert.ok(black < 0.5 && black > 0)
  // Simetris terhadap titik tengah.
  assert.ok(Math.abs(white - 0.5 - (0.5 - black)) < 1e-9)
})

test('kurva melambat di ujung: pion ke-9 menggeser bilah jauh lebih sedikit daripada pion pertama', () => {
  const firstPawn = whiteShare({ cp: 100, mate: null, depth: 20 }) - 0.5
  const ninthPawn =
    whiteShare({ cp: 900, mate: null, depth: 20 }) - whiteShare({ cp: 800, mate: null, depth: 20 })
  assert.ok(ninthPawn < firstPawn)
})

test('keunggulan telak tetap menyisakan garis untuk sisi yang kalah, tapi mat mengisi penuh', () => {
  assert.equal(whiteShare({ cp: 5000, mate: null, depth: 20 }), 0.98)
  assert.equal(whiteShare({ cp: -5000, mate: null, depth: 20 }), 0.02)
  assert.equal(whiteShare({ cp: null, mate: 3, depth: 20 }), 1)
  assert.equal(whiteShare({ cp: null, mate: -2, depth: 20 }), 0)
})

test('teks: bertanda untuk pion, "M" untuk mat, "…" sebelum ada kabar', () => {
  assert.equal(formatEval({ cp: 120, mate: null, depth: 18 }), '+1.2')
  assert.equal(formatEval({ cp: -40, mate: null, depth: 18 }), '-0.4')
  assert.equal(formatEval({ cp: 2, mate: null, depth: 18 }), '0.0')
  assert.equal(formatEval({ cp: null, mate: 3, depth: 18 }), 'M3')
  assert.equal(formatEval({ cp: null, mate: -5, depth: 18 }), 'M5')
  assert.equal(formatEval(null), '…')
  assert.equal(formatEval({ cp: null, mate: null, depth: 0 }), '…')
})
