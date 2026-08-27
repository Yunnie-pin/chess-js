/**
 * Matematika bilah evaluasi: angka mesin → bagian bilah + teks. Logika murni,
 * jadi diuji langsung tanpa memuat komponennya.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { formatEval, whiteShare } from '../src/engine/evalScale.ts'

/** FEN awal — dipakai sebagai isian saat giliran tidak relevan bagi tesnya. */
const ANY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/**
 * Skor mentah dari mesin. `fen` ikut karena pada posisi yang sudah mat, hanya
 * giliranlah yang memberi tahu siapa yang kalah.
 */
const s = (
  cp: number | null,
  mate: number | null = null,
  fen: string = ANY
): { cp: number | null; mate: number | null; fen: string } => ({ cp, mate, fen })

/*
 * Mat baris belakang, keduanya sudah diperiksa `Position.status()` di `shared`.
 * Perhatikan keduanya bukan cerminan satu sama lain: pion hanya maju satu arah,
 * jadi mencerminkan posisi Putih-dimat begitu saja justru memberi Hitam pion
 * yang bisa promosi dan MEMBLOKIR cek — dan posisinya berhenti jadi mat.
 */
const MATED_BLACK = 'R6k/5ppp/8/8/8/8/8/6K1 b - - 0 1' // Putih yang memberi mat
const MATED_WHITE = '6k1/8/8/8/8/8/5PPP/r6K w - - 0 1' // Hitam yang memberi mat

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

/*
 * Regresi. Stockfish melaporkan posisi yang SUDAH mat sebagai `score mate 0`
 * (diverifikasi langsung terhadap berkas mesin di public/engine). Nol tidak
 * punya tanda, jadi pembalikan sudut pandang di `stockfishEngine.ts` — yang
 * mengalikan skor dengan -1 bila Hitam yang jalan — menghapus satu-satunya
 * petunjuk siapa pemenangnya. Dulu `mate > 0 ? 1 : 0` menjawab 0 untuk kedua
 * kasus, jadi bilahnya hitam penuh bahkan ketika PUTIH yang menang.
 */
test('mat yang sudah terjadi: bilah memihak pemenang, bukan selalu Hitam', () => {
  // Hitam yang jalan dan dimat -> Putih menang -> bilah penuh milik Putih.
  assert.equal(whiteShare(s(null, 0, MATED_BLACK)), 1)
  // Putih yang jalan dan dimat -> Hitam menang -> bilah kosong.
  assert.equal(whiteShare(s(null, 0, MATED_WHITE)), 0)
})

test('remis tetap separuh: buntu dilaporkan mesin sebagai cp 0, bukan mat', () => {
  // Diverifikasi langsung: posisi buntu memberi `score cp 0`, jadi jalur mat
  // tidak boleh ikut menangkapnya.
  assert.equal(whiteShare(s(0, null, '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), 0.5)
})

test('teks: bertanda untuk pion, "M" untuk mat, "…" sebelum ada kabar', () => {
  assert.equal(formatEval(s(120)), '+1.2')
  assert.equal(formatEval(s(-40)), '-0.4')
  assert.equal(formatEval(s(2)), '0.0')
  assert.equal(formatEval(s(null, 3)), 'M3')
  assert.equal(formatEval(s(null, -5)), 'M5')
  // Mat sudah jatuh: "#", bukan "M0" yang tidak berarti apa-apa.
  assert.equal(formatEval(s(null, 0, MATED_BLACK)), '#')
  assert.equal(formatEval(null), '…')
  assert.equal(formatEval(s(null, null)), '…')
})
