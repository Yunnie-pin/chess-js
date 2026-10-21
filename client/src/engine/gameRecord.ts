/**
 * Catatan satu partai dalam bentuk yang sama untuk offline maupun online:
 * FEN tiap posisi, langkah, dan SAN-nya — bahan ulasan, grafik, dan PGN.
 * Murni, diuji tanpa DOM.
 */

import { Position, START_FEN } from '@chess/shared/chess'
import type { Move, PromotionType, Square } from '@chess/shared/types'

export interface GameRecord {
  /** Indeks 0 = posisi awal, indeks i = sesudah i ply. Panjangnya `moves.length + 1`. */
  fens: string[]
  moves: { from: Square; to: Square }[]
  sans: string[]
}

/**
 * Bangun ulang partai dari langkah mentah (bentuk jaringan: from/to/promotion).
 * Tiap langkah dicocokkan ke `legalMoves()` — rokade, en passant, dan promosi
 * dilengkapi generator langkah yang sama dengan server. Berhenti di langkah
 * pertama yang tidak cocok alih-alih melempar: catatan yang terpotong masih
 * lebih berguna daripada layar galat.
 */
export function replayMoves(
  wire: readonly { from: Square; to: Square; promotion: PromotionType | null }[],
  startFen: string = START_FEN
): GameRecord {
  const position = new Position(startFen)
  const record: GameRecord = { fens: [position.fen()], moves: [], sans: [] }
  for (const step of wire) {
    const legal = position.legalMoves()
    const move = legal.find(
      (m) => m.from === step.from && m.to === step.to && (m.promotion ?? null) === step.promotion
    )
    if (!move) break
    record.sans.push(position.toSAN(move, legal))
    position.makeMove(move)
    record.fens.push(position.fen())
    record.moves.push({ from: move.from, to: move.to })
  }
  return record
}

export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*'

/** Escape nilai tag PGN: hanya `\` dan `"` yang istimewa di dalam tanda kutip. */
const escapeTag = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Format tanggal PGN: "2026.10.21". */
export function pgnDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

/**
 * PGN lengkap. Tujuh tag wajib (Seven Tag Roster) selalu ada, berurutan,
 * diikuti tag tambahan; teks langkah dibungkus ≤ 80 kolom seperti yang
 * diminta standarnya. Posisi awal non-standar tidak didukung — permainan di
 * aplikasi ini selalu mulai dari posisi awal.
 */
export function toPgn(options: {
  sans: readonly string[]
  result: PgnResult
  white: string
  black: string
  date: Date
  event?: string
  site?: string
  extraTags?: Record<string, string>
}): string {
  const tags: [string, string][] = [
    ['Event', options.event ?? '?'],
    ['Site', options.site ?? '?'],
    ['Date', pgnDate(options.date)],
    ['Round', '-'],
    ['White', options.white],
    ['Black', options.black],
    ['Result', options.result],
    ...Object.entries(options.extraTags ?? {})
  ]
  const header = tags.map(([name, value]) => `[${name} "${escapeTag(value)}"]`).join('\n')

  const tokens: string[] = []
  options.sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`)
    tokens.push(san)
  })
  tokens.push(options.result)

  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > 80) {
      lines.push(line)
      line = token
    } else {
      line = line ? `${line} ${token}` : token
    }
  }
  if (line) lines.push(line)

  return `${header}\n\n${lines.join('\n')}\n`
}

export type PgnParseResult =
  | { ok: true; moves: Move[]; sans: string[]; tags: Record<string, string>; result: PgnResult }
  /**
   * - `empty`: tidak ada satu langkah pun.
   * - `illegal`: langkah ke-`ply` (`san`) tidak legal di posisinya.
   * - `custom-start`: PGN dari posisi awal non-standar (tag FEN) — tidak didukung.
   */
  | { ok: false; error: 'empty' | 'illegal' | 'custom-start'; ply?: number; san?: string }

const RESULTS: readonly string[] = ['1-0', '0-1', '1/2-1/2', '*']

/** SAN tanpa hiasan yang boleh berbeda antar sumber: +, #, !, ?, dan '=' promosi. */
const bareSan = (san: string): string =>
  san
    .replace(/[+#!?]+$/, '')
    .replace(/^0-0-0$/, 'O-O-O')
    .replace(/^0-0$/, 'O-O')
    .replace('=', '')

/**
 * Urai PGN satu partai (partai pertama bila berisi beberapa). Ditulis sendiri
 * seperti seluruh aturan di repo ini: tag, komentar `{…}` dan `;…`, variasi
 * `(…)` bertingkat, NAG `$n`, nomor langkah, lalu tiap SAN dicocokkan ke
 * `legalMoves()` — jadi PGN yang "hampir benar" (tanpa `+`, `0-0`, `e8Q`)
 * tetap terbaca, sedangkan langkah yang memang ilegal ditolak dengan tepat.
 */
export function parsePgn(text: string): PgnParseResult {
  const tags: Record<string, string> = {}
  const tagPattern = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm
  for (const match of text.matchAll(tagPattern)) {
    tags[match[1]] = match[2].replace(/\\(["\\])/g, '$1')
  }
  if (tags.FEN && tags.FEN.trim() !== START_FEN) return { ok: false, error: 'custom-start' }

  let body = text.replace(tagPattern, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  // Variasi bisa bertingkat — kupas dari yang terdalam sampai tidak ada lagi.
  for (let previous = ''; previous !== body; ) {
    previous = body
    body = body.replace(/\([^()]*\)/g, ' ')
  }
  body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ')

  const position = new Position(START_FEN)
  const moves: Move[] = []
  const sans: string[] = []
  let result: PgnResult = '*'
  for (const token of body.split(/\s+/).filter(Boolean)) {
    if (RESULTS.includes(token)) {
      result = token as PgnResult
      break // akhir partai pertama
    }
    if (token === '…' || token === '..') continue
    const wanted = bareSan(token)
    const legal = position.legalMoves()
    const move = legal.find((m) => bareSan(position.toSAN(m, legal)) === wanted)
    if (!move) return { ok: false, error: 'illegal', ply: moves.length + 1, san: token }
    sans.push(position.toSAN(move, legal))
    position.makeMove(move)
    moves.push(move)
  }
  if (!moves.length) return { ok: false, error: 'empty' }
  if (result === '*' && tags.Result && RESULTS.includes(tags.Result)) result = tags.Result as PgnResult
  return { ok: true, moves, sans, tags, result }
}
