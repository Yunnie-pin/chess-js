/**
 * Kapan state online yang baru datang berarti "ada langkah baru" — murni,
 * diuji tanpa server.
 *
 * Server selalu mengirim potret room UTUH: saat bergabung, saat resync
 * sesudah langkah ditolak, saat reconnect, dan sesudah setiap langkah. Kalau
 * semua itu dianggap langkah, bergabung ke partai yang sudah 40 ply atau
 * reconnect akan memainkan puluhan suara sekaligus. Jadi yang dihitung hanya
 * riwayat yang BERTAMBAH di ujungnya, di room yang sama, dengan awalan yang
 * tetap sama.
 */

import type { Color } from '@chess/shared/types'

interface StateLike {
  roomId: string
  history: readonly { san: string }[]
  waiting: boolean
  resignedBy: Color | null
}

/**
 * Jumlah ply yang baru ditambahkan di `next` dibanding `prev` — 0 bila ini
 * bukan kelanjutan biasa (state pertama, room lain, rematch, riwayat yang
 * berbeda), atau bila lompatannya terlalu jauh untuk didengar sebagai langkah.
 * Dua masih wajar: premove yang langsung dieksekusi, atau satu langkah lawan
 * yang terlewat selama reconnect singkat.
 */
export function appendedPlies(prev: StateLike | null, next: StateLike): number {
  if (!prev || prev.roomId !== next.roomId) return 0
  const before = prev.history.length
  const added = next.history.length - before
  if (added < 1 || added > 2) return 0
  // Awalan harus sama — riwayat yang ditulis ulang bukan "langkah baru".
  if (before > 0 && prev.history[before - 1].san !== next.history[before - 1].san) return 0
  return added
}

/** Lawan baru saja duduk: room yang sama berhenti menunggu. */
export function opponentJoined(prev: StateLike | null, next: StateLike): boolean {
  return !!prev && prev.roomId === next.roomId && prev.waiting && !next.waiting
}

/** Seseorang baru saja menyerah di room yang sama — kembalikan warnanya. */
export function justResigned(prev: StateLike | null, next: StateLike): Color | null {
  if (!prev || prev.roomId !== next.roomId || prev.resignedBy || !next.resignedBy) return null
  return next.resignedBy
}
