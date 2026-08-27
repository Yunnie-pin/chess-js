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
import { DEFAULT_ELO, ELO_LEVELS, STRENGTH_PROFILES } from '@chess/shared/ai'
import type { EloRating } from '@chess/shared/ai'
import type { AiResponse } from '../engine/ai.worker.ts'
import { findBestMove as findBestStockfishMove } from '../engine/stockfishEngine.ts'
import type { StockfishMove } from '../engine/stockfishEngine.ts'
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

/**
 * Fase pertandingan:
 * - `setup`   — papan awal tergambar tapi BEKU; lawan, warna, dan level bebas
 *               diganti; tidak ada satu bidak pun yang bergerak.
 * - `playing` — pertandingan berjalan; susunan terkunci.
 * - `finished`— permainan usai (skakmat/remis); menunggu "Permainan baru".
 */
export type GamePhase = 'setup' | 'playing' | 'finished'

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
   * Sakelar premove, dibagi dari luar (App.vue, dari `settings.ts`) supaya
   * nilainya sama di mode offline dan online sekaligus — checkbox-nya cuma ada
   * satu tapi dipakai di kedua papan.
   */
  premoveEnabled?: Ref<boolean>
  /**
   * Sakelar undo, dibagi dari luar (App.vue) dengan cara yang sama seperti
   * `premoveEnabled`. Ditegakkan di `undo()` sendiri, bukan cuma di tombolnya —
   * sama seperti `playAs` di bawah, yang menjaga keutuhan permainan seharusnya
   * modelnya, bukan UI-nya.
   */
  undoEnabled?: Ref<boolean>
  /**
   * Lawan komputer SELALU Stockfish — tidak ada sakelar mesin lain di UI.
   * Satu-satunya alasan ini bisa diganti adalah pengujian: Node tidak punya
   * `Worker`/WASM, jadi tes menyuntikkan pengganti sinkron di sini alih-alih
   * diam-diam jatuh ke mesin buatan sendiri (`shared/src/ai.ts`) yang memang
   * sengaja tidak lagi dipanggil dari jalur permainan.
   */
  findBestMove?: typeof findBestStockfishMove
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
  const undoEnabled = options.undoEnabled ?? ref(true)
  const findBestMove = options.findBestMove ?? findBestStockfishMove

  const orientation = ref<Color>(WHITE)
  const mode = ref<GameMode>('lawan-komputer')
  const aiColor = ref<Color>('b')
  const elo = ref<EloRating>(DEFAULT_ELO)

  const thinking = ref(false)
  const lastSearch = ref<{ depth: number; nodes: number; timeMs: number } | null>(null)

  /**
   * Fase pertandingan — lihat `GamePhase`. Mulai dari `setup`: papan awal sudah
   * digambar tapi beku sampai "Mulai" ditekan. "Permainan baru" mengembalikannya
   * ke `setup` lagi, jadi tiap pertandingan punya jendela penyiapan yang sama —
   * bukan cuma yang pertama.
   */
  const phase = ref<GamePhase>('setup')

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
    for (const move of projected.premoveMoves(colorOf(piece))) {
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
  const displayBoard = computed<(Piece | null)[]>(() =>
    premoveQueue.value.length ? projectedPosition.value.board.slice() : board.value
  )

  /**
   * Susunan pertandingan — siapa lawannya, dan pemain memegang warna apa —
   * tidak boleh diubah di tengah permainan yang sudah berjalan. Mengganti lawan
   * di langkah kesepuluh berarti separuh papan dimainkan orang lain; menukar
   * warna berarti pemain mewarisi posisi yang tadi dibangun melawan dirinya
   * sendiri.
   *
   * Terkunci begitu keluar dari fase `setup` — yaitu tepat saat "Mulai"
   * ditekan. "Permainan baru" membawanya kembali ke `setup`, dan membatalkan
   * langkah sampai papan kosong pun mengembalikannya ke sana.
   */
  const setupLocked = computed<boolean>(
    () => mode.value === 'lawan-komputer' && phase.value !== 'setup'
  )

  /** Manusia boleh menggerakkan warna ini sekarang. */
  const canPlay = computed<Color | null>(() => {
    if (phase.value !== 'playing' || status.value.over || thinking.value || pendingPromotion.value) {
      return null
    }
    if (mode.value === 'dua-pemain') return turn.value
    return turn.value === humanColor.value ? turn.value : null
  })

  /** Warna yang boleh menyiapkan premove sekarang — giliran mesin, tapi manusia sudah tahu mau ke mana. */
  const premoveColor = computed<Color | null>(() => {
    if (phase.value !== 'playing' || !premoveEnabled.value) return null
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
    if (position.status().over) phase.value = 'finished'
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
    const candidates = projected.premoveMoves(color).filter((move) => move.from === from && move.to === to)
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
    if (!undoEnabled.value || !history.value.length) return
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
    // Membatalkan sampai papan kosong = seperti belum dimulai; kalau permainan
    // tadi sudah usai lalu dibuka lagi lewat undo, kembali ke `playing`.
    if (!history.value.length) phase.value = 'setup'
    else if (phase.value === 'finished' && !position.status().over) phase.value = 'playing'
    scheduleAi()
  }

  /** Muat posisi baru & bersihkan seluruh state turunannya. Tidak menyentuh `phase`. */
  function loadPosition(fen: string): void {
    invalidateSearch()
    cancelPremove()
    position.load(fen)
    history.value = []
    lastMove.value = null
    selected.value = null
    pendingPromotion.value = null
    lastSearch.value = null
    bump()
  }

  /**
   * "Permainan baru" — kembali ke fase PENYIAPAN. Papan awal langsung tergambar
   * tapi beku: lawan dan warna bebas diganti, dan tidak ada bidak yang bergerak
   * sampai `startGame()`.
   */
  function newGame(): void {
    loadPosition(START_FEN)
    phase.value = 'setup'
  }

  /**
   * "Mulai" — dari penyiapan ke bermain. Mesin langsung mengambil giliran bila
   * pemain memegang hitam; kalau putih, papan tinggal menunggu langkahnya.
   */
  function startGame(): void {
    if (phase.value !== 'setup') return
    phase.value = 'playing'
    scheduleAi()
  }

  /**
   * Muat sebuah posisi lalu LANGSUNG bermain darinya — dipakai tes untuk
   * menyiapkan skenario. Alur produksi memakai `newGame()` + `startGame()`.
   */
  function reset(startFen?: string): void {
    loadPosition(startFen ?? START_FEN)
    phase.value = 'playing'
    scheduleAi()
  }

  function flipBoard(): void {
    orientation.value = opponent(orientation.value)
  }

  /**
   * Ganti sisi yang dimainkan manusia. Hanya berpengaruh di fase `setup` —
   * mesin belum jalan sampai "Mulai" ditekan, jadi memilih hitam di sini TIDAK
   * lagi memicu langkah pertama komputer.
   *
   * Menolak diam-diam di luar `setup`. Tombolnya di UI memang sudah
   * dinonaktifkan, tapi aturannya ditegakkan di model juga — sama seperti server
   * yang tetap memvalidasi langkah walau klien sudah menyaringnya.
   */
  function playAs(color: Color): void {
    if (setupLocked.value) return
    aiColor.value = opponent(color)
    orientation.value = color
  }

  // ------------------------------------------------------------------
  // Lawan komputer
  // ------------------------------------------------------------------

  let requestId = 0
  let searchStartedAt = 0
  let replyTimer: ReturnType<typeof setTimeout> | null = null

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

  /**
   * Lawan komputer SELALU Stockfish (lewat `findBestMove`, sungguhan atau
   * pengganti tes) — mesin buatan sendiri di `shared/src/ai.ts` sengaja tidak
   * lagi dipanggil dari sini sama sekali, bukan sekadar cadangan.
   */
  function scheduleAi(): void {
    if (phase.value !== 'playing' || mode.value !== 'lawan-komputer') return
    if (position.turn !== aiColor.value) return
    if (position.status().over || pendingPromotion.value) return

    const id = ++requestId
    thinking.value = true
    searchStartedAt = Date.now()

    const fen = position.fen()
    const movetimeMs = STRENGTH_PROFILES[elo.value].timeMs
    findBestMove(fen, elo.value, movetimeMs)
      .then((move: StockfishMove | null) => {
        applyAiResult({
          id,
          from: move?.from ?? null,
          to: move?.to ?? null,
          promotion: move?.promotion ?? null,
          score: 0,
          depth: 0,
          nodes: 0,
          timeMs: Date.now() - searchStartedAt
        })
      })
      .catch((error: unknown) => {
        // Tidak ada jalan lain di sini secara sengaja — lawan hanya diam
        // menunggu daripada balik memakai mesin buatan sendiri.
        if (id !== requestId) return
        console.error('Stockfish gagal dimuat:', error)
        thinking.value = false
      })
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
    if (premoveFailTimer !== null) clearTimeout(premoveFailTimer)
  })

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
    phase,
    pendingPromotion,
    premoveQueue,
    premoveFailed,
    premoveColor,
    premoveEnabled,
    undoEnabled,
    thinking,
    lastSearch,
    // pengaturan
    orientation,
    mode,
    aiColor,
    elo,
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
    newGame,
    startGame,
    flipBoard,
    playAs,
    // util
    algebraic
  }
}

export type ChessGame = ReturnType<typeof useChessGame>
