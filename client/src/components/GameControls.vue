<script setup lang="ts">
import { computed } from 'vue'

import type { EloRating } from '@chess/shared/ai'
import { useI18n } from '../i18n/index.ts'
import OpponentPicker from './OpponentPicker.vue'
import { opponentFor } from '../opponents.ts'
import type { GameMode, GamePhase } from '../composables/useChessGame.ts'
import type { Color } from '@chess/shared/types'

const { t } = useI18n()

const mode = defineModel<GameMode>('mode', { required: true })
const elo = defineModel<EloRating>('elo', { required: true })

const props = defineProps<{
  humanColor: Color | null
  canUndo: boolean
  busy: boolean
  /** Pertandingan sudah berjalan, jadi lawannya tidak boleh diganti lagi. */
  setupLocked: boolean
  phase: GamePhase
  /** Cuma dibaca di sini (tombol Undo dinonaktifkan bila mati) — sakelarnya sendiri ada di SettingsMenu. */
  undoEnabled: boolean
}>()

const emit = defineEmits<{
  reset: []
  start: []
  undo: []
  flip: []
  playAs: [color: Color]
}>()

/** Di fase penyiapan tombol utamanya "Mulai"; selebihnya "Permainan baru". */
const inSetup = computed(() => props.phase === 'setup')
/**
 * Sesudah partai usai (atau partai impor dibuka) semua pilihan penyiapan toh
 * terkunci — menampilkannya penuh cuma mendorong panel ulasan ke bawah layar.
 * Diringkas jadi satu baris; "Permainan baru" membuka semuanya lagi.
 */
const compact = computed(() => props.phase === 'finished' || props.phase === 'analysis')

const summary = computed(() => {
  if (props.phase === 'analysis') return t('controls.summaryImported')
  if (mode.value === 'dua-pemain') return t('controls.twoPlayers')
  const parts = [`${opponentFor(elo.value).name} · ${elo.value}`]
  if (props.humanColor) parts.push(t('controls.summaryAs', { color: t(`color.${props.humanColor}`) }))
  return parts.join(' · ')
})

const onPrimary = (): void => {
  if (inSetup.value) emit('start')
  else emit('reset')
}

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
    <p v-if="compact" class="summary">{{ summary }}</p>

    <template v-else>
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
    </template>

    <div class="buttons">
      <button type="button" class="btn btn--primary" @click="onPrimary">
        {{ inSetup ? t('controls.startGame') : t('controls.newGame') }}
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

/* `.field`, `.field__label`, `.segmented*`, dan `.btn*` ada di assets/ui.css —
   dipakai bersama komponen lain, lihat catatannya di sana. */

.summary {
  margin: 0;
  padding: 0.5rem 0.65rem;
  font-size: 0.82rem;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
