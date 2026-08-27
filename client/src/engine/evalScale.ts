/**
 * Mengubah evaluasi mesin (centipawn / mat) menjadi dua hal yang dipakai
 * `EvalBar.vue`: seberapa besar bagian bilah yang jadi milik Putih, dan teks
 * pendek di ujungnya. Dipisah dari komponennya supaya bisa diuji tanpa DOM.
 */

import type { Evaluation } from './stockfishEngine.ts'

/** Cuma bagian skor dari `Evaluation` — fungsi di sini tak peduli `fen`/`depth`/`best`. */
type Score = Pick<Evaluation, 'cp' | 'mate'>

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
  if (evaluation.mate !== null) return evaluation.mate > 0 ? 1 : 0
  if (evaluation.cp === null) return 0.5
  const share = 1 / (1 + Math.exp(-evaluation.cp / 400))
  return Math.min(0.98, Math.max(0.02, share))
}

/** Teks di ujung bilah: "+1.2", "-0.4", "0.0", "M3", atau "…" bila belum ada kabar. */
export function formatEval(evaluation: Score | null): string {
  if (!evaluation || (evaluation.cp === null && evaluation.mate === null)) return '…'
  if (evaluation.mate !== null) return `M${Math.abs(evaluation.mate)}`
  const pawns = (evaluation.cp ?? 0) / 100
  if (Math.abs(pawns) < 0.05) return '0.0'
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1)
}
