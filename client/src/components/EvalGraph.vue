<script setup lang="ts">
/**
 * Grafik evaluasi sepanjang partai, di panel ulasan. Geometrinya di
 * `evalGraph.ts` (murni, diuji tanpa DOM); di sini hanya menggambar dan
 * menangani pointer: crosshair menempel ke posisi terdekat, klik melompat ke
 * posisi itu di papan.
 */
import { computed, ref } from 'vue'

import { useI18n } from '../i18n/index.ts'
import { formatEval, whiteShare } from '../engine/evalScale.ts'
import type { MoveClass, Score } from '../engine/moveClassify.ts'
import {
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  areaPath,
  graphSegments,
  indexAtX,
  linePath,
  xAt,
  yAt
} from './evalGraph.ts'

const props = defineProps<{
  /** Evaluasi tiap posisi (indeks 0 = posisi awal); `undefined` = belum dinilai. */
  scores: readonly (Score | undefined)[]
  /** Label per ply (indeks 0 = ply 1). */
  marks: readonly (MoveClass | null)[]
  /** SAN per ply (indeks 0 = ply 1), untuk tooltip. */
  sans: readonly string[]
  /** Ply yang sedang tampil di papan. */
  activePly: number
}>()

const emit = defineEmits<{ jump: [ply: number] }>()

const { t } = useI18n()

/** Hanya yang benar-benar menggeser partai yang diberi titik — ?! di setiap tikungan cuma jadi bising. */
const DOTTED: readonly MoveClass[] = ['mistake', 'blunder']
const MARK_SYMBOL: Partial<Record<MoveClass, string>> = {
  best: '★',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??'
}

const count = computed(() => props.scores.length)
const shares = computed(() => props.scores.map((score) => (score ? whiteShare(score) : null)))
const segments = computed(() => graphSegments(shares.value))

const dots = computed(() =>
  props.marks.flatMap((mark, i) => {
    const share = shares.value[i + 1]
    if (!mark || !DOTTED.includes(mark) || share === null || share === undefined) return []
    return [{ ply: i + 1, mark, x: xAt(i + 1, count.value), y: yAt(share) }]
  })
)

const svgEl = ref<SVGSVGElement | null>(null)
/** Indeks posisi di bawah pointer, atau null bila pointer di luar grafik. */
const hover = ref<number | null>(null)

function indexFromEvent(event: PointerEvent): number | null {
  const svg = svgEl.value
  if (!svg || count.value === 0) return null
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH
  return indexAtX(x, count.value)
}

const onMove = (event: PointerEvent) => (hover.value = indexFromEvent(event))
const onLeave = () => (hover.value = null)
const onClick = (event: PointerEvent) => {
  const index = indexFromEvent(event)
  if (index !== null) emit('jump', index)
}

/** Garis vertikal: yang di-hover, kalau tidak ada ya posisi yang sedang tampil. */
const cursorIndex = computed(() => hover.value ?? props.activePly)
const cursorX = computed(() => xAt(Math.min(cursorIndex.value, count.value - 1), count.value))

/** "12. Nf6??" / "12… Nf6??" — nomor langkah dihitung dari ply, Putih mulai. */
function moveLabel(ply: number): string {
  if (ply === 0) return t('review.graph.start')
  const number = Math.ceil(ply / 2)
  const san = props.sans[ply - 1] ?? ''
  const mark = props.marks[ply - 1]
  const symbol = mark ? (MARK_SYMBOL[mark] ?? '') : ''
  return `${number}${ply % 2 ? '.' : '…'} ${san}${symbol}`
}

const tooltip = computed(() => {
  const index = hover.value
  if (index === null) return null
  const score = props.scores[index]
  const mark = index > 0 ? props.marks[index - 1] : null
  return {
    move: moveLabel(index),
    evaluation: score ? formatEval(score) : '…',
    cls: mark && mark !== 'good' ? t(`review.class.${mark}`) : null,
    /** Posisi horizontal dalam persen; tooltip dijepit supaya tidak keluar panel. */
    left: Math.min(78, Math.max(22, (xAt(index, count.value) / GRAPH_WIDTH) * 100))
  }
})
</script>

<template>
  <div class="graph">
    <svg
      ref="svgEl"
      class="graph__svg"
      :viewBox="`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`"
      role="img"
      :aria-label="t('review.graph.ariaLabel')"
      @pointermove="onMove"
      @pointerleave="onLeave"
      @click="onClick"
    >
      <rect class="graph__empty" x="0" y="0" :width="GRAPH_WIDTH" :height="GRAPH_HEIGHT" />
      <template v-for="(segment, i) in segments" :key="`a${i}`">
        <path class="graph__black" :d="areaPath(segment, 'b')" />
        <path class="graph__white" :d="areaPath(segment, 'w')" />
      </template>
      <line class="graph__mid" x1="0" :y1="GRAPH_HEIGHT / 2" :x2="GRAPH_WIDTH" :y2="GRAPH_HEIGHT / 2" />
      <path v-for="(segment, i) in segments" :key="`l${i}`" class="graph__line" :d="linePath(segment)" />
      <line
        v-if="count > 0"
        class="graph__cursor"
        :class="{ 'graph__cursor--hover': hover !== null }"
        :x1="cursorX"
        y1="0"
        :x2="cursorX"
        :y2="GRAPH_HEIGHT"
      />
      <circle
        v-for="dot in dots"
        :key="dot.ply"
        class="graph__dot"
        :class="`graph__dot--${dot.mark}`"
        :cx="dot.x"
        :cy="dot.y"
        r="4"
      />
    </svg>

    <!-- Siapa di atas, siapa di bawah — grafik tanpa ini harus ditebak. -->
    <span class="graph__side graph__side--top" aria-hidden="true">{{ t('color.b') }}</span>
    <span class="graph__side graph__side--bottom" aria-hidden="true">{{ t('color.w') }}</span>

    <div v-if="tooltip" class="graph__tip" :style="{ left: `${tooltip.left}%` }">
      <span class="graph__tip-move">{{ tooltip.move }}</span>
      <span class="graph__tip-eval">{{ tooltip.evaluation }}</span>
      <span v-if="tooltip.cls" class="graph__tip-cls">{{ tooltip.cls }}</span>
    </div>
  </div>
</template>

<style scoped>
.graph {
  position: relative;
}

.graph__svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  cursor: crosshair;
  /* Sentuh-geser di grafik = menelusuri, bukan menggulir halaman. */
  touch-action: pan-y;
}

/* Bagian yang belum dinilai: netral, bukan warna salah satu pihak. */
.graph__empty {
  fill: var(--surface-hover);
}

/* Dua kutub yang sama dengan bilah evaluasi: atas milik Hitam, bawah milik Putih. */
.graph__black {
  fill: var(--piece-dark);
}

.graph__white {
  fill: var(--piece-light-small);
}

.graph__mid {
  stroke: var(--text-muted);
  stroke-width: 1;
  opacity: 0.45;
}

.graph__line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.graph__cursor {
  stroke: var(--accent);
  stroke-width: 1;
  opacity: 0.55;
}

.graph__cursor--hover {
  opacity: 0.9;
}

/* Cincin warna permukaan supaya titik tetap terbaca di atas garis dan area. */
.graph__dot {
  stroke: var(--surface);
  stroke-width: 2;
  pointer-events: none;
}

.graph__dot--mistake {
  fill: rgb(232 133 63);
}

.graph__dot--blunder {
  fill: var(--danger);
}

/* Chip berlatar permukaan: terbaca di atas area terang maupun gelap. */
.graph__side {
  position: absolute;
  left: 0.3rem;
  padding: 0 0.3rem;
  font-size: 0.6rem;
  line-height: 1.5;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  pointer-events: none;
}

.graph__side--top {
  top: 0.3rem;
}

.graph__side--bottom {
  bottom: 0.3rem;
}

.graph__tip {
  position: absolute;
  bottom: calc(100% + 0.35rem);
  transform: translateX(-50%);
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  padding: 0.3rem 0.5rem;
  font-size: 0.76rem;
  white-space: nowrap;
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
  pointer-events: none;
  z-index: 2;
}

.graph__tip-move {
  font-family: var(--font-mono);
}

.graph__tip-eval {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.graph__tip-cls {
  color: var(--text-muted);
}
</style>
