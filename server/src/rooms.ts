/** Kumpulan room aktif, beserta pembuatan kode dan pembersihan room mati. */

import { randomBytes } from 'node:crypto'

import { ROOM_CODE_LENGTH } from '@chess/shared/protocol'
import { Room } from './room.ts'

/**
 * Tanpa huruf/angka yang mudah tertukar saat dibacakan lewat telepon atau chat:
 * 0/O, 1/I/L, 5/S, 8/B. Kode room memang untuk diketik ulang orang.
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'

/** Room tanpa satu pun peserta tersambung akan dibuang setelah tenggang ini. */
export const ROOM_IDLE_MS = 10 * 60 * 1000

export function randomCode(length = ROOM_CODE_LENGTH): string {
  // rejection sampling: modulo langsung akan membuat huruf awal alfabet lebih sering muncul.
  const limit = 256 - (256 % CODE_ALPHABET.length)
  let code = ''
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === length) break
    }
  }
  return code
}

export function randomToken(): string {
  return randomBytes(16).toString('hex')
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()

  get size(): number {
    return this.rooms.size
  }

  create(): Room {
    let id = randomCode()
    // Praktis tidak pernah terjadi pada jumlah room yang wajar, tapi tabrakan
    // kode berarti dua pertandingan berbeda saling menimpa — jadi tetap dijaga.
    while (this.rooms.has(id)) id = randomCode()

    const room = new Room(id)
    this.rooms.set(id, room)
    return room
  }

  /** Kode room tidak peka huruf besar-kecil; pemain mengetiknya dari ingatan. */
  find(id: string): Room | undefined {
    return this.rooms.get(id.trim().toUpperCase())
  }

  delete(id: string): void {
    this.rooms.delete(id)
  }

  /** Membuang room yang sudah lama tidak dipakai; kembalikan jumlah yang dibuang. */
  sweep(now = Date.now(), idleMs = ROOM_IDLE_MS): number {
    let removed = 0
    for (const [id, room] of this.rooms) {
      if (room.isEmpty && now - room.lastActivityAt > idleMs) {
        this.rooms.delete(id)
        removed++
      }
    }
    return removed
  }

  stats(): { rooms: number; players: number } {
    let players = 0
    for (const room of this.rooms.values()) players += room.playerCount
    return { rooms: this.rooms.size, players }
  }
}
