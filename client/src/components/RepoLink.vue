<script setup lang="ts">
/**
 * Ajakan berkontribusi ke repositori. Ditaruh di panel supaya kelihatan tanpa
 * mengganggu papan.
 *
 * `rel="noopener noreferrer"` wajib bersama `target="_blank"`: tanpa itu halaman
 * tujuan bisa mengakses `window.opener` dan mengarahkan ulang tab ini.
 */
import { useI18n } from '../i18n/index.ts'

const { t } = useI18n()

const REPO_URL = 'https://github.com/Yunnie-pin/chess-js'
</script>

<template>
  <a class="repo" :href="REPO_URL" target="_blank" rel="noopener noreferrer">
    <svg class="repo__mark" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
           -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
           .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
           -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09
           2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82
           2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
           2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
    <span class="repo__text">
      <strong>{{ t('repo.title') }}</strong>
      <span class="repo__sub">{{ t('repo.subtitle') }}</span>
    </span>
    <svg class="repo__arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M6 3.5h6.5V10M12.5 3.5 3.5 12.5"
      />
    </svg>
  </a>
</template>

<style scoped>
/* inline-flex, bukan flex: kartunya menyusut seukuran isinya supaya bisa
   ditaruh di tengah, bukan melar selebar wadahnya. */
.repo {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  max-width: 100%;
  padding: 0.7rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  color: var(--text);
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

.repo:hover,
.repo:focus-visible {
  background: var(--surface-hover);
  border-color: var(--accent);
}

.repo__mark {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  color: var(--accent);
}

.repo__text {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.repo__text strong {
  font-size: 0.84rem;
  font-weight: 600;
}

.repo__sub {
  font-size: 0.7rem;
  color: var(--text-muted);
  line-height: 1.3;
}

.repo__arrow {
  width: 0.8rem;
  height: 0.8rem;
  flex-shrink: 0;
  color: var(--text-muted);
  transition: color 0.15s, transform 0.15s;
}

.repo:hover .repo__arrow {
  color: var(--accent);
  transform: translate(1px, -1px);
}

@media (prefers-reduced-motion: reduce) {
  .repo__arrow {
    transition: color 0.15s;
  }

  .repo:hover .repo__arrow {
    transform: none;
  }
}
</style>
