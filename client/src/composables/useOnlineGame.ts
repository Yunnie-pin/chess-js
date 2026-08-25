/**
 * Klien multiplayer: sambungan WebSocket ke server, dibungkus jadi state reaktif.
 *
 * Prinsipnya: server adalah satu-satunya pemegang kebenaran. Composable ini
 * tidak pernah memutuskan sendiri apakah sebuah langkah sah — ia mengirim niat
 * ke server, lalu menggambar ulang papan dari `RoomState` yang dikembalikan.
 * Karena itu klien yang telat, salah versi, atau dioprek tidak bisa membuat
 * papan kedua pemain berbeda isi.
 */

import { computed, onScopeDispose, ref, shallowRef } from 'vue'

import { Position, opponent } from '@chess/shared/chess'
import type { Color, Move, Piece, PieceType, PromotionType, Square } from '@chess/shared/types'
import { parseServerMessage } from '@chess/shared/protocol'
import type {
  ClientMessage,
  PlayerView,
  RoomState,
  Seat,
  ServerErrorCode,
  WireMove
} from '@chess/shared/protocol'

export interface PendingPromotion {
  from: Square
  to: Square
  color: Color
}

export type ConnectionStatus = 'terputus' | 'menyambung' | 'tersambung' | 'gagal'

/** Nama pemain bertahan antar muat ulang; token menjaga kursi di room. */
const NAME_KEY = 'catur.nama'
const TOKEN_KEY = 'catur.token'

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // mode privat / penyimpanan diblokir
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* tidak apa-apa: fitur ini hanya kenyamanan */
  }
}

export function useOnlineGame(serverUrl: string) {
  const status = ref<ConnectionStatus>('terputus')
  const roomState = shallowRef<RoomState | null>(null)
  const seat = ref<Seat | null>(null)
  const error = ref<string | null>(null)
  const playerName = ref(readStorage(NAME_KEY) ?? '')

  /** Posisi hasil rekonstruksi dari FEN milik server — bukan sumber kebenaran. */
  const position = shallowRef<Position | null>(null)
  const lastMove = shallowRef<Move | null>(null)
  const selected = ref<Square | null>(null)
  const pendingPromotion = shallowRef<PendingPromotion | null>(null)

  let socket: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closedByUs = false
  /** Permintaan yang menunggu sambungan terbuka (mis. user menekan "Buat room"). */
  let pendingIntent: ClientMessage | null = null

  // ------------------------------------------------------------------
  // Turunan untuk UI
  // ------------------------------------------------------------------

  const inRoom = computed(() => roomState.value !== null)
  const roomId = computed(() => roomState.value?.roomId ?? null)
  const isSpectator = computed(() => seat.value === 'penonton')
  const myColor = computed<Color | null>(() =>
    seat.value === 'w' || seat.value === 'b' ? seat.value : null
  )

  const board = computed<(Piece | null)[]>(() => position.value?.board.slice() ?? [])
  const turn = computed<Color>(() => position.value?.turn ?? 'w')
  const status_ = computed(() => position.value?.status() ?? null)

  const checkSquare = computed<Square | null>(() => {
    const current = position.value
    if (!current) return null
    return current.inCheck() ? current.kings[current.turn] : null
  })

  const legalMoves = computed<Move[]>(() => position.value?.legalMoves() ?? [])

  /** Pemain hanya boleh menggerakkan warnanya sendiri, dan hanya saat gilirannya. */
  const canPlay = computed<Color | null>(() => {
    const room = roomState.value
    if (!room || !position.value || !myColor.value) return null
    if (room.waiting || room.resignedBy || status_.value?.over) return null
    return turn.value === myColor.value ? myColor.value : null
  })

  const targets = computed<Map<Square, Move[]>>(() => {
    const map = new Map<Square, Move[]>()
    if (selected.value === null) return map
    for (const move of legalMoves.value) {
      if (move.from !== selected.value) continue
      const list = map.get(move.to)
      if (list) list.push(move)
      else map.set(move.to, [move])
    }
    return map
  })

  const opponentPlayer = computed<PlayerView | null>(() => {
    const room = roomState.value
    if (!room || !myColor.value) return null
    return room.players.find((player) => player.seat === opponent(myColor.value!)) ?? null
  })

  const mePlayer = computed<PlayerView | null>(
    () => roomState.value?.players.find((player) => player.seat === seat.value) ?? null
  )

  const MATERIAL_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

  /** Bidak tertangkap diambil dari riwayat server, jadi tetap tepat setelah promosi. */
  const captured = computed(() => {
    const taken: Record<Color, PieceType[]> = { w: [], b: [] }
    for (const entry of roomState.value?.history ?? []) {
      if (entry.captured) taken[entry.captured[0] as Color].push(entry.captured[1] as PieceType)
    }
    taken.w.sort((a, b) => MATERIAL_VALUE[b] - MATERIAL_VALUE[a])
    taken.b.sort((a, b) => MATERIAL_VALUE[b] - MATERIAL_VALUE[a])
    return taken
  })

  const materialLead = computed(() => {
    let lead = 0
    for (const piece of position.value?.board ?? []) {
      if (!piece) continue
      lead += piece[0] === 'w' ? MATERIAL_VALUE[piece[1] as PieceType] : -MATERIAL_VALUE[piece[1] as PieceType]
    }
    return lead
  })

  /** Riwayat dua kolom, bentuknya sama dengan mode offline agar komponennya dipakai ulang. */
  const historyRows = computed(() => {
    const rows: { number: number; white?: { san: string }; black?: { san: string } }[] = []
    const entries = roomState.value?.history ?? []
    entries.forEach((entry, index) => {
      const number = Math.floor(index / 2) + 1
      if (index % 2 === 0) rows.push({ number, white: { san: entry.san } })
      else rows[rows.length - 1].black = { san: entry.san }
    })
    return rows
  })

  // ------------------------------------------------------------------
  // Menerapkan kondisi dari server
  // ------------------------------------------------------------------

  function applyState(state: RoomState): void {
    roomState.value = state
    const next = new Position(state.fen)
    position.value = next
    selected.value = null
    pendingPromotion.value = null

    // Sorotan langkah terakhir direkonstruksi dari riwayat yang dikirim server.
    const last = state.history[state.history.length - 1]
    lastMove.value = last
      ? ({
          from: last.move.from,
          to: last.move.to,
          promotion: last.move.promotion,
          piece: 'wp', // tidak dipakai untuk menggambar sorotan
          captured: null,
          castle: null,
          enPassant: false,
          doublePush: false
        } as Move)
      : null
  }

  // ------------------------------------------------------------------
  // Sambungan
  // ------------------------------------------------------------------

  function connect(): void {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    closedByUs = false
    status.value = 'menyambung'
    error.value = null

    try {
      socket = new WebSocket(serverUrl)
    } catch {
      status.value = 'gagal'
      error.value = `Tidak bisa menyambung ke ${serverUrl}.`
      return
    }

    socket.addEventListener('open', () => {
      status.value = 'tersambung'
      reconnectAttempt = 0
      if (pendingIntent) {
        socket?.send(JSON.stringify(pendingIntent))
        pendingIntent = null
      } else if (roomState.value) {
        // Sambungan putus lalu pulih: masuk lagi ke room yang sama.
        send({
          type: 'gabung-room',
          roomId: roomState.value.roomId,
          name: playerName.value || 'Pemain',
          token: readStorage(TOKEN_KEY) ?? undefined
        })
      }
    })

    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(String(event.data))
      if (!message) return

      switch (message.type) {
        case 'bergabung':
          seat.value = message.seat
          writeStorage(TOKEN_KEY, message.token)
          applyState(message.state)
          error.value = null
          break
        case 'kondisi':
          // Kursi bisa berubah tanpa pesan 'bergabung' baru — mis. setelah main lagi.
          seat.value = message.yourSeat
          applyState(message.state)
          break
        case 'langkah-dimainkan':
          // Kondisi lengkap menyusul tepat setelah ini, jadi cukup catat sorotan.
          break
        case 'galat':
          error.value = message.message
          break
      }
    })

    socket.addEventListener('close', () => {
      socket = null
      if (closedByUs) {
        status.value = 'terputus'
        return
      }
      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      // Detailnya tidak pernah diberikan browser; 'close' yang menyusul yang menangani.
    })
  }

  /** Menyambung ulang dengan jeda menaik, supaya server tidak dibanjiri. */
  function scheduleReconnect(): void {
    if (reconnectTimer !== null) return
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    reconnectAttempt++
    status.value = 'menyambung'
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function send(message: ClientMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
      return
    }
    // Belum tersambung: simpan niatnya, kirim begitu sambungan terbuka.
    pendingIntent = message
    connect()
  }

  // ------------------------------------------------------------------
  // Aksi pemain
  // ------------------------------------------------------------------

  function rememberName(name: string): string {
    const cleaned = name.trim() || 'Pemain'
    playerName.value = cleaned
    writeStorage(NAME_KEY, cleaned)
    return cleaned
  }

  function createRoom(name: string, requestedSeat: Color | 'acak' = 'acak'): void {
    send({ type: 'buat-room', name: rememberName(name), seat: requestedSeat })
  }

  function joinRoom(code: string, name: string): void {
    send({
      type: 'gabung-room',
      roomId: code.trim().toUpperCase(),
      name: rememberName(name),
      token: readStorage(TOKEN_KEY) ?? undefined
    })
  }

  function playMove(move: WireMove): void {
    send({ type: 'langkah', move })
  }

  /**
   * Mencoba menjalankan langkah. Langkah promosi ditahan dulu supaya pemain bisa
   * memilih bidaknya — tanpa ini, mengirim `promotion: null` membuat server
   * memakai menteri secara diam-diam dan pilihan pemain hilang.
   */
  function tryMove(from: Square, to: Square): boolean {
    if (canPlay.value === null) return false
    const candidates = legalMoves.value.filter((move) => move.from === from && move.to === to)
    if (candidates.length === 0) return false

    if (candidates[0].promotion) {
      pendingPromotion.value = { from, to, color: canPlay.value }
      selected.value = null
      return true
    }
    playMove({ from, to, promotion: null })
    selected.value = null
    pendingPromotion.value = null
    return true
  }

  function completePromotion(type: PromotionType): void {
    const pending = pendingPromotion.value
    pendingPromotion.value = null
    if (pending) playMove({ from: pending.from, to: pending.to, promotion: type })
  }

  function cancelPromotion(): void {
    pendingPromotion.value = null
    selected.value = null
    pendingPromotion.value = null
  }

  /** Klik petak: pilih bidak sendiri, atau jalankan langkah ke petak yang sah. */
  function activateSquare(square: Square): void {
    if (pendingPromotion.value) return
    const playable = canPlay.value

    if (selected.value !== null) {
      if (square === selected.value) {
        selected.value = null
        return
      }
      if (targets.value.has(square)) {
        tryMove(selected.value, square)
        return
      }
    }
    const piece = position.value?.board[square]
    selected.value = piece && playable && piece[0] === playable ? square : null
  }

  function dropPiece(from: Square, to: Square): void {
    if (from === to) return
    if (!tryMove(from, to)) selected.value = null
  }

  function resign(): void {
    send({ type: 'menyerah' })
  }

  function rematch(): void {
    send({ type: 'main-lagi' })
  }

  function leaveRoom(): void {
    send({ type: 'keluar' })
    roomState.value = null
    position.value = null
    seat.value = null
    lastMove.value = null
    selected.value = null
    pendingPromotion.value = null
  }

  function disconnect(): void {
    closedByUs = true
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
    status.value = 'terputus'
  }

  onScopeDispose(disconnect)

  return {
    // sambungan
    status,
    error,
    connect,
    disconnect,
    // room
    roomState,
    roomId,
    inRoom,
    seat,
    myColor,
    isSpectator,
    mePlayer,
    opponentPlayer,
    playerName,
    createRoom,
    joinRoom,
    leaveRoom,
    resign,
    rematch,
    // papan
    board,
    turn,
    gameStatus: status_,
    legalMoves,
    targets,
    selected,
    lastMove,
    checkSquare,
    canPlay,
    historyRows,
    captured,
    materialLead,
    activateSquare,
    dropPiece,
    playMove,
    // promosi
    pendingPromotion,
    completePromotion,
    cancelPromotion
  }
}

export type OnlineGame = ReturnType<typeof useOnlineGame>
export type { ServerErrorCode }
