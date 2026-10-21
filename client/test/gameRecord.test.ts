/**
 * Catatan partai (dari langkah jaringan), PGN, dan nama pembukaan. Murni.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePgn, pgnDate, replayMoves, toPgn } from '../src/engine/gameRecord.ts'
import { openingName } from '../src/engine/openings.ts'
import { START_FEN, fromAlgebraic } from '@chess/shared/chess'

const wire = (uci: string) => ({
  from: fromAlgebraic(uci.slice(0, 2)),
  to: fromAlgebraic(uci.slice(2, 4)),
  promotion: (uci[4] as 'q' | undefined) ?? null
})

test('replayMoves: FEN tiap posisi + SAN, mulai dari posisi awal', () => {
  const record = replayMoves(['e2e4', 'e7e5', 'g1f3'].map(wire))
  assert.equal(record.fens.length, 4)
  assert.equal(record.fens[0], START_FEN)
  assert.deepEqual(record.sans, ['e4', 'e5', 'Nf3'])
  assert.equal(record.moves.length, 3)
})

test('replayMoves: berhenti di langkah ilegal, tidak melempar', () => {
  const record = replayMoves(['e2e4', 'e2e4', 'g1f3'].map(wire))
  assert.deepEqual(record.sans, ['e4'])
  assert.equal(record.fens.length, 2)
})

test('toPgn: Seven Tag Roster berurutan, nomor langkah, hasil di akhir', () => {
  const pgn = toPgn({
    sans: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
    result: '1-0',
    white: 'Mari "the" Bot',
    black: 'Anda',
    date: new Date(2026, 9, 21),
    event: 'Chess with Mari',
    extraTags: { Opening: 'Wayward Queen Attack' }
  })
  const [header, moves] = pgn.split('\n\n')
  assert.deepEqual(
    header.split('\n').map((l) => l.match(/^\[(\w+)/)?.[1]),
    ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'Opening']
  )
  assert.match(header, /\[White "Mari \\"the\\" Bot"\]/)
  assert.match(header, /\[Date "2026\.10\.21"\]/)
  assert.equal(moves.trim(), '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')
})

test('toPgn: teks langkah dibungkus ≤ 80 kolom', () => {
  const sans = Array.from({ length: 60 }, (_, i) => (i % 2 ? 'Nf6' : 'Nf3'))
  const body = toPgn({ sans, result: '*', white: 'a', black: 'b', date: new Date() }).split('\n\n')[1]
  for (const line of body.trim().split('\n')) assert.ok(line.length <= 80, line)
  assert.ok(body.trim().endsWith('*'))
})

test('pgnDate: angka dua digit', () => {
  assert.equal(pgnDate(new Date(2026, 0, 5)), '2026.01.05')
})

test('openingName: posisi terdalam yang dikenali, termasuk transposisi', () => {
  const ruy = replayMoves(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4'].map(wire))
  assert.equal(openingName(ruy.fens), 'Ruy Lopez: Morphy Defense')
  // Sampai ke QGD lewat urutan lain: 1. c4 e6 2. d4 d5.
  const qgd = replayMoves(['c2c4', 'e7e6', 'd2d4', 'd7d5'].map(wire))
  assert.equal(openingName(qgd.fens), "Queen's Gambit Declined")
  assert.equal(openingName([START_FEN]), null)
})

test('openingName: seluruh tabel berisi langkah legal (salah ketik melempar)', () => {
  // Panggilan pertama membangun tabel; kalau ada salah ketik, ini yang melempar.
  assert.doesNotThrow(() => openingName([START_FEN]))
})

test('parsePgn: tag, komentar, variasi bertingkat, NAG, anotasi', () => {
  const pgn = `[Event "Uji"]
[White "Mari \\"M\\" Iochi"]
[Black "Toki"]
[Result "1-0"]

1. e4 {pembukaan raja} e5 2. Qh5?! (2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5) Nc6 $1
3. Bc4 Nf6?? ; blunder
4. Qxf7# 1-0`
  const parsed = parsePgn(pgn)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.sans, ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'])
  assert.equal(parsed.tags.White, 'Mari "M" Iochi')
  assert.equal(parsed.result, '1-0')
  assert.equal(parsed.moves.length, 7)
})

test('parsePgn: SAN yang "hampir benar" tetap terbaca', () => {
  // Tanpa +, rokade dengan nol, promosi tanpa '=', nomor hitam "3...".
  const parsed = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 d6 6. Bg5 h6 7. Bxf7 Kxf7 *')
  assert.ok(parsed.ok)
  assert.equal(parsed.sans[6], 'O-O')
  assert.equal(parsed.sans[12], 'Bxf7+')
  const promo = parsePgn('[FEN "' + START_FEN + '"]\n1. e4 *')
  assert.ok(promo.ok, 'tag FEN berisi posisi awal standar tetap diterima')
})

test('parsePgn: langkah ilegal, kosong, posisi awal non-standar, partai kedua diabaikan', () => {
  assert.deepEqual(parsePgn('1. e4 e5 2. Ke3 *'), { ok: false, error: 'illegal', ply: 3, san: 'Ke3' })
  assert.deepEqual(parsePgn('[Event "x"]\n\n*'), { ok: false, error: 'empty' })
  assert.deepEqual(parsePgn('[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n1. Kb1 *'), {
    ok: false,
    error: 'custom-start'
  })
  const two = parsePgn('1. d4 d5 1/2-1/2\n\n[Event "dua"]\n1. e4 *')
  assert.ok(two.ok)
  assert.deepEqual(two.sans, ['d4', 'd5'])
  assert.equal(two.result, '1/2-1/2')
})

test('parsePgn ↔ toPgn: PGN buatan sendiri terbaca kembali utuh', () => {
  const sans = ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O']
  const pgn = toPgn({ sans, result: '*', white: 'A', black: 'B', date: new Date() })
  const parsed = parsePgn(pgn)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.sans, sans)
})
