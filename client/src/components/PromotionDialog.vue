<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import ChessPiece from './ChessPiece.vue'
import { PROMOTION_TYPES } from '@chess/shared/chess'
import type { Color, Piece, PromotionType } from '@chess/shared/types'

const props = defineProps<{ color: Color }>()
const emit = defineEmits<{ choose: [type: PromotionType]; cancel: [] }>()

const LABELS: Record<PromotionType, string> = {
  q: 'Menteri',
  r: 'Benteng',
  b: 'Gajah',
  n: 'Kuda'
}

const pieceFor = (type: PromotionType): Piece => `${props.color}${type}`

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Pilih bidak promosi" @click.self="emit('cancel')">
    <div class="dialog">
      <h2 class="dialog__title">Promosi pion</h2>
      <p class="dialog__hint">Pilih bidak pengganti.</p>
      <div class="options">
        <button
          v-for="type in PROMOTION_TYPES"
          :key="type"
          type="button"
          class="option"
          :aria-label="LABELS[type]"
          @click="emit('choose', type)"
        >
          <ChessPiece :piece="pieceFor(type)" />
          <span class="option__label">{{ LABELS[type] }}</span>
        </button>
      </div>
      <button type="button" class="cancel" @click="emit('cancel')">Batal</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: var(--overlay);
  backdrop-filter: blur(3px);
  padding: 1rem;
}

.dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.55);
  max-width: min(28rem, 100%);
}

.dialog__title {
  margin: 0;
  font-size: 1.05rem;
}

.dialog__hint {
  margin: 0.25rem 0 1.1rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.6rem;
}

.option {
  display: grid;
  justify-items: center;
  gap: 0.35rem;
  padding: 0.7rem 0.3rem 0.5rem;
  font-size: 2.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  color: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}

.option:hover,
.option:focus-visible {
  background: var(--surface-hover);
  border-color: var(--accent);
  transform: translateY(-2px);
}

.option__label {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.cancel {
  margin-top: 1rem;
  width: 100%;
  padding: 0.5rem;
  font-size: 0.82rem;
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text-muted);
  cursor: pointer;
}

.cancel:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
</style>
