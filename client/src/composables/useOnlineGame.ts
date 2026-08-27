/**
 * Klien multiplayer: sambungan WebSocket ke server, dibungkus jadi state reaktif.
 *
 * Prinsipnya: server adalah satu-satunya pemegang kebenaran. Composable ini
 * tidak pernah memutuskan sendiri apakah sebuah langkah sah — ia mengirim niat
 * ke server, lalu menggambar ulang papan dari `RoomState` yang dikembalikan.
 * Karena itu klien yang telat, salah versi, atau dioprek tidak bisa membuat
 * papan kedua pemain berbeda isi.
 */

import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { readStorage, writeStorage } from '../storage.ts'
import { t } from '../i18n/index.ts'
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

export interface Premove {
  from: Square
  to: Square
  promotion: PromotionType | null
}

export type ConnectionStatus = 'terputus' | 'menyambung' | 'tersambung' | 'gagal'

/** Batas panjang antrean premove — cukup untuk beberapa langkah beruntun, tidak perlu tak terhingga. */
const MAX_PREMOVE_QUEUE = 5

/** Berapa lama sorotan merah "premove gagal" tetap tampil sebelum memudar. */
const PREMOVE_FAIL_FLASH_MS = 650

/** Nama pemain bertahan antar muat ulang; token menjaga kursi di room. */
const NAME_KEY = 'catur.nama'
const TOKEN_KEY = 'catur.token'

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

/**
 * Kegagalan yang ditemui klien sendiri, di luar kode galat milik protokol.
 * Dibedakan supaya keduanya bisa dipetakan ke teks yang sama-sama diterjemahkan.
 */
type ClientErrorCode = 'connect'

type ErrorState =
  | { code: ServerErrorCode; params?: undefined }
  | { code: ClientErrorCode; params: { url: string } }

export interface UseOnlineGameOptions {
  /** Sakelar premove, dibagi dari luar (App.vue) supaya nilainya sama dengan mode offline. */
  premoveEnabled?: Ref<boolean>
}

export function useOnlineGame(serverUrl: string, options: UseOnlineGameOptions = {}) {
  const status = ref<ConnectionStatus>('terputus')
  const roomState = shallowRef<RoomState | null>(null)
  const seat = ref<Seat | null>(null)
  const playerName = ref(readStorage(NAME_KEY) ?? '')

  /*
   * Yang disimpan adalah kodenya, bukan kalimat kiriman server. Teks server
   * selalu berbahasa Indonesia — kalau dipakai apa adanya, pemain yang memilih
   * bahasa Inggris tetap mendapat pesan galat berbahasa Indonesia. Kodenya
   * sendiri bagian dari protokol, jadi memang stabil untuk dipetakan.
   */
  const errorState = shallowRef<ErrorState | null>(null)

  const error = computed<string | null>(() =>
    errorState.value ? t(`error.${errorState.value.code}`, errorState.value.params) : null
  )

  /** Posisi hasil rekonstruksi dari FEN milik server — bukan sumber kebenaran. */
  const position = shallowRef<Position | null>(null)
  const lastMove = shallowRef<Move | null>(null)
  const selected = ref<Square | null>(null)
  const pendingPromotion = shallowRef<PendingPromotion | null>(null)
  /** Antrean premove, dijalankan satu per satu begitu giliran sendiri benar-benar tiba. */
  const premoveQueue = ref<Premove[]>([])
  /** Langkah premove yang baru saja gagal (tidak legal lagi) — untuk kedipan merah sesaat. */
  const premoveFailed = shallowRef<{ from: Square; to: Square } | null>(null)
  let premoveFailTimer: ReturnType<typeof setTimeout> | null = null
  const premoveEnabled = options.premoveEnabled ?? ref(true)

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

  /** Warna yang boleh menyiapkan premove sekarang — giliran lawan, tapi kursi dan permainan masih aktif. */
  const premoveColor = computed<Color | null>(() => {
    if (!premoveEnabled.value) return null
    const room = roomState.value
    if (!room || room.waiting || room.resignedBy || status_.value?.over) return null
    if (isSpectator.value || !myColor.value) return null
    return turn.value !== myColor.value ? myColor.value : null
  })

  /**
   * Papan bayangan: klon posisi dari server dengan seluruh antrean premove
   * sudah diterapkan berurutan. Dipakai untuk menghitung sasaran langkah
   * premove berikutnya (mis. menyusun langkah kedua seolah langkah pertama
   * sudah jalan) dan untuk menggambar bidak seolah sudah berpindah. Balasan
   * lawan di antaranya tidak ikut disimulasikan — memang tidak bisa ditebak.
   */
  const projectedPosition = computed<Position | null>(() => {
    if (!position.value) return null
    const clone = position.value.clone()
    const color = myColor.value
    if (!color) return clone
    for (const step of premoveQueue.value) {
      const candidates = clone.premoveMoves(color).filter((m) => m.from === step.from && m.to === step.to)
      if (candidates.length === 0) break
      const move = step.promotion
        ? (candidates.find((m) => m.promotion === step.promotion) ?? candidates[0])
        : candidates[0]
      clone.makeMove(move)
    }
    return clone
  })

  /** Papan yang ditampilkan: bidak sudah "dipindahkan" ke tujuan premove-nya, sekadar visual. */
  const displayBoard = computed<(Piece | null)[]>(() => {
    if (!premoveQueue.value.length || !projectedPosition.value) return board.value
    return projectedPosition.value.board.slice()
  })

  /**
   * Petak tujuan dari bidak yang sedang dipilih. Saat gilirannya sendiri, ini
   * langkah legal sungguhan. Saat giliran lawan, ini pola gerak bidak di papan
   * bayangan (pseudo-legal, dengan antrean premove yang sudah ada ikut
   * diperhitungkan) — dipakai untuk menyiapkan premove berikutnya, dan
   * diperiksa ulang lewat kondisi dari server saat benar-benar dijalankan.
   */
  const targets = computed<Map<Square, Move[]>>(() => {
    const map = new Map<Square, Move[]>()
    if (selected.value === null) return map

    if (canPlay.value !== null) {
      if (!position.value) return map
      const piece = position.value.board[selected.value]
      if (!piece) return map
      for (const move of legalMoves.value) {
        if (move.from !== selected.value) continue
        const list = map.get(move.to)
        if (list) list.push(move)
        else map.set(move.to, [move])
      }
      return map
    }

    const projected = projectedPosition.value
    if (!projected) return map
    const piece = projected.board[selected.value]
    if (!piece) return map
    for (const move of projected.premoveMoves(piece[0] as Color)) {
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

    runQueuedPremove()
  }

  /**
   * Dipanggil tiap kondisi baru datang dari server — coba kirim langkah PALING
   * DEPAN dari antrean premove. Kalau sudah tidak legal, sisa antrean ikut
   * dibuang: langkah-langkah berikutnya dihitung dengan asumsi langkah ini
   * berhasil, jadi begitu asumsinya salah, sisanya juga tidak lagi bisa
   * dipercaya.
   */
  function runQueuedPremove(): void {
    if (!premoveQueue.value.length || canPlay.value === null) return

    const pending = premoveQueue.value[0]
    const candidates = legalMoves.value.filter(
      (move) => move.from === pending.from && move.to === pending.to
    )
    if (candidates.length === 0) {
      flagPremoveFailed(pending)
      premoveQueue.value = []
      return
    }
    premoveQueue.value = premoveQueue.value.slice(1)
    const move = pending.promotion
      ? (candidates.find((m) => m.promotion === pending.promotion) ?? candidates[0])
      : candidates[0]
    playMove({ from: move.from, to: move.to, promotion: move.promotion })
  }

  /** Kedipkan merah sesaat pada langkah yang gagal, lalu memudar sendiri. */
  function flagPremoveFailed(step: Premove): void {
    if (premoveFailTimer !== null) clearTimeout(premoveFailTimer)
    premoveFailed.value = { from: step.from, to: step.to }
    premoveFailTimer = setTimeout(() => {
      premoveFailTimer = null
      premoveFailed.value = null
    }, PREMOVE_FAIL_FLASH_MS)
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
    errorState.value = null

    try {
      socket = new WebSocket(serverUrl)
    } catch {
      status.value = 'gagal'
      errorState.value = { code: 'connect', params: { url: serverUrl } }
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
          name: playerName.value || t('lobby.namePlaceholder'),
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
          errorState.value = null
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
          errorState.value = { code: message.code }
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
    // Nama cadangan ikut bahasa pemain sendiri; ia yang menyiarkannya, bukan lawan.
    const cleaned = name.trim() || t('lobby.namePlaceholder')
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
   * memakai menteri secara diam-diam dan pilihan pemain hilang. Di luar giliran
   * sendiri, ini menyiapkan premove sebagai gantinya.
   */
  function tryMove(from: Square, to: Square): boolean {
    if (canPlay.value !== null) {
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
    return queuePremove(from, to)
  }

  /**
   * Antre langkah untuk dikirim otomatis begitu giliran sendiri tiba. Bisa
   * dipanggil lagi selagi antrean belum kosong untuk menambah langkah
   * berikutnya — sasarannya dihitung dari papan bayangan (`projectedPosition`),
   * yaitu seolah langkah-langkah yang sudah diantre lebih dulu sudah jalan.
   * Legalitas sungguhan baru diperiksa ulang satu per satu lewat kondisi dari
   * server saat benar-benar dijalankan.
   */
  function queuePremove(from: Square, to: Square): boolean {
    const color = premoveColor.value
    const projected = projectedPosition.value
    if (!color || !projected || premoveQueue.value.length >= MAX_PREMOVE_QUEUE) return false
    const piece = projected.board[from]
    if (!piece || piece[0] !== color) return false
    const candidates = projected.premoveMoves(color).filter((move) => move.from === from && move.to === to)
    if (candidates.length === 0) return false
    premoveQueue.value.push({ from, to, promotion: candidates[0].promotion ? 'q' : null })
    selected.value = null
    return true
  }

  /**
   * Petak asal langkah PALING DEPAN di antrean — di papan bayangan petak ini
   * tampak kosong (bidaknya sudah "pindah"), jadi mengetuknya tidak berguna
   * untuk memilih apa pun. Dipakai sebagai gagang pembatalan yang bisa
   * diketuk, tanpa mengganggu ketukan pada bidak bayangan itu sendiri (yang
   * artinya menyambung antrean, bukan membatalkannya).
   *
   * Diperiksa juga terhadap papan bayangan, bukan cuma indeksnya: rentetan
   * langkah yang berbalik ke petak asalnya sendiri (mis. bolak-balik dua
   * petak) membuat petak itu terisi lagi oleh bidak bayangan, dan saat itu
   * ketukannya harus tetap berarti "pilih", bukan "batalkan".
   */
  function isPremoveOrigin(square: Square): boolean {
    return premoveQueue.value[0]?.from === square && !projectedPosition.value?.board[square]
  }

  function cancelPremove(): void {
    premoveQueue.value = []
    if (premoveFailTimer !== null) {
      clearTimeout(premoveFailTimer)
      premoveFailTimer = null
    }
    premoveFailed.value = null
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

  /** Klik petak: pilih bidak sendiri, jalankan langkah, atau batalkan premove. */
  function activateSquare(square: Square): void {
    if (pendingPromotion.value) return

    // Mengetuk ulang petak asal langkah premove paling depan, tanpa ada
    // pilihan lain aktif, membatalkan seluruh antrean — cara paling langsung
    // di layar sentuh, yang tidak punya klik kanan untuk itu. Mengetuk bidak
    // bayangannya sendiri (petak tujuan) tetap berarti menyambung antrean.
    if (selected.value === null && isPremoveOrigin(square)) {
      cancelPremove()
      return
    }

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

    if (playable) {
      const piece = position.value?.board[square]
      selected.value = piece && piece[0] === playable ? square : null
      return
    }

    const color = premoveColor.value
    const projected = projectedPosition.value
    if (!color || !projected) {
      selected.value = null
      return
    }
    // Sasaran seleksi premove dibaca dari papan bayangan, bukan papan dari
    // server — supaya bidak yang "sudah dipindahkan" oleh premove sebelumnya
    // tetap bisa dipilih lagi untuk menyusun langkah berikutnya.
    const piece = projected.board[square]
    selected.value = piece && piece[0] === color ? square : null
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
    cancelPremove()
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

  watch(premoveEnabled, (enabled) => {
    if (!enabled) cancelPremove()
  })

  onScopeDispose(() => {
    disconnect()
    if (premoveFailTimer !== null) clearTimeout(premoveFailTimer)
  })

  return {
    // sambungan
    status,
    error,
    /** Kode mentahnya — dipakai tes, yang tidak boleh bergantung pada bunyi kalimat. */
    errorCode: computed(() => errorState.value?.code ?? null),
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
    displayBoard,
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
    cancelPromotion,
    // premove
    premoveQueue,
    premoveFailed,
    premoveColor,
    premoveEnabled,
    cancelPremove
  }
}

export type OnlineGame = ReturnType<typeof useOnlineGame>
export type { ServerErrorCode }
