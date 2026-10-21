/**
 * Suara apa untuk sebuah langkah — murni, diuji tanpa audio. Yang memutarnya
 * `synth.ts`; yang memutuskan KAPAN (hanya langkah baru, bukan undo/impor/
 * resync) adalah pemanggilnya di App.
 */

import type { Color, GameStatus, Move } from '@chess/shared/types'

export type SoundName =
  | 'move-self'
  | 'move-opponent'
  | 'capture'
  | 'castle'
  | 'promote'
  | 'check'
  | 'game-start'
  | 'game-win'
  | 'game-lose'
  | 'game-draw'
  | 'game-end'
  | 'illegal'
  | 'premove'

export interface MoveSoundInput {
  move: Pick<Move, 'captured' | 'castle' | 'promotion'>
  /** Warna yang baru saja melangkah. */
  mover: Color
  /** Status posisi SESUDAH langkah itu. */
  status: Pick<GameStatus, 'over' | 'winner' | 'check'>
  /**
   * Dari sudut siapa partai ini didengar — menentukan langkah "sendiri" vs
   * "lawan" dan menang vs kalah. `null` untuk dua pemain di satu papan
   * (dan penonton): tidak ada "sendiri", jadi semua langkah terdengar sama.
   */
  me: Color | null
}

/**
 * Suara untuk satu langkah, berurutan. Biasanya satu; langkah yang mengakhiri
 * partai memberi dua — bunyi langkahnya dulu, baru jingle akhir — supaya
 * makan-sambil-mat tetap terdengar sebagai makan.
 *
 * Prioritas bunyi langkah: skak > promosi > rokade > makan > langkah biasa.
 * Skak paling atas karena itulah yang paling perlu didengar pihak satunya;
 * pada mat, nada skak diganti jingle akhir.
 */
export function soundsForMove(input: MoveSoundInput): SoundName[] {
  const { move, mover, status, me } = input
  const base: SoundName = move.promotion
    ? 'promote'
    : move.castle
      ? 'castle'
      : move.captured
        ? 'capture'
        : me !== null && mover !== me
          ? 'move-opponent'
          : 'move-self'

  if (status.over) return [base, endSound(status.winner, me)]
  if (status.check) return ['check']
  return [base]
}

/** Jingle akhir partai dari sudut `me`. */
export function endSound(winner: Color | null, me: Color | null): SoundName {
  if (winner === null) return 'game-draw'
  if (me === null) return 'game-end'
  return winner === me ? 'game-win' : 'game-lose'
}
