<script setup lang="ts">
import { computed } from 'vue'

import { colorOf, typeOf } from '@chess/shared/chess'
import { useI18n } from '../i18n/index.ts'
import type { Piece, PieceType } from '@chess/shared/types'

const { t } = useI18n()

const props = defineProps<{ piece: Piece }>()

/**
 * Glyph "isi penuh" dipakai untuk kedua warna, lalu dibedakan lewat CSS. Kalau
 * memakai pasangan outline (♔) dan solid (♚), kedua set sering datang dari font
 * berbeda sehingga tebal garis dan tingginya tidak seragam.
 */
const GLYPHS: Record<PieceType, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟'
}

const type = computed(() => typeOf(props.piece))
const color = computed(() => colorOf(props.piece))

/*
 * Urutan nama bidak dan warnanya berbeda antar bahasa — "Menteri Putih" tapi
 * "White Queen" — jadi susunannya ikut kamus, bukan dirangkai di sini.
 */
const label = computed(() =>
  t('piece.ariaLabel', { piece: t(`piece.${type.value}`), color: t(`color.${color.value}`) })
)
</script>

<template>
  <span class="piece" :class="`piece--${color}`" role="img" :aria-label="label">
    {{ GLYPHS[type] }}
  </span>
</template>

<style scoped>
.piece {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  /* Relatif terhadap ukuran petak yang diwariskan induknya. */
  font-size: 0.85em;
  line-height: 1;
  user-select: none;
  -webkit-user-select: none;
  font-family: 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', 'DejaVu Sans', sans-serif;
}

.piece--w {
  color: var(--piece-light);
  -webkit-text-stroke: 1.6px var(--piece-light-stroke);
  text-shadow: 0 2px 3px rgb(0 0 0 / 0.35);
}

.piece--b {
  color: var(--piece-dark);
  -webkit-text-stroke: 1.1px var(--piece-dark-stroke);
  text-shadow: 0 2px 3px rgb(0 0 0 / 0.3);
}
</style>
