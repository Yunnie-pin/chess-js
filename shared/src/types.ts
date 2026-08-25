/** Tipe dasar yang dipakai bersama oleh engine, AI, dan komponen Vue. */

export type Color = 'w' | 'b'
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type PromotionType = 'q' | 'r' | 'b' | 'n'

/** Bidak sebagai string dua karakter, contoh: 'wq' (menteri putih), 'bp' (pion hitam). */
export type Piece = `${Color}${PieceType}`

/** Indeks petak 0..63, dengan 0 = a8 dan 63 = h1. */
export type Square = number

export type CastleSide = 'k' | 'q'

export interface Move {
  from: Square
  to: Square
  piece: Piece
  /** Bidak yang tertangkap, termasuk pada en passant. */
  captured: Piece | null
  promotion: PromotionType | null
  castle: CastleSide | null
  enPassant: boolean
  doublePush: boolean
}

export interface CastlingRights {
  wk: boolean
  wq: boolean
  bk: boolean
  bq: boolean
}

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold'
  | 'fifty-move'

export interface GameStatus {
  over: boolean
  reason: GameEndReason | null
  winner: Color | null
  /** Hasil dalam notasi PGN: '1-0', '0-1', '1/2-1/2', atau '*' bila belum selesai. */
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  check: boolean
}

/** Satu langkah yang sudah dimainkan, disimpan untuk daftar langkah dan undo. */
export interface HistoryEntry {
  move: Move
  san: string
  fen: string
  moveNumber: number
  color: Color
}
