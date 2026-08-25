<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import ChessPiece from './ChessPiece.vue'
import { FILES, colorOf, fileOf, isLightSquare, rankOf } from '@chess/shared/chess'
import type { Color, Move, Piece, Square } from '@chess/shared/types'

const props = defineProps<{
  board: (Piece | null)[]
  orientation: Color
  selected: Square | null
  targets: Map<Square, Move[]>
  lastMove: Move | null
  checkSquare: Square | null
  /** Warna yang boleh digerakkan manusia sekarang, atau null bila papan terkunci. */
  playable: Color | null
  showHints: boolean
}>()

const emit = defineEmits<{
  activate: [square: Square]
  drop: [from: Square, to: Square]
}>()

const boardEl = ref<HTMLElement | null>(null)

interface DragState {
  from: Square
  piece: Piece
  x: number
  y: number
  pointerId: number
  moved: boolean
}
const drag = ref<DragState | null>(null)

/** Urutan petak yang digambar: dari sudut pandang pemain yang sedang melihat. */
const squares = computed<Square[]>(() => {
  const list = Array.from({ length: 64 }, (_, index) => index)
  return props.orientation === 'w' ? list : list.reverse()
})

const isLight = isLightSquare

const canGrab = (square: Square): boolean => {
  const piece = props.board[square]
  return !!piece && !!props.playable && colorOf(piece) === props.playable
}

const isCapture = (square: Square): boolean =>
  !!props.board[square] || (props.targets.get(square)?.[0]?.enPassant ?? false)

/** Label koordinat hanya di tepi papan, seperti papan sungguhan. */
const fileLabel = (square: Square): string | null => {
  const bottomRank = props.orientation === 'w' ? 7 : 0
  return rankOf(square) === bottomRank ? FILES[fileOf(square)] : null
}

const rankLabel = (square: Square): string | null => {
  const leftFile = props.orientation === 'w' ? 0 : 7
  return fileOf(square) === leftFile ? String(8 - rankOf(square)) : null
}

const squareSize = (): number => (boardEl.value?.getBoundingClientRect().width ?? 0) / 8

function squareFromPoint(clientX: number, clientY: number): Square | null {
  const rect = boardEl.value?.getBoundingClientRect()
  if (!rect) return null
  const size = rect.width / 8
  const column = Math.floor((clientX - rect.left) / size)
  const row = Math.floor((clientY - rect.top) / size)
  if (column < 0 || column > 7 || row < 0 || row > 7) return null
  return props.orientation === 'w' ? row * 8 + column : (7 - row) * 8 + (7 - column)
}

function onPointerDown(square: Square, event: PointerEvent): void {
  if (event.button !== 0) return
  emit('activate', square)

  const piece = props.board[square]
  if (!piece || !canGrab(square)) return

  event.preventDefault()
  drag.value = {
    from: square,
    piece,
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
    moved: false
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', endDrag)
}

function onPointerMove(event: PointerEvent): void {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return
  state.x = event.clientX
  state.y = event.clientY
  state.moved = true
}

function onPointerUp(event: PointerEvent): void {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return
  // Klik tanpa geser sudah ditangani oleh 'activate' pada pointerdown.
  if (state.moved) {
    const target = squareFromPoint(event.clientX, event.clientY)
    if (target !== null) emit('drop', state.from, target)
  }
  endDrag()
}

function endDrag(): void {
  drag.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', endDrag)
}

onBeforeUnmount(endDrag)

/** Bidak yang sedang diseret mengikuti kursor, jadi dilepas dari alur papan. */
const dragStyle = computed(() => {
  const state = drag.value
  if (!state || !state.moved) return undefined
  const size = squareSize()
  return {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${size}px`,
    transform: `translate(${state.x - size / 2}px, ${state.y - size / 2}px)`
  }
})
</script>

<template>
  <div class="board-wrap">
    <div
      ref="boardEl"
      class="board"
      :class="{ 'board--dragging': drag?.moved }"
      role="grid"
      aria-label="Papan catur"
    >
      <div
        v-for="square in squares"
        :key="square"
        class="square"
        :class="{
          'square--light': isLight(square),
          'square--dark': !isLight(square),
          'square--selected': square === props.selected,
          'square--last': square === props.lastMove?.from || square === props.lastMove?.to,
          'square--check': square === props.checkSquare,
          'square--grabbable': canGrab(square)
        }"
        role="gridcell"
        @pointerdown="onPointerDown(square, $event)"
      >
        <span v-if="rankLabel(square)" class="coord coord--rank">{{ rankLabel(square) }}</span>
        <span v-if="fileLabel(square)" class="coord coord--file">{{ fileLabel(square) }}</span>

        <template v-if="props.showHints && props.targets.has(square)">
          <span v-if="isCapture(square)" class="hint hint--capture" />
          <span v-else class="hint hint--move" />
        </template>

        <ChessPiece
          v-if="props.board[square]"
          :piece="props.board[square]!"
          :class="{ 'piece--ghost': drag?.moved && drag.from === square }"
        />
      </div>
    </div>

    <ChessPiece v-if="drag?.moved" class="drag-layer" :piece="drag.piece" :style="dragStyle" />
  </div>
</template>

<style scoped>
.board-wrap {
  position: relative;
  width: 100%;
}

.board {
  display: grid;
  /* Baris HARUS ditulis eksplisit: tanpa ini baris implisit diukur dari isinya,
     dan rank yang kosong sama sekali akan mengempis lebih pendek dari yang lain. */
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  aspect-ratio: 1;
  width: 100%;
  /* Jadi acuan satuan cqw, supaya bidak menskala mengikuti lebar papan. */
  container-type: inline-size;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: 0 18px 40px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(255 255 255 / 0.06);
  touch-action: none;
}

.board--dragging {
  cursor: grabbing;
}

.square {
  position: relative;
  display: grid;
  place-items: center;
  /* 12.5cqw = seperdelapan lebar papan = tepat satu petak. Bidak lalu mengambil
     0.85em dari angka itu, jadi ukurannya selalu proporsional terhadap papan —
     dan sama persis dengan bidak yang sedang diseret. */
  font-size: 12.5cqw;
}

.square--light {
  background: var(--square-light);
}

.square--dark {
  background: var(--square-dark);
}

.square--grabbable {
  cursor: grab;
}

.board--dragging .square--grabbable {
  cursor: grabbing;
}

/* Sorotan dipasang sebagai lapisan agar warna dasar petak tetap terlihat. */
.square--last::before,
.square--selected::before,
.square--check::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.square--last::before {
  background: var(--highlight-last);
}

.square--selected::before {
  background: var(--highlight-selected);
  box-shadow: inset 0 0 0 3px var(--accent);
}

.square--check::before {
  background: radial-gradient(circle, var(--danger) 0%, rgb(220 38 38 / 0) 72%);
}

.hint {
  position: absolute;
  pointer-events: none;
}

.hint--move {
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background: rgb(20 24 30 / 0.32);
}

.hint--capture {
  inset: 6%;
  border-radius: 50%;
  border: 6px solid rgb(20 24 30 / 0.3);
}

.coord {
  position: absolute;
  font-size: 0.16em;
  font-weight: 700;
  opacity: 0.62;
  pointer-events: none;
  user-select: none;
}

.square--light .coord {
  color: var(--square-dark);
}

.square--dark .coord {
  color: var(--square-light);
}

.coord--rank {
  top: 4%;
  left: 5%;
}

.coord--file {
  right: 6%;
  bottom: 2%;
}

.piece--ghost {
  opacity: 0.28;
}

.drag-layer {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 40;
  pointer-events: none;
  filter: drop-shadow(0 8px 12px rgb(0 0 0 / 0.5));
}
</style>
