/**
 * Kontrak pesan WebSocket antara fe dan be.
 *
 * Berkas ini sengaja tidak mengimpor apa pun dari sisi jaringan maupun DOM, dan
 * dipakai apa adanya oleh kedua sisi. Bila salah satu sisi mengubah bentuk
 * pesan tanpa mengubah yang lain, `npm run typecheck` yang gagal — bukan
 * pemain yang menemukannya saat pertandingan berjalan.
 */

import type { Color, Piece, PromotionType, Square } from './types.ts'

export const PROTOCOL_VERSION = 1

/** Panjang kode room yang dibagikan pemain, contoh: "K7QM". */
export const ROOM_CODE_LENGTH = 4

export type Seat = Color | 'penonton'

export interface PlayerView {
  seat: Seat
  name: string
  connected: boolean
}

/** Satu langkah seperti yang dikirim lewat jaringan — sengaja minimal. */
export interface WireMove {
  from: Square
  to: Square
  promotion: PromotionType | null
}

export interface WireHistoryEntry {
  san: string
  move: WireMove
  /** Bidak yang tertangkap pada langkah ini — server yang tahu pasti, klien tidak
      bisa menyimpulkannya dari SAN. */
  captured: Piece | null
}

/** Potret lengkap sebuah room; cukup untuk menggambar ulang papan dari nol. */
export interface RoomState {
  roomId: string
  fen: string
  history: WireHistoryEntry[]
  players: PlayerView[]
  /** Diisi bila permainan usai karena menyerah, bukan karena posisi di papan. */
  resignedBy: Color | null
  /** Room baru dibuka dan masih menunggu lawan. */
  waiting: boolean
}

// ---------------------------------------------------------------------------
// Klien -> server
// ---------------------------------------------------------------------------

export interface CreateRoomMessage {
  type: 'buat-room'
  name: string
  /** Warna yang diminta pembuat room; 'acak' membiarkan server memilih. */
  seat: Color | 'acak'
}

export interface JoinRoomMessage {
  type: 'gabung-room'
  roomId: string
  name: string
  /** Token dari sesi sebelumnya, untuk merebut kembali kursi yang sama. */
  token?: string
}

export interface MoveMessage {
  type: 'langkah'
  move: WireMove
}

export interface ResignMessage {
  type: 'menyerah'
}

export interface RematchMessage {
  type: 'main-lagi'
}

export interface LeaveMessage {
  type: 'keluar'
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | MoveMessage
  | ResignMessage
  | RematchMessage
  | LeaveMessage

// ---------------------------------------------------------------------------
// Server -> klien
// ---------------------------------------------------------------------------

export interface JoinedMessage {
  type: 'bergabung'
  /** Kursi yang benar-benar diberikan server — belum tentu yang diminta. */
  seat: Seat
  /** Disimpan klien agar bisa merebut kursi ini lagi setelah muat ulang. */
  token: string
  state: RoomState
}

export interface StateMessage {
  type: 'kondisi'
  /**
   * Kursi milik penerima pesan ini. Wajib ada karena kursi bisa berubah setelah
   * room dimulai — "main lagi" menukar putih dan hitam — dan klien tidak punya
   * cara lain mengenali dirinya di dalam daftar `players`.
   */
  yourSeat: Seat | null
  state: RoomState
}

/** Dikirim setiap kali papan berubah, termasuk untuk langkah pemain itu sendiri. */
export interface MovePlayedMessage {
  type: 'langkah-dimainkan'
  entry: WireHistoryEntry
  fen: string
  by: Color
}

export type ServerErrorCode =
  | 'room-tidak-ada'
  | 'room-penuh'
  | 'bukan-giliran'
  | 'langkah-tidak-sah'
  | 'bukan-pemain'
  | 'permainan-usai'
  | 'pesan-tidak-dikenal'
  | 'versi-protokol'

export interface ErrorMessage {
  type: 'galat'
  code: ServerErrorCode
  message: string
}

export type ServerMessage = JoinedMessage | StateMessage | MovePlayedMessage | ErrorMessage

/** Pesan mentah dari jaringan tidak pernah dipercaya — selalu lewat penjaga ini. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  const message = value as Record<string, unknown>
  switch (message.type) {
    case 'buat-room':
      return typeof message.name === 'string' &&
        (message.seat === 'w' || message.seat === 'b' || message.seat === 'acak')
        ? { type: 'buat-room', name: message.name, seat: message.seat }
        : null
    case 'gabung-room':
      return typeof message.roomId === 'string' && typeof message.name === 'string'
        ? {
            type: 'gabung-room',
            roomId: message.roomId,
            name: message.name,
            ...(typeof message.token === 'string' ? { token: message.token } : {})
          }
        : null
    case 'langkah':
      return isWireMove(message.move) ? { type: 'langkah', move: message.move } : null
    case 'menyerah':
      return { type: 'menyerah' }
    case 'main-lagi':
      return { type: 'main-lagi' }
    case 'keluar':
      return { type: 'keluar' }
    default:
      return null
  }
}

/**
 * Penjaga arah sebaliknya. Klien juga tidak boleh percaya buta: sambungan bisa
 * mengarah ke server versi lama, ke proxy yang menyisipkan sesuatu, atau ke
 * alamat yang salah ketik. Pesan yang tidak dikenali diabaikan, bukan membuat
 * papan rusak.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  const message = value as Record<string, unknown>
  switch (message.type) {
    case 'bergabung':
      return isSeat(message.seat) && typeof message.token === 'string' && isRoomState(message.state)
        ? (message as unknown as JoinedMessage)
        : null
    case 'kondisi':
      return isRoomState(message.state) &&
        (message.yourSeat === null || isSeat(message.yourSeat))
        ? (message as unknown as StateMessage)
        : null
    case 'langkah-dimainkan':
      return isHistoryEntry(message.entry) &&
        typeof message.fen === 'string' &&
        (message.by === 'w' || message.by === 'b')
        ? (message as unknown as MovePlayedMessage)
        : null
    case 'galat':
      return typeof message.code === 'string' && typeof message.message === 'string'
        ? (message as unknown as ErrorMessage)
        : null
    default:
      return null
  }
}

const isSeat = (value: unknown): value is Seat =>
  value === 'w' || value === 'b' || value === 'penonton'

function isHistoryEntry(value: unknown): value is WireHistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.san === 'string' &&
    isWireMove(entry.move) &&
    (entry.captured === null || typeof entry.captured === 'string')
  )
}

function isRoomState(value: unknown): value is RoomState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return (
    typeof state.roomId === 'string' &&
    typeof state.fen === 'string' &&
    Array.isArray(state.history) &&
    state.history.every(isHistoryEntry) &&
    Array.isArray(state.players) &&
    typeof state.waiting === 'boolean'
  )
}

function isWireMove(value: unknown): value is WireMove {
  if (typeof value !== 'object' || value === null) return false
  const move = value as Record<string, unknown>
  const isSquare = (square: unknown): boolean =>
    typeof square === 'number' && Number.isInteger(square) && square >= 0 && square < 64
  const validPromotion =
    move.promotion === null ||
    move.promotion === undefined ||
    ['q', 'r', 'b', 'n'].includes(move.promotion as string)
  return isSquare(move.from) && isSquare(move.to) && validPromotion
}
