/**
 * Satu room pertandingan.
 *
 * Kelas ini otoritatif: ia menyimpan posisi sesungguhnya dan memvalidasi setiap
 * langkah dengan engine yang sama persis dengan yang dipakai klien. Klien boleh
 * berbohong, salah versi, atau sudah dimodifikasi — yang diterima papan hanya
 * langkah yang lolos `legalMoves()` di sini.
 *
 * Sengaja tidak tahu apa-apa soal WebSocket supaya bisa diuji tanpa jaringan.
 */

import { Position, WHITE, opponent } from '@chess/shared/chess'
import type { Color, Move, PromotionType } from '@chess/shared/types'
import type { PlayerView, RoomState, Seat, WireHistoryEntry, WireMove } from '@chess/shared/protocol'

export interface Player {
  token: string
  name: string
  seat: Seat
  connected: boolean
}

export type JoinResult =
  | { ok: true; player: Player }
  | { ok: false; code: 'room-penuh' }

export type MoveResult =
  | { ok: true; entry: WireHistoryEntry; fen: string; by: Color }
  | { ok: false; code: 'bukan-pemain' | 'bukan-giliran' | 'langkah-tidak-sah' | 'permainan-usai' }

const MAX_NAME_LENGTH = 24

/** Nama dari jaringan dipangkas dan dibersihkan sebelum disiarkan ke pemain lain. */
export function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '') // buang karakter kendali dan penanda arah teks
    .trim()
    .slice(0, MAX_NAME_LENGTH)
  return cleaned || fallback
}

export class Room {
  readonly id: string
  readonly createdAt = Date.now()
  lastActivityAt = Date.now()

  private position: Position
  private history: WireHistoryEntry[] = []
  private players = new Map<string, Player>()
  private resignedBy: Color | null = null
  /** Posisi awal room; dipakai lagi saat main ulang. */
  private readonly startFen: string | undefined

  constructor(id: string, startFen?: string) {
    this.id = id
    this.startFen = startFen
    this.position = new Position(startFen)
  }

  /** Kursi yang masih kosong; penonton tidak pernah dianggap penuh. */
  private seatTaken(seat: Color): boolean {
    for (const player of this.players.values()) {
      if (player.seat === seat) return true
    }
    return false
  }

  get playerCount(): number {
    return this.players.size
  }

  get isEmpty(): boolean {
    for (const player of this.players.values()) {
      if (player.connected) return false
    }
    return true
  }

  getPlayer(token: string): Player | undefined {
    return this.players.get(token)
  }

  /**
   * Menempatkan pemain. Bila `token` cocok dengan pemain yang pernah di sini,
   * kursinya direbut kembali — ini yang membuat muat ulang halaman tidak
   * membuang seseorang dari pertandingan yang sedang berjalan.
   */
  join(token: string, name: string, requested: Color | 'acak'): JoinResult {
    this.lastActivityAt = Date.now()

    const existing = this.players.get(token)
    if (existing) {
      existing.connected = true
      existing.name = name
      return { ok: true, player: existing }
    }

    const seat = this.pickSeat(requested)
    if (seat === null) return { ok: false, code: 'room-penuh' }

    const player: Player = { token, name, seat, connected: true }
    this.players.set(token, player)
    return { ok: true, player }
  }

  private pickSeat(requested: Color | 'acak'): Seat | null {
    const whiteFree = !this.seatTaken('w')
    const blackFree = !this.seatTaken('b')

    if (requested !== 'acak' && !this.seatTaken(requested)) return requested
    if (requested === 'acak') {
      if (whiteFree && blackFree) return Math.random() < 0.5 ? 'w' : 'b'
      if (whiteFree) return 'w'
      if (blackFree) return 'b'
    } else {
      // Kursi yang diminta sudah terisi — tawarkan yang tersisa.
      if (whiteFree) return 'w'
      if (blackFree) return 'b'
    }
    // Kedua kursi terisi: masuk sebagai penonton, bukan ditolak.
    return 'penonton'
  }

  disconnect(token: string): void {
    const player = this.players.get(token)
    if (!player) return
    player.connected = false
    this.lastActivityAt = Date.now()
    // Penonton yang pergi tidak perlu diingat; pemain tetap disimpan agar
    // kursinya menunggu kalau ia menyambung lagi.
    if (player.seat === 'penonton') this.players.delete(token)
  }

  leave(token: string): void {
    this.players.delete(token)
    this.lastActivityAt = Date.now()
  }

  get isOver(): boolean {
    return this.resignedBy !== null || this.position.status().over
  }

  playMove(token: string, wire: WireMove): MoveResult {
    const player = this.players.get(token)
    if (!player || player.seat === 'penonton') return { ok: false, code: 'bukan-pemain' }
    if (this.isOver) return { ok: false, code: 'permainan-usai' }
    if (player.seat !== this.position.turn) return { ok: false, code: 'bukan-giliran' }

    const legal = this.position.legalMoves()
    const move = this.matchMove(legal, wire)
    if (!move) return { ok: false, code: 'langkah-tidak-sah' }

    const san = this.position.toSAN(move, legal)
    this.position.makeMove(move)
    const entry: WireHistoryEntry = {
      san,
      move: { from: move.from, to: move.to, promotion: move.promotion },
      captured: move.captured
    }
    this.history.push(entry)
    this.lastActivityAt = Date.now()

    return { ok: true, entry, fen: this.position.fen(), by: player.seat }
  }

  /**
   * Mencocokkan langkah dari jaringan dengan langkah legal yang sesungguhnya.
   * Promosi yang tidak disebutkan klien default ke menteri, karena itu pilihan
   * yang hampir selalu dimaksud dan menghindari langkah tergantung.
   */
  private matchMove(legal: Move[], wire: WireMove): Move | undefined {
    const candidates = legal.filter((move) => move.from === wire.from && move.to === wire.to)
    if (candidates.length === 0) return undefined
    if (!candidates[0].promotion) return candidates[0]

    const wanted: PromotionType = wire.promotion ?? 'q'
    return candidates.find((move) => move.promotion === wanted)
  }

  resign(token: string): Color | null {
    const player = this.players.get(token)
    if (!player || player.seat === 'penonton' || this.isOver) return null
    this.resignedBy = player.seat
    this.lastActivityAt = Date.now()
    return player.seat
  }

  /** Memulai partai baru di room yang sama, dengan kursi pemain ditukar. */
  rematch(token: string): boolean {
    const player = this.players.get(token)
    if (!player || player.seat === 'penonton') return false
    if (!this.isOver) return false

    this.position = new Position(this.startFen)
    this.history = []
    this.resignedBy = null
    for (const other of this.players.values()) {
      if (other.seat !== 'penonton') other.seat = opponent(other.seat)
    }
    this.lastActivityAt = Date.now()
    return true
  }

  private playerViews(): PlayerView[] {
    return [...this.players.values()]
      .map(({ seat, name, connected }) => ({ seat, name, connected }))
      .sort((a, b) => seatOrder(a.seat) - seatOrder(b.seat))
  }

  state(): RoomState {
    return {
      roomId: this.id,
      fen: this.position.fen(),
      history: this.history.slice(),
      players: this.playerViews(),
      resignedBy: this.resignedBy,
      waiting: !this.seatTaken('w') || !this.seatTaken('b')
    }
  }

  /** Token semua peserta, untuk menyiarkan pesan ke seluruh isi room. */
  tokens(): string[] {
    return [...this.players.keys()]
  }
}

const seatOrder = (seat: Seat): number => (seat === WHITE ? 0 : seat === 'b' ? 1 : 2)
