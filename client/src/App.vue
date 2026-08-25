<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import CapturedPieces from './components/CapturedPieces.vue'
import ChessBoard from './components/ChessBoard.vue'
import GameControls from './components/GameControls.vue'
import MariHalo from './components/MariHalo.vue'
import MariPortrait from './components/MariPortrait.vue'
import MoveHistory from './components/MoveHistory.vue'
import OnlineLobby from './components/OnlineLobby.vue'
import PromotionDialog from './components/PromotionDialog.vue'
import RepoLink from './components/RepoLink.vue'
import RoomPanel from './components/RoomPanel.vue'
import { useChessGame } from './composables/useChessGame.ts'
import { useOnlineGame } from './composables/useOnlineGame.ts'
import { resolveServerUrl } from './net/serverUrl.ts'
import { opponent } from '@chess/shared/chess'
import type { Color, GameEndReason, Move, Piece, PieceType, Square } from '@chess/shared/types'

type AppMode = 'offline' | 'online'

const offline = useChessGame()
const online = useOnlineGame(resolveServerUrl())

const appMode = ref<AppMode>('offline')
const orientation = ref<Color>('w')

const COLOR_NAMES: Record<Color, string> = { w: 'Putih', b: 'Hitam' }

const END_MESSAGES: Record<GameEndReason, string> = {
  checkmate: 'Skakmat',
  stalemate: 'Remis — raja terkunci (stalemate)',
  'insufficient-material': 'Remis — materi tidak cukup untuk menang',
  threefold: 'Remis — posisi berulang tiga kali',
  'fifty-move': 'Remis — aturan 50 langkah'
}

const isOnline = computed(() => appMode.value === 'online')

// Masuk mode online membuka sambungan; keluar menutupnya agar tidak ada socket
// menganggur yang terus menyambung ulang di latar belakang.
watch(isOnline, (value) => {
  if (value) online.connect()
  else online.disconnect()
})

// Papan online selalu dilihat dari kursi pemain sendiri — itu yang diharapkan.
watch(
  () => online.myColor.value,
  (color) => {
    if (color) orientation.value = color
  }
)

// Orientasi offline dikelola composable-nya sendiri; jaga keduanya sejalan.
watch(orientation, (value) => {
  if (!isOnline.value) offline.orientation.value = value
})
watch(
  () => offline.orientation.value,
  (value) => {
    if (!isOnline.value) orientation.value = value
  }
)

// ---------------------------------------------------------------------------
// Sumber data papan — offline atau online, bentuknya sama
// ---------------------------------------------------------------------------

const board = computed<(Piece | null)[]>(() =>
  isOnline.value ? online.board.value : offline.board.value
)
const selected = computed<Square | null>(() =>
  isOnline.value ? online.selected.value : offline.selected.value
)
const targets = computed<Map<Square, Move[]>>(() =>
  isOnline.value ? online.targets.value : offline.targets.value
)
const lastMove = computed<Move | null>(() =>
  isOnline.value ? online.lastMove.value : offline.lastMove.value
)
const checkSquare = computed<Square | null>(() =>
  isOnline.value ? online.checkSquare.value : offline.checkSquare.value
)
const canPlay = computed<Color | null>(() =>
  isOnline.value ? online.canPlay.value : offline.canPlay.value
)
const turn = computed<Color>(() => (isOnline.value ? online.turn.value : offline.turn.value))
const captured = computed<Record<Color, PieceType[]>>(() =>
  isOnline.value ? online.captured.value : offline.captured.value
)
const materialLead = computed(() =>
  isOnline.value ? online.materialLead.value : offline.materialLead.value
)
const historyRows = computed(() =>
  isOnline.value ? online.historyRows.value : offline.historyRows.value
)
const plyCount = computed(() =>
  isOnline.value ? (online.roomState.value?.history.length ?? 0) : offline.history.value.length
)
const pendingPromotionColor = computed<Color | null>(() =>
  isOnline.value
    ? (online.pendingPromotion.value?.color ?? null)
    : (offline.pendingPromotion.value?.color ?? null)
)

const activateSquare = (square: Square) =>
  isOnline.value ? online.activateSquare(square) : offline.activateSquare(square)

const dropPiece = (from: Square, to: Square) =>
  isOnline.value ? online.dropPiece(from, to) : offline.dropPiece(from, to)

const completePromotion = (type: 'q' | 'r' | 'b' | 'n') =>
  isOnline.value ? online.completePromotion(type) : offline.completePromotion(type)

const cancelPromotion = () =>
  isOnline.value ? online.cancelPromotion() : offline.cancelPromotion()

// ---------------------------------------------------------------------------
// Baris status
// ---------------------------------------------------------------------------

const statusText = computed(() => {
  if (isOnline.value) {
    const room = online.roomState.value
    if (!room) return 'Belum berada di room mana pun'
    if (room.waiting) return 'Menunggu lawan bergabung…'
    if (room.resignedBy) {
      return `${COLOR_NAMES[room.resignedBy]} menyerah — ${COLOR_NAMES[opponent(room.resignedBy)]} menang`
    }
    const state = online.gameStatus.value
    if (state?.over) {
      return state.reason === 'checkmate'
        ? `Skakmat — ${COLOR_NAMES[state.winner!]} menang`
        : END_MESSAGES[state.reason!]
    }
    if (online.isSpectator.value) return `Menonton — giliran ${COLOR_NAMES[turn.value]}`
    const mine = turn.value === online.myColor.value
    if (state?.check) return mine ? 'Anda sedang skak!' : 'Lawan sedang skak!'
    return mine ? 'Giliran Anda' : 'Menunggu langkah lawan…'
  }

  const state = offline.status.value
  if (state.over) {
    return state.reason === 'checkmate'
      ? `Skakmat — ${COLOR_NAMES[state.winner!]} menang`
      : END_MESSAGES[state.reason!]
  }
  if (offline.thinking.value) return 'Komputer sedang berpikir…'
  const side = COLOR_NAMES[turn.value]
  return state.check ? `${side} sedang skak!` : `Giliran ${side}`
})

const statusTone = computed(() => {
  if (isOnline.value) {
    const room = online.roomState.value
    if (!room) return 'normal'
    if (room.waiting) return 'draw'
    if (room.resignedBy) return 'win'
    const state = online.gameStatus.value
    if (state?.over) return state.reason === 'checkmate' ? 'win' : 'draw'
    return state?.check ? 'check' : 'normal'
  }
  const state = offline.status.value
  if (state.over) return state.reason === 'checkmate' ? 'win' : 'draw'
  return state.check ? 'check' : 'normal'
})

// ---------------------------------------------------------------------------
// Papan nama di atas dan bawah papan
// ---------------------------------------------------------------------------

const topColor = computed<Color>(() => opponent(orientation.value))
const bottomColor = computed<Color>(() => orientation.value)

function playerLabel(color: Color): string {
  if (isOnline.value) {
    const player = online.roomState.value?.players.find((entry) => entry.seat === color)
    if (!player) return `${COLOR_NAMES[color]} — kosong`
    const you = color === online.myColor.value ? ' (Anda)' : ''
    return `${player.name}${you}${player.connected ? '' : ' — terputus'}`
  }
  if (offline.mode.value === 'dua-pemain') return COLOR_NAMES[color]
  return color === offline.humanColor.value
    ? `Anda (${COLOR_NAMES[color]})`
    : `Komputer (${COLOR_NAMES[color]})`
}

const leadFor = (color: Color): number =>
  color === 'w' ? materialLead.value : -materialLead.value

const searchInfo = computed(() => {
  const search = offline.lastSearch.value
  if (isOnline.value || !search || !search.depth) return null
  return `kedalaman ${search.depth} · ${search.nodes.toLocaleString('id-ID')} simpul · ${search.timeMs} ms`
})

const canResign = computed(
  () => !!online.myColor.value && !online.roomState.value?.waiting && !online.gameStatus.value?.over &&
    !online.roomState.value?.resignedBy
)
const canRematch = computed(
  () => !!online.myColor.value && (!!online.roomState.value?.resignedBy || !!online.gameStatus.value?.over)
)

const flipBoard = () => {
  orientation.value = opponent(orientation.value)
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

  if (event.key.toLowerCase() === 'f') {
    flipBoard()
  } else if (event.key === 'Escape') {
    if (isOnline.value) online.selected.value = null
    else offline.selected.value = null
  } else if (!isOnline.value && (event.key === 'ArrowLeft' || (event.ctrlKey && event.key.toLowerCase() === 'z'))) {
    // Undo hanya untuk permainan lokal — di online, papan milik server.
    event.preventDefault()
    offline.undo()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <MariPortrait />

    <header class="app__header">
      <div class="brand">
        <MariHalo />
        <div>
          <h1 class="app__title">Chess with Mari</h1>
          <p class="app__subtitle">Vue 3 · TypeScript · aturan lengkap FIDE</p>
        </div>
      </div>
      <nav class="modes">
        <button
          type="button"
          class="modes__item"
          :class="{ 'modes__item--on': appMode === 'offline' }"
          @click="appMode = 'offline'"
        >
          Lokal
        </button>
        <button
          type="button"
          class="modes__item"
          :class="{ 'modes__item--on': appMode === 'online' }"
          @click="appMode = 'online'"
        >
          Online
        </button>
      </nav>
    </header>

    <main class="layout">
      <div class="board-column">
        <div class="player">
          <div class="player__id">
            <span class="player__dot" :class="`player__dot--${topColor}`" />
            <span class="player__name">{{ playerLabel(topColor) }}</span>
            <span v-if="turn === topColor" class="player__turn">giliran</span>
          </div>
          <CapturedPieces
            :color="opponent(topColor)"
            :pieces="captured[opponent(topColor)]"
            :lead="leadFor(topColor)"
          />
        </div>

        <ChessBoard
          :board="board"
          :orientation="orientation"
          :selected="selected"
          :targets="targets"
          :last-move="lastMove"
          :check-square="checkSquare"
          :playable="canPlay"
          :show-hints="offline.showHints.value"
          @activate="activateSquare"
          @drop="dropPiece"
        />

        <div class="player">
          <div class="player__id">
            <span class="player__dot" :class="`player__dot--${bottomColor}`" />
            <span class="player__name">{{ playerLabel(bottomColor) }}</span>
            <span v-if="turn === bottomColor" class="player__turn">giliran</span>
          </div>
          <CapturedPieces
            :color="opponent(bottomColor)"
            :pieces="captured[opponent(bottomColor)]"
            :lead="leadFor(bottomColor)"
          />
        </div>
      </div>

      <aside class="panel">
        <div class="status" :class="`status--${statusTone}`">
          <span v-if="offline.thinking.value && !isOnline" class="status__spinner" aria-hidden="true" />
          <span>{{ statusText }}</span>
        </div>

        <p v-if="isOnline && online.error.value" class="alert" role="alert">
          {{ online.error.value }}
        </p>

        <template v-if="isOnline">
          <OnlineLobby
            v-if="!online.inRoom.value"
            :status="online.status.value"
            :error="null"
            :initial-name="online.playerName.value"
            @create="(name, seat) => online.createRoom(name, seat)"
            @join="(code, name) => online.joinRoom(code, name)"
          />
          <RoomPanel
            v-else
            :state="online.roomState.value!"
            :seat="online.seat.value"
            :status="online.status.value"
            :can-resign="canResign"
            :can-rematch="canRematch"
            @resign="online.resign"
            @rematch="online.rematch"
            @leave="online.leaveRoom"
          />
          <button type="button" class="flip" @click="flipBoard">Putar papan</button>
        </template>

        <GameControls
          v-else
          v-model:mode="offline.mode.value"
          v-model:elo="offline.elo.value"
          v-model:show-hints="offline.showHints.value"
          :human-color="offline.humanColor.value"
          :can-undo="offline.history.value.length > 0"
          :busy="offline.thinking.value"
          @reset="offline.reset()"
          @undo="offline.undo"
          @flip="flipBoard"
          @play-as="offline.playAs"
        />

        <MoveHistory :rows="historyRows" :ply-count="plyCount" />

        <footer class="meta">
          <p v-if="searchInfo" class="meta__line">Pencarian terakhir: {{ searchInfo }}</p>
          <p v-if="!isOnline" class="meta__line meta__fen" :title="offline.fen.value">
            FEN: {{ offline.fen.value }}
          </p>
          <p class="meta__line meta__keys">
            Pintasan:
            <template v-if="!isOnline"><kbd>←</kbd> batalkan · </template>
            <kbd>F</kbd> putar papan · <kbd>Esc</kbd> batal pilih
          </p>
        </footer>
      </aside>
    </main>

    <footer class="page-footer">
      <RepoLink />
    </footer>

    <PromotionDialog
      v-if="pendingPromotionColor"
      :color="pendingPromotionColor"
      @choose="completePromotion"
      @cancel="cancelPromotion"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: 68rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
  /* Naikkan di atas potret latar yang ber-position: fixed. */
  position: relative;
  z-index: 1;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

/* Di luar panel: melintang selebar halaman, isinya di tengah. */
.page-footer {
  display: flex;
  justify-content: center;
  margin-top: 2.25rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
}

.app__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.app__title {
  margin: 0;
  font-size: 1.6rem;
  letter-spacing: -0.01em;
  /* Emas trim jubahnya meluruh ke oranye rambutnya. */
  background: linear-gradient(100deg, var(--accent-hover) 0%, var(--orange) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  width: fit-content;
}

.app__subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.84rem;
  color: var(--text-muted);
}

.modes {
  display: flex;
  gap: 0.25rem;
  padding: 0.22rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.modes__item {
  padding: 0.4rem 0.9rem;
  font: inherit;
  font-size: 0.84rem;
  background: none;
  border: none;
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
}

.modes__item:hover {
  color: var(--text);
}

.modes__item--on {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20rem;
  gap: 1.5rem;
  align-items: start;
}

.board-column {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
}

.player {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 1.9rem;
}

.player__id {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  min-width: 0;
}

.player__dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.player__dot--w {
  background: var(--piece-light-small);
}

.player__dot--b {
  background: var(--piece-dark-small);
}

.player__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player__turn {
  padding: 0.1rem 0.4rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 0.3rem;
  flex-shrink: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.1rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  position: sticky;
  top: 1.5rem;
}

.status {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 0.85rem;
  font-size: 0.92rem;
  font-weight: 500;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-muted);
  border-radius: 0.5rem;
}

.status--check {
  border-left-color: var(--danger);
  color: var(--danger-text);
}

.status--win {
  border-left-color: var(--accent);
  color: var(--gold-text);
}

.status--draw {
  border-left-color: var(--sky);
  color: var(--sky-text);
}

.status__spinner {
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.alert {
  margin: 0;
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
  color: var(--danger-text);
  background: var(--danger-soft);
  border: 1px solid var(--danger-line);
  border-radius: 0.5rem;
}

.flip {
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-size: 0.84rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text);
  cursor: pointer;
}

.flip:hover {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

.meta {
  display: grid;
  gap: 0.35rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border);
  font-size: 0.72rem;
  color: var(--text-muted);
}

.meta__line {
  margin: 0;
}

.meta__fen {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta__keys kbd {
  padding: 0.05rem 0.28rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.25rem;
}

@media (max-width: 60rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .panel {
    position: static;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status__spinner {
    animation-duration: 2s;
  }
}
</style>
