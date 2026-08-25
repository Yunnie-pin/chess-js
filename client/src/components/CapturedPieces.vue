<script setup lang="ts">
import { computed } from 'vue'

import type { Color, Piece, PieceType } from '@chess/shared/types'

const props = defineProps<{
  /** Warna bidak yang ditampilkan di baris ini (yaitu yang sudah tertangkap). */
  color: Color
  pieces: PieceType[]
  /** Selisih materi dari sudut pandang pemain yang menangkap. */
  lead: number
}>()

const GLYPHS: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }

const captured = computed<Piece[]>(() => props.pieces.map((type) => `${props.color}${type}` as Piece))
</script>

<template>
  <div class="captured">
    <span
      v-for="(piece, index) in captured"
      :key="`${piece}-${index}`"
      class="captured__piece"
      :class="`captured__piece--${color}`"
      aria-hidden="true"
    >
      {{ GLYPHS[piece[1] as PieceType] }}
    </span>
    <span v-if="lead > 0" class="captured__lead">+{{ lead }}</span>
  </div>
</template>

<style scoped>
.captured {
  display: flex;
  align-items: center;
  gap: 0.05rem;
  min-height: 1.35rem;
  font-size: 1.15rem;
  line-height: 1;
}

.captured__piece--w {
  color: #e8e9ec;
  -webkit-text-stroke: 0.8px #2b3038;
}

.captured__piece--b {
  color: #3d434d;
}

.captured__lead {
  margin-left: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
