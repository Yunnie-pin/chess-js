<script setup lang="ts">
/**
 * Bilah evaluasi di samping papan — hanya di mode lawan komputer. Angkanya
 * datang dari worker analisis Stockfish tersendiri (lihat `stockfishEngine.ts`),
 * yang menilai posisi terkini sekuat mungkin, bukan pada kekuatan bot yang
 * dipilih. Jadi bilah ini tetap jujur walau lawannya disetel lemah.
 */
import { computed } from 'vue'

import { useI18n } from '../i18n/index.ts'
import { formatEval, whiteShare } from '../engine/evalScale.ts'
import type { Evaluation } from '../engine/stockfishEngine.ts'
import type { Color } from '@chess/shared/types'

const props = defineProps<{
  evaluation: Evaluation | null
  /** Orientasi papan — ujung Putih bilah ikut sisi Putih di papan. */
  orientation: Color
}>()

const { t } = useI18n()

const share = computed(() => whiteShare(props.evaluation))
const label = computed(() => formatEval(props.evaluation))

/** Angka menempel di ujung Putih: bawah saat main Putih, atas saat papan diputar. */
const flipped = computed(() => props.orientation === 'b')
/** Ujung Putih sedang terisi warna terang? kalau ya, teksnya gelap biar terbaca. */
const labelOnLight = computed(() => share.value > 0.12)
</script>

<template>
  <div
    class="evalbar"
    :class="{ 'evalbar--flip': flipped }"
    role="img"
    :aria-label="t('evalBar.ariaLabel', { score: label })"
  >
    <div class="evalbar__white" :style="{ height: `${share * 100}%` }" />
    <span
      class="evalbar__score"
      :class="labelOnLight ? 'evalbar__score--dark' : 'evalbar__score--light'"
    >
      {{ label }}
    </span>
  </div>
</template>

<style scoped>
.evalbar {
  position: relative;
  width: 1.5rem;
  flex-shrink: 0;
  /* Tinggi mengikuti papan lewat `align-items: stretch` di induknya. */
  align-self: stretch;
  background: var(--piece-dark);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  overflow: hidden;
}

.evalbar__white {
  position: absolute;
  inset: auto 0 0 0;
  background: var(--piece-light);
  transition: height 0.35s ease;
}

.evalbar--flip .evalbar__white {
  inset: 0 0 auto 0;
}

.evalbar__score {
  position: absolute;
  inset: auto 0 0.2rem 0;
  text-align: center;
  font-size: 0.58rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  pointer-events: none;
}

.evalbar--flip .evalbar__score {
  inset: 0.2rem 0 auto 0;
}

.evalbar__score--dark {
  color: var(--piece-dark);
}

.evalbar__score--light {
  color: var(--piece-light);
}

@media (prefers-reduced-motion: reduce) {
  .evalbar__white {
    transition: none;
  }
}
</style>
