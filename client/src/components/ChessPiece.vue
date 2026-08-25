<script setup lang="ts">
import { computed } from 'vue'

import { colorOf, typeOf } from '@chess/shared/chess'
import type { Piece, PieceType } from '@chess/shared/types'

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

const NAMES: Record<PieceType, string> = {
  k: 'Raja',
  q: 'Menteri',
  r: 'Benteng',
  b: 'Gajah',
  n: 'Kuda',
  p: 'Pion'
}

const type = computed(() => typeOf(props.piece))
const color = computed(() => colorOf(props.piece))
const label = computed(() => `${NAMES[type.value]} ${color.value === 'w' ? 'Putih' : 'Hitam'}`)
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
  color: #fbfbf8;
  -webkit-text-stroke: 1.6px #2b3038;
  text-shadow: 0 2px 3px rgb(0 0 0 / 0.35);
}

.piece--b {
  color: #2a2e36;
  -webkit-text-stroke: 1.1px #14171c;
  text-shadow: 0 2px 3px rgb(0 0 0 / 0.3);
}
</style>
