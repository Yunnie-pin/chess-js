<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import ChessPiece from './ChessPiece.vue'
import { FILES, colorOf, fileOf, isLightSquare, rankOf } from '@chess/shared/chess'
import { useI18n } from '../i18n/index.ts'
import type { Color, Move, Piece, Square } from '@chess/shared/types'

const { t } = useI18n()

/**
 * Warna anotasi (panah/tanda) ditentukan oleh tombol modifier yang ditekan
 * selagi klik kanan — sama seperti kebiasaan di situs catur lain (Shift/Ctrl/
 * Alt). Warnanya tetap (bukan ikut tema karakter aktif) karena maksudnya
 * justru membedakan beberapa ide di papan yang sama, bukan menyatu dengan
 * palet papan.
 */
type AnnotationColor = 'green' | 'red' | 'blue' | 'yellow'
const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  green: '#3aa655',
  red: '#dd3344',
  blue: '#3a7bd5',
  yellow: '#e0a030'
}
const ANNOTATION_COLOR_KEYS = Object.keys(ANNOTATION_COLORS) as AnnotationColor[]

function colorFromModifiers(event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): AnnotationColor {
  if (event.shiftKey) return 'red'
  if (event.ctrlKey) return 'blue'
  if (event.altKey) return 'yellow'
  return 'green'
}

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

/**
 * Bidak yang diseret jari digambar di ATAS titik sentuhnya, bukan tepat di
 * bawahnya — kalau tidak, ujung jari menutupinya sepenuhnya, dan di ponsel satu
 * petak hanya sekitar 44px sementara area sentuh jari menutupi hampir tiga
 * petak. Angkatannya dipatok dalam piksel, bukan pecahan petak: yang harus
 * dilewati adalah ukuran jari, dan itu tidak ikut membesar bersama papan.
 *
 * Petak tujuan dihitung dari titik yang SUDAH diangkat ini juga (lihat
 * `dragPoint`), bukan dari posisi jari mentah. Kalau keduanya dibiarkan
 * berbeda, bidak terlihat melayang di atas satu petak tapi mendarat di petak
 * lain di bawahnya — lebih membingungkan daripada bidak yang tertutup jari.
 */
const TOUCH_LIFT_PX = 44
const TOUCH_DRAG_SCALE = 1.2

/** Geser sejauh ini masih dihitung ketukan, bukan gulir. */
const TAP_SLOP_PX = 10

const boardEl = ref<HTMLElement | null>(null)

interface DragState {
  from: Square
  piece: Piece
  x: number
  y: number
  pointerId: number
  moved: boolean
  pointerType: string
}
const drag = ref<DragState | null>(null)

/**
 * Ketukan pada petak yang TIDAK bisa diseret ditunda sampai `pointerup`.
 *
 * Petak seperti itu sengaja membiarkan halaman digulir (lihat `touch-action` di
 * blok style), dan gulir dimulai dengan `pointerdown` yang sama persis dengan
 * ketukan. Kalau `activate` tetap dipancarkan di `pointerdown`, setiap kali
 * pemain menggulir halaman dari atas papan selagi ada bidak terpilih, gulirnya
 * ikut menjalankan langkah. Menunggu sampai jari diangkat — dan memastikan ia
 * nyaris tidak bergeser — memisahkan keduanya. Tetikus tidak lewat sini sama
 * sekali: ia tidak menggulir dengan menyeret, jadi tetap langsung di
 * `pointerdown` supaya terasa seketika.
 */
interface TapState {
  square: Square
  pointerId: number
  x: number
  y: number
}
const tap = ref<TapState | null>(null)

interface RightDragState {
  from: Square
  pointerId: number
  moved: boolean
  color: AnnotationColor
}
const rightDrag = ref<RightDragState | null>(null)
/** Anotasi papan (panah dan tanda petak), digambar lewat klik kanan — murni lokal, tidak memengaruhi permainan. */
const arrows = ref<{ from: Square; to: Square; color: AnnotationColor }[]>([])
const marks = ref<Map<Square, AnnotationColor>>(new Map())

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
    rightDrag.value = {
      from: square,
      pointerId: event.pointerId,
      moved: false,
      color: colorFromModifiers(event)
    }
    window.addEventListener('pointermove', onRightPointerMove)
    window.addEventListener('pointerup', onRightPointerUp)
    window.addEventListener('pointercancel', endRightDrag)
    return
  }
  if (event.button !== 0) return

  // Klik kiri membersihkan anotasi papan, seperti pada situs catur pada umumnya.
  if (arrows.value.length || marks.value.size) clearAnnotations()

  const grabbable = !!props.board[square] && canGrab(square)

  if (event.pointerType === 'touch' && !grabbable) {
    tap.value = {
      square,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    }
    window.addEventListener('pointermove', onTapPointerMove)
    window.addEventListener('pointerup', onTapPointerUp)
    window.addEventListener('pointercancel', endTap)
    return
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
    moved: false,
    pointerType: event.pointerType
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', endDrag)
}

/** Jarak tempuh pointer sejak ketukan dimulai. */
function tapDistance(state: TapState, event: PointerEvent): number {
  return Math.hypot(event.clientX - state.x, event.clientY - state.y)
}

function onTapPointerMove(event: PointerEvent): void {
  const state = tap.value
  if (!state || event.pointerId !== state.pointerId) return
  // Sudah bergeser jauh: ini gulir. Lepaskan, jangan sampai jadi langkah.
  if (tapDistance(state, event) > TAP_SLOP_PX) endTap()
}

function onTapPointerUp(event: PointerEvent): void {
  const state = tap.value
  if (!state || event.pointerId !== state.pointerId) return
  const isTap = tapDistance(state, event) <= TAP_SLOP_PX
  const { square } = state
  endTap()
  if (isTap) emit('activate', square)
}

/** Peramban juga membatalkan sendiri lewat `pointercancel` begitu ia mengambil alih gestur untuk menggulir. */
function endTap(): void {
  tap.value = null
  window.removeEventListener('pointermove', onTapPointerMove)
  window.removeEventListener('pointerup', onTapPointerUp)
  window.removeEventListener('pointercancel', endTap)
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
    if (state.moved && target !== state.from) toggleArrow(state.from, target, state.color)
    else toggleMark(state.from, state.color)
  }
  endRightDrag()
}

function endRightDrag(): void {
  rightDrag.value = null
  window.removeEventListener('pointermove', onRightPointerMove)
  window.removeEventListener('pointerup', onRightPointerUp)
  window.removeEventListener('pointercancel', endRightDrag)
}

/** Menggambar ulang panah yang sama persis (termasuk warnanya) menghapusnya; warna berbeda menggantikannya. */
function toggleArrow(from: Square, to: Square, color: AnnotationColor): void {
  const index = arrows.value.findIndex((arrow) => arrow.from === from && arrow.to === to)
  if (index >= 0) {
    const same = arrows.value[index].color === color
    arrows.value.splice(index, 1)
    if (same) return
  }
  arrows.value.push({ from, to, color })
}

function toggleMark(square: Square, color: AnnotationColor): void {
  if (marks.value.get(square) === color) marks.value.delete(square)
  else marks.value.set(square, color)
}

function clearAnnotations(): void {
  arrows.value = []
  marks.value.clear()
}

/** Dipanggil dari luar (App.vue) saat berpindah ke ply lain — anotasi digambar untuk posisi yang sekarang tampil, bukan untuk posisi manapun. */
defineExpose({ clearAnnotations })

/** Petak dalam baris/kolom layar (0-7), mengikuti orientasi papan. */
function squareRowCol(square: Square): { row: number; col: number } {
  const row = props.orientation === 'w' ? rankOf(square) : 7 - rankOf(square)
  const col = props.orientation === 'w' ? fileOf(square) : 7 - fileOf(square)
  return { row, col }
}

/** Titik tengah sebuah baris/kolom layar, dalam persen (0-100). */
function centerOf(row: number, col: number): { x: number; y: number } {
  return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 }
}

/** Titik tengah petak dalam persen (0-100), mengikuti orientasi papan. */
function squareCenter(square: Square): { x: number; y: number } {
  const { row, col } = squareRowCol(square)
  return centerOf(row, col)
}

/** Geser sebuah titik ke arah titik lain sejauh `amount` — dipakai supaya ujung panah tidak menusuk ke tengah bidak. */
function shortenTowards(
  from: { x: number; y: number },
  to: { x: number; y: number },
  amount: number
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return { x: to.x - (dx / len) * amount, y: to.y - (dy / len) * amount }
}

/** Perpindahan berpola kuda (1,2) murni dari geometrinya — tidak peduli bidak apa yang sungguhan ada di sana. */
function isKnightShape(from: Square, to: Square): boolean {
  const dr = Math.abs(rankOf(to) - rankOf(from))
  const df = Math.abs(fileOf(to) - fileOf(from))
  return (dr === 1 && df === 2) || (dr === 2 && df === 1)
}

/**
 * Titik tekuk sebuah panah kuda: penuh dulu di sumbu yang bergerak 2 petak,
 * baru menyamping — persis lintasan kuda melompat, bukan garis lurus yang
 * gampang terbaca sebagai langkah gajah/menteri.
 */
function knightBend(from: Square, to: Square): { x: number; y: number } {
  const a = squareRowCol(from)
  const b = squareRowCol(to)
  const bendRow = Math.abs(b.row - a.row) === 2 ? b.row : a.row
  const bendCol = Math.abs(b.col - a.col) === 2 ? b.col : a.col
  return centerOf(bendRow, bendCol)
}

/** Titik-titik SVG untuk satu panah — dua titik untuk garis lurus, tiga (dengan tekukan) untuk langkah kuda. */
function arrowPoints(arrow: { from: Square; to: Square }): string {
  const start = squareCenter(arrow.from)
  if (isKnightShape(arrow.from, arrow.to)) {
    const bend = knightBend(arrow.from, arrow.to)
    const tip = shortenTowards(bend, squareCenter(arrow.to), 4.5)
    return `${start.x},${start.y} ${bend.x},${bend.y} ${tip.x},${tip.y}`
  }
  const tip = shortenTowards(start, squareCenter(arrow.to), 4.5)
  return `${start.x},${start.y} ${tip.x},${tip.y}`
}

function onPointerMove(event: PointerEvent): void {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return
  state.x = event.clientX
  state.y = event.clientY
  state.moved = true
}

/**
 * Titik acuan seret: posisi pointer, diangkat bila itu jari.
 *
 * Satu fungsi untuk dua pemakaian — menggambar bidaknya dan menentukan petak
 * tujuannya — supaya yang terlihat dan yang terjadi tidak mungkin berbeda.
 */
function dragPoint(state: DragState): { x: number; y: number } {
  return { x: state.x, y: state.y - (state.pointerType === 'touch' ? TOUCH_LIFT_PX : 0) }
}

function onPointerUp(event: PointerEvent): void {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return
  // Klik tanpa geser sudah ditangani oleh 'activate' pada pointerdown.
  if (state.moved) {
    state.x = event.clientX
    state.y = event.clientY
    const point = dragPoint(state)
    const target = squareFromPoint(point.x, point.y)
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
  endTap()
  endRightDrag()
})

/** Bidak yang sedang diseret mengikuti kursor, jadi dilepas dari alur papan. */
const dragStyle = computed(() => {
  const state = drag.value
  if (!state || !state.moved) return undefined
  // Sedikit lebih besar saat diseret jari — memperkuat kesan "sedang dipegang"
  // pada petak yang di ponsel memang kecil.
  const drawn = squareSize() * (state.pointerType === 'touch' ? TOUCH_DRAG_SCALE : 1)
  const point = dragPoint(state)
  return {
    width: `${drawn}px`,
    height: `${drawn}px`,
    fontSize: `${drawn}px`,
    transform: `translate(${point.x - drawn / 2}px, ${point.y - drawn / 2}px)`
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
          'square--grabbable': canGrab(square),
          'square--target': props.targets.has(square)
        }"
        :style="marks.has(square) ? { '--mark-color': ANNOTATION_COLORS[marks.get(square)!] } : undefined"
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
          class="piece-icon"
          :piece="props.board[square]!"
          :class="{ 'piece--ghost': drag?.moved && drag.from === square }"
        />
      </div>

      <!--
        Ditaruh sesudah petak-petaknya (bukan sebelum) supaya tetap terlihat
        di atas warna dasar petak yang OPAK — ditaruh sebelum sempat dicoba,
        dan hasilnya panahnya lenyap total, tertutup background petak
        berikutnya. Supaya tidak menimpa BIDAK juga, `.piece-icon` diberi
        z-index lebih tinggi daripada lapisan ini secara eksplisit — `.square`
        sendiri sengaja tidak diberi z-index, supaya bukan konteks stacking
        baru, dan z-index anaknya (`.piece-icon`) bisa langsung dibandingkan
        dengan `.arrows-layer` yang sejajar dengannya di sini.
      -->
      <svg v-if="arrows.length" class="arrows-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker
            v-for="color in ANNOTATION_COLOR_KEYS"
            :id="`arrowhead-${color}`"
            :key="color"
            markerWidth="3"
            markerHeight="3"
            refX="2.4"
            refY="1.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L3,1.5 L0,3 Z" :fill="ANNOTATION_COLORS[color]" />
          </marker>
        </defs>
        <polyline
          v-for="(arrow, index) in arrows"
          :key="index"
          :points="arrowPoints(arrow)"
          :stroke="ANNOTATION_COLORS[arrow.color]"
          :marker-end="`url(#arrowhead-${arrow.color})`"
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
  /* Kotak sorot bawaan Android digambar per petak dan terlihat seperti
     kerusakan tampilan di atas papan; umpan baliknya sudah ada dari sorotan
     petak yang kita gambar sendiri. */
  -webkit-tap-highlight-color: transparent;
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
  /*
   * Papan tidak boleh menelan gulir halaman.
   *
   * Dulu `touch-action: none` dipasang pada SELURUH papan. Di desktop itu tidak
   * terasa, tapi di ponsel layoutnya satu kolom dan papan memenuhi lebar layar,
   * sementara status, kontrol, dan daftar langkah semuanya ada di bawahnya —
   * jadi bagian terbesar halaman justru mati untuk digulir, dan pemain harus
   * mencari pita sempit di atas atau di bawah papan.
   *
   * Sekarang hanya petak yang memang jadi milik kita yang menahan gestur
   * (lihat aturan di bawah); sisanya menggulir seperti halaman biasa.
   * `manipulation` mematikan tunda dobel-ketuk-untuk-perbesar, yang di papan
   * ini tidak ada gunanya dan hanya membuat ketukan terasa lambat.
   */
  touch-action: manipulation;
}

/*
 * Bidak yang bisa diangkat, dan petak tujuan yang sedang disorot: gestur di
 * sini milik papan, bukan milik gulir. Petak tujuan ikut disebut supaya
 * menyeret bidak yang sudah terpilih ke tujuannya tidak berubah jadi gulir di
 * tengah jalan.
 */
.square--grabbable,
.square--target {
  touch-action: none;
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

/*
 * Tebal garis ikut menskala bersama papan, seperti bidak dan hint — `em` di
 * sini adalah 12.5cqw milik `.square`, yaitu satu petak. Sebelumnya angkanya px
 * tetap, jadi di papan ponsel (petak ~44px) garis 3px terbaca dua kali lebih
 * tebal daripada di desktop (petak ~88px). `max()` menjaga lantainya: murni
 * proporsional akan terlalu tipis untuk dilihat di petak sekecil itu.
 */
.square--selected::before {
  background: var(--highlight-selected);
  box-shadow: inset 0 0 0 max(2px, 0.035em) var(--accent);
}

.square--check::before {
  background: radial-gradient(circle, var(--danger) 0%, var(--danger-fade) 72%);
}

/* Langkah yang sudah diantre (premove), menunggu giliran sendiri tiba. */
.square--premove::before {
  background: rgba(88, 140, 255, 0.32);
  box-shadow: inset 0 0 0 max(2px, 0.035em) rgba(88, 140, 255, 0.8);
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

/* Tanda petak dari klik kanan — murni anotasi, tidak memengaruhi permainan.
   Warnanya beda-beda per tanda (lihat --mark-color di style inline-nya),
   bukan tetap seperti sorotan lain — makanya tidak bisa jadi satu variabel tema. */
.square--marked::before {
  background: var(--mark-color, var(--accent));
  opacity: 0.35;
}

/*
 * z-index-nya harus DI ATAS petak (yang warna dasarnya opak, jadi kalau
 * lapisan ini di bawahnya panahnya lenyap total) tapi DI BAWAH bidak
 * (`.piece-icon`, lihat di bawah) — tiga tingkat, bukan dua, makanya tidak
 * cukup sekadar dipasang belakangan atau duluan di template.
 */
.arrows-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

/*
 * Warna tiap panah diberikan lewat atribut stroke/fill langsung di elemennya
 * (lihat template) — bukan lewat variabel tema, karena tujuannya justru
 * membedakan beberapa ide di papan yang sama. Bayangan gelap tipis di
 * sekelilingnya (termasuk ke ujung panahnya, karena drop-shadow ikut
 * membayangi marker) supaya tetap terbaca di petak apa pun dan tema karakter
 * apa pun — tanpa itu, warna kuning terutama bisa tenggelam di petak terang
 * yang hangat seperti punya Mari.
 */
.arrows-layer polyline {
  fill: none;
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.9;
  filter: drop-shadow(0 0 1.4px rgba(0, 0, 0, 0.8));
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
  /* Sama alasannya dengan garis sorotan di atas: px tetap membuat cincin ini
     menelan bidak di dalamnya begitu petaknya mengecil. */
  border: max(3px, 0.07em) solid var(--hint);
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

/* Di atas .arrows-layer (z-index 5) supaya ujung panah yang mendarat di
   petak berisi bidak tidak menutupinya. `.square` sendiri sengaja tidak
   diberi z-index (lihat komentar di .arrows-layer), jadi ini langsung
   dibandingkan dengan lapisan panah, bukan terjebak di dalam petaknya sendiri. */
.piece-icon {
  z-index: 6;
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
