/**
 * Nama pembukaan untuk partai yang sedang tampil — tabel kecil buatan sendiri,
 * bukan basis data ECO lengkap, sejalan dengan repo ini yang tanpa pustaka
 * catur. Cukup untuk pembukaan yang lazim; di luar itu namanya ikut posisi
 * terakhir yang masih dikenali.
 *
 * Dicocokkan per POSISI (kunci FEN tanpa penghitung langkah), bukan per
 * urutan langkah: 1. Nf3 d5 2. d4 dan 1. d4 d5 2. Nf3 sampai di posisi yang
 * sama, dan memang pembukaan yang sama.
 *
 * Nama sengaja tidak diterjemahkan: nama pembukaan adalah nama diri yang
 * dipakai pemain catur di mana pun, termasuk di Indonesia. Kode ECO sengaja
 * tidak dicantumkan — kode yang keliru lebih menyesatkan daripada tanpa kode.
 */

import { Position, START_FEN } from '@chess/shared/chess'

/**
 * Kunci posisi untuk pembukaan: papan, giliran, rokade. Field en passant
 * sengaja dibuang — FEN mencatatnya sesudah SETIAP dorongan dua petak walau
 * tak ada pion yang bisa memakannya, jadi 1. c4 e6 2. d4 d5 dan 1. d4 d5
 * 2. c4 e6 akan dianggap berbeda padahal posisinya sama persis.
 */
const openingKey = (fen: string): string => fen.split(' ').slice(0, 3).join(' ')

/** [nama, langkah dalam SAN dari posisi awal]. Urutan bebas — yang menang posisi terdalam di partai. */
const OPENINGS: readonly [string, string][] = [
  ["King's Pawn Opening", 'e4'],
  ["King's Pawn Game", 'e4 e5'],
  ["King's Knight Opening", 'e4 e5 Nf3'],
  ["King's Knight Opening: Normal Variation", 'e4 e5 Nf3 Nc6'],
  ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5'],
  ['Ruy Lopez: Morphy Defense', 'e4 e5 Nf3 Nc6 Bb5 a6'],
  ['Ruy Lopez: Berlin Defense', 'e4 e5 Nf3 Nc6 Bb5 Nf6'],
  ['Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
  ['Italian Game: Giuoco Piano', 'e4 e5 Nf3 Nc6 Bc4 Bc5'],
  ['Italian Game: Two Knights Defense', 'e4 e5 Nf3 Nc6 Bc4 Nf6'],
  ['Scotch Game', 'e4 e5 Nf3 Nc6 d4'],
  ['Three Knights Opening', 'e4 e5 Nf3 Nc6 Nc3'],
  ['Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6'],
  ['Philidor Defense', 'e4 e5 Nf3 d6'],
  ["Petrov's Defense", 'e4 e5 Nf3 Nf6'],
  ["King's Gambit", 'e4 e5 f4'],
  ["King's Gambit Accepted", 'e4 e5 f4 exf4'],
  ['Vienna Game', 'e4 e5 Nc3'],
  ["Bishop's Opening", 'e4 e5 Bc4'],
  ['Center Game', 'e4 e5 d4 exd4'],
  ['Wayward Queen Attack', 'e4 e5 Qh5'],
  ['Sicilian Defense', 'e4 c5'],
  ['Sicilian Defense: Closed', 'e4 c5 Nc3'],
  ['Sicilian Defense: Alapin Variation', 'e4 c5 c3'],
  ['Sicilian Defense: Open', 'e4 c5 Nf3 d6 d4'],
  ['Sicilian Defense: Najdorf Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
  ['Sicilian Defense: Dragon Variation', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6'],
  ['French Defense', 'e4 e6'],
  ['French Defense: Advance Variation', 'e4 e6 d4 d5 e5'],
  ['French Defense: Exchange Variation', 'e4 e6 d4 d5 exd5'],
  ['French Defense: Tarrasch Variation', 'e4 e6 d4 d5 Nd2'],
  ['Caro-Kann Defense', 'e4 c6'],
  ['Caro-Kann Defense: Advance Variation', 'e4 c6 d4 d5 e5'],
  ['Scandinavian Defense', 'e4 d5'],
  ['Pirc Defense', 'e4 d6'],
  ['Modern Defense', 'e4 g6'],
  ["Alekhine's Defense", 'e4 Nf6'],
  ["Queen's Pawn Game", 'd4'],
  ["Queen's Pawn Game", 'd4 d5'],
  ["Queen's Gambit", 'd4 d5 c4'],
  ["Queen's Gambit Declined", 'd4 d5 c4 e6'],
  ["Queen's Gambit Accepted", 'd4 d5 c4 dxc4'],
  ['Slav Defense', 'd4 d5 c4 c6'],
  ['London System', 'd4 d5 Bf4'],
  ['London System', 'd4 Nf6 Bf4'],
  ['Indian Defense', 'd4 Nf6'],
  ["King's Indian Defense", 'd4 Nf6 c4 g6 Nc3 Bg7'],
  ['Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5'],
  ['Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4'],
  ["Queen's Indian Defense", 'd4 Nf6 c4 e6 Nf3 b6'],
  ['Benoni Defense', 'd4 Nf6 c4 c5'],
  ['Dutch Defense', 'd4 f5'],
  ['English Opening', 'c4'],
  ['Zukertort Opening', 'Nf3'],
  ['Réti Opening', 'Nf3 d5 c4'],
  ["Bird's Opening", 'f4'],
  ['Nimzo-Larsen Attack', 'b3'],
  ['Hungarian Opening', 'g3']
]

let table: Map<string, string> | null = null

/** Kunci posisi → nama; dibangun sekali saat pertama dibutuhkan. */
function openingTable(): Map<string, string> {
  if (table) return table
  table = new Map()
  for (const [name, line] of OPENINGS) {
    const position = new Position(START_FEN)
    for (const san of line.split(' ')) {
      const legal = position.legalMoves()
      const move = legal.find((m) => position.toSAN(m, legal).replace(/[+#]$/, '') === san)
      // Salah ketik di tabel di atas harus ketahuan di tes, bukan diam-diam salah nama.
      if (!move) throw new Error(`Langkah pembukaan tidak legal: ${name} — ${san}`)
      position.makeMove(move)
    }
    table.set(openingKey(position.fen()), name)
  }
  return table
}

/** Nama pembukaan dari posisi terdalam partai yang masih dikenali, atau null. */
export function openingName(fens: readonly string[]): string | null {
  const known = openingTable()
  for (let i = fens.length - 1; i >= 1; i--) {
    const name = known.get(openingKey(fens[i]))
    if (name) return name
  }
  return null
}
