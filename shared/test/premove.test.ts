/**
 * `premoveMoves` — daftar langkah yang boleh DIANTRE saat giliran lawan. Lebih
 * longgar dari `pseudoMoves` karena langkah lawan di antaranya bisa mengubah isi
 * petak tujuan; legalitas sungguhannya baru dicek saat premove dijalankan.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { Position, fromAlgebraic } from '../src/chess.ts'
import type { Color, Square } from '../src/types.ts'

const sq = fromAlgebraic

/** Bisakah `color` mem-pre-move dari `from` ke `to` di posisi `fen`? */
function canPremove(fen: string, color: Color, from: string, to: string): boolean {
  return new Position(fen)
    .premoveMoves(color)
    .some((m) => m.from === sq(from) && m.to === sq(to))
}

/** Semua petak tujuan pre-move dari `from`. */
function premoveDests(fen: string, color: Color, from: string): Square[] {
  return new Position(fen)
    .premoveMoves(color)
    .filter((m) => m.from === sq(from))
    .map((m) => m.to)
}

test('pion boleh dipre-move diagonal ke petak KOSONG (bakal jadi tangkapan)', () => {
  // Giliran hitam; putih menyiapkan premove e4xd5 walau d5 masih kosong.
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2'
  assert.equal(canPremove(fen, 'w', 'e4', 'd5'), true, 'd5 terisi bidak lawan → jelas boleh')
  assert.equal(canPremove(fen, 'w', 'e4', 'f5'), true, 'f5 kosong → tetap boleh dipre-move')
})

test('pion boleh dipre-move diagonal ke petak berisi bidak SENDIRI (lawan menangkap, aku balas)', () => {
  // Pion putih e4 & d5. Skenario: hitam menangkap d5, lalu putih balas exd5.
  const fen = 'rnbqkbnr/ppp1pppp/8/3P4/4P3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3'
  assert.equal(canPremove(fen, 'w', 'e4', 'd5'), true)
})

test('pion tidak mengarang langkah diagonal ke luar papan', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/P7/8/1PPPPPPP/RNBQKBNR b KQkq - 0 1'
  const dests = premoveDests(fen, 'w', 'a4').map((s) => s)
  // a4: hanya a5 (maju) dan b5 (diagonal ke dalam papan) — tidak ada "kolom -1".
  assert.deepEqual(dests.sort(), [sq('a5'), sq('b5')].sort())
})

test('benteng boleh dipre-move ke petak berisi bidak sendiri, tapi tidak menembusnya', () => {
  // Posisi awal: benteng a1 terhalang pion a2 sendiri.
  const dests = premoveDests('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'w', 'a1')
  assert.ok(dests.includes(sq('a2')), 'boleh menuju petak bidak sendiri (langkah balas)')
  assert.ok(!dests.includes(sq('a3')), 'tidak menembus a2')
})

test('kuda boleh dipre-move ke petak berisi bidak sendiri', () => {
  // Kuda b1, pion sendiri d2 → Nb1-d2 boleh dipre-move (mis. d2 ditukar dulu).
  assert.equal(canPremove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', 'w', 'b1', 'd2'), true)
})

test('rokade boleh dipre-move walau petak di antaranya masih terisi / raja terancam', () => {
  // Raja e1, benteng h1/a1, bidak minor masih di f1/g1/b1/c1/d1, hak rokade utuh.
  const fen = 'rnbqk2r/pppppppp/8/8/7q/8/PPPPP1PP/RNBQK2R w KQkq - 0 1'
  assert.equal(canPremove(fen, 'w', 'e1', 'g1'), true, 'O-O boleh diantre; halangan f1/g1 & skak dicek nanti')
  const fenFull = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'
  assert.equal(canPremove(fenFull, 'w', 'e1', 'c1'), true, 'O-O-O boleh diantre dari posisi awal')
})

test('tidak ada langkah pre-move yang menangkap raja lawan', () => {
  // Kuda c3 secara geometri bisa melompat ke d5 — tapi di sana ada raja hitam.
  const moves = new Position('8/8/8/3k4/8/2N5/8/K7 w - - 0 1').premoveMoves('w')
  assert.ok(moves.some((m) => m.from === sq('c3')), 'kuda c3 tetap punya langkah pre-move lain')
  assert.ok(!moves.some((m) => m.to === sq('d5')), 'petak raja lawan tidak pernah jadi tujuan')
})

test('peluncur tetap berhenti di bidak LAWAN pertama (tak menembus)', () => {
  // Gajah c1, d2 kosong, pion lawan di e3 pada diagonal c1-h6.
  const fen = 'rnbqkbnr/pppppppp/8/8/8/4p3/PPP1PPPP/RNBQKBNR w KQkq - 0 1'
  const dests = premoveDests(fen, 'w', 'c1')
  assert.ok(dests.includes(sq('d2')) && dests.includes(sq('e3')), 'sampai e3 (tangkapan)')
  assert.ok(!dests.includes(sq('f4')), 'tidak menembus e3')
})
