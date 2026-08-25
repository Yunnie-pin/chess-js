<script setup lang="ts">
import { ELO_LEVELS, STRENGTH_PROFILES } from '@chess/shared/ai'
import type { EloRating } from '@chess/shared/ai'
import type { GameMode } from '../composables/useChessGame.ts'
import type { Color } from '@chess/shared/types'

const mode = defineModel<GameMode>('mode', { required: true })
const elo = defineModel<EloRating>('elo', { required: true })
const showHints = defineModel<boolean>('showHints', { required: true })

defineProps<{ humanColor: Color | null; canUndo: boolean; busy: boolean }>()

const emit = defineEmits<{
  reset: []
  undo: []
  flip: []
  playAs: [color: Color]
}>()

const MODES: { value: GameMode; label: string }[] = [
  { value: 'lawan-komputer', label: 'Lawan komputer' },
  { value: 'dua-pemain', label: 'Dua pemain' }
]

const LEVELS = ELO_LEVELS.map((rating) => ({
  value: rating,
  label: `${rating} — ${STRENGTH_PROFILES[rating].label}`
}))
</script>

<template>
  <section class="controls">
    <div class="field">
      <span class="field__label">Mode</span>
      <div class="segmented">
        <button
          v-for="option in MODES"
          :key="option.value"
          type="button"
          class="segmented__item"
          :class="{ 'segmented__item--on': mode === option.value }"
          @click="mode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <template v-if="mode === 'lawan-komputer'">
      <div class="field">
        <label class="field__label" for="elo">Kekuatan lawan</label>
        <select id="elo" v-model="elo" class="select">
          <option v-for="option in LEVELS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <p class="note">Angka Elo ini perkiraan, belum dikalibrasi lewat pertandingan.</p>
      </div>

      <div class="field">
        <span class="field__label">Anda bermain sebagai</span>
        <div class="segmented">
          <button
            type="button"
            class="segmented__item"
            :class="{ 'segmented__item--on': humanColor === 'w' }"
            @click="emit('playAs', 'w')"
          >
            Putih
          </button>
          <button
            type="button"
            class="segmented__item"
            :class="{ 'segmented__item--on': humanColor === 'b' }"
            @click="emit('playAs', 'b')"
          >
            Hitam
          </button>
        </div>
      </div>
    </template>

    <label class="switch">
      <input v-model="showHints" type="checkbox" />
      <span>Tampilkan petunjuk langkah</span>
    </label>

    <div class="buttons">
      <button type="button" class="btn btn--primary" @click="emit('reset')">Permainan baru</button>
      <button type="button" class="btn" :disabled="!canUndo || busy" @click="emit('undo')">
        Batalkan langkah
      </button>
      <button type="button" class="btn" @click="emit('flip')">Putar papan</button>
    </div>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.22rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.segmented__item {
  flex: 1;
  padding: 0.42rem 0.5rem;
  font-size: 0.82rem;
  background: none;
  border: none;
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.segmented__item:hover {
  color: var(--text);
}

.segmented__item--on {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.note {
  margin: 0.1rem 0 0;
  font-size: 0.7rem;
  color: var(--text-muted);
  line-height: 1.35;
}

.select {
  padding: 0.5rem 0.6rem;
  font: inherit;
  font-size: 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text);
  cursor: pointer;
}

.switch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  cursor: pointer;
}

.switch input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
  cursor: pointer;
}

.buttons {
  display: grid;
  gap: 0.45rem;
}

.btn {
  padding: 0.6rem 0.8rem;
  font: inherit;
  font-size: 0.86rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

.btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
</style>
