/**
 * Seluruh state permainan yang dipakai UI.
 *
 * Catatan desain: objek `Position` sengaja TIDAK dibungkus reactive(). Pencarian
 * AI memanggil makeMove/undoMove ratusan ribu kali, dan proxy Vue akan membuat
 * hal itu berkali-kali lipat lebih lambat. Sebagai gantinya papan dimutasi
 * secara langsung dan sebuah penghitung `version` dinaikkan setiap kali posisi
 * berubah; seluruh computed di bawah bergantung pada penghitung itu.
 */

import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { Position, START_FEN, WHITE, algebraic, colorOf, opponent, typeOf } from '@chess/shared/chess'
import { DEFAULT_ELO, ELO_LEVELS, STRENGTH_PROFILES, chooseMove } from '@chess/shared/ai'
import type { EloRating } from '@chess/shared/ai'
import type { AiRequest, AiResponse } from '../engine/ai.worker.ts'
import type {
  Color,
  HistoryEntry,
  Move,
  Piece,
  PieceType,
  PromotionType,
  Square
} from '@chess/shared/types'

export type GameMode = 'dua-pemain' | 'lawan-komputer'

export interface PendingPromotion {
  from: Square
  to: Square
  color: Color
  options: Move[]
}

export interface Premove {
  from: Square
  to: Square
  promotion: PromotionType | null
}

const MATERIAL_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Batas panjang antrean premove — cukup untuk beberapa langkah beruntun, tidak perlu tak terhingga. */
const MAX_PREMOVE_QUEUE = 5

/** Berapa lama sorotan merah "premove gagal" tetap tampil sebelum memudar. */
const PREMOVE_FAIL_FLASH_MS = 650

/**
 * Jeda minimum antara langkah pemain dan jawaban komputer. Ini batas bawah,
 * bukan tambahan: pencarian yang sudah melampauinya menjawab begitu selesai,
 * jadi level tinggi tidak jadi lebih lambat.
 */
export const MIN_REPLY_MS = 500

export interface UseChessGameOptions {
  /**
   * Sakelar premove, dibagi dari luar (App.vue) supaya nilainya sama di mode
   * offline dan online sekaligus — persis seperti `showHints` sekarang, yang
   * checkbox-nya cuma ada satu tapi dipakai di kedua papan.
   */
  premoveEnabled?: Ref<boolean>
}

export function useChessGame(options: UseChessGameOptions = {}) {
  const position = new Position()

  /** Dinaikkan setiap kali papan berubah — inilah dependensi semua computed. */
  const version = ref(0)
  const bump = () => {
    version.value++
  }

  const history = ref<HistoryEntry[]>([])
  const selected = ref<Square | null>(null)
  const lastMove = shallowRef<Move | null>(null)
  const pendingPromotion = shallowRef<PendingPromotion | null>(null)
  /** Antrean premove, dijalankan satu per satu begitu giliran manusia benar-benar tiba. */
  const premoveQueue = ref<Premove[]>([])
  /** Langkah premove yang baru saja gagal (tidak legal lagi) — untuk kedipan merah sesaat. */
  const premoveFailed = shallowRef<{ from: Square; to: Square } | null>(null)
  let premoveFailTimer: ReturnType<typeof setTimeout> | null = null
  const premoveEnabled = options.premoveEnabled ?? ref(true)

  const orientation = ref<Color>(WHITE)
  const mode = ref<GameMode>('lawan-komputer')
  const aiColor = ref<Color>('b')
  const elo = ref<EloRating>(DEFAULT_ELO)
  const showHints = ref(true)

  const thinking = ref(false)
  const lastSearch = ref<{ depth: number; nodes: number; timeMs: number } | null>(null)

  // ------------------------------------------------------------------
  // Turunan dari posisi
  // ------------------------------------------------------------------

  const board = computed<(Piece | null)[]>(() => {
    version.value
    return position.board.slice()
  })

  const turn = computed<Color>(() => {
    version.value
    return position.turn
  })

  const status = computed(() => {
    version.value
    return position.status()
  })

  const legalMoves = computed<Move[]>(() => {
    version.value
    return position.legalMoves()
  })

  const fen = computed(() => {
    version.value
    return position.fen()
  })

  const checkSquare = computed<Square | null>(() => {
    version.value
    return position.inCheck() ? position.kings[position.turn] : null
  })

  /**
   * Petak tujuan dari bidak yang sedang dipilih, beserta langkahnya. Saat
   * gilirannya sendiri, ini langkah legal sungguhan. Saat giliran mesin, ini
   * pola gerak bidak di papan bayangan (pseudo-legal, dengan antrean premove
   * yang sudah ada ikut diperhitungkan) — dipakai untuk menyiapkan premove
   * berikutnya, dan diperiksa ulang sebagai langkah sungguhan saat benar-benar
   * dijalankan.
   */
  const targets = computed<Map<Square, Move[]>>(() => {
    const map = new Map<Square, Move[]>()
    if (selected.value === null) return map

    if (canPlay.value !== null) {
      const piece = position.board[selected.value]
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
    const piece = projected.board[selected.value]
    if (!piece) return map
    for (const move of projected.pseudoMoves(colorOf(piece))) {
      if (move.from !== selected.value) continue
      const list = map.get(move.to)
      if (list) list.push(move)
      else map.set(move.to, [move])
    }
    return map
  })

  const humanColor = computed<Color | null>(() =>
    mode.value === 'lawan-komputer' ? opponent(aiColor.value) : null
  )

  /**
   * Papan bayangan: klon posisi sungguhan dengan seluruh antrean premove sudah
   * diterapkan berurutan. Dipakai untuk menghitung sasaran langkah premove
   * berikutnya (mis. menyusun langkah kedua seolah langkah pertama sudah
   * jalan) dan untuk menggambar bidak seolah sudah berpindah. Balasan lawan di
   * antaranya tidak ikut disimulasikan — memang tidak bisa ditebak.
   */
  const projectedPosition = computed<Position>(() => {
    version.value
    const clone = position.clone()
    const color = humanColor.value
    if (!color) return clone
    for (const step of premoveQueue.value) {
      const candidates = clone.pseudoMoves(color).filter((m) => m.from === step.from && m.to === step.to)
      if (candidates.length === 0) break
      const move = step.promotion
        ? (candidates.find((m) => m.promotion === step.promotion) ?? candidates[0])
        : candidates[0]
      clone.makeMove(move)
    }
    return clone
  })

  /** Papan yang ditampilkan: bidak sudah "dipindahkan" ke tujuan premove-nya, sekadar visual. */
  const displayBoard = computed<(Piece | null)[]>(() =>
    premoveQueue.value.length ? projectedPosition.value.board.slice() : board.value
  )

  /**
   * Susunan pertandingan — siapa lawannya, dan pemain memegang warna apa —
   * tidak boleh diubah di tengah permainan yang sudah berjalan.
   *
   * Keduanya satu aturan karena keduanya merusak hal yang sama. Mengganti lawan
   * di langkah kesepuluh berarti separuh papan dimainkan orang lain; menukar
   * warna berarti pemain tiba-tiba mewarisi posisi yang tadi dibangun melawan
   * dirinya sendiri. Papannya tetap sah menurut aturan catur, tapi tidak lagi
   * berarti apa-apa sebagai pertandingan.
   *
   * Patokannya langkah PEMAIN, bukan langkah pertama di papan. Kalau pemain
   * memegang hitam, komputer yang jalan lebih dulu — mengunci di langkah
   * pertama papan berarti lawan mustahil diganti sama sekali, karena
   * "Permainan baru" pun langsung disusul langkah komputer dalam hitungan
   * milidetik. Selama pemain belum menjalankan apa pun, belum ada yang
   * dipertaruhkan, jadi tidak ada yang perlu dilindungi.
   *
   * Membatalkan langkah sampai habis membuka kuncinya lagi, dengan sendirinya.
   */
  const setupLocked = computed<boolean>(
    () =>
      mode.value === 'lawan-komputer' &&
      history.value.some((entry) => entry.color === humanColor.value)
  )

  /** Manusia boleh menggerakkan warna ini sekarang. */
  const canPlay = computed<Color | null>(() => {
    if (status.value.over || thinking.value || pendingPromotion.value) return null
    if (mode.value === 'dua-pemain') return turn.value
    return turn.value === humanColor.value ? turn.value : null
  })

  /** Warna yang boleh menyiapkan premove sekarang — giliran mesin, tapi manusia sudah tahu mau ke mana. */
  const premoveColor = computed<Color | null>(() => {
    if (!premoveEnabled.value) return null
    if (mode.value !== 'lawan-komputer' || status.value.over || humanColor.value === null) return null
    return turn.value !== humanColor.value ? humanColor.value : null
  })

  const captured = computed(() => {
    const taken: Record<Color, PieceType[]> = { w: [], b: [] }
    for (const entry of history.value) {
      const piece = entry.move.captured
      if (piece) taken[colorOf(piece)].push(typeOf(piece))
    }
    taken.w.sort((a, b) => MATERIAL_VALUE[b] - MATERIAL_VALUE[a])
    taken.b.sort((a, b) => MATERIAL_VALUE[b] - MATERIAL_VALUE[a])
    return taken
  })

  /** Selisih materi; positif berarti Putih unggul. */
  const materialLead = computed(() => {
    version.value
    let lead = 0
    for (const piece of position.board) {
      if (!piece) continue
      const value = MATERIAL_VALUE[typeOf(piece)]
      lead += colorOf(piece) === WHITE ? value : -value
    }
    return lead
  })

  /** Riwayat dikelompokkan per nomor langkah, untuk tabel dua kolom. */
  const historyRows = computed(() => {
    const rows: { number: number; white?: HistoryEntry; black?: HistoryEntry }[] = []
    for (const entry of history.value) {
      let row = rows[rows.length - 1]
      if (!row || entry.color === WHITE || row.number !== entry.moveNumber) {
        row = { number: entry.moveNumber }
        rows.push(row)
      }
      if (entry.color === WHITE) row.white = entry
      else row.black = entry
    }
    return rows
  })

  // ------------------------------------------------------------------
  // Menjalankan langkah
  // ------------------------------------------------------------------

  function commit(move: Move): void {
    const entry: HistoryEntry = {
      move,
      san: position.toSAN(move, legalMoves.value),
      fen: '',
      moveNumber: position.fullmove,
      color: position.turn
    }
    position.makeMove(move)
    entry.fen = position.fen()

    history.value.push(entry)
    lastMove.value = move
    selected.value = null
    pendingPromotion.value = null
    bump()
    scheduleAi()
    runQueuedPremove()
  }

  /**
   * Coba jalankan langkah dari `from` ke `to`. Bila langkah itu adalah promosi,
   * dialog pilihan bidak dibuka dan langkah ditunda sampai pemain memilih.
   * Di luar giliran sendiri, ini menyiapkan premove sebagai gantinya.
   */
  function tryMove(from: Square, to: Square): boolean {
    if (canPlay.value !== null) {
      const candidates = legalMoves.value.filter((move) => move.from === from && move.to === to)
      if (candidates.length === 0) return false

      if (candidates[0].promotion) {
        pendingPromotion.value = { from, to, color: colorOf(candidates[0].piece), options: candidates }
        return true
      }
      commit(candidates[0])
      return true
    }
    return queuePremove(from, to)
  }

  /**
   * Antre langkah untuk dijalankan otomatis begitu giliran manusia tiba. Bisa
   * dipanggil lagi selagi antrean belum kosong untuk menambah langkah
   * berikutnya — sasarannya dihitung dari papan bayangan (`projectedPosition`),
   * yaitu seolah langkah-langkah yang sudah diantre lebih dulu sudah jalan.
   * Legalitas sungguhan baru diperiksa ulang satu per satu saat dieksekusi,
   * karena papan sesungguhnya bisa sudah berubah akibat langkah mesin.
   */
  function queuePremove(from: Square, to: Square): boolean {
    const color = premoveColor.value
    if (!color || premoveQueue.value.length >= MAX_PREMOVE_QUEUE) return false
    const projected = projectedPosition.value
    const piece = projected.board[from]
    if (!piece || colorOf(piece) !== color) return false
    const candidates = projected.pseudoMoves(color).filter((move) => move.from === from && move.to === to)
    if (candidates.length === 0) return false
    // Promosi premove selalu ke menteri — menunda dialog pemilihan sampai giliran
    // sungguhan tiba akan membingungkan, karena papan saat itu sudah bisa berbeda.
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
    return premoveQueue.value[0]?.from === square && !projectedPosition.value.board[square]
  }

  function cancelPremove(): void {
    premoveQueue.value = []
    if (premoveFailTimer !== null) {
      clearTimeout(premoveFailTimer)
      premoveFailTimer = null
    }
    premoveFailed.value = null
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

  /**
   * Dipanggil tiap giliran berpindah — coba jalankan langkah PALING DEPAN dari
   * antrean premove. Kalau sudah tidak legal, sisa antrean ikut dibuang:
   * langkah-langkah berikutnya dihitung dengan asumsi langkah ini berhasil,
   * jadi begitu asumsinya salah, sisanya juga tidak lagi bisa dipercaya.
   */
  function runQueuedPremove(): void {
    if (!premoveQueue.value.length) return
    if (mode.value !== 'lawan-komputer' || status.value.over || turn.value !== humanColor.value) return

    const pending = premoveQueue.value[0]
    const candidates = legalMoves.value.filter((move) => move.from === pending.from && move.to === pending.to)
    if (candidates.length === 0) {
      flagPremoveFailed(pending)
      premoveQueue.value = []
      return
    }
    premoveQueue.value = premoveQueue.value.slice(1)
    const move = pending.promotion
      ? (candidates.find((m) => m.promotion === pending.promotion) ?? candidates[0])
      : candidates[0]
    commit(move)
  }

  function completePromotion(type: PromotionType): void {
    const pending = pendingPromotion.value
    if (!pending) return
    const move = pending.options.find((option) => option.promotion === type)
    pendingPromotion.value = null
    if (move) commit(move)
  }

  function cancelPromotion(): void {
    pendingPromotion.value = null
    selected.value = null
  }

  /** Klik/ketuk sebuah petak: pilih bidak, pindah, batalkan pilihan, atau batalkan premove. */
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
      const piece = position.board[square]
      selected.value = piece && colorOf(piece) === playable ? square : null
      return
    }

    const color = premoveColor.value
    if (!color) {
      selected.value = null
      return
    }
    // Sasaran seleksi premove dibaca dari papan bayangan, bukan papan
    // sungguhan — supaya bidak yang "sudah dipindahkan" oleh premove
    // sebelumnya tetap bisa dipilih lagi untuk menyusun langkah berikutnya.
    const piece = projectedPosition.value.board[square]
    selected.value = piece && colorOf(piece) === color ? square : null
  }

  function dropPiece(from: Square, to: Square): void {
    if (from === to) return
    if (!tryMove(from, to)) selected.value = null
  }

  // ------------------------------------------------------------------
  // Kontrol permainan
  // ------------------------------------------------------------------

  function undo(): void {
    if (!history.value.length) return
    invalidateSearch()
    cancelPremove()

    const stopAt = humanColor.value
    do {
      position.undoMove()
      history.value.pop()
    } while (stopAt && history.value.length > 0 && position.turn !== stopAt)

    lastMove.value = history.value[history.value.length - 1]?.move ?? null
    selected.value = null
    pendingPromotion.value = null
    bump()
    scheduleAi()
  }

  function reset(startFen?: string): void {
    invalidateSearch()
    cancelPremove()
    position.load(startFen ?? START_FEN)
    history.value = []
    lastMove.value = null
    selected.value = null
    pendingPromotion.value = null
    lastSearch.value = null
    bump()
    scheduleAi()
  }

  function flipBoard(): void {
    orientation.value = opponent(orientation.value)
  }

  /**
   * Ganti sisi yang dimainkan manusia; komputer langsung mengambil giliran.
   *
   * Menolak diam-diam bila pertandingan sudah berjalan. Tombolnya di UI memang
   * sudah dinonaktifkan, tapi aturannya ditegakkan di sini juga: yang menjaga
   * keutuhan permainan seharusnya modelnya, bukan tombolnya — sama seperti
   * server yang tetap memvalidasi langkah walau klien sudah menyaringnya.
   */
  function playAs(color: Color): void {
    if (setupLocked.value) return
    aiColor.value = opponent(color)
    orientation.value = color
    scheduleAi()
  }

  // ------------------------------------------------------------------
  // Lawan komputer
  // ------------------------------------------------------------------

  let worker: Worker | null = null
  let workerBroken = false
  let requestId = 0
  let searchStartedAt = 0
  let replyTimer: ReturnType<typeof setTimeout> | null = null

  function getWorker(): Worker | null {
    if (worker || workerBroken) return worker
    try {
      worker = new Worker(new URL('../engine/ai.worker.ts', import.meta.url), { type: 'module' })
      worker.addEventListener('message', (event: MessageEvent<AiResponse>) => applyAiResult(event.data))
      worker.addEventListener('error', () => {
        // Beberapa lingkungan melarang module worker — jatuh ke mode sinkron.
        workerBroken = true
        worker?.terminate()
        worker = null
        thinking.value = false
        scheduleAi()
      })
    } catch {
      workerBroken = true
      worker = null
    }
    return worker
  }

  /** Hasil pencarian yang sudah tidak relevan (mis. setelah undo) diabaikan. */
  function invalidateSearch(): void {
    requestId++
    thinking.value = false
    if (replyTimer !== null) {
      clearTimeout(replyTimer)
      replyTimer = null
    }
  }

  /**
   * Menahan hasil pencarian sampai jeda minimum terpenuhi. Tanpa ini, level
   * rendah — yang kadang menjawab dengan langkah acak tanpa mencari sama sekali —
   * membalas dalam hitungan milidetik dan papan terasa melompat sendiri.
   */
  function applyAiResult(result: AiResponse): void {
    if (result.id !== requestId) return
    const remaining = MIN_REPLY_MS - (Date.now() - searchStartedAt)
    if (remaining <= 0) {
      finishAiResult(result)
      return
    }
    // Indikator "berpikir" sengaja dibiarkan menyala selama sisa jeda.
    replyTimer = setTimeout(() => {
      replyTimer = null
      finishAiResult(result)
    }, remaining)
  }

  function finishAiResult(result: AiResponse): void {
    // Diperiksa ulang: pemain bisa saja membatalkan langkah selagi jeda berjalan.
    if (result.id !== requestId) return
    thinking.value = false
    lastSearch.value = { depth: result.depth, nodes: result.nodes, timeMs: result.timeMs }
    if (result.from === null || result.to === null) return

    const move = position
      .legalMoves()
      .find((m) => m.from === result.from && m.to === result.to && m.promotion === result.promotion)
    if (move) commit(move)
  }

  function scheduleAi(): void {
    if (mode.value !== 'lawan-komputer') return
    if (position.turn !== aiColor.value) return
    if (position.status().over || pendingPromotion.value) return

    const id = ++requestId
    thinking.value = true
    searchStartedAt = Date.now()
    const request: AiRequest = { id, fen: position.fen(), elo: elo.value }

    const activeWorker = getWorker()
    if (activeWorker) {
      activeWorker.postMessage(request)
      return
    }

    // Cadangan tanpa worker: beri browser satu frame untuk menggambar indikator
    // "berpikir" sebelum pencarian memblokir thread utama.
    setTimeout(() => {
      if (id !== requestId) return
      const started = Date.now()
      const result = chooseMove(position, elo.value)
      applyAiResult({
        id,
        from: result.move?.from ?? null,
        to: result.move?.to ?? null,
        promotion: result.move?.promotion ?? null,
        score: result.score,
        depth: result.depth,
        nodes: result.nodes,
        timeMs: Date.now() - started
      })
    }, 50)
  }

  watch([mode, aiColor, elo], () => {
    invalidateSearch()
    cancelPremove()
    scheduleAi()
  })

  watch(premoveEnabled, (enabled) => {
    if (!enabled) cancelPremove()
  })

  onScopeDispose(() => {
    invalidateSearch()
    worker?.terminate()
    worker = null
    if (premoveFailTimer !== null) clearTimeout(premoveFailTimer)
  })

  scheduleAi()

  return {
    // state
    board,
    displayBoard,
    turn,
    status,
    fen,
    history,
    historyRows,
    selected,
    targets,
    lastMove,
    checkSquare,
    captured,
    materialLead,
    canPlay,
    humanColor,
    setupLocked,
    pendingPromotion,
    premoveQueue,
    premoveFailed,
    premoveColor,
    premoveEnabled,
    thinking,
    lastSearch,
    // pengaturan
    orientation,
    mode,
    aiColor,
    elo,
    showHints,
    eloLevels: ELO_LEVELS,
    strengthProfiles: STRENGTH_PROFILES,
    // aksi
    activateSquare,
    dropPiece,
    completePromotion,
    cancelPromotion,
    cancelPremove,
    undo,
    reset,
    flipBoard,
    playAs,
    // util
    algebraic
  }
}

export type ChessGame = ReturnType<typeof useChessGame>
