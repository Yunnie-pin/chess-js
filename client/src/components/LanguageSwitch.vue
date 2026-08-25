<script setup lang="ts">
/**
 * Pemilih bahasa. Singkatan yang tampil ("ID"/"EN") sengaja tidak diterjemahkan
 * — pemain yang tersesat di bahasa yang salah harus tetap mengenali jalan
 * pulang, dan nama bahasa selalu ditulis dalam bahasanya sendiri.
 */
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT, useI18n } from '../i18n/index.ts'

const { t, locale, setLocale } = useI18n()
</script>

<template>
  <div class="lang" role="group" :aria-label="t('app.language')">
    <button
      v-for="option in LOCALES"
      :key="option"
      type="button"
      class="lang__item"
      :class="{ 'lang__item--on': locale === option }"
      :lang="option"
      :title="LOCALE_LABELS[option]"
      :aria-pressed="locale === option"
      @click="setLocale(option)"
    >
      {{ LOCALE_SHORT[option] }}
    </button>
  </div>
</template>

<style scoped>
.lang {
  display: flex;
  gap: 0.2rem;
  padding: 0.22rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.lang__item {
  padding: 0.4rem 0.55rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: none;
  border: none;
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.lang__item:hover {
  color: var(--text);
}

.lang__item--on {
  background: var(--accent);
  color: var(--on-accent);
}
</style>
