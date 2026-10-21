/**
 * Menilai kualitas satu langkah dari dua evaluasi mesin: posisi SEBELUM dan
 * SESUDAH langkah itu. Dipakai untuk label langkah (blunder, kesalahan, …) dan
 * akurasi pemain di ulasan pasca-partai. Logika murni, dipisah dari komponen
 * supaya bisa diuji tanpa DOM — pola yang sama dengan `evalScale.ts`.
 */

import type { Evaluation } from './stockfishEngine.ts'

/** Bagian `Evaluation` yang dipakai. `fen` wajib — giliran menentukan siapa yang melangkah. */
export type Score = Pick<Evaluation, 'cp' | 'mate' | 'fen'>

export type MoveClass = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

/**
 * Ambang penurunan peluang menang (skala 0..1, dari sudut yang melangkah).
 * Setara ambang Lichess (0.1 / 0.2 / 0.3 pada skala -1..1 mereka), supaya
 * labelnya terasa akrab bagi pemain yang terbiasa di sana.
 */
const INACCURACY = 0.05
const MISTAKE = 0.1
const BLUNDER = 0.15

/**
 * Konstanta kurva logistik Lichess untuk centipawn → peluang menang. Sengaja
 * BUKAN kurva `whiteShare` (yang skalanya 400 dan dijepit 0.02..0.98): bilah
 * itu dirancang untuk tampilan, sedangkan rumus akurasi di bawah dikalibrasi
 * terhadap kurva ini — menukar kurvanya menggeser semua angka akurasi.
 */
const WIN_K = 0.00368208

function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

/**
 * Peluang menang PUTIH, 0..1, tanpa penjepit. Mat paksa = pasti (0 atau 1).
 * `mate 0` berarti pihak yang jalan sudah dimat — tandanya hilang, jadi
 * giliranlah penentunya (lihat catatan panjang di `evalScale.ts`).
 */
export function whiteWinChance(score: Score): number {
  if (score.mate !== null) {
    if (score.mate === 0) return sideToMove(score.fen) === 'w' ? 0 : 1
    return score.mate > 0 ? 1 : 0
  }
  if (score.cp === null) return 0.5
  return 1 / (1 + Math.exp(-WIN_K * score.cp))
}

/**
 * Berapa peluang menang yang dibuang langkah ini, dari sudut pihak yang
 * melangkah (giliran di `before.fen`). 0 bila langkahnya tidak merugikan —
 * evaluasi yang malah naik (mesin belum melihatnya di kedalaman sebelumnya)
 * tidak dihitung sebagai "untung negatif".
 */
export function winChanceLoss(before: Score, after: Score): number {
  const mover = sideToMove(before.fen)
  const own = (score: Score): number =>
    mover === 'w' ? whiteWinChance(score) : 1 - whiteWinChance(score)
  return Math.max(0, own(before) - own(after))
}

/**
 * Label satu langkah. `matchedBest` = langkah yang dimainkan sama dengan lini
 * teratas mesin di posisi `before`; itu satu-satunya jalan ke 'best', karena
 * penurunan nol saja belum berarti langkah terbaik (bisa sekadar sama baiknya
 * di posisi yang sudah menang telak, tempat kurvanya datar).
 */
export function classifyMove(before: Score, after: Score, matchedBest = false): MoveClass {
  if (matchedBest) return 'best'
  const loss = winChanceLoss(before, after)
  if (loss >= BLUNDER) return 'blunder'
  if (loss >= MISTAKE) return 'mistake'
  if (loss >= INACCURACY) return 'inaccuracy'
  return 'good'
}

/**
 * Akurasi satu langkah, 0..100 — rumus Lichess dari penurunan peluang menang
 * (dalam persen). Tanpa penurunan = 100; makin besar penurunan, makin cepat
 * akurasinya jatuh secara eksponensial.
 */
export function moveAccuracy(before: Score, after: Score): number {
  const lossPercent = winChanceLoss(before, after) * 100
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * lossPercent) - 3.166924740191411
  return Math.min(100, Math.max(0, raw))
}

/** Evaluasi satu posisi seperti yang dibutuhkan ulasan: skor + lini terbaik mesin. */
export type ReviewedScore = Score & Pick<Evaluation, 'moves'>

export interface PlyReview {
  cls: MoveClass
  accuracy: number
}

export interface GameReview {
  /** Indeks i = langkah ke-(i+1); null bila salah satu posisinya belum dinilai. */
  plies: (PlyReview | null)[]
  /** Akurasi per warna, null bila warna itu belum punya langkah yang dinilai. */
  accuracy: { w: number | null; b: number | null }
  /** Jumlah langkah per label, per warna. */
  counts: Record<'w' | 'b', Record<MoveClass, number>>
}

const emptyCounts = (): Record<MoveClass, number> => ({
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0
})

/**
 * Rangkum satu partai. `scores[i]` = evaluasi posisi sesudah i ply (indeks 0 =
 * posisi awal), jadi panjangnya `moves.length + 1`. Langkah ke-i dinilai dari
 * `scores[i-1]` → `scores[i]`, dan 'best' bila sama dengan lini teratas mesin
 * di `scores[i-1]`. Warna yang melangkah dibaca dari FEN, bukan dari paritas
 * indeks — partai tidak selalu dimulai giliran Putih.
 */
export function reviewGame(
  scores: readonly (ReviewedScore | undefined)[],
  moves: readonly { from: number; to: number }[]
): GameReview {
  const plies: (PlyReview | null)[] = []
  const perColor: Record<'w' | 'b', number[]> = { w: [], b: [] }
  const counts = { w: emptyCounts(), b: emptyCounts() }
  for (let i = 0; i < moves.length; i++) {
    const before = scores[i]
    const after = scores[i + 1]
    if (!before || !after) {
      plies.push(null)
      continue
    }
    const best = before.moves[0]
    const played = moves[i]
    const matchedBest = best !== undefined && best.from === played.from && best.to === played.to
    const accuracy = moveAccuracy(before, after)
    const cls = classifyMove(before, after, matchedBest)
    const mover = sideToMove(before.fen)
    plies.push({ cls, accuracy })
    perColor[mover].push(accuracy)
    counts[mover][cls]++
  }
  return {
    plies,
    accuracy: { w: gameAccuracy(perColor.w), b: gameAccuracy(perColor.b) },
    counts
  }
}

/** Label yang dihitung sebagai "momen penting" untuk navigasi — yang benar-benar menggeser partai. */
export const KEY_MOMENTS: readonly MoveClass[] = ['mistake', 'blunder']

/**
 * Ply momen penting terdekat sebelum (`-1`) atau sesudah (`1`) `fromPly`, atau
 * null bila tidak ada. `marks[i]` = label ply ke-(i+1).
 */
export function nearestMoment(
  marks: readonly (MoveClass | null)[],
  fromPly: number,
  direction: -1 | 1
): number | null {
  for (let ply = fromPly + direction; ply >= 1 && ply <= marks.length; ply += direction) {
    const mark = marks[ply - 1]
    if (mark && KEY_MOMENTS.includes(mark)) return ply
  }
  return null
}

/**
 * Akurasi satu partai dari akurasi tiap langkah seorang pemain. Rata-rata
 * aritmetika dan harmonik digabung: aritmetika saja terlalu memaafkan satu
 * blunder di antara banyak langkah sempurna, harmonik saja terlalu keras
 * (satu langkah 0% menyeret semuanya ke 0). `null` bila belum ada langkah.
 */
export function gameAccuracy(accuracies: readonly number[]): number | null {
  if (accuracies.length === 0) return null
  const arithmetic = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length
  // Lantai 1% supaya langkah 0% tidak membuat pembaginya tak hingga.
  const harmonic = accuracies.length / accuracies.reduce((sum, a) => sum + 1 / Math.max(1, a), 0)
  return (arithmetic + harmonic) / 2
}
