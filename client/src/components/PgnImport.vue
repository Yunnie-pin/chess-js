<script setup lang="ts">
/**
 * Impor PGN: tombol yang membuka kotak tempel. Penguraiannya di
 * `gameRecord.ts` (murni, diuji); di sini hanya kotak teks, pesan galat, dan
 * meneruskan hasil yang sah ke App — yang memuatnya ke fase `analysis`.
 */
import { ref } from 'vue'

import { useI18n } from '../i18n/index.ts'
import { parsePgn, type PgnParseResult } from '../engine/gameRecord.ts'

const { t } = useI18n()

const emit = defineEmits<{ load: [game: Extract<PgnParseResult, { ok: true }>] }>()

const open = ref(false)
const text = ref('')
const error = ref<string | null>(null)

function load(): void {
  const parsed = parsePgn(text.value)
  if (!parsed.ok) {
    error.value =
      parsed.error === 'illegal'
        ? t('import.error.illegal', { ply: parsed.ply ?? 0, san: parsed.san ?? '' })
        : t(`import.error.${parsed.error}`)
    return
  }
  emit('load', parsed)
  close()
}

function close(): void {
  open.value = false
  text.value = ''
  error.value = null
}
</script>

<template>
  <section class="import">
    <button v-if="!open" type="button" class="btn" @click="open = true">{{ t('import.open') }}</button>

    <template v-else>
      <label class="field">
        <span class="field__label">{{ t('import.label') }}</span>
        <textarea
          v-model="text"
          class="import__text"
          rows="6"
          spellcheck="false"
          :placeholder="t('import.placeholder')"
          @input="error = null"
        />
      </label>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <div class="import__buttons">
        <button type="button" class="btn btn--primary" :disabled="!text.trim()" @click="load">
          {{ t('import.load') }}
        </button>
        <button type="button" class="btn" @click="close">{{ t('import.cancel') }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.import {
  display: grid;
  gap: 0.5rem;
}

.import__text {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  resize: vertical;
}

.import__text:focus {
  outline: none;
  border-color: var(--accent);
}

.import__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
</style>
