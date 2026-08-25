/**
 * Lawan komputer: negamax dengan pemangkasan alpha-beta, pencarian quiescence,
 * pengurutan langkah MVV-LVA, dan iterative deepening yang dibatasi waktu.
 *
 * Evaluasi memakai nilai materi + piece-square table gaya "Simplified Evaluation
 * Function" (chessprogramming.org), selalu dari sudut pandang Putih.
 */

import { BLACK, Position, WHITE, colorOf, rankOf, typeOf } from './chess.ts'
import type { Color, Move, PieceType } from './types.ts'

export type Difficulty = 'mudah' | 'sedang' | 'sulit' | 'ahli'

export interface SearchResult {
  move: Move | null
  score: number
  depth: number
  nodes: number
  timeMs: number
}

interface DifficultyProfile {
  maxDepth: number
  timeMs: number
  /** Peluang memilih langkah acak dari daftar legal, untuk level rendah. */
  blunderChance: number
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  mudah: { maxDepth: 2, timeMs: 250, blunderChance: 0.35 },
  sedang: { maxDepth: 3, timeMs: 700, blunderChance: 0.1 },
  sulit: { maxDepth: 4, timeMs: 1600, blunderChance: 0 },
  ahli: { maxDepth: 6, timeMs: 4000, blunderChance: 0 }
}

const PIECE_VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const MATE_SCORE = 100_000

/** Tabel dibaca dari a8 ke h1, sesuai tata letak papan — cocok langsung untuk Putih. */
const PST: Record<PieceType, number[]> = {
  p: [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ],
  r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ]
}

/** Di babak akhir raja justru harus aktif ke tengah. */
const KING_ENDGAME_PST: number[] = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50
]

/** Cermin vertikal: petak Putih diubah ke sudut pandang Hitam. */
const mirror = (square: number): number => square ^ 56

function isEndgame(position: Position): boolean {
  let material = 0
  for (const piece of position.board) {
    if (!piece) continue
    const type = typeOf(piece)
    if (type !== 'p' && type !== 'k') material += PIECE_VALUE[type]
  }
  return material <= 1300 // kira-kira setara satu menteri + satu perwira ringan per pihak
}

/** Skor posisi dalam satuan seperseratus pion, positif berarti Putih unggul. */
export function evaluate(position: Position): number {
  const endgame = isEndgame(position)
  let score = 0
  for (let square = 0; square < 64; square++) {
    const piece = position.board[square]
    if (!piece) continue
    const type = typeOf(piece)
    const white = colorOf(piece) === WHITE
    const table = type === 'k' && endgame ? KING_ENDGAME_PST : PST[type]
    const value = PIECE_VALUE[type] + table[white ? square : mirror(square)]
    score += white ? value : -value
  }
  return score
}

/** Most Valuable Victim / Least Valuable Aggressor — tangkapan menggiurkan lebih dulu. */
function moveScore(move: Move): number {
  let score = 0
  if (move.captured) score += 10 * PIECE_VALUE[typeOf(move.captured)] - PIECE_VALUE[typeOf(move.piece)]
  if (move.promotion) score += PIECE_VALUE[move.promotion]
  if (move.castle) score += 60
  // Dorongan pion ke arah promosi sedikit dinaikkan agar tidak selalu terakhir.
  if (typeOf(move.piece) === 'p') {
    const advance = colorOf(move.piece) === WHITE ? 7 - rankOf(move.to) : rankOf(move.to)
    score += advance * 2
  }
  return score
}

const orderMoves = (moves: Move[]): Move[] =>
  moves
    .map((move) => ({ move, score: moveScore(move) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.move)

class Searcher {
  nodes = 0
  private position: Position
  private deadline = Infinity
  private aborted = false

  constructor(position: Position) {
    this.position = position
  }

  /** Cari langkah terbaik dengan memperdalam bertahap sampai batas waktu habis. */
  search(maxDepth: number, timeMs: number): SearchResult {
    const started = Date.now()
    this.deadline = started + timeMs
    this.nodes = 0
    this.aborted = false

    const root = orderMoves(this.position.legalMoves())
    let best: Move | null = root[0] ?? null
    let bestScore = 0
    let reached = 0

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -Infinity
      let localBest: Move | null = null
      let localScore = -Infinity

      for (const move of root) {
        this.position.makeMove(move)
        const score = -this.negamax(depth - 1, -Infinity, -alpha)
        this.position.undoMove()

        if (this.aborted) break
        if (score > localScore) {
          localScore = score
          localBest = move
        }
        if (score > alpha) alpha = score
      }

      if (this.aborted) break
      if (localBest) {
        best = localBest
        bestScore = localScore
        reached = depth
        // Urutkan ulang agar langkah terbaik dicoba lebih dulu di kedalaman berikutnya.
        root.splice(root.indexOf(localBest), 1)
        root.unshift(localBest)
      }
      // Skakmat sudah ditemukan — memperdalam tidak menghasilkan apa-apa lagi.
      if (Math.abs(bestScore) > MATE_SCORE - 100) break
    }

    return {
      move: best,
      score: bestScore,
      depth: reached,
      nodes: this.nodes,
      timeMs: Date.now() - started
    }
  }

  private outOfTime(): boolean {
    // Cek jam tiap 1024 simpul; Date.now() di setiap simpul terlalu mahal.
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.aborted = true
    return this.aborted
  }

  private negamax(depth: number, alpha: number, beta: number): number {
    this.nodes++
    if (this.outOfTime()) return 0

    if (depth <= 0) return this.quiescence(alpha, beta)

    const position = this.position
    const moves = position.legalMoves()
    if (moves.length === 0) {
      // Skakmat lebih cepat bernilai lebih baik, jadi kedalaman ikut dihitung.
      return position.inCheck() ? -MATE_SCORE - depth : 0
    }
    if (position.halfmove >= 100 || (position.repetition.get(position.key) ?? 0) >= 3) return 0

    let best = -Infinity
    for (const move of orderMoves(moves)) {
      position.makeMove(move)
      const score = -this.negamax(depth - 1, -beta, -alpha)
      position.undoMove()

      if (this.aborted) return 0
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break // pemangkasan beta
    }
    return best
  }

  /** Lanjutkan hanya lewat tangkapan/promosi agar tidak berhenti di tengah baku hantam. */
  private quiescence(alpha: number, beta: number): number {
    this.nodes++
    if (this.outOfTime()) return 0

    const position = this.position
    const sign = position.turn === WHITE ? 1 : -1
    const standPat = sign * evaluate(position)
    if (standPat >= beta) return beta
    if (standPat > alpha) alpha = standPat

    for (const move of orderMoves(position.legalMoves(true))) {
      position.makeMove(move)
      const score = -this.quiescence(-beta, -alpha)
      position.undoMove()

      if (this.aborted) return 0
      if (score >= beta) return beta
      if (score > alpha) alpha = score
    }
    return alpha
  }
}

/**
 * Pilih langkah untuk pihak yang sedang jalan. Pencarian berjalan sinkron dan
 * memblokir, jadi pemanggil sebaiknya menjalankannya lewat Web Worker atau
 * setelah UI sempat menggambar indikator "berpikir".
 */
export function chooseMove(position: Position, difficulty: Difficulty = 'sedang'): SearchResult {
  const profile = DIFFICULTY_PROFILES[difficulty]
  const legal = position.legalMoves()
  if (legal.length === 0) return { move: null, score: 0, depth: 0, nodes: 0, timeMs: 0 }

  // Level rendah sesekali asal jalan supaya pemain baru punya peluang.
  if (profile.blunderChance > 0 && Math.random() < profile.blunderChance) {
    return {
      move: legal[Math.floor(Math.random() * legal.length)],
      score: 0,
      depth: 0,
      nodes: 0,
      timeMs: 0
    }
  }

  // Bekerja pada salinan agar posisi yang dipakai UI tidak tersentuh.
  const scratch = position.clone()
  const result = new Searcher(scratch).search(profile.maxDepth, profile.timeMs)
  if (!result.move) return { ...result, move: legal[0] }

  // Kembalikan objek langkah milik posisi asli, bukan milik salinan.
  const found = legal.find(
    (move) =>
      move.from === result.move!.from &&
      move.to === result.move!.to &&
      move.promotion === result.move!.promotion
  )
  return { ...result, move: found ?? legal[0] }
}

/** Skor dari sudut pandang satu warna — dipakai untuk bilah keunggulan di UI. */
export function evaluateFor(position: Position, color: Color): number {
  const score = evaluate(position)
  return color === BLACK ? -score : score
}
