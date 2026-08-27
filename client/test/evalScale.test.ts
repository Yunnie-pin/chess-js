/**
 * Matematika bilah evaluasi: angka mesin → bagian bilah + teks. Logika murni,
 * jadi diuji langsung tanpa memuat komponennya.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { formatEval, whiteShare } from '../src/engine/evalScale.ts'

/** Skor mentah dari mesin — cuma `cp`/`mate` yang dipakai kedua fungsi ini. */
const s = (cp: number | null, mate: number | null = null): { cp: number | null; mate: number | null } => ({
  cp,
  mate
})

test('posisi imbang mengisi bilah tepat separuh', () => {
  assert.equal(whiteShare(s(0)), 0.5)
  assert.equal(whiteShare(null), 0.5)
  assert.equal(whiteShare(s(null, null)), 0.5)
})

test('keunggulan Putih menaikkan bagiannya, keunggulan Hitam menurunkannya', () => {
  const white = whiteShare(s(300))
  const black = whiteShare(s(-300))
  assert.ok(white > 0.5 && white < 1)
  assert.ok(black < 0.5 && black > 0)
  // Simetris terhadap titik tengah.
  assert.ok(Math.abs(white - 0.5 - (0.5 - black)) < 1e-9)
})

test('kurva melambat di ujung: pion ke-9 menggeser bilah jauh lebih sedikit daripada pion pertama', () => {
  const firstPawn = whiteShare(s(100)) - 0.5
  const ninthPawn = whiteShare(s(900)) - whiteShare(s(800))
  assert.ok(ninthPawn < firstPawn)
})

test('keunggulan telak tetap menyisakan garis untuk sisi yang kalah, tapi mat mengisi penuh', () => {
  assert.equal(whiteShare(s(5000)), 0.98)
  assert.equal(whiteShare(s(-5000)), 0.02)
  assert.equal(whiteShare(s(null, 3)), 1)
  assert.equal(whiteShare(s(null, -2)), 0)
})

test('teks: bertanda untuk pion, "M" untuk mat, "…" sebelum ada kabar', () => {
  assert.equal(formatEval(s(120)), '+1.2')
  assert.equal(formatEval(s(-40)), '-0.4')
  assert.equal(formatEval(s(2)), '0.0')
  assert.equal(formatEval(s(null, 3)), 'M3')
  assert.equal(formatEval(s(null, -5)), 'M5')
  assert.equal(formatEval(null), '…')
  assert.equal(formatEval(s(null, null)), '…')
})
