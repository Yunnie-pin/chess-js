<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'



interface Row {
  number: number
  white?: { san: string }
  black?: { san: string }
}

const props = defineProps<{ rows: Row[]; plyCount: number }>()

const listEl = ref<HTMLElement | null>(null)

// Selalu perlihatkan langkah terakhir tanpa perlu menggulir manual.
watch(
  () => props.plyCount,
  async () => {
    await nextTick()
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <section class="history">
    <h2 class="history__title">Daftar langkah</h2>
    <div ref="listEl" class="history__scroll">
      <p v-if="!rows.length" class="history__empty">Belum ada langkah.</p>
      <table v-else class="history__table">
        <tbody>
          <tr v-for="row in rows" :key="row.number">
            <td class="history__number">{{ row.number }}.</td>
            <td class="history__san">{{ row.white?.san ?? '' }}</td>
            <td class="history__san">{{ row.black?.san ?? '' }}</td>
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
  min-height: 0;
  flex: 1;
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
  padding: 0.24rem 0.5rem;
  font-family: var(--font-mono);
}
</style>
