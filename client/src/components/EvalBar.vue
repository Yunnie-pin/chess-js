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

/** Ujung Putih di bawah saat main Putih, di atas saat papan diputar. */
const flipped = computed(() => props.orientation === 'b')
/**
 * Angka menempel di ujung pihak yang UNGGUL (imbang → ujung Putih). Ujung itu
 * selalu terisi warna pihaknya sendiri lebih dari separuh, jadi teks gelap di
 * ujung Putih dan teks terang di ujung Hitam selalu kontras — tidak perlu
 * menebak ambang seperti dulu, dan mata langsung tahu siapa yang di depan.
 */
const atWhiteEnd = computed(() => share.value >= 0.5)
const labelEdge = computed(() => (atWhiteEnd.value !== flipped.value ? 'bottom' : 'top'))
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
      :class="[
        `evalbar__score--${labelEdge}`,
        atWhiteEnd ? 'evalbar__score--dark' : 'evalbar__score--light',
        { 'evalbar__score--long': label.length >= 5 }
      ]"
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

/* Lebar bilah (1.5rem) dipakai App.vue untuk menggeser kolom papan — jadi
   yang dinaikkan ukuran hurufnya, bukan lebarnya; spasi huruf dirapatkan
   supaya "+10.5" tetap muat. */
.evalbar__score {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.64rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.05em;
  pointer-events: none;
}

/* "+10.5", "-12.3": lima karakter tak muat di 1.5rem pada ukuran normal. */
.evalbar__score--long {
  font-size: 0.54rem;
}

.evalbar__score--bottom {
  bottom: 0.25rem;
}

.evalbar__score--top {
  top: 0.25rem;
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
