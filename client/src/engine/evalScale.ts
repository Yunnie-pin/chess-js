/**
 * Mengubah evaluasi mesin (centipawn / mat) menjadi dua hal yang dipakai
 * `EvalBar.vue`: seberapa besar bagian bilah yang jadi milik Putih, dan teks
 * pendek di ujungnya. Dipisah dari komponennya supaya bisa diuji tanpa DOM.
 */

import type { Evaluation } from './stockfishEngine.ts'

/**
 * Bagian `Evaluation` yang dipakai di sini. `fen` ikut — bukan hiasan: pada
 * posisi yang SUDAH mat, tanda skornya hilang dan hanya giliranlah yang masih
 * memberi tahu siapa yang kalah. Lihat catatan di `whiteShare`.
 */
type Score = Pick<Evaluation, 'cp' | 'mate' | 'fen'>

/** Pihak yang jalan menurut FEN — field kedua. */
function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

/**
 * Bagian bilah milik Putih, 0..1.
 *
 * Kurva logistik, bukan linear: selisih 1 pion di posisi imbang jauh lebih
 * berarti daripada pion ke-9 saat sudah menang telak, jadi bilahnya ikut
 * melambat di ujung. Dijepit ke [0.02, 0.98] supaya sisi yang kalah tetap
 * tersisa setipis garis — kecuali memang sudah mat paksa, yang langsung penuh.
 */
export function whiteShare(evaluation: Score | null): number {
  if (!evaluation) return 0.5
  if (evaluation.mate !== null) {
    /*
     * `mate 0` berarti pihak yang JALAN sudah dimat — bukan "mat dalam nol
     * langkah bagi seseorang". Ini kasus khusus yang wajib dipisah: nol tidak
     * punya tanda, jadi pembalikan sudut pandang di `stockfishEngine.ts`
     * (yang mengalikan skor dengan -1 bila Hitam yang jalan) menghapus satu-
     * satunya petunjuk siapa pemenangnya. Tanpa cabang ini, `0 > 0` selalu
     * salah dan bilahnya jadi hitam penuh — termasuk saat PUTIH yang menang.
     *
     * Yang jalan adalah yang kalah, jadi giliranlah penentunya.
     */
    if (evaluation.mate === 0) return sideToMove(evaluation.fen) === 'w' ? 0 : 1
    return evaluation.mate > 0 ? 1 : 0
  }
  if (evaluation.cp === null) return 0.5
  const share = 1 / (1 + Math.exp(-evaluation.cp / 400))
  return Math.min(0.98, Math.max(0.02, share))
}

/** Teks di ujung bilah: "+1.2", "-0.4", "0.0", "M3", "#" bila sudah mat, atau "…" bila belum ada kabar. */
export function formatEval(evaluation: Score | null): string {
  if (!evaluation || (evaluation.cp === null && evaluation.mate === null)) return '…'
  // Mat sudah terjadi, bukan mat dalam sekian langkah — "M0" tidak berarti apa-apa.
  if (evaluation.mate === 0) return '#'
  if (evaluation.mate !== null) return `M${Math.abs(evaluation.mate)}`
  const pawns = (evaluation.cp ?? 0) / 100
  if (Math.abs(pawns) < 0.05) return '0.0'
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1)
}
