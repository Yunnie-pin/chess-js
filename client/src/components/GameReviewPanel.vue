<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../i18n/index.ts'
import type { ReviewStatus } from '../composables/useGameReview.ts'
import { nearestMoment, type GameReview, type MoveClass } from '../engine/moveClassify.ts'
import { formatLine, uciLineToSan } from '../engine/pvLine.ts'
import type { Evaluation } from '../engine/stockfishEngine.ts'
import EvalGraph from './EvalGraph.vue'
import type { Color } from '@chess/shared/types'

const { t } = useI18n()

const props = defineProps<{
  status: ReviewStatus
  progress: { done: number; total: number }
  review: GameReview | null
  /** Nama tampilan tiap warna — "Anda", nama karakter lawan, atau "Putih"/"Hitam". */
  labels: Record<Color, string>
  /** Untuk grafik: evaluasi tiap posisi, label + SAN per ply, dan ply yang tampil. */
  scores: readonly (Evaluation | undefined)[]
  marks: readonly (MoveClass | null)[]
  sans: readonly string[]
  activePly: number
}>()

const emit = defineEmits<{ start: []; cancel: []; jump: [ply: number] }>()

const COLORS: Color[] = ['w', 'b']

/** Yang dihitung di ringkasan, dari yang paling parah. 'good' tidak — itu sisanya. */
const SHOWN: { cls: MoveClass; symbol: string }[] = [
  { cls: 'blunder', symbol: '??' },
  { cls: 'mistake', symbol: '?' },
  { cls: 'inaccuracy', symbol: '?!' },
  { cls: 'best', symbol: '★' }
]

const percent = computed(() =>
  props.progress.total ? Math.round((props.progress.done / props.progress.total) * 100) : 0
)

/** Akurasi dibulatkan satu desimal; "–" sebelum warna itu punya langkah yang dinilai. */
const accuracyText = (color: Color): string => {
  const value = props.review?.accuracy[color] ?? null
  return value === null ? '–' : `${value.toFixed(1)}%`
}

const SYMBOL: Partial<Record<MoveClass, string>> = Object.fromEntries(
  SHOWN.map((item) => [item.cls, item.symbol])
)

/** Panjang variasi mesin yang ditampilkan — cukup untuk melihat idenya, belum sampai jadi tembok teks. */
const LINE_PLIES = 6

/**
 * Langkah yang sedang tampil, bila langkah itu ?!, ?, atau ??: apa yang
 * dimainkan, dan apa yang lebih baik menurut mesin di posisi SEBELUMNYA
 * (`scores[ply - 1]`) — bukan posisi sesudahnya yang sedang tampil di papan.
 */
const moment = computed(() => {
  const ply = props.activePly
  const cls = ply > 0 ? props.marks[ply - 1] : null
  if (!cls || cls === 'best' || cls === 'good') return null
  const before = props.scores[ply - 1]
  const line = before ? uciLineToSan(before.fen, before.line, LINE_PLIES) : []
  return {
    cls,
    played: formatLine(before?.fen ?? '', [`${props.sans[ply - 1] ?? ''}${SYMBOL[cls] ?? ''}`]),
    better: before && line.length ? formatLine(before.fen, line.slice(0, 1)) : null,
    line: before && line.length > 1 ? formatLine(before.fen, line) : null
  }
})

const prevMoment = computed(() => nearestMoment(props.marks, props.activePly, -1))
const nextMoment = computed(() => nearestMoment(props.marks, props.activePly, 1))
</script>

<template>
  <section class="review">
    <h2 class="field__label">{{ t('review.title') }}</h2>

    <template v-if="status === 'idle'">
      <p class="review__hint">{{ t('review.hint') }}</p>
      <button type="button" class="btn btn--primary" @click="emit('start')">
        {{ t('review.start') }}
      </button>
    </template>

    <div v-if="status === 'running'" class="review__progress">
      <div class="review__track" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
        <div class="review__fill" :style="{ width: `${percent}%` }" />
      </div>
      <span class="review__progress-text">
        {{ t('review.progress', { done: progress.done, total: progress.total }) }}
      </span>
      <button type="button" class="btn" @click="emit('cancel')">{{ t('review.cancel') }}</button>
    </div>

    <EvalGraph
      v-if="scores.length"
      :scores="scores"
      :marks="marks"
      :sans="sans"
      :active-ply="activePly"
      @jump="(ply) => emit('jump', ply)"
    />

    <div v-if="review" class="review__players">
      <div v-for="color in COLORS" :key="color" class="review__row">
        <span class="review__player">
          <span class="review__dot" :class="`review__dot--${color}`" />
          <span class="review__name" :title="labels[color]">{{ labels[color] }}</span>
        </span>
        <span class="review__accuracy" :title="t('review.accuracy')">{{ accuracyText(color) }}</span>
        <span class="review__counts">
          <span
            v-for="item in SHOWN"
            :key="item.cls"
            class="review__count"
            :class="[`review__count--${item.cls}`, { 'review__count--zero': !review.counts[color][item.cls] }]"
            :title="t(`review.class.${item.cls}`)"
          >
            {{ item.symbol }} {{ review.counts[color][item.cls] }}
          </span>
        </span>
      </div>
    </div>

    <div v-if="moment" class="review__moment" :class="`review__moment--${moment.cls}`">
      <p class="review__moment-head">
        <span class="review__moment-move">{{ moment.played }}</span>
        <span>{{ t(`review.class.${moment.cls}`) }}</span>
      </p>
      <p v-if="moment.better" class="review__moment-line">
        {{ t('review.better', { move: moment.better }) }}
      </p>
      <p v-if="moment.line" class="review__moment-line review__moment-line--muted">
        {{ t('review.line', { line: moment.line }) }}
      </p>
    </div>

    <div v-if="review" class="review__nav">
      <button type="button" class="btn" :disabled="prevMoment === null" @click="emit('jump', prevMoment!)">
        ← {{ t('review.prevMoment') }}
      </button>
      <button type="button" class="btn" :disabled="nextMoment === null" @click="emit('jump', nextMoment!)">
        {{ t('review.nextMoment') }} →
      </button>
    </div>
  </section>
</template>

<style scoped>
/*
 * `minmax(0, 1fr)`, bukan kolom bawaan: kolom grid bawaan tidak mau lebih
 * sempit dari isi terlebarnya, jadi satu baris yang tak bisa dibungkus bisa
 * menarik seluruh panel — grafik ikut — keluar dari panel samping.
 */
.review {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.55rem;
  padding: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
}

.review h2 {
  margin: 0;
  font-weight: inherit;
}

.review__hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.review__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.4rem 0.6rem;
}

.review__track {
  grid-column: 1 / -1;
  height: 0.35rem;
  background: var(--surface-hover);
  border-radius: 999px;
  overflow: hidden;
}

.review__fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

.review__progress-text {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.review__players {
  display: grid;
  gap: 0.45rem;
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
}

/* Nama (boleh terpotong) + akurasi di baris pertama; hitungan di bawahnya, boleh membungkus. */
.review__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.15rem 0.5rem;
}

.review__player {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.review__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review__dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.review__dot--w {
  background: var(--piece-light-small);
}

.review__dot--b {
  background: var(--piece-dark-small);
}

.review__accuracy {
  font-weight: 700;
  color: var(--gold-text);
  text-align: right;
  white-space: nowrap;
}

.review__counts {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.1rem 0.6rem;
  padding-left: 1.05rem; /* sejajar dengan nama, melewati titik warna */
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.review__count {
  white-space: nowrap;
}

.review__count--best {
  color: var(--accent);
}

.review__count--inaccuracy {
  color: var(--sky-text);
}

.review__count--mistake {
  color: rgb(232 133 63);
}

.review__count--blunder {
  color: var(--danger-text);
}

.review__count--zero {
  opacity: 0.35;
}

/* Garis kiri berwarna membawa label; teksnya tetap warna teks biasa. */
.review__moment {
  display: grid;
  gap: 0.25rem;
  padding: 0.5rem 0.65rem;
  background: var(--surface-hover);
  border-left: 3px solid var(--text-muted);
  border-radius: 0.4rem;
  font-size: 0.82rem;
}

.review__moment--inaccuracy {
  border-left-color: var(--sky);
}

.review__moment--mistake {
  border-left-color: rgb(232 133 63);
}

.review__moment--blunder {
  border-left-color: var(--danger);
}

.review__moment p {
  margin: 0;
}

.review__moment-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-weight: 600;
}

.review__moment-move,
.review__moment-line {
  font-family: var(--font-mono);
}

.review__moment-line {
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.review__moment-line--muted {
  color: var(--text-muted);
}

.review__nav {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.4rem;
}

.review__nav .btn {
  padding: 0.45rem 0.5rem;
  font-size: 0.78rem;
}
</style>
