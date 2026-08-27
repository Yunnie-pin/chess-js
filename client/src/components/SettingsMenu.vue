<script setup lang="ts">
/**
 * Menu pengaturan global: bantuan bermain (petunjuk langkah, premove, undo)
 * yang berlaku di kedua mode (offline dan online), makanya ditaruh di header
 * — bukan di panel kendali lokal, yang cuma tampil saat offline. Sebelum ini
 * ketiganya tinggal di panel itu, jadi tidak bisa diubah sama sekali selagi
 * main online.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n/index.ts'

const { t } = useI18n()

const showHints = defineModel<boolean>('showHints', { required: true })
const premoveEnabled = defineModel<boolean>('premoveEnabled', { required: true })
const undoEnabled = defineModel<boolean>('undoEnabled', { required: true })
const showEvalBar = defineModel<boolean>('showEvalBar', { required: true })
const showSuggestion = defineModel<boolean>('showSuggestion', { required: true })

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}

/** Klik di luar menunya sendiri menutup — pola dropdown yang umum. */
function onDocumentPointerDown(event: PointerEvent): void {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="settings">
    <button
      type="button"
      class="settings__trigger"
      :class="{ 'settings__trigger--on': open }"
      :aria-expanded="open"
      :aria-label="t('settings.title')"
      @click="toggle"
    >
      <svg
        class="settings__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65
             1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65
             0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65
             1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0
             0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65
             0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1
             1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0
             0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0
             0-1.51 1z"
        />
      </svg>
    </button>

    <div v-if="open" class="settings__panel" role="menu">
      <span class="settings__heading">{{ t('controls.playAids') }}</span>
      <label class="switch">
        <input v-model="showHints" type="checkbox" />
        <span>{{ t('controls.showHints') }}</span>
      </label>
      <label class="switch">
        <input v-model="premoveEnabled" type="checkbox" />
        <span>{{ t('controls.premove') }}</span>
      </label>
      <label class="switch">
        <input v-model="undoEnabled" type="checkbox" />
        <span>{{ t('controls.undoEnabled') }}</span>
      </label>
      <label class="switch">
        <input v-model="showEvalBar" type="checkbox" />
        <span>{{ t('controls.evalBar') }}</span>
      </label>
      <label class="switch">
        <input v-model="showSuggestion" type="checkbox" />
        <span>{{ t('controls.suggestionArrow') }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.settings {
  position: relative;
}

.settings__trigger {
  display: grid;
  place-items: center;
  width: 2.35rem;
  height: 2.35rem;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.settings__trigger:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.settings__trigger--on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.settings__icon {
  width: 1.15rem;
  height: 1.15rem;
}

.settings__panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 13rem;
  padding: 0.75rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.4);
}

.settings__heading {
  font-size: 0.7rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
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
</style>
