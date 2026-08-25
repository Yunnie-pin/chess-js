import test from 'node:test'
import assert from 'node:assert/strict'

import { Position } from '../src/chess.ts'
import { chooseMove, evaluate } from '../src/ai.ts'

test('evaluasi simetris pada posisi awal', () => {
  assert.equal(evaluate(new Position()), 0)
})

test('evaluasi menghitung keunggulan materi', () => {
  // Hitam kehilangan satu menteri.
  const position = new Position('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  assert.ok(evaluate(position) > 800, 'Putih harus unggul sekitar satu menteri')
})

test('menemukan skakmat satu langkah', () => {
  // Mat tangga: benteng h1 menuju h8.
  const position = new Position('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1')
  const { move } = chooseMove(position, 2000)
  assert.ok(move)
  assert.equal(position.toSAN(move!), 'Ra8#')
})

test('menghindari skakmat satu langkah dari lawan', () => {
  // Putih sedang diancam mat di g2; satu-satunya pertahanan adalah menutup jalur.
  const position = new Position('6k1/8/8/8/8/8/6q1/6K1 w - - 0 1')
  const { move } = chooseMove(position, 2000)
  assert.ok(move)
  position.makeMove(move!)
  assert.notEqual(position.status().reason, 'checkmate')
})

test('mengambil bidak gratis', () => {
  // Menteri hitam di d5 tidak terlindungi dan bisa ditangkap benteng d1.
  const position = new Position('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1')
  const { move } = chooseMove(position, 2000)
  assert.ok(move)
  assert.equal(move!.captured, 'bq')
})

test('mengembalikan langkah milik posisi asli, bukan salinan', () => {
  const position = new Position()
  const { move } = chooseMove(position, 400)
  assert.ok(move)
  assert.ok(
    position.legalMoves().some((m) => m.from === move!.from && m.to === move!.to),
    'langkah harus ada dalam daftar legal posisi asli'
  )
  // Posisi yang dipakai UI tidak boleh ikut berubah selama pencarian.
  assert.equal(position.fen(), new Position().fen())
})

test('mengembalikan null bila tidak ada langkah legal', () => {
  const mated = new Position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
  assert.equal(chooseMove(mated, 1200).move, null)
})
