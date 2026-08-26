<script setup lang="ts">
import { computed } from 'vue'

import type { EloRating } from '@chess/shared/ai'
import { useI18n } from '../i18n/index.ts'
import OpponentPicker from './OpponentPicker.vue'
import type { GameMode } from '../composables/useChessGame.ts'
import type { Color } from '@chess/shared/types'

const { t } = useI18n()

const mode = defineModel<GameMode>('mode', { required: true })
const elo = defineModel<EloRating>('elo', { required: true })

defineProps<{
  humanColor: Color | null
  canUndo: boolean
  busy: boolean
  /** Pertandingan sudah berjalan, jadi lawannya tidak boleh diganti lagi. */
  setupLocked: boolean
  /** Cuma dibaca di sini (tombol Undo dinonaktifkan bila mati) — sakelarnya sendiri ada di SettingsMenu. */
  undoEnabled: boolean
}>()

const emit = defineEmits<{
  reset: []
  undo: []
  flip: []
  playAs: [color: Color]
}>()

/*
 * Nilai mode tetap 'lawan-komputer'/'dua-pemain' — itu tipe internal, bukan
 * teks. Yang berganti bahasa hanya labelnya, karena itu keduanya `computed`.
 */
const MODES = computed<{ value: GameMode; label: string }[]>(() => [
  { value: 'lawan-komputer', label: t('controls.vsComputer') },
  { value: 'dua-pemain', label: t('controls.twoPlayers') }
])

/*
 * Daftar lawannya sendiri hidup di OpponentPicker; di sini hanya disambungkan.
 * Nama karakter dan warnanya ada di `src/opponents.ts`, keterangan tingkatnya
 * di kamus i18n, dan kekuatan sesungguhnya tetap di `STRENGTH_PROFILES` milik
 * shared — tiga hal berbeda yang memang tidak perlu saling tahu.
 */
</script>

<template>
  <section class="controls">
    <div class="field">
      <span class="field__label">{{ t('controls.mode') }}</span>
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
        <OpponentPicker v-model="elo" :locked="setupLocked" />
        <!-- Saat terkunci, keterangan kuncinya yang berguna; catatan Elo bisa menunggu. -->
        <p v-if="!setupLocked" class="note">{{ t('controls.eloNote') }}</p>
      </div>

      <div class="field">
        <span class="field__label">{{ t('controls.playAs') }}</span>
        <div class="segmented">
          <button
            type="button"
            class="segmented__item"
            :class="{ 'segmented__item--on': humanColor === 'w' }"
            :disabled="setupLocked"
            @click="emit('playAs', 'w')"
          >
            {{ t('color.w') }}
          </button>
          <button
            type="button"
            class="segmented__item"
            :class="{ 'segmented__item--on': humanColor === 'b' }"
            :disabled="setupLocked"
            @click="emit('playAs', 'b')"
          >
            {{ t('color.b') }}
          </button>
        </div>
      </div>

      <!-- Satu keterangan untuk satu kunci, ditaruh setelah kedua hal yang
           dikuncinya — bukan diulang dua kali di atas masing-masing. -->
      <p v-if="setupLocked" class="note note--lock">{{ t('controls.setupLocked') }}</p>
    </template>

    <div class="buttons">
      <button type="button" class="btn btn--primary" @click="emit('reset')">
        {{ t('controls.newGame') }}
      </button>
      <button type="button" class="btn" :disabled="!canUndo || busy || !undoEnabled" @click="emit('undo')">
        {{ t('controls.undo') }}
      </button>
      <button type="button" class="btn" @click="emit('flip')">{{ t('board.flip') }}</button>
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

.segmented__item:hover:not(:disabled) {
  color: var(--text);
}

.segmented__item:disabled {
  cursor: not-allowed;
}

/* Yang sedang dipakai tetap terbaca penuh; hanya pilihan lain yang meredup. */
.segmented__item:disabled:not(.segmented__item--on) {
  opacity: 0.42;
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

/* Keterangan kunci menjelaskan dua kontrol di atasnya sekaligus; diberi garis
   tepi supaya terbaca sebagai sebab, bukan sebagai catatan kaki lepas. */
.note--lock {
  margin-top: 0.15rem;
  padding-left: 0.55rem;
  border-left: 2px solid var(--border);
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
