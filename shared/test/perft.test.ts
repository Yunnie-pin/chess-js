import test from 'node:test'
import assert from 'node:assert/strict'

import { Position, START_FEN } from '../src/chess.ts'

/** Menghitung jumlah daun pohon langkah legal — ukuran standar kebenaran engine. */
function perft(position: Position, depth: number): number {
  if (depth === 0) return 1
  const moves = position.legalMoves()
  if (depth === 1) return moves.length
  let nodes = 0
  for (const move of moves) {
    position.makeMove(move)
    nodes += perft(position, depth - 1)
    position.undoMove()
  }
  return nodes
}

// Angka acuan dari https://www.chessprogramming.org/Perft_Results
const CASES: { name: string; fen: string; expected: number[] }[] = [
  {
    name: 'posisi awal',
    fen: START_FEN,
    expected: [20, 400, 8902, 197281]
  },
  {
    name: 'Kiwipete (rokade, en passant, pin)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expected: [48, 2039, 97862]
  },
  {
    name: 'posisi 3 (akhir permainan, en passant skak)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    expected: [14, 191, 2812, 43238]
  },
  {
    name: 'posisi 4 (promosi dengan skak)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    expected: [6, 264, 9467]
  },
  {
    name: 'posisi 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    expected: [44, 1486, 62379]
  }
]

for (const { name, fen, expected } of CASES) {
  test(`perft: ${name}`, () => {
    const position = new Position(fen)
    expected.forEach((nodes, index) => {
      assert.equal(perft(position, index + 1), nodes, `depth ${index + 1}`)
    })
    assert.equal(position.fen(), fen, 'undoMove harus memulihkan posisi persis')
  })
}

test('FEN pulang-pergi tanpa kehilangan informasi', () => {
  for (const { fen } of CASES) {
    assert.equal(new Position(fen).fen(), fen)
  }
})

test('mendeteksi skakmat, remis, dan materi tidak cukup', () => {
  const foolsMate = new Position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
  assert.equal(foolsMate.status().reason, 'checkmate')
  assert.equal(foolsMate.status().winner, 'b')

  const stalemate = new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  assert.equal(stalemate.status().reason, 'stalemate')
  assert.equal(stalemate.status().result, '1/2-1/2')

  assert.equal(new Position('8/8/4k3/8/8/3K1B2/8/8 w - - 0 1').status().reason, 'insufficient-material')
  assert.equal(new Position('8/8/4k3/8/8/3K1R2/8/8 w - - 0 1').status().over, false)
})

const sanOf = (fen: string): string[] => {
  const position = new Position(fen)
  return position.legalMoves().map((move) => position.toSAN(move))
}

test('SAN memakai disambiguasi dan menandai skak', () => {
  const castling = sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
  assert.ok(castling.includes('O-O'), 'rokade sisi raja')
  assert.ok(castling.includes('O-O-O'), 'rokade sisi menteri')
  assert.ok(castling.includes('Rxa8+'), 'tangkapan yang memberi skak')
  // Benteng h1 terhalang raja di e1, jadi Rb1 tidak perlu disambiguasi.
  assert.ok(castling.includes('Rb1') && !castling.includes('Rab1'))

  // Dua benteng sama-sama bisa mencapai b1 -> perlu huruf file.
  const byFile = sanOf('4k3/8/8/8/8/4K3/8/R6R w - - 0 1')
  assert.ok(byFile.includes('Rab1') && byFile.includes('Rhb1'), 'disambiguasi lewat file')

  // Dua benteng pada file yang sama -> perlu angka baris.
  const byRank = sanOf('4k3/8/8/R7/8/4K3/8/R7 w - - 0 1')
  assert.ok(byRank.includes('R5a4') && byRank.includes('R1a4'), 'disambiguasi lewat baris')

  const promo = sanOf('8/P6k/8/8/8/8/8/K7 w - - 0 1')
  assert.ok(promo.includes('a8=Q'), 'promosi menteri')
  assert.ok(promo.includes('a8=N'), 'promosi kuda')
})

test('tiga kali pengulangan berakhir remis', () => {
  const position = new Position()
  const play = (from: string, to: string) => {
    const move = position
      .legalMoves()
      .find((m) => m.from === fromSquare(from) && m.to === fromSquare(to))
    assert.ok(move, `langkah ${from}${to} harus legal`)
    position.makeMove(move!)
  }
  const fromSquare = (text: string) => (8 - Number(text[1])) * 8 + 'abcdefgh'.indexOf(text[0])

  for (let i = 0; i < 2; i++) {
    play('g1', 'f3')
    play('g8', 'f6')
    play('f3', 'g1')
    play('f6', 'g8')
  }
  assert.equal(position.status().reason, 'threefold')
})
