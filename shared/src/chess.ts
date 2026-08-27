/**
 * Engine catur murni — tanpa DOM, tanpa Vue. Mendukung seluruh aturan resmi:
 * rokade, en passant, promosi, skak, skakmat, dan semua kondisi remis
 * (stalemate, materi tidak cukup, tiga kali pengulangan, aturan 50 langkah).
 *
 * Papan adalah array 64 elemen dengan indeks 0 = a8 dan 63 = h1, sehingga
 * rank = index >> 3 (0 berarti baris ke-8) dan file = index & 7 (0 = file a).
 */

import {
  CASTLING_HI,
  CASTLING_LO,
  EP_FILE_HI,
  EP_FILE_LO,
  PIECE_HI,
  PIECE_INDEX,
  PIECE_LO,
  SIDE_HI,
  SIDE_LO,
  combineKey
} from './zobrist.ts'
import type {
  CastleSide,
  CastlingRights,
  Color,
  GameStatus,
  Move,
  Piece,
  PieceType,
  PromotionType,
  Square
} from './types.ts'

export const WHITE = 'w' as const
export const BLACK = 'b' as const
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const FILES = 'abcdefgh'
export const PROMOTION_TYPES: PromotionType[] = ['q', 'r', 'b', 'n']

type Direction = readonly [number, number]

const KNIGHT_DIRS: Direction[] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]
]
const BISHOP_DIRS: Direction[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const ROOK_DIRS: Direction[] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const KING_DIRS: Direction[] = [...BISHOP_DIRS, ...ROOK_DIRS]

export const sq = (rank: number, file: number): Square => rank * 8 + file
export const rankOf = (square: Square): number => square >> 3
export const fileOf = (square: Square): number => square & 7
export const onBoard = (rank: number, file: number): boolean =>
  rank >= 0 && rank < 8 && file >= 0 && file < 8
export const algebraic = (square: Square): string => FILES[fileOf(square)] + (8 - rankOf(square))
/** Warna petak papan: a8 dan h1 terang, a1 dan h8 gelap. */
export const isLightSquare = (square: Square): boolean =>
  (rankOf(square) + fileOf(square)) % 2 === 0
export const fromAlgebraic = (text: string): Square => sq(8 - Number(text[1]), FILES.indexOf(text[0]))
export const opponent = (color: Color): Color => (color === WHITE ? BLACK : WHITE)
export const colorOf = (piece: Piece): Color => piece[0] as Color
export const typeOf = (piece: Piece): PieceType => piece[1] as PieceType

interface MoveExtras {
  promotion?: PromotionType
  castle?: CastleSide
  enPassant?: boolean
  doublePush?: boolean
}

function createMove(
  from: Square,
  to: Square,
  piece: Piece,
  captured: Piece | null | undefined,
  extra?: MoveExtras
): Move {
  return {
    from,
    to,
    piece,
    captured: captured ?? null,
    promotion: extra?.promotion ?? null,
    castle: extra?.castle ?? null,
    enPassant: extra?.enPassant ?? false,
    doublePush: extra?.doublePush ?? false
  }
}

interface UndoRecord {
  move: Move
  captured: Piece | null
  capturedSquare: Square
  castling: CastlingRights
  epSquare: Square
  halfmove: number
  fullmove: number
  hashLo: number
  hashHi: number
  key: number
  kingSquare: Square
}

export class Position {
  board!: (Piece | null)[]
  turn!: Color
  castling!: CastlingRights
  /** Petak tujuan en passant, atau -1 bila tidak ada. */
  epSquare!: Square
  halfmove!: number
  fullmove!: number
  kings!: Record<Color, Square>
  /** Dua bagian kunci Zobrist 64-bit; di-update inkremental di `makeMove`. */
  hashLo!: number
  hashHi!: number
  /** Kunci gabungan 53-bit, dipakai sebagai indeks `repetition`. */
  key!: number
  repetition!: Map<number, number>
  private undoStack!: UndoRecord[]

  constructor(fen: string = START_FEN) {
    this.load(fen)
  }

  load(fen: string): void {
    const [placement, turn, rights = '-', ep = '-', halfmove = '0', fullmove = '1'] =
      fen.trim().split(/\s+/)

    const board: (Piece | null)[] = new Array(64).fill(null)
    let index = 0
    for (const ch of placement) {
      if (ch === '/') continue
      if (ch >= '1' && ch <= '8') {
        index += Number(ch)
      } else {
        const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK
        board[index++] = (color + ch.toLowerCase()) as Piece
      }
    }

    this.board = board
    this.turn = turn === BLACK ? BLACK : WHITE
    this.castling = {
      wk: rights.includes('K'),
      wq: rights.includes('Q'),
      bk: rights.includes('k'),
      bq: rights.includes('q')
    }
    this.epSquare = ep !== '-' ? fromAlgebraic(ep) : -1
    this.halfmove = Number(halfmove)
    this.fullmove = Number(fullmove)
    this.undoStack = []
    this.kings = { w: board.indexOf('wk'), b: board.indexOf('bk') }
    this.recomputeHash()
    this.repetition = new Map([[this.key, 1]])
  }

  /** Bitmask hak rokade — bentuk yang dipakai tabel Zobrist. */
  castlingMask(): number {
    return (
      (this.castling.wk ? 1 : 0) |
      (this.castling.wq ? 2 : 0) |
      (this.castling.bk ? 4 : 0) |
      (this.castling.bq ? 8 : 0)
    )
  }

  /**
   * Menghitung ulang hash dari nol. Dipakai saat memuat posisi, dan oleh tes
   * sebagai pembanding untuk memastikan update inkremental tidak melenceng.
   */
  recomputeHash(): void {
    let lo = 0
    let hi = 0
    for (let square = 0; square < 64; square++) {
      const piece = this.board[square]
      if (!piece) continue
      const index = PIECE_INDEX[piece] * 64 + square
      lo ^= PIECE_LO[index]
      hi ^= PIECE_HI[index]
    }
    const mask = this.castlingMask()
    lo ^= CASTLING_LO[mask]
    hi ^= CASTLING_HI[mask]
    if (this.epSquare >= 0) {
      lo ^= EP_FILE_LO[fileOf(this.epSquare)]
      hi ^= EP_FILE_HI[fileOf(this.epSquare)]
    }
    if (this.turn === BLACK) {
      lo ^= SIDE_LO
      hi ^= SIDE_HI
    }
    this.hashLo = lo
    this.hashHi = hi
    this.key = combineKey(lo, hi)
  }

  /** XOR satu bidak di satu petak, masuk maupun keluar (XOR itu simetris). */
  private xorPiece(piece: Piece, square: Square): void {
    const index = PIECE_INDEX[piece] * 64 + square
    this.hashLo ^= PIECE_LO[index]
    this.hashHi ^= PIECE_HI[index]
  }

  fen(): string {
    let placement = ''
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0
      for (let file = 0; file < 8; file++) {
        const piece = this.board[sq(rank, file)]
        if (!piece) {
          empty++
          continue
        }
        if (empty) {
          placement += empty
          empty = 0
        }
        placement += colorOf(piece) === WHITE ? piece[1].toUpperCase() : piece[1]
      }
      if (empty) placement += empty
      if (rank < 7) placement += '/'
    }
    return [
      placement,
      this.turn,
      this.castlingText(),
      this.epSquare >= 0 ? algebraic(this.epSquare) : '-',
      this.halfmove,
      this.fullmove
    ].join(' ')
  }

  castlingText(): string {
    let text = ''
    if (this.castling.wk) text += 'K'
    if (this.castling.wq) text += 'Q'
    if (this.castling.bk) text += 'k'
    if (this.castling.bq) text += 'q'
    return text || '-'
  }

  pieceAt(square: Square): Piece | null {
    return this.board[square]
  }

  // ------------------------------------------------------------------
  // Pembangkitan langkah
  // ------------------------------------------------------------------

  /** Langkah pseudo-legal: belum memeriksa apakah raja sendiri tertinggal terancam. */
  pseudoMoves(color: Color, capturesOnly = false): Move[] {
    const moves: Move[] = []
    for (let square = 0; square < 64; square++) {
      const piece = this.board[square]
      if (!piece || colorOf(piece) !== color) continue
      switch (typeOf(piece)) {
        case 'p':
          this.pawnMoves(moves, square, color, capturesOnly)
          break
        case 'n':
          this.stepMoves(moves, square, piece, KNIGHT_DIRS, capturesOnly)
          break
        case 'b':
          this.slideMoves(moves, square, piece, BISHOP_DIRS, capturesOnly)
          break
        case 'r':
          this.slideMoves(moves, square, piece, ROOK_DIRS, capturesOnly)
          break
        case 'q':
          this.slideMoves(moves, square, piece, KING_DIRS, capturesOnly)
          break
        case 'k':
          this.stepMoves(moves, square, piece, KING_DIRS, capturesOnly)
          if (!capturesOnly) this.castleMoves(moves, color)
          break
      }
    }
    return moves
  }

  private pawnMoves(moves: Move[], from: Square, color: Color, capturesOnly: boolean): void {
    const piece = (color + 'p') as Piece
    const dir = color === WHITE ? -1 : 1
    const startRank = color === WHITE ? 6 : 1
    const promoRank = color === WHITE ? 0 : 7
    const rank = rankOf(from)
    const file = fileOf(from)

    const push = (to: Square, captured: Piece | null, extra?: MoveExtras) => {
      if (rankOf(to) === promoRank) {
        for (const promotion of PROMOTION_TYPES) {
          moves.push(createMove(from, to, piece, captured, { ...extra, promotion }))
        }
      } else {
        moves.push(createMove(from, to, piece, captured, extra))
      }
    }

    const ahead = rank + dir
    if (onBoard(ahead, file) && !this.board[sq(ahead, file)]) {
      // Quiescence hanya perlu langkah memaksa — promosi termasuk memaksa.
      if (!capturesOnly || ahead === promoRank) push(sq(ahead, file), null)
      if (!capturesOnly && rank === startRank && !this.board[sq(rank + dir * 2, file)]) {
        moves.push(createMove(from, sq(rank + dir * 2, file), piece, null, { doublePush: true }))
      }
    }

    for (const df of [-1, 1]) {
      if (!onBoard(ahead, file + df)) continue
      const to = sq(ahead, file + df)
      const target = this.board[to]
      if (target && colorOf(target) !== color) {
        push(to, target)
      } else if (!target && to === this.epSquare) {
        push(to, (opponent(color) + 'p') as Piece, { enPassant: true })
      }
    }
  }

  private stepMoves(
    moves: Move[],
    from: Square,
    piece: Piece,
    dirs: Direction[],
    capturesOnly: boolean
  ): void {
    const rank = rankOf(from)
    const file = fileOf(from)
    for (const [dr, df] of dirs) {
      if (!onBoard(rank + dr, file + df)) continue
      const to = sq(rank + dr, file + df)
      const target = this.board[to]
      if (target && colorOf(target) === colorOf(piece)) continue
      if (capturesOnly && !target) continue
      moves.push(createMove(from, to, piece, target))
    }
  }

  private slideMoves(
    moves: Move[],
    from: Square,
    piece: Piece,
    dirs: Direction[],
    capturesOnly: boolean
  ): void {
    const rank = rankOf(from)
    const file = fileOf(from)
    for (const [dr, df] of dirs) {
      let r = rank + dr
      let f = file + df
      while (onBoard(r, f)) {
        const to = sq(r, f)
        const target = this.board[to]
        if (target) {
          if (colorOf(target) !== colorOf(piece)) moves.push(createMove(from, to, piece, target))
          break
        }
        if (!capturesOnly) moves.push(createMove(from, to, piece, null))
        r += dr
        f += df
      }
    }
  }

  private castleMoves(moves: Move[], color: Color): void {
    const home = color === WHITE ? 7 : 0
    const kingSquare = sq(home, 4)
    const foe = opponent(color)
    if (this.board[kingSquare] !== color + 'k') return
    // Rokade dilarang saat sedang skak atau bila petak yang dilewati raja terancam.
    if (this.isSquareAttacked(kingSquare, foe)) return

    if (
      this.castling[`${color}k`] &&
      this.board[sq(home, 7)] === color + 'r' &&
      !this.board[sq(home, 5)] &&
      !this.board[sq(home, 6)] &&
      !this.isSquareAttacked(sq(home, 5), foe)
    ) {
      moves.push(createMove(kingSquare, sq(home, 6), (color + 'k') as Piece, null, { castle: 'k' }))
    }
    if (
      this.castling[`${color}q`] &&
      this.board[sq(home, 0)] === color + 'r' &&
      !this.board[sq(home, 1)] &&
      !this.board[sq(home, 2)] &&
      !this.board[sq(home, 3)] &&
      !this.isSquareAttacked(sq(home, 3), foe)
    ) {
      moves.push(createMove(kingSquare, sq(home, 2), (color + 'k') as Piece, null, { castle: 'q' }))
    }
  }

  /**
   * Langkah yang boleh DIPRE-MOVE (diantre saat giliran lawan) — lebih longgar
   * dari `pseudoMoves`, karena langkah lawan di antaranya bisa menaruh atau
   * menyingkirkan bidak di petak tujuan. Legalitas sungguhannya diperiksa ulang
   * lewat `legalMoves` saat premove benar-benar dijalankan.
   *
   * Yang dilonggarkan dibanding pseudo-legal:
   * - pion boleh melangkah diagonal ke petak MANA PUN di depannya (bakal jadi
   *   tangkapan / en passant), termasuk yang sekarang berisi bidak sendiri —
   *   kasus "lawan menangkap, aku balas menangkap";
   * - bidak apa pun boleh menuju petak berisi bidak SENDIRI (langkah balas);
   * - rokade cukup rajanya di petak asal + hak rokade + benteng di tempat;
   *   halangan dan skak dibiarkan untuk pengecekan saat dijalankan.
   *
   * Yang TIDAK dilonggarkan: peluncur tetap berhenti di bidak pertama yang
   * dijumpai — tidak bisa menembus barisan bidak.
   *
   * Raja lawan tidak pernah jadi petak tujuan (tidak ada langkah yang menangkap raja).
   */
  premoveMoves(color: Color): Move[] {
    const moves: Move[] = []
    for (let square = 0; square < 64; square++) {
      const piece = this.board[square]
      if (!piece || colorOf(piece) !== color) continue
      switch (typeOf(piece)) {
        case 'p':
          this.premovePawn(moves, square, color)
          break
        case 'n':
          this.premoveStep(moves, square, piece, KNIGHT_DIRS)
          break
        case 'b':
          this.premoveSlide(moves, square, piece, BISHOP_DIRS)
          break
        case 'r':
          this.premoveSlide(moves, square, piece, ROOK_DIRS)
          break
        case 'q':
          this.premoveSlide(moves, square, piece, KING_DIRS)
          break
        case 'k':
          this.premoveStep(moves, square, piece, KING_DIRS)
          this.premoveCastle(moves, color)
          break
      }
    }
    return moves
  }

  private premovePawn(moves: Move[], from: Square, color: Color): void {
    const piece = (color + 'p') as Piece
    const dir = color === WHITE ? -1 : 1
    const startRank = color === WHITE ? 6 : 1
    const promoRank = color === WHITE ? 0 : 7
    const rank = rankOf(from)
    const file = fileOf(from)
    const ahead = rank + dir

    const add = (to: Square): void => {
      const target = this.board[to]
      const captured = target && colorOf(target) !== color ? target : null
      moves.push(
        createMove(from, to, piece, captured, rankOf(to) === promoRank ? { promotion: 'q' } : undefined)
      )
    }

    if (onBoard(ahead, file) && !this.board[sq(ahead, file)]) {
      add(sq(ahead, file))
      if (rank === startRank && !this.board[sq(rank + dir * 2, file)]) {
        moves.push(createMove(from, sq(rank + dir * 2, file), piece, null, { doublePush: true }))
      }
    }
    // Diagonal: selalu bisa dipre-move, terlepas dari isi petaknya sekarang.
    for (const df of [-1, 1]) {
      if (!onBoard(ahead, file + df)) continue
      const to = sq(ahead, file + df)
      const target = this.board[to]
      if (target && typeOf(target) === 'k') continue
      add(to)
    }
  }

  private premoveStep(moves: Move[], from: Square, piece: Piece, dirs: Direction[]): void {
    const rank = rankOf(from)
    const file = fileOf(from)
    for (const [dr, df] of dirs) {
      if (!onBoard(rank + dr, file + df)) continue
      const to = sq(rank + dr, file + df)
      const target = this.board[to]
      if (target && typeOf(target) === 'k') continue
      moves.push(createMove(from, to, piece, target && colorOf(target) !== colorOf(piece) ? target : null))
    }
  }

  private premoveSlide(moves: Move[], from: Square, piece: Piece, dirs: Direction[]): void {
    const rank = rankOf(from)
    const file = fileOf(from)
    for (const [dr, df] of dirs) {
      let r = rank + dr
      let f = file + df
      while (onBoard(r, f)) {
        const to = sq(r, f)
        const target = this.board[to]
        if (target) {
          // Petak berisi bidak pertama tetap boleh jadi tujuan (langkah balas /
          // tangkapan), tapi peluncur berhenti di situ — tak menembus.
          if (typeOf(target) !== 'k') {
            moves.push(createMove(from, to, piece, colorOf(target) !== colorOf(piece) ? target : null))
          }
          break
        }
        moves.push(createMove(from, to, piece, null))
        r += dr
        f += df
      }
    }
  }

  private premoveCastle(moves: Move[], color: Color): void {
    const home = color === WHITE ? 7 : 0
    const kingSquare = sq(home, 4)
    if (this.board[kingSquare] !== color + 'k') return
    const king = (color + 'k') as Piece
    if (this.castling[`${color}k`] && this.board[sq(home, 7)] === color + 'r') {
      moves.push(createMove(kingSquare, sq(home, 6), king, null, { castle: 'k' }))
    }
    if (this.castling[`${color}q`] && this.board[sq(home, 0)] === color + 'r') {
      moves.push(createMove(kingSquare, sq(home, 2), king, null, { castle: 'q' }))
    }
  }

  /** Langkah legal untuk pihak yang sedang jalan. */
  legalMoves(capturesOnly = false): Move[] {
    const color = this.turn
    const foe = opponent(color)
    const legal: Move[] = []
    for (const move of this.pseudoMoves(color, capturesOnly)) {
      this.makeMove(move)
      const safe = !this.isSquareAttacked(this.kings[color], foe)
      this.undoMove()
      if (safe) legal.push(move)
    }
    return legal
  }

  movesFrom(square: Square): Move[] {
    return this.legalMoves().filter((move) => move.from === square)
  }

  // ------------------------------------------------------------------
  // Deteksi ancaman
  // ------------------------------------------------------------------

  isSquareAttacked(square: Square, byColor: Color): boolean {
    const rank = rankOf(square)
    const file = fileOf(square)
    const board = this.board

    // Pion putih berdiri satu baris di bawah petak yang diserangnya.
    const pawnRank = rank + (byColor === WHITE ? 1 : -1)
    for (const df of [-1, 1]) {
      if (onBoard(pawnRank, file + df) && board[sq(pawnRank, file + df)] === byColor + 'p') return true
    }
    for (const [dr, df] of KNIGHT_DIRS) {
      if (onBoard(rank + dr, file + df) && board[sq(rank + dr, file + df)] === byColor + 'n') return true
    }
    for (const [dr, df] of KING_DIRS) {
      if (onBoard(rank + dr, file + df) && board[sq(rank + dr, file + df)] === byColor + 'k') return true
    }
    const rays: [Direction[], PieceType][] = [
      [ROOK_DIRS, 'r'],
      [BISHOP_DIRS, 'b']
    ]
    for (const [dirs, slider] of rays) {
      for (const [dr, df] of dirs) {
        let r = rank + dr
        let f = file + df
        while (onBoard(r, f)) {
          const piece = board[sq(r, f)]
          if (piece) {
            const type = typeOf(piece)
            if (colorOf(piece) === byColor && (type === slider || type === 'q')) return true
            break
          }
          r += dr
          f += df
        }
      }
    }
    return false
  }

  inCheck(color: Color = this.turn): boolean {
    return this.isSquareAttacked(this.kings[color], opponent(color))
  }

  // ------------------------------------------------------------------
  // Jalankan / batalkan langkah
  // ------------------------------------------------------------------

  makeMove(move: Move): Move {
    const board = this.board
    const color = colorOf(move.piece)
    const undo: UndoRecord = {
      move,
      captured: null,
      capturedSquare: -1,
      castling: { ...this.castling },
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      hashLo: this.hashLo,
      hashHi: this.hashHi,
      key: this.key,
      kingSquare: this.kings[color]
    }

    // Hak rokade dan petak en passant di-XOR keluar sekarang, lalu yang baru
    // di-XOR masuk di akhir — lebih mudah dibaca daripada melacak tiap
    // perubahannya satu per satu.
    const oldMask = this.castlingMask()
    this.hashLo ^= CASTLING_LO[oldMask]
    this.hashHi ^= CASTLING_HI[oldMask]
    if (this.epSquare >= 0) {
      this.hashLo ^= EP_FILE_LO[fileOf(this.epSquare)]
      this.hashHi ^= EP_FILE_HI[fileOf(this.epSquare)]
    }

    if (move.enPassant) {
      // Pion yang tertangkap berada di baris asal penyerang, bukan di petak tujuan.
      const capturedSquare = sq(rankOf(move.from), fileOf(move.to))
      undo.captured = board[capturedSquare]
      undo.capturedSquare = capturedSquare
      board[capturedSquare] = null
    } else if (board[move.to]) {
      undo.captured = board[move.to]
      undo.capturedSquare = move.to
    }

    if (undo.captured) this.xorPiece(undo.captured, undo.capturedSquare)

    const landing: Piece = move.promotion ? ((color + move.promotion) as Piece) : move.piece
    board[move.to] = landing
    board[move.from] = null
    this.xorPiece(move.piece, move.from)
    this.xorPiece(landing, move.to)

    if (typeOf(move.piece) === 'k') {
      this.kings[color] = move.to
      if (move.castle) {
        const home = rankOf(move.from)
        const [rookFrom, rookTo] =
          move.castle === 'k' ? [sq(home, 7), sq(home, 5)] : [sq(home, 0), sq(home, 3)]
        const rook = board[rookFrom]!
        board[rookTo] = rook
        board[rookFrom] = null
        this.xorPiece(rook, rookFrom)
        this.xorPiece(rook, rookTo)
      }
      this.castling[`${color}k`] = false
      this.castling[`${color}q`] = false
    }

    this.revokeRookRights(move.from)
    this.revokeRookRights(move.to)

    this.epSquare = move.doublePush
      ? sq((rankOf(move.from) + rankOf(move.to)) / 2, fileOf(move.from))
      : -1
    this.halfmove = typeOf(move.piece) === 'p' || undo.captured ? 0 : this.halfmove + 1
    if (color === BLACK) this.fullmove++
    this.turn = opponent(color)

    // Pasangan dari XOR-keluar di awal: masukkan hak rokade dan en passant yang baru.
    const newMask = this.castlingMask()
    this.hashLo ^= CASTLING_LO[newMask]
    this.hashHi ^= CASTLING_HI[newMask]
    if (this.epSquare >= 0) {
      this.hashLo ^= EP_FILE_LO[fileOf(this.epSquare)]
      this.hashHi ^= EP_FILE_HI[fileOf(this.epSquare)]
    }
    this.hashLo ^= SIDE_LO
    this.hashHi ^= SIDE_HI
    this.key = combineKey(this.hashLo, this.hashHi)

    this.undoStack.push(undo)
    this.repetition.set(this.key, (this.repetition.get(this.key) ?? 0) + 1)
    return move
  }

  /** Benteng yang bergerak dari — atau tertangkap di — petak asalnya mencabut hak rokade. */
  private revokeRookRights(square: Square): void {
    if (square === 56) this.castling.wq = false
    else if (square === 63) this.castling.wk = false
    else if (square === 0) this.castling.bq = false
    else if (square === 7) this.castling.bk = false
  }

  undoMove(): Move | null {
    const undo = this.undoStack.pop()
    if (!undo) return null

    const count = (this.repetition.get(this.key) ?? 1) - 1
    if (count > 0) this.repetition.set(this.key, count)
    else this.repetition.delete(this.key)

    const { move } = undo
    const board = this.board
    const color = colorOf(move.piece)

    board[move.from] = move.piece
    board[move.to] = null
    if (undo.captured) board[undo.capturedSquare] = undo.captured

    if (move.castle) {
      const home = rankOf(move.from)
      if (move.castle === 'k') {
        board[sq(home, 7)] = board[sq(home, 5)]
        board[sq(home, 5)] = null
      } else {
        board[sq(home, 0)] = board[sq(home, 3)]
        board[sq(home, 3)] = null
      }
    }
    if (typeOf(move.piece) === 'k') this.kings[color] = undo.kingSquare

    this.castling = undo.castling
    this.epSquare = undo.epSquare
    this.halfmove = undo.halfmove
    this.fullmove = undo.fullmove
    this.turn = color
    // Hash dipulihkan dari rekaman, bukan di-XOR balik. Hasilnya sama karena
    // XOR simetris, tapi cara ini tidak bisa melenceng dari makeMove.
    this.hashLo = undo.hashLo
    this.hashHi = undo.hashHi
    this.key = undo.key
    return move
  }

  // ------------------------------------------------------------------
  // Notasi & status permainan
  // ------------------------------------------------------------------

  /**
   * Notasi aljabar standar (SAN), lengkap dengan disambiguasi dan tanda +/#.
   * `legal` adalah daftar langkah legal pada posisi ini sebelum `move` dijalankan;
   * berikan bila sudah tersedia agar tidak dihitung ulang.
   */
  toSAN(move: Move, legal: Move[] | null = null): string {
    let text: string
    if (move.castle) {
      text = move.castle === 'k' ? 'O-O' : 'O-O-O'
    } else if (typeOf(move.piece) === 'p') {
      text = move.captured ? FILES[fileOf(move.from)] + 'x' : ''
      text += algebraic(move.to)
      if (move.promotion) text += '=' + move.promotion.toUpperCase()
    } else {
      text = move.piece[1].toUpperCase()
      const rivals = (legal ?? this.legalMoves()).filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from
      )
      if (rivals.length) {
        const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from))
        const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from))
        if (!sameFile) text += FILES[fileOf(move.from)]
        else if (!sameRank) text += String(8 - rankOf(move.from))
        else text += algebraic(move.from)
      }
      if (move.captured) text += 'x'
      text += algebraic(move.to)
    }

    this.makeMove(move)
    const foeInCheck = this.inCheck(this.turn)
    const foeStuck = this.legalMoves().length === 0
    this.undoMove()

    if (foeInCheck) text += foeStuck ? '#' : '+'
    return text
  }

  hasInsufficientMaterial(): boolean {
    const minors: { piece: Piece; light: boolean }[] = []
    for (let square = 0; square < 64; square++) {
      const piece = this.board[square]
      if (!piece) continue
      const type = typeOf(piece)
      if (type === 'k') continue
      if (type === 'p' || type === 'r' || type === 'q') return false
      minors.push({ piece, light: (rankOf(square) + fileOf(square)) % 2 === 0 })
    }
    // Raja lawan raja, atau raja + satu perwira ringan.
    if (minors.length <= 1) return true
    // Gajah lawan gajah yang berdiri di warna petak yang sama.
    return (
      minors.length === 2 &&
      typeOf(minors[0].piece) === 'b' &&
      typeOf(minors[1].piece) === 'b' &&
      colorOf(minors[0].piece) !== colorOf(minors[1].piece) &&
      minors[0].light === minors[1].light
    )
  }

  status(): GameStatus {
    if (this.legalMoves().length === 0) {
      return this.inCheck()
        ? {
            over: true,
            reason: 'checkmate',
            winner: opponent(this.turn),
            result: this.turn === WHITE ? '0-1' : '1-0',
            check: true
          }
        : { over: true, reason: 'stalemate', winner: null, result: '1/2-1/2', check: false }
    }
    const draw = (reason: GameStatus['reason']): GameStatus => ({
      over: true,
      reason,
      winner: null,
      result: '1/2-1/2',
      check: this.inCheck()
    })
    if (this.hasInsufficientMaterial()) return draw('insufficient-material')
    if ((this.repetition.get(this.key) ?? 0) >= 3) return draw('threefold')
    if (this.halfmove >= 100) return draw('fifty-move')

    return { over: false, reason: null, winner: null, result: '*', check: this.inCheck() }
  }

  clone(): Position {
    const copy = new Position(this.fen())
    copy.repetition = new Map(this.repetition)
    return copy
  }
}
