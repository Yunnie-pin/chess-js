<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { useI18n } from '../i18n/index.ts'

const { t } = useI18n()

interface Row {
  number: number
  white?: { san: string }
  black?: { san: string }
}

const props = defineProps<{ rows: Row[]; plyCount: number; activePly: number }>()

const emit = defineEmits<{ jump: [ply: number] }>()

const listEl = ref<HTMLElement | null>(null)

/** Ply dari sebuah baris: putih di (nomor-1)*2+1, hitam tepat sesudahnya. */
const plyOf = (row: Row, color: 'white' | 'black'): number =>
  (row.number - 1) * 2 + (color === 'white' ? 1 : 2)

// Selalu perlihatkan langkah terakhir tanpa perlu menggulir manual.
watch(
  () => props.plyCount,
  async () => {
    await nextTick()
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

/**
 * Gulir HANYA daftar internalnya sendiri, bukan `Element.scrollIntoView` —
 * itu ikut menggulir seluruh halaman kalau elemennya di luar layar, dan
 * sejak daftar ini pindah ke bawah papan (bukan lagi di panel tetap di
 * samping), setiap langkah baru sama saja dengan "di luar layar" begitu
 * papannya cukup tinggi. Akibatnya halaman melompat sendiri setiap kali
 * bermain — persis yang mau dihindari di sini.
 */
function scrollActiveIntoView(): void {
  const container = listEl.value
  const target = container?.querySelector<HTMLElement>(`[data-ply="${props.activePly}"]`)
  if (!container || !target) return
  const top = target.offsetTop
  const bottom = top + target.offsetHeight
  if (top < container.scrollTop) container.scrollTop = top
  else if (bottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottom - container.clientHeight
  }
}

// Menelusuri lewat panah keyboard atau lompat lewat MoveHistory sendiri
// sama-sama harus terlihat, walau di luar area yang sedang digulir.
watch(
  () => props.activePly,
  async () => {
    await nextTick()
    scrollActiveIntoView()
  }
)
</script>

<template>
  <section class="history">
    <h2 class="history__title">{{ t('history.title') }}</h2>
    <div ref="listEl" class="history__scroll">
      <p v-if="!rows.length" class="history__empty">{{ t('history.empty') }}</p>
      <table v-else class="history__table">
        <tbody>
          <tr v-for="row in rows" :key="row.number">
            <td class="history__number">{{ row.number }}.</td>
            <td class="history__san">
              <button
                v-if="row.white"
                type="button"
                class="history__move"
                :class="{ 'history__move--active': plyOf(row, 'white') === activePly }"
                :data-ply="plyOf(row, 'white')"
                @click="emit('jump', plyOf(row, 'white'))"
              >
                {{ row.white.san }}
              </button>
            </td>
            <td class="history__san">
              <button
                v-if="row.black"
                type="button"
                class="history__move"
                :class="{ 'history__move--active': plyOf(row, 'black') === activePly }"
                :data-ply="plyOf(row, 'black')"
                @click="emit('jump', plyOf(row, 'black'))"
              >
                {{ row.black.san }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
}

.history__title {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.history__scroll {
  flex: 1;
  min-height: 6rem;
  max-height: 17rem;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  padding: 0.4rem;
}

.history__empty {
  margin: 0;
  padding: 0.8rem 0.5rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.history__table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  font-size: 0.86rem;
}

.history__table tr:nth-child(odd) {
  background: rgb(255 255 255 / 0.025);
}

.history__number {
  width: 2.6rem;
  padding: 0.24rem 0.5rem;
  color: var(--text-muted);
}

.history__san {
  padding: 0.15rem 0.3rem;
  font-family: var(--font-mono);
}

.history__move {
  width: 100%;
  padding: 0.09rem 0.2rem;
  font: inherit;
  font-family: var(--font-mono);
  text-align: left;
  background: none;
  border: none;
  border-radius: 0.3rem;
  color: inherit;
  cursor: pointer;
}

@media (hover: hover) {
  .history__move:hover {
    background: var(--surface-hover);
  }
}

.history__move:active {
  background: var(--surface-hover);
}

.history__move--active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
</style>
