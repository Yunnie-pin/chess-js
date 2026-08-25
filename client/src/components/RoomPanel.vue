<script setup lang="ts">
import { ref } from 'vue'

import type { ConnectionStatus } from '../composables/useOnlineGame.ts'
import type { PlayerView, RoomState, Seat } from '@chess/shared/protocol'

const props = defineProps<{
  state: RoomState
  seat: Seat | null
  status: ConnectionStatus
  canResign: boolean
  canRematch: boolean
}>()

const emit = defineEmits<{ resign: []; rematch: []; leave: [] }>()

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

/** Kode room disalin agar mudah ditempel ke chat; ada fallback bila clipboard ditolak. */
async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.state.roomId)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false
  }
}

const SEAT_LABEL: Record<Seat, string> = { w: 'Putih', b: 'Hitam', penonton: 'Penonton' }

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  terputus: 'Terputus',
  menyambung: 'Menyambung…',
  tersambung: 'Tersambung',
  gagal: 'Gagal tersambung'
}

const describe = (player: PlayerView): string =>
  `${player.name}${player.connected ? '' : ' (terputus)'}`
</script>

<template>
  <section class="room">
    <div class="room__code">
      <div>
        <span class="room__label">Kode room</span>
        <strong class="room__value">{{ state.roomId }}</strong>
      </div>
      <button type="button" class="copy" @click="copyCode">
        {{ copied ? 'Tersalin' : 'Salin' }}
      </button>
    </div>

    <p v-if="state.waiting" class="waiting">
      Menunggu lawan bergabung. Bagikan kode di atas.
    </p>

    <ul class="players">
      <li v-for="player in state.players" :key="`${player.seat}-${player.name}`" class="player">
        <span class="player__dot" :class="`player__dot--${player.seat}`" />
        <span class="player__name" :class="{ 'player__name--me': player.seat === seat }">
          {{ describe(player) }}
        </span>
        <span class="player__seat">{{ SEAT_LABEL[player.seat] }}</span>
      </li>
    </ul>

    <div class="conn" :class="`conn--${status}`">
      <span class="conn__dot" />
      {{ STATUS_LABEL[status] }}
    </div>

    <div class="actions">
      <button v-if="canRematch" type="button" class="btn btn--primary" @click="emit('rematch')">
        Main lagi
      </button>
      <button v-if="canResign" type="button" class="btn" @click="emit('resign')">Menyerah</button>
      <button type="button" class="btn" @click="emit('leave')">Keluar room</button>
    </div>
  </section>
</template>

<style scoped>
.room {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.room__code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  padding: 0.65rem 0.8rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.room__label {
  display: block;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.room__value {
  font-family: var(--font-mono);
  font-size: 1.4rem;
  letter-spacing: 0.25em;
}

.copy {
  padding: 0.4rem 0.7rem;
  font: inherit;
  font-size: 0.78rem;
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.copy:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.waiting {
  margin: 0;
  padding: 0.5rem 0.7rem;
  font-size: 0.82rem;
  color: var(--sky-text);
  background: var(--sky-soft);
  border: 1px solid var(--sky-line);
  border-radius: 0.5rem;
}

.players {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.player {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.86rem;
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

.player__dot--penonton {
  background: transparent;
}

.player__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player__name--me {
  font-weight: 600;
  color: var(--accent);
}

.player__seat {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.conn {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.conn__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-muted);
}

.conn--tersambung .conn__dot {
  background: var(--sky);
}

.conn--menyambung .conn__dot {
  background: var(--orange);
}

.conn--gagal .conn__dot,
.conn--terputus .conn__dot {
  background: var(--danger);
}

.actions {
  display: grid;
  gap: 0.4rem;
}

.btn {
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-size: 0.84rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text);
  cursor: pointer;
}

.btn:hover {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
</style>
