/**
 * Web Worker pembungkus pencarian AI. Pencarian memblokir thread tempat ia
 * berjalan, jadi dijalankan di sini agar papan tetap bisa digeser dan animasi
 * tetap mulus selama komputer berpikir.
 */

import { Position } from '@chess/shared/chess'
import { chooseMove } from '@chess/shared/ai'
import type { EloRating } from '@chess/shared/ai'
import type { PromotionType, Square } from '@chess/shared/types'

export interface AiRequest {
  id: number
  fen: string
  elo: EloRating
}

export interface AiResponse {
  id: number
  from: Square | null
  to: Square | null
  promotion: PromotionType | null
  score: number
  depth: number
  nodes: number
  timeMs: number
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, fen, elo } = event.data
  const result = chooseMove(new Position(fen), elo)
  const response: AiResponse = {
    id,
    from: result.move?.from ?? null,
    to: result.move?.to ?? null,
    promotion: result.move?.promotion ?? null,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    timeMs: result.timeMs
  }
  ;(self as unknown as Worker).postMessage(response)
}
