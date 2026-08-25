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

import { Position, START_FEN, WHITE, algebraic, colorOf, opponent, typeOf } from '@chess/shared/chess'
import { DIFFICULTY_PROFILES, chooseMove } from '@chess/shared/ai'
import type { Difficulty } from '@chess/shared/ai'
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

const MATERIAL_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/**
 * Jeda minimum antara langkah pemain dan jawaban komputer. Ini batas bawah,
 * bukan tambahan: pencarian yang sudah melampauinya menjawab begitu selesai,
 * jadi level tinggi tidak jadi lebih lambat.
 */
export const MIN_REPLY_MS = 500

export function useChessGame() {
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

  const orientation = ref<Color>(WHITE)
  const mode = ref<GameMode>('lawan-komputer')
  const aiColor = ref<Color>('b')
  const difficulty = ref<Difficulty>('sedang')
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

  /** Petak tujuan yang sah dari bidak yang sedang dipilih, beserta langkahnya. */
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

  const humanColor = computed<Color | null>(() =>
    mode.value === 'lawan-komputer' ? opponent(aiColor.value) : null
  )

  /** Manusia boleh menggerakkan warna ini sekarang. */
  const canPlay = computed<Color | null>(() => {
    if (status.value.over || thinking.value || pendingPromotion.value) return null
    if (mode.value === 'dua-pemain') return turn.value
    return turn.value === humanColor.value ? turn.value : null
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
  }

  /**
   * Coba jalankan langkah dari `from` ke `to`. Bila langkah itu adalah promosi,
   * dialog pilihan bidak dibuka dan langkah ditunda sampai pemain memilih.
   */
  function tryMove(from: Square, to: Square): boolean {
    if (canPlay.value === null) return false
    const candidates = legalMoves.value.filter((move) => move.from === from && move.to === to)
    if (candidates.length === 0) return false

    if (candidates[0].promotion) {
      pendingPromotion.value = { from, to, color: colorOf(candidates[0].piece), options: candidates }
      return true
    }
    commit(candidates[0])
    return true
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

  /** Klik/ketuk sebuah petak: pilih bidak, pindah, atau batalkan pilihan. */
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

    const piece = position.board[square]
    selected.value = piece && playable && colorOf(piece) === playable ? square : null
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

  /** Ganti sisi yang dimainkan manusia; komputer langsung mengambil giliran. */
  function playAs(color: Color): void {
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
    const request: AiRequest = { id, fen: position.fen(), difficulty: difficulty.value }

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
      const result = chooseMove(position, difficulty.value)
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

  watch([mode, aiColor, difficulty], () => {
    invalidateSearch()
    scheduleAi()
  })

  onScopeDispose(() => {
    invalidateSearch()
    worker?.terminate()
    worker = null
  })

  scheduleAi()

  return {
    // state
    board,
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
    pendingPromotion,
    thinking,
    lastSearch,
    // pengaturan
    orientation,
    mode,
    aiColor,
    difficulty,
    showHints,
    difficultyProfiles: DIFFICULTY_PROFILES,
    // aksi
    activateSquare,
    dropPiece,
    completePromotion,
    cancelPromotion,
    undo,
    reset,
    flipBoard,
    playAs,
    // util
    algebraic
  }
}

export type ChessGame = ReturnType<typeof useChessGame>
