/**
 * Lawan komputer: negamax dengan pemangkasan alpha-beta, pencarian quiescence,
 * pengurutan langkah MVV-LVA, dan iterative deepening yang dibatasi waktu.
 *
 * Evaluasi memakai nilai materi + piece-square table gaya "Simplified Evaluation
 * Function" (chessprogramming.org), selalu dari sudut pandang Putih.
 */

import { BLACK, Position, WHITE, colorOf, rankOf, typeOf } from './chess.ts'
import type { Color, Move, PieceType } from './types.ts'
import { TT_EXACT, TT_LOWER, TT_UPPER, ttProbe, ttStore } from './tt.ts'
import type { TTHit } from './tt.ts'

/**
 * Level kekuatan yang bisa dipilih pemain, dinyatakan sebagai Elo.
 *
 * Rentang ini SENGAJA dipatok persis ke jangkauan `UCI_Elo` milik Stockfish
 * sendiri (1320-3190) — bukan skala Elo bebas seperti dulu. Alasannya: lawan
 * sungguhannya sekarang Stockfish (lihat `client/src/engine/stockfishEngine.ts`),
 * dan lantai kekuatannya sendiri adalah 1320 — level di bawah itu mustahil
 * dibuat, jadi tidak ada gunanya menjanjikan angka yang tidak bisa ditepati.
 */
export const ELO_LEVELS = [1320, 1800, 2200, 2600, 3190] as const
export type EloRating = (typeof ELO_LEVELS)[number]

export const DEFAULT_ELO: EloRating = 1320

/** Satu langkah di akar beserta skornya — dasar pemilihan langkah per level. */
export interface RootMove {
  move: Move
  score: number
}

export interface SearchResult {
  move: Move | null
  score: number
  depth: number
  nodes: number
  timeMs: number
  /** Seluruh langkah akar, terurut dari terbaik. Kosong bila tidak ada langkah legal. */
  rootMoves: RootMove[]
}

interface StrengthProfile {
  label: string
  maxDepth: number
  timeMs: number
  /**
   * Seberapa buruk langkah yang masih boleh dipilih, dalam centipawn di bawah
   * langkah terbaik. Inilah yang membedakan level, bukan kedalaman semata:
   * mesin yang mencari dalam tapi kadang memilih langkah kedua terbaik terasa
   * jauh lebih manusiawi daripada mesin yang mencarinya dangkal.
   */
  errorMargin: number
  /** Peluang mengabaikan hasil pencarian sepenuhnya dan asal pilih. */
  blunderChance: number
}

/**
 * Tabel ini menyetel dua hal berbeda sekarang:
 *
 * - `timeMs` masih hidup — itu yang dikirim ke Stockfish sebagai anggaran
 *   `go movetime` di `scheduleAi`, jadi level yang lebih tinggi memang benar
 *   diberi waktu berpikir lebih lama, bukan cuma dilabeli begitu.
 * - `maxDepth`/`errorMargin`/`blunderChance` sudah tidak dipakai jalur
 *   permainan sama sekali — itu milik mesin buatan sendiri di bawah, yang
 *   masih diuji tapi tidak lagi jalan. PERINGATAN SOAL ANGKANYA (untuk mesin
 *   itu): perkiraan kasar, belum dikalibrasi lewat pertandingan melawan mesin
 *   ber-rating.
 */
export const STRENGTH_PROFILES: Record<EloRating, StrengthProfile> = {
  1320: { label: 'Pemula', maxDepth: 1, timeMs: 120, errorMargin: 500, blunderChance: 0.25 },
  1800: { label: 'Kasual', maxDepth: 2, timeMs: 300, errorMargin: 250, blunderChance: 0.1 },
  2200: { label: 'Menengah', maxDepth: 3, timeMs: 700, errorMargin: 110, blunderChance: 0.03 },
  2600: { label: 'Kuat', maxDepth: 4, timeMs: 1500, errorMargin: 40, blunderChance: 0 },
  3190: { label: 'Maksimal', maxDepth: 7, timeMs: 4000, errorMargin: 0, blunderChance: 0 }
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

/** Nilai jauh di atas skor evaluasi apa pun, dipakai sebagai batas alpha-beta awal. */
const INF = 1_000_000

/** Di atas ambang ini sebuah skor pasti berarti mat, bukan keunggulan materi. */
const MATE_THRESHOLD = MATE_SCORE - 1000

/**
 * Skor mat disimpan relatif terhadap posisi itu sendiri, bukan terhadap akar
 * pencarian. Tanpa ini, "mat dalam 3" yang ditemukan di kedalaman 5 akan dibaca
 * sebagai "mat dalam 3" juga ketika posisi yang sama muncul di kedalaman 2.
 */
const scoreToTT = (score: number, ply: number): number =>
  score >= MATE_THRESHOLD ? score + ply : score <= -MATE_THRESHOLD ? score - ply : score

const scoreFromTT = (score: number, ply: number): number =>
  score >= MATE_THRESHOLD ? score - ply : score <= -MATE_THRESHOLD ? score + ply : score

/**
 * Mengurutkan langkah. `hit` adalah entri tabel untuk posisi ini bila ada —
 * langkah terbaiknya ditaruh paling depan karena kemungkinan besar masih yang
 * terbaik, dan itu membuat pemangkasan terjadi jauh lebih awal.
 */
function orderMoves(moves: Move[], hit?: TTHit | null): Move[] {
  const scored = moves.map((move) => {
    let score = moveScore(move)
    if (
      hit &&
      hit.from === move.from &&
      hit.to === move.to &&
      hit.promotion === move.promotion
    ) {
      score += 1_000_000
    }
    return { move, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((entry) => entry.move)
}

class Searcher {
  nodes = 0
  private position: Position
  private deadline = Infinity
  private aborted = false

  constructor(position: Position) {
    this.position = position
  }

  /**
   * Cari langkah terbaik dengan memperdalam bertahap sampai batas waktu habis.
   *
   * `exactRootScores` mematikan penyempitan alpha di akar. Dengan penyempitan,
   * langkah selain yang terbaik cuma dapat batas atas — cukup untuk memilih
   * yang terbaik, tapi tidak cukup untuk level Elo rendah yang justru perlu
   * tahu seberapa buruk sebuah langkah supaya bisa memilih yang agak jelek
   * secara terukur.
   */
  search(maxDepth: number, timeMs: number, exactRootScores = false): SearchResult {
    const started = Date.now()
    this.deadline = started + timeMs
    this.nodes = 0
    this.aborted = false

    const root = orderMoves(this.position.legalMoves())
    let best: Move | null = root[0] ?? null
    let bestScore = 0
    let reached = 0
    let rootMoves: RootMove[] = root.map((move) => ({ move, score: 0 }))

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF
      let iterationBest: Move | null = null
      let iterationScore = -INF
      const scored: RootMove[] = []

      for (const move of root) {
        this.position.makeMove(move)
        const score = exactRootScores
          ? -this.negamax(depth - 1, -INF, INF, 1)
          : -this.negamax(depth - 1, -INF, -alpha, 1)
        this.position.undoMove()

        if (this.aborted) break
        scored.push({ move, score })
        if (score > iterationScore) {
          iterationScore = score
          iterationBest = move
        }
        if (score > alpha) alpha = score
      }

      // Kedalaman yang tidak selesai dibuang seluruhnya — separuh hasil lebih
      // menyesatkan daripada hasil kedalaman sebelumnya yang utuh.
      if (this.aborted) break

      scored.sort((a, b) => b.score - a.score)

      // Dengan penyempitan alpha, setiap langkah yang gagal-rendah melaporkan
      // skor yang sama dengan alpha, jadi hasil sort penuh seri dan urutannya
      // tidak bermakna. Yang benar-benar menaikkan alpha dipastikan di depan.
      if (!exactRootScores && iterationBest) {
        const index = scored.findIndex((entry) => entry.move === iterationBest)
        if (index > 0) scored.unshift(...scored.splice(index, 1))
      }

      rootMoves = scored
      best = scored[0]?.move ?? best
      bestScore = scored[0]?.score ?? bestScore
      reached = depth

      // Urutkan ulang agar langkah terbaik dicoba lebih dulu di kedalaman berikutnya.
      root.length = 0
      for (const entry of scored) root.push(entry.move)

      // Skakmat sudah ditemukan — memperdalam tidak menghasilkan apa-apa lagi.
      if (Math.abs(bestScore) >= MATE_THRESHOLD) break
    }

    return {
      move: best,
      score: bestScore,
      depth: reached,
      nodes: this.nodes,
      timeMs: Date.now() - started,
      rootMoves
    }
  }

  private outOfTime(): boolean {
    // Cek jam tiap 1024 simpul; Date.now() di setiap simpul terlalu mahal.
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.aborted = true
    return this.aborted
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.nodes++
    if (this.outOfTime()) return 0

    if (depth <= 0) return this.quiescence(alpha, beta)

    const position = this.position

    // Remis dicek sebelum tabel: skor remis bergantung pada riwayat langkah,
    // bukan cuma pada posisi, jadi tidak boleh diambil dari cache.
    if (position.halfmove >= 100 || (position.repetition.get(position.key) ?? 0) >= 3) return 0

    const lo = position.hashLo
    const hi = position.hashHi
    const alphaBefore = alpha

    const hit = ttProbe(lo, hi)
    if (hit && hit.depth >= depth) {
      const score = scoreFromTT(hit.score, ply)
      if (hit.flag === TT_EXACT) return score
      if (hit.flag === TT_LOWER && score > alpha) alpha = score
      else if (hit.flag === TT_UPPER && score < beta) beta = score
      if (alpha >= beta) return score
    }

    const moves = position.legalMoves()
    if (moves.length === 0) {
      // Mat yang lebih cepat bernilai lebih baik bagi pihak yang mengeksekusi.
      return position.inCheck() ? -MATE_SCORE + ply : 0
    }

    // Langkah terbaik dari pencarian sebelumnya dicoba duluan. Ini sumber
    // percepatan terbesar dari tabel — bukan cache hit-nya, tapi urutan yang
    // jauh lebih baik sehingga alpha-beta memangkas lebih awal.
    const ordered = orderMoves(moves, hit)

    let best = -INF
    let bestMove: Move | null = null

    for (const move of ordered) {
      position.makeMove(move)
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1)
      position.undoMove()

      if (this.aborted) return 0
      if (score > best) {
        best = score
        bestMove = move
      }
      if (best > alpha) alpha = best
      if (alpha >= beta) break // pemangkasan beta
    }

    const flag = best <= alphaBefore ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
    ttStore(
      lo,
      hi,
      depth,
      flag,
      scoreToTT(best, ply),
      bestMove ? bestMove.from : -1,
      bestMove ? bestMove.to : -1,
      bestMove ? bestMove.promotion : null
    )
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
 * Sumber angka acak untuk pemilihan langkah per level.
 *
 * Bisa diganti supaya perilaku AI dapat diulang persis. Tes memakainya agar
 * pengukuran kekuatan tidak bergantung pada keberuntungan — pengukuran statistik
 * dengan sampel kecil pernah membuat CI gagal secara acak. Berguna juga saat
 * menelusuri partai yang hasilnya aneh.
 */
let randomSource: () => number = Math.random

export function setRandomSource(source: () => number): void {
  randomSource = source
}

export function resetRandomSource(): void {
  randomSource = Math.random
}

/**
 * Memilih langkah dari daftar akar sesuai kekuatan yang diminta.
 *
 * Level rendah TIDAK dibuat lemah dengan mencari lebih dangkal saja. Mesin
 * dangkal salahnya seragam dan aneh; mesin yang mencari cukup dalam lalu
 * sesekali memilih langkah kedua atau ketiga terbaik salahnya mirip manusia —
 * kadang melewatkan taktik, bukan tiba-tiba menggantung menteri.
 */
function pickByStrength(rootMoves: RootMove[], profile: StrengthProfile): Move | null {
  if (rootMoves.length === 0) return null

  // Sesekali benar-benar meleset, tanpa memandang skor. Ini yang membuat level
  // pemula bisa dikalahkan pemain baru.
  if (profile.blunderChance > 0 && randomSource() < profile.blunderChance) {
    return rootMoves[Math.floor(randomSource() * rootMoves.length)].move
  }
  if (profile.errorMargin <= 0) return rootMoves[0].move

  const best = rootMoves[0].score
  const candidates = rootMoves.filter((entry) => best - entry.score <= profile.errorMargin)

  // Bobot linear: makin dekat ke langkah terbaik, makin besar peluang terpilih.
  // Jadi langkah bagus tetap lebih sering keluar, tapi bukan selalu.
  const weights = candidates.map((entry) => profile.errorMargin - (best - entry.score) + 1)
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  let roll = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return candidates[i].move
  }
  return candidates[candidates.length - 1].move
}

/**
 * Pilih langkah untuk pihak yang sedang jalan pada kekuatan `elo`. Pencarian
 * berjalan sinkron dan memblokir, jadi pemanggil sebaiknya menjalankannya lewat
 * Web Worker atau setelah UI sempat menggambar indikator "berpikir".
 */
export function chooseMove(position: Position, elo: EloRating = DEFAULT_ELO): SearchResult {
  const profile = STRENGTH_PROFILES[elo] ?? STRENGTH_PROFILES[DEFAULT_ELO]
  const legal = position.legalMoves()
  const empty: SearchResult = { move: null, score: 0, depth: 0, nodes: 0, timeMs: 0, rootMoves: [] }
  if (legal.length === 0) return empty

  // Bekerja pada salinan agar posisi yang dipakai UI tidak tersentuh.
  const scratch = position.clone()
  // Skor akar yang tepat hanya dibutuhkan level yang memang memilih langkah
  // tidak-terbaik; level maksimal tetap memakai penyempitan alpha yang cepat.
  const result = new Searcher(scratch).search(
    profile.maxDepth,
    profile.timeMs,
    profile.errorMargin > 0
  )

  const chosen = pickByStrength(result.rootMoves, profile) ?? result.move
  if (!chosen) return { ...result, move: legal[0] }

  // Kembalikan objek langkah milik posisi asli, bukan milik salinan.
  const found = legal.find(
    (move) =>
      move.from === chosen.from && move.to === chosen.to && move.promotion === chosen.promotion
  )
  return { ...result, move: found ?? legal[0] }
}

/**
 * Skor eksak untuk SETIAP langkah akar pada kedalaman tertentu, terurut dari
 * terbaik. Berbeda dengan `chooseMove` yang cuma perlu tahu mana yang terbaik,
 * fungsi ini mematikan penyempitan alpha sehingga skor langkah-langkah lain
 * juga bisa dipercaya.
 *
 * Dipakai sebagai pembanding tetap saat mengukur kekuatan tiap level: mengukur
 * sebuah langkah dengan pencarian level itu sendiri tidak bisa dibandingkan
 * antar level, karena kedalamannya berbeda-beda.
 */
export function analyseRootMoves(position: Position, depth: number, timeMs = 10_000): RootMove[] {
  return new Searcher(position.clone()).search(depth, timeMs, true).rootMoves
}

/** Skor dari sudut pandang satu warna — dipakai untuk bilah keunggulan di UI. */
export function evaluateFor(position: Position, color: Color): number {
  const score = evaluate(position)
  return color === BLACK ? -score : score
}
