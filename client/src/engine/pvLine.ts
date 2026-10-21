/**
 * Mengubah lini utama Stockfish (notasi UCI: "e2e4 e7e5 g1f3") jadi SAN yang
 * dibaca manusia, lengkap dengan nomor langkah. Murni — dipakai panel ulasan
 * untuk "lebih baik: …", diuji tanpa worker.
 *
 * Tiap langkah dicocokkan ke `legalMoves()` posisi yang sedang dibangun,
 * bukan dirakit sendiri dari teks — dengan begitu rokade, en passant, dan
 * promosi dilengkapi oleh generator langkah yang sama dengan permainan.
 */

import { Position, fromAlgebraic } from '@chess/shared/chess'

/**
 * SAN untuk paling banyak `max` langkah pertama `uci` dari posisi `fen`.
 * Berhenti diam-diam di token pertama yang tidak legal atau tidak terbaca —
 * PV dari pencarian yang dihentikan di tengah jalan kadang terpotong aneh,
 * dan sebagian lini yang benar lebih berguna daripada tidak ada sama sekali.
 */
export function uciLineToSan(fen: string, uci: readonly string[], max = 6): string[] {
  const position = new Position(fen)
  const sans: string[] = []
  for (const token of uci.slice(0, max)) {
    const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(token)
    if (!match) break
    const from = fromAlgebraic(match[1])
    const to = fromAlgebraic(match[2])
    const promotion = match[3] ?? null
    const legal = position.legalMoves()
    const move = legal.find((m) => m.from === from && m.to === to && (m.promotion ?? null) === promotion)
    if (!move) break
    sans.push(position.toSAN(move, legal))
    position.makeMove(move)
  }
  return sans
}

/**
 * "7… Nf6 8. Qxf7#" — nomor langkah dari FEN (field 6), giliran dari field 2.
 * Lini yang dimulai giliran Hitam diberi "N…" di depan, seperti notasi biasa.
 */
export function formatLine(fen: string, sans: readonly string[]): string {
  const fields = fen.split(' ')
  let black = fields[1] === 'b'
  let number = Number(fields[5] ?? 1) || 1
  const parts: string[] = []
  sans.forEach((san, i) => {
    if (!black) parts.push(`${number}.`)
    else if (i === 0) parts.push(`${number}…`)
    parts.push(san)
    if (black) number++
    black = !black
  })
  return parts.join(' ')
}
