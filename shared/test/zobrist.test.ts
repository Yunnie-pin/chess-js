import test from 'node:test'
import assert from 'node:assert/strict'

import { Position, START_FEN } from '../src/chess.ts'
import { combineKey } from '../src/zobrist.ts'

/**
 * Update hash inkremental itu mudah salah — satu XOR yang kelewat pada rokade
 * atau en passant baru terasa jauh kemudian sebagai tabrakan hash yang aneh.
 * Tes ini menjalankan seluruh pohon langkah dan membandingkan hash inkremental
 * dengan hasil hitung-ulang dari nol di SETIAP posisi.
 */
function walk(position: Position, depth: number, check: (p: Position) => void): number {
  check(position)
  if (depth === 0) return 1
  let nodes = 0
  for (const move of position.legalMoves()) {
    position.makeMove(move)
    nodes += walk(position, depth - 1, check)
    position.undoMove()
    check(position) // undo juga harus memulihkan hash dengan tepat
  }
  return nodes
}

const CASES: { name: string; fen: string; depth: number }[] = [
  { name: 'posisi awal', fen: START_FEN, depth: 4 },
  {
    name: 'Kiwipete (rokade, en passant, pin)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depth: 3
  },
  {
    name: 'promosi dengan skak',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    depth: 3
  },
  {
    name: 'en passant memberi skak',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depth: 4
  }
]

for (const { name, fen, depth } of CASES) {
  test(`hash inkremental cocok dengan hitung ulang: ${name}`, () => {
    const position = new Position(fen)
    let checked = 0

    walk(position, depth, (p) => {
      const incrementalLo = p.hashLo
      const incrementalHi = p.hashHi
      const incrementalKey = p.key

      p.recomputeHash()

      assert.equal(p.hashLo, incrementalLo, `hashLo melenceng di ${p.fen()}`)
      assert.equal(p.hashHi, incrementalHi, `hashHi melenceng di ${p.fen()}`)
      assert.equal(p.key, incrementalKey, `key melenceng di ${p.fen()}`)
      checked++
    })

    assert.ok(checked > 1000, `harusnya memeriksa banyak posisi, baru ${checked}`)
  })
}

test('posisi yang sama lewat urutan langkah berbeda punya hash sama', () => {
  // Inilah yang bikin transposition table ada gunanya.
  const a = new Position()
  const b = new Position()

  const play = (p: Position, from: string, to: string) => {
    const at = (s: string) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0])
    const move = p.legalMoves().find((m) => m.from === at(from) && m.to === at(to))
    assert.ok(move, `${from}${to} harus legal`)
    p.makeMove(move!)
  }

  // 1. Nf3 Nf6 2. Nc3 Nc6  lawan  1. Nc3 Nc6 2. Nf3 Nf6 — posisi akhirnya identik.
  play(a, 'g1', 'f3'); play(a, 'g8', 'f6'); play(a, 'b1', 'c3'); play(a, 'b8', 'c6')
  play(b, 'b1', 'c3'); play(b, 'b8', 'c6'); play(b, 'g1', 'f3'); play(b, 'g8', 'f6')

  assert.equal(a.fen(), b.fen(), 'prasyarat: posisinya memang sama')
  assert.equal(a.key, b.key)
  assert.equal(a.hashLo, b.hashLo)
  assert.equal(a.hashHi, b.hashHi)
})

test('hak rokade ikut membedakan hash', () => {
  const withRights = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
  const without = new Position('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1')
  assert.notEqual(withRights.key, without.key, 'papan sama tapi hak rokade beda')
})

test('target en passant ikut membedakan hash', () => {
  const withEp = new Position('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2')
  const without = new Position('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')
  assert.notEqual(withEp.key, without.key)
})

test('giliran ikut membedakan hash', () => {
  const white = new Position('4k3/8/8/8/8/8/8/4K3 w - - 0 1')
  const black = new Position('4k3/8/8/8/8/8/8/4K3 b - - 0 1')
  assert.notEqual(white.key, black.key)
})

test('kunci gabungan tetap dalam batas integer yang aman', () => {
  // combineKey memampatkan 64 bit jadi 53 bit; di atas itu presisinya hilang
  // diam-diam dan dua posisi berbeda bisa terlihat identik.
  for (const [lo, hi] of [
    [0, 0],
    [-1, -1],
    [0x7fffffff, 0x7fffffff],
    [-2147483648, -2147483648]
  ]) {
    const key = combineKey(lo, hi)
    assert.ok(Number.isSafeInteger(key), `${lo},${hi} menghasilkan ${key}`)
    assert.ok(key >= 0)
  }
})
