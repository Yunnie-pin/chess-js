<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import ChessPiece from './ChessPiece.vue'
import { FILES, colorOf, fileOf, isLightSquare, rankOf } from '@chess/shared/chess'
import { useI18n } from '../i18n/index.ts'
import type { Color, Move, Piece, Square } from '@chess/shared/types'

const { t } = useI18n()

const props = defineProps<{
  board: (Piece | null)[]
  orientation: Color
  selected: Square | null
  targets: Map<Square, Move[]>
  lastMove: Move | null
  checkSquare: Square | null
  /** Warna yang boleh digerakkan manusia sekarang, atau null bila papan terkunci. */
  playable: Color | null
  /** Warna yang boleh menyiapkan premove sekarang, atau null bila tidak berlaku. */
  premoveColor: Color | null
  /** Langkah-langkah premove yang sedang diantre, untuk sorotan — bisa lebih dari satu. */
  premoveQueue: { from: Square; to: Square }[]
  /** Langkah premove yang baru saja gagal, untuk kedipan merah sesaat. */
  premoveFailed: { from: Square; to: Square } | null
  showHints: boolean
}>()

const emit = defineEmits<{
  activate: [square: Square]
  drop: [from: Square, to: Square]
  rightClick: []
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

interface RightDragState {
  from: Square
  pointerId: number
  moved: boolean
}
const rightDrag = ref<RightDragState | null>(null)
/** Anotasi papan (panah dan tanda petak), digambar lewat klik kanan — murni lokal, tidak memengaruhi permainan. */
const arrows = ref<{ from: Square; to: Square }[]>([])
const marks = ref<Set<Square>>(new Set())

/** Urutan petak yang digambar: dari sudut pandang pemain yang sedang melihat. */
const squares = computed<Square[]>(() => {
  const list = Array.from({ length: 64 }, (_, index) => index)
  return props.orientation === 'w' ? list : list.reverse()
})

const isLight = isLightSquare

const canGrab = (square: Square): boolean => {
  const piece = props.board[square]
  if (!piece) return false
  if (props.playable && colorOf(piece) === props.playable) return true
  return !!props.premoveColor && colorOf(piece) === props.premoveColor
}

const isCapture = (square: Square): boolean =>
  !!props.board[square] || (props.targets.get(square)?.[0]?.enPassant ?? false)

const isPremoveSquare = (square: Square): boolean =>
  props.premoveQueue.some((step) => step.from === square || step.to === square)

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
  if (event.button === 2) {
    event.preventDefault()
    emit('rightClick')
    rightDrag.value = { from: square, pointerId: event.pointerId, moved: false }
    window.addEventListener('pointermove', onRightPointerMove)
    window.addEventListener('pointerup', onRightPointerUp)
    window.addEventListener('pointercancel', endRightDrag)
    return
  }
  if (event.button !== 0) return

  // Klik kiri membersihkan anotasi papan, seperti pada situs catur pada umumnya.
  if (arrows.value.length || marks.value.size) {
    arrows.value = []
    marks.value.clear()
  }

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

function onRightPointerMove(event: PointerEvent): void {
  const state = rightDrag.value
  if (!state || event.pointerId !== state.pointerId) return
  const target = squareFromPoint(event.clientX, event.clientY)
  if (target !== null && target !== state.from) state.moved = true
}

function onRightPointerUp(event: PointerEvent): void {
  const state = rightDrag.value
  if (!state || event.pointerId !== state.pointerId) return
  const target = squareFromPoint(event.clientX, event.clientY)
  if (target !== null) {
    if (state.moved && target !== state.from) toggleArrow(state.from, target)
    else toggleMark(state.from)
  }
  endRightDrag()
}

function endRightDrag(): void {
  rightDrag.value = null
  window.removeEventListener('pointermove', onRightPointerMove)
  window.removeEventListener('pointerup', onRightPointerUp)
  window.removeEventListener('pointercancel', endRightDrag)
}

/** Menggambar ulang panah yang sudah ada menghapusnya — cara umum di situs catur untuk membatalkan satu panah. */
function toggleArrow(from: Square, to: Square): void {
  const index = arrows.value.findIndex((arrow) => arrow.from === from && arrow.to === to)
  if (index >= 0) arrows.value.splice(index, 1)
  else arrows.value.push({ from, to })
}

function toggleMark(square: Square): void {
  if (marks.value.has(square)) marks.value.delete(square)
  else marks.value.add(square)
}

/** Titik tengah petak dalam persen (0-100), mengikuti orientasi papan — dasar untuk menggambar panah. */
function squareCenter(square: Square): { x: number; y: number } {
  const row = props.orientation === 'w' ? rankOf(square) : 7 - rankOf(square)
  const col = props.orientation === 'w' ? fileOf(square) : 7 - fileOf(square)
  return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 }
}

/** Ujung panah dipendekkan sedikit supaya tidak menusuk ke tengah bidak tujuan. */
function arrowTip(from: Square, to: Square): { x: number; y: number } {
  const start = squareCenter(from)
  const end = squareCenter(to)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const shorten = 4.5
  return { x: end.x - (dx / len) * shorten, y: end.y - (dy / len) * shorten }
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

onBeforeUnmount(() => {
  endDrag()
  endRightDrag()
})

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
      :aria-label="t('board.ariaLabel')"
      @contextmenu.prevent
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
          'square--premove': isPremoveSquare(square),
          'square--premove-failed':
            square === props.premoveFailed?.from || square === props.premoveFailed?.to,
          'square--marked': marks.has(square),
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

      <svg v-if="arrows.length" class="arrows-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker
            id="premove-arrowhead"
            markerWidth="3"
            markerHeight="3"
            refX="2.4"
            refY="1.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L3,1.5 L0,3 Z" />
          </marker>
        </defs>
        <line
          v-for="(arrow, index) in arrows"
          :key="index"
          :x1="squareCenter(arrow.from).x"
          :y1="squareCenter(arrow.from).y"
          :x2="arrowTip(arrow.from, arrow.to).x"
          :y2="arrowTip(arrow.from, arrow.to).y"
          marker-end="url(#premove-arrowhead)"
        />
      </svg>
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
.square--check::before,
.square--premove::before,
.square--premove-failed::before,
.square--marked::before {
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
  background: radial-gradient(circle, var(--danger) 0%, var(--danger-fade) 72%);
}

/* Langkah yang sudah diantre (premove), menunggu giliran sendiri tiba. */
.square--premove::before {
  background: rgba(88, 140, 255, 0.32);
  box-shadow: inset 0 0 0 3px rgba(88, 140, 255, 0.8);
}

/* Kedip merah sesaat saat premove ternyata sudah tidak legal begitu dieksekusi. */
.square--premove-failed::before {
  background: rgba(239, 68, 68, 0.55);
  animation: premove-fail-flash 650ms ease-out;
}

@keyframes premove-fail-flash {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* Tanda petak dari klik kanan — murni anotasi, tidak memengaruhi permainan. */
.square--marked::before {
  background: var(--accent);
  opacity: 0.35;
}

.arrows-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.arrows-layer line {
  stroke: var(--accent);
  stroke-width: 3.2;
  stroke-linecap: round;
  opacity: 0.85;
}

.arrows-layer marker path {
  fill: var(--accent);
}

.hint {
  position: absolute;
  pointer-events: none;
}

.hint--move {
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background: var(--hint);
}

.hint--capture {
  inset: 6%;
  border-radius: 50%;
  border: 6px solid var(--hint);
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
