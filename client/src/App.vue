<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'

import CapturedPieces from './components/CapturedPieces.vue'
import ChessBoard from './components/ChessBoard.vue'
import EvalBar from './components/EvalBar.vue'
import GameControls from './components/GameControls.vue'
import GameReviewPanel from './components/GameReviewPanel.vue'
import PgnImport from './components/PgnImport.vue'
import LanguageSwitch from './components/LanguageSwitch.vue'
import SettingsMenu from './components/SettingsMenu.vue'
import MoveHistory from './components/MoveHistory.vue'
import OnlineLobby from './components/OnlineLobby.vue'
import OpponentHalo from './components/OpponentHalo.vue'
import OpponentFace from './components/OpponentFace.vue'
import OpponentPortrait from './components/OpponentPortrait.vue'
import PromotionDialog from './components/PromotionDialog.vue'
import RepoLink from './components/RepoLink.vue'
import RoomPanel from './components/RoomPanel.vue'
import { useChessGame } from './composables/useChessGame.ts'
import { useOnlineGame } from './composables/useOnlineGame.ts'
import { useGameReview } from './composables/useGameReview.ts'
import { replayMoves, toPgn, type GameRecord, type PgnParseResult, type PgnResult } from './engine/gameRecord.ts'
import { openingName } from './engine/openings.ts'
import { nearestMoment, type MoveClass } from './engine/moveClassify.ts'
import { useI18n } from './i18n/index.ts'
import { HOST, opponentFor, type Opponent } from './opponents.ts'
import { applyTheme } from './theme.ts'
import { resolveServerUrl } from './net/serverUrl.ts'
import {
  premoveEnabled,
  showEvalBar,
  showHints,
  showSuggestion,
  soundEnabled,
  undoEnabled
} from './settings.ts'
import { endSound, soundsForMove, type SoundName } from './sound/moveSound.ts'
import { appendedPlies, justResigned, opponentJoined } from './sound/onlineSounds.ts'
import { alertTab } from './sound/tabAlert.ts'
import { playSounds, primeAudioOnFirstGesture } from './sound/synth.ts'
import { analysePosition, stopAnalysis, type Evaluation } from './engine/stockfishEngine.ts'
import { Position, START_FEN, opponent } from '@chess/shared/chess'
import type { Color, GameEndReason, Move, Piece, PieceType, Square } from '@chess/shared/types'

type AppMode = 'offline' | 'online'

const { t, formatNumber } = useI18n()

// Sakelar bantuan bermain (petunjuk, premove, undo, bilah evaluasi) tinggal di
// `settings.ts`, yang menyimpannya ke localStorage. `premoveEnabled` diteruskan
// ke kedua composable supaya satu checkbox berlaku di mode offline dan online;
// `undoEnabled` cuma ke yang offline (di online papan milik server).
const offline = useChessGame({ premoveEnabled, undoEnabled })
const online = useOnlineGame(resolveServerUrl(), { premoveEnabled })

const appMode = ref<AppMode>('offline')
const orientation = ref<Color>('w')
const chessBoardRef = ref<InstanceType<typeof ChessBoard> | null>(null)

const colorName = (color: Color): string => t(`color.${color}`)
const endMessage = (reason: GameEndReason): string => t(`end.${reason}`)

const isOnline = computed(() => appMode.value === 'online')

/*
 * Karakter yang sedang "menemani" halaman: lawan komputer kalau memang sedang
 * melawan komputer, selain itu Mari — dialah tuan rumahnya. Dua pemain dan
 * mode online tidak punya lawan mesin, jadi memilihkan wajah untuk keduanya
 * hanya akan menipu.
 */
/** Partai hasil impor PGN sedang dibuka — bukan partai melawan siapa pun di sini. */
const analysing = computed(() => !isOnline.value && offline.phase.value === 'analysis')
/**
 * Benar-benar melawan mesin sekarang. Mode 'lawan-komputer' saja tidak cukup:
 * partai impor tetap membawa mode terakhir, tapi lawannya bukan karakter itu.
 */
const vsComputer = computed(
  () => !isOnline.value && offline.mode.value === 'lawan-komputer' && !analysing.value
)

/** Tag PGN partai impor — nama pemain dan hasil — selama fase analisis. */
const importedGame = shallowRef<{ tags: Record<string, string>; result: PgnResult } | null>(null)

const host = computed(() => (vsComputer.value ? opponentFor(offline.elo.value) : HOST))

// Warna aksen, papan, dan pendar halaman ikut karakter yang sedang menemani.
watchEffect(() => applyTheme(host.value.theme))

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

const plyCount = computed(() =>
  isOnline.value ? (online.roomState.value?.history.length ?? 0) : offline.history.value.length
)

/**
 * Penelusuran riwayat: `null` berarti "ikuti posisi sekarang"; sebuah angka
 * berarti "tampilkan posisi setelah sekian ply", terlepas dari giliran
 * sungguhannya. Murni tampilan — tidak pernah mengubah permainan yang
 * sebenarnya, dan diset ulang ke `null` setiap kali riwayatnya sendiri
 * berubah (langkah baru, undo, permainan baru, main lagi).
 *
 * Dijepit ke `plyCount` saat dibaca (bukan saat ditulis) supaya kalau
 * riwayatnya memendek di belakang layar — undo, misalnya — penelusuran yang
 * sudah basi tidak menunjuk ke ply yang tidak ada lagi.
 */
const viewPly = ref<number | null>(null)
const displayPly = computed(() => Math.min(viewPly.value ?? plyCount.value, plyCount.value))
const isLive = computed(() => displayPly.value === plyCount.value)

/** Posisi yang sedang ditelusuri, atau null bila sedang mengikuti posisi sekarang. */
const viewedPosition = computed<Position | null>(() => {
  if (isLive.value) return null
  if (isOnline.value) {
    // Riwayat jaringan cuma menyimpan from/to/promotion, bukan Move penuh —
    // jalankan ulang dari awal dan biarkan legalMoves() sendiri yang
    // melengkapi castle/en passant/dst. dari posisi yang sedang dibangun.
    const history = online.roomState.value?.history ?? []
    const position = new Position()
    for (let i = 0; i < displayPly.value; i++) {
      const wire = history[i]?.move
      const match = wire
        ? position
            .legalMoves()
            .find((m) => m.from === wire.from && m.to === wire.to && m.promotion === wire.promotion)
        : null
      if (!match) break
      position.makeMove(match)
    }
    return position
  }
  const entry = offline.history.value[displayPly.value - 1]
  return new Position(entry ? entry.fen : START_FEN)
})

// Papan bayangan: kalau ada premove diantre, bidaknya sudah tampak "berpindah"
// ke tujuannya walau langkah sungguhannya belum dikirim/dijalankan. Kalau
// sedang menelusuri riwayat, itu yang ditampilkan sebagai gantinya.
const board = computed<(Piece | null)[]>(() => {
  const viewed = viewedPosition.value
  if (viewed) return viewed.board.slice()
  return isOnline.value ? online.displayBoard.value : offline.displayBoard.value
})
const turn = computed<Color>(() => {
  const viewed = viewedPosition.value
  if (viewed) return viewed.turn
  return isOnline.value ? online.turn.value : offline.turn.value
})
const checkSquare = computed<Square | null>(() => {
  const viewed = viewedPosition.value
  if (viewed) return viewed.inCheck() ? viewed.kings[viewed.turn] : null
  return isOnline.value ? online.checkSquare.value : offline.checkSquare.value
})
const lastMove = computed<Move | null>(() => {
  if (isLive.value) return isOnline.value ? online.lastMove.value : offline.lastMove.value
  if (displayPly.value === 0) return null
  if (isOnline.value) {
    const wire = online.roomState.value?.history[displayPly.value - 1]?.move
    return wire
      ? ({
          from: wire.from,
          to: wire.to,
          promotion: wire.promotion,
          piece: 'wp', // tidak dipakai untuk menggambar sorotan
          captured: null,
          castle: null,
          enPassant: false,
          doublePush: false
        } as Move)
      : null
  }
  return offline.history.value[displayPly.value - 1]?.move ?? null
})

// Memilih bidak, premove, dan giliran hanya berlaku pada posisi sekarang —
// menelusuri riwayat murni membaca, tidak pernah menyiapkan langkah apa pun.
const selected = computed<Square | null>(() =>
  isLive.value ? (isOnline.value ? online.selected.value : offline.selected.value) : null
)
const targets = computed<Map<Square, Move[]>>(() =>
  isLive.value ? (isOnline.value ? online.targets.value : offline.targets.value) : new Map()
)
const canPlay = computed<Color | null>(() =>
  isLive.value ? (isOnline.value ? online.canPlay.value : offline.canPlay.value) : null
)

// ---------------------------------------------------------------------------
// Analisis Stockfish (worker tersendiri) — sumber bilah evaluasi DAN panah
// saran. Menilai posisi yang SEDANG tampil sekuat mungkin, lepas dari kekuatan
// bot, jadi keduanya jujur.
// ---------------------------------------------------------------------------

/** Bilah evaluasi: lawan komputer atau partai impor, dan hanya bila sakelarnya sendiri menyala. */
const evalBarVisible = computed(() => showEvalBar.value && (vsComputer.value || analysing.value))
/** Panah saran: lawan komputer ATAU dua pemain (tidak online). */
const suggestionEnabled = computed(() => showSuggestion.value && !isOnline.value)
/** Worker analisis jalan bila salah satu fitur memerlukannya. */
const analysisActive = computed(() => evalBarVisible.value || suggestionEnabled.value)

/** FEN posisi yang tampil: yang sedang ditelusuri, atau posisi sekarang. */
const analysedFen = computed(() => viewedPosition.value?.fen() ?? offline.fen.value)

/**
 * FEN yang benar-benar dikirim ke analiser — atau null untuk menjedanya.
 *
 * Kalau cuma panah saran yang dipakai (bilah evaluasi mati), tidak ada gunanya
 * menganalisis giliran LAWAN di posisi live: panahnya toh disembunyikan, dan
 * worker langkah bot sudah menghabiskan satu inti sendiri. Menelusuri riwayat
 * tetap dianalisis — di sanalah panah saran jadi alat review.
 */
const analysisFen = computed<string | null>(() => {
  if (!analysisActive.value) return null
  // Partai impor tidak punya "giliran lawan" — posisi live-nya pun bahan analisis.
  if (!evalBarVisible.value && isLive.value && canPlay.value === null && !analysing.value) return null
  return analysedFen.value
})

const evaluation = ref<Evaluation | null>(null)

// ---------------------------------------------------------------------------
// Catatan partai + ulasan pasca-partai. Offline dan online memakai bentuk
// catatan yang sama; bedanya hanya KAPAN ulasan boleh dibuka.
// ---------------------------------------------------------------------------

/**
 * Partai yang sedang tampil: FEN tiap posisi, langkah, SAN. Offline sudah
 * menyimpan FEN per langkah; online cuma punya from/to/promotion dari server,
 * jadi dimainkan ulang dari posisi awal.
 */
const gameRecord = computed<GameRecord>(() => {
  if (isOnline.value) return replayMoves((online.roomState.value?.history ?? []).map((entry) => entry.move))
  const history = offline.history.value
  return {
    fens: [START_FEN, ...history.map((entry) => entry.fen)],
    moves: history.map((entry) => entry.move),
    sans: history.map((entry) => entry.san)
  }
})
const reviewFens = computed(() => gameRecord.value.fens)
const reviewMoves = computed(() => gameRecord.value.moves)
const reviewSans = computed(() => gameRecord.value.sans)
const gameReview = useGameReview(reviewFens, reviewMoves)

/** Partai online sudah usai — mat/remis di papan, atau salah satu menyerah. */
const onlineOver = computed(
  () => !!online.roomState.value?.resignedBy || !!online.gameStatus.value?.over
)

/**
 * Tombol ulasan muncul hanya sesudah partai usai. Untuk online ini bukan
 * sekadar kerapian: membuka mesin selagi partai berjalan sama saja dengan
 * curang, jadi gerbangnya di sini — sama dengan bilah evaluasi dan panah
 * saran yang memang tidak pernah menyala di mode online.
 */
const reviewAvailable = computed(() =>
  isOnline.value
    ? onlineOver.value
    : offline.phase.value === 'finished' || offline.phase.value === 'analysis'
)
const reviewMarks = computed(() => gameReview.review.value?.plies.map((ply) => ply?.cls ?? null) ?? [])

/** Nama pembukaan sampai posisi yang sedang tampil — ikut berubah saat menelusuri riwayat. */
const openingLabel = computed(() => openingName(gameRecord.value.fens.slice(0, displayPly.value + 1)))

/** Hasil dalam notasi PGN; '*' selama partai belum usai. */
const pgnResult = computed<PgnResult>(() => {
  if (analysing.value) return importedGame.value?.result ?? '*'
  if (!isOnline.value) return offline.status.value.result
  const resigned = online.roomState.value?.resignedBy
  if (resigned) return resigned === 'w' ? '0-1' : '1-0'
  return online.gameStatus.value?.result ?? '*'
})

/** Umpan balik singkat sesudah PGN disalin: 'copied', 'failed', atau null. */
const pgnFeedback = ref<'copied' | 'failed' | null>(null)
let pgnFeedbackTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Nama pemain untuk tag PGN — polos, tanpa "(Anda)" atau "— terputus" yang
 * dipakai `playerLabel` di layar. Sisi mesin dicatat dengan Elo-nya, seperti
 * kebiasaan PGN dari partai lawan komputer.
 */
function pgnName(color: Color): string {
  if (isOnline.value) {
    return online.roomState.value?.players.find((entry) => entry.seat === color)?.name ?? '?'
  }
  if (analysing.value) return importedName(color) ?? '?'
  if (offline.mode.value === 'dua-pemain') return colorName(color)
  if (color === offline.humanColor.value) return t('player.you')
  return `${host.value.name} (Stockfish ${offline.elo.value})`
}

/**
 * Nama di kartu akurasi: tanpa "(Putih)" — titik warna di kartu sudah
 * mengatakannya — dan tanpa Elo, supaya muat di setengah lebar panel.
 */
function reviewName(color: Color): string {
  if (vsComputer.value && color !== offline.humanColor.value) return host.value.name
  return pgnName(color)
}

async function copyPgn(): Promise<void> {
  const opening = openingName(gameRecord.value.fens)
  const pgn = toPgn({
    sans: gameRecord.value.sans,
    result: pgnResult.value,
    white: pgnName('w'),
    black: pgnName('b'),
    date: new Date(),
    event: 'Chess with Mari',
    extraTags: opening ? { Opening: opening } : {}
  })
  try {
    await navigator.clipboard.writeText(pgn)
    pgnFeedback.value = 'copied'
  } catch {
    // Clipboard ditolak (izin, konteks tidak aman, dsb.) — katakan terus terang.
    pgnFeedback.value = 'failed'
  }
  if (pgnFeedbackTimer) clearTimeout(pgnFeedbackTimer)
  pgnFeedbackTimer = setTimeout(() => (pgnFeedback.value = null), 2000)
}

watch(
  analysisFen,
  (fen) => {
    if (fen) {
      analysePosition(fen, (result) => {
        evaluation.value = result
        gameReview.remember(result)
      })
    } else {
      stopAnalysis()
      evaluation.value = null
    }
  },
  { immediate: true }
)

onBeforeUnmount(stopAnalysis)

/**
 * Evaluasi yang ditampilkan: hasil live bila sudah untuk posisi ini dan
 * setidaknya sedalam yang tersimpan; selain itu hasil tersimpan (dari ulasan
 * atau kunjungan sebelumnya), supaya menelusuri partai yang sudah diulas
 * langsung menampilkan angka tanpa menunggu mesin mulai dari kedalaman 1.
 */
const shownEvaluation = computed<Evaluation | null>(() => {
  const live = evaluation.value
  const cached = gameReview.cachedEvaluation(analysedFen.value)
  if (live && live.fen === analysedFen.value && (!cached || live.depth >= cached.depth)) return live
  return cached ?? live
})

/**
 * Langkah terbaik di posisi SEBELUM langkah yang sedang tampil, bila langkah
 * itu diberi label ?!, ?, atau ??. Digambar di papan sesudah langkahnya —
 * sorotan langkah terakhir menunjukkan apa yang dimainkan, panahnya apa yang
 * seharusnya. Tidak ikut sakelar panah saran: pemain sendiri yang meminta ulasan.
 */
const reviewBetterMove = computed<{ from: Square; to: Square } | null>(() => {
  const ply = displayPly.value
  const mark = ply > 0 ? reviewMarks.value[ply - 1] : null
  if (!mark || mark === 'best' || mark === 'good') return null
  return gameReview.scores.value[ply - 1]?.moves[0] ?? null
})

/**
 * Badge label ulasan di papan: langkah yang sedang tampil (ply `displayPly`),
 * ditempel di petak tujuannya — `lastMove` sudah mengikuti penelusuran, dan
 * untuk rokade itu petak raja. Kosong sebelum ulasan berjalan.
 */
const boardMoveBadge = computed<{ square: Square; cls: MoveClass } | null>(() => {
  const ply = displayPly.value
  const cls = ply > 0 ? reviewMarks.value[ply - 1] : null
  const to = lastMove.value?.to
  return cls && to !== undefined ? { square: to, cls } : null
})

/** Kedalaman minimal sebelum panah saran ditampilkan — supaya tidak lompat-lompat sebelum mengendap. */
const SUGGESTION_MIN_DEPTH = 6

/**
 * Panah saran: beberapa langkah teratas menurut analiser (MultiPV) untuk posisi
 * yang tampil, terurut dari terbaik. `ChessBoard` menggambar yang pertama paling
 * tegas, sisanya makin redup.
 *
 * Live → hanya saat giliran pihak yang boleh digerakkan (`canPlay`). Menelusuri
 * riwayat → untuk posisi yang dilihat, siapa pun yang jalan (alat review).
 * Hasil analiser dibuang kalau `fen`-nya sudah tidak cocok (basi sesaat setelah
 * lawan menjawab) atau kedalamannya belum cukup.
 */
const suggestionArrows = computed<{ from: Square; to: Square }[]>(() => {
  // Ulasan berbicara lebih dulu: di langkah yang salah, satu-satunya panah
  // adalah langkah yang seharusnya — pasangan visual kartu "Lebih baik: …".
  if (reviewBetterMove.value) return [reviewBetterMove.value]
  if (!suggestionEnabled.value) return []
  if (isLive.value && canPlay.value === null && !analysing.value) return []
  const result = shownEvaluation.value
  if (!result || result.fen !== analysedFen.value || result.depth < SUGGESTION_MIN_DEPTH) return []
  // Selama ulasan, papan dibuat setenang mungkin: satu panah saja, bukan tiga.
  return gameReview.status.value === 'idle' ? result.moves : result.moves.slice(0, 1)
})

const premoveColor = computed<Color | null>(() =>
  isLive.value ? (isOnline.value ? online.premoveColor.value : offline.premoveColor.value) : null
)
const premoveQueue = computed<{ from: Square; to: Square }[]>(() =>
  isLive.value
    ? (isOnline.value ? online.premoveQueue.value : offline.premoveQueue.value).map((step) => ({
        from: step.from,
        to: step.to
      }))
    : []
)
const premoveFailed = computed<{ from: Square; to: Square } | null>(() =>
  isLive.value ? (isOnline.value ? online.premoveFailed.value : offline.premoveFailed.value) : null
)
const premoveBannerText = computed(() =>
  premoveQueue.value.length > 1
    ? `${t('premove.queued')} (${premoveQueue.value.length})`
    : t('premove.queued')
)
const captured = computed<Record<Color, PieceType[]>>(() =>
  isOnline.value ? online.captured.value : offline.captured.value
)
const materialLead = computed(() =>
  isOnline.value ? online.materialLead.value : offline.materialLead.value
)
const historyRows = computed(() =>
  isOnline.value ? online.historyRows.value : offline.historyRows.value
)
const pendingPromotionColor = computed<Color | null>(() =>
  isOnline.value
    ? (online.pendingPromotion.value?.color ?? null)
    : (offline.pendingPromotion.value?.color ?? null)
)

/**
 * Klik di papan selagi menelusuri riwayat cuma kembali ke posisi sekarang —
 * tidak diteruskan sebagai langkah. Tanpa ini, klik akan tetap tembus ke
 * composable sungguhan (yang tidak tahu-menahu soal ply yang sedang
 * ditampilkan) dan diam-diam menjalankan langkah di posisi yang sebenarnya,
 * padahal papan yang terlihat masih papan lama.
 */
const activateSquare = (square: Square) => {
  if (!isLive.value) {
    viewPly.value = null
    return
  }
  if (isOnline.value) online.activateSquare(square)
  else offline.activateSquare(square)
}

const dropPiece = (from: Square, to: Square) => {
  if (!isLive.value) {
    viewPly.value = null
    return
  }
  const accepted = isOnline.value ? online.dropPiece(from, to) : offline.dropPiece(from, to)
  // Hanya seret-lepas yang ditolak yang berbunyi — klik petak lain cuma
  // mengganti pilihan, bukan mencoba langkah, jadi tidak "ilegal".
  if (!accepted && soundEnabled.value) playSounds(['illegal'])
}

/** Mundur/maju satu ply; sampai di ujung terbaru kembali "mengikuti" posisi sekarang. */
/**
 * Anotasi (panah/tanda) digambar untuk posisi yang SEDANG tampil. Begitu
 * tampilannya berpindah ke posisi lain — lewat panah keyboard, lompat dari
 * daftar langkah, atau balik ke posisi sekarang — anotasi lama tidak lagi
 * berarti apa-apa di papan yang baru, jadi ikut dibersihkan di sini.
 */
function clearBoardAnnotations(): void {
  chessBoardRef.value?.clearAnnotations()
}

/** Mundur/maju satu ply; sampai di ujung terbaru kembali "mengikuti" posisi sekarang. */
function stepView(delta: -1 | 1): void {
  const next = Math.min(plyCount.value, Math.max(0, displayPly.value + delta))
  if (next !== displayPly.value && soundEnabled.value) {
    // Maju: langkah yang baru tampil; mundur: langkah yang baru ditarik —
    // seperti memutar ulang partai. Lompatan (klik daftar/grafik) sengaja diam.
    playSounds(browseSounds(delta === 1 ? next : displayPly.value))
  }
  viewPly.value = next === plyCount.value ? null : next
  clearBoardAnnotations()
}

/**
 * Bunyi satu ply saat menelusuri riwayat: langkahnya saja (atau skak), tanpa
 * jingle akhir — memutar ulang langkah terakhir partai bukan "partai usai lagi".
 */
function browseSounds(ply: number): SoundName[] {
  if (ply < 1) return []
  const san = gameRecord.value.sans[ply - 1] ?? ''
  const mover: Color = ply % 2 === 1 ? 'w' : 'b'
  const check = san.endsWith('+') || san.endsWith('#')
  const status = { over: false, winner: null, check }
  if (isOnline.value) {
    const entry = online.roomState.value?.history[ply - 1]
    if (!entry) return []
    return soundsForMove({
      move: {
        captured: entry.captured,
        castle: san.startsWith('O-O') ? 'k' : null,
        promotion: entry.move.promotion
      },
      mover,
      status,
      me: online.myColor.value
    })
  }
  const entry = offline.history.value[ply - 1]
  return entry ? soundsForMove({ move: entry.move, mover, status, me: offlineListener.value }) : []
}

function jumpView(ply: number): void {
  const clamped = Math.min(plyCount.value, Math.max(0, ply))
  viewPly.value = clamped === plyCount.value ? null : clamped
  clearBoardAnnotations()
}

/** PGN yang sudah sah diurai → partai impor di fase analisis, dilihat dari posisi terakhir. */
function loadImportedGame(game: Extract<PgnParseResult, { ok: true }>): void {
  importedGame.value = { tags: game.tags, result: game.result }
  offline.importGame(game.moves)
  viewPly.value = null
  clearBoardAnnotations()
}

function backToLive(): void {
  viewPly.value = null
  clearBoardAnnotations()
}

// Riwayatnya sendiri berubah bentuk (langkah baru dari sini, room lain,
// dsb.) — kembali mengikuti posisi sekarang alih-alih menunjuk ply yang
// sudah tidak lagi berarti sama.
watch(appMode, () => {
  viewPly.value = null
  clearBoardAnnotations()
})
watch(
  () => online.inRoom.value,
  () => {
    viewPly.value = null
    clearBoardAnnotations()
  }
)

const completePromotion = (type: 'q' | 'r' | 'b' | 'n') =>
  isOnline.value ? online.completePromotion(type) : offline.completePromotion(type)

const cancelPromotion = () =>
  isOnline.value ? online.cancelPromotion() : offline.cancelPromotion()

const cancelPremove = () => (isOnline.value ? online.cancelPremove() : offline.cancelPremove())

// ---------------------------------------------------------------------------
// Baris status
// ---------------------------------------------------------------------------

const statusText = computed(() => {
  if (isOnline.value) {
    const room = online.roomState.value
    if (!room) return t('status.noRoom')
    if (room.waiting) return t('status.waitingOpponent')
    if (room.resignedBy) {
      return t('status.resigned', {
        loser: colorName(room.resignedBy),
        winner: colorName(opponent(room.resignedBy))
      })
    }
    const state = online.gameStatus.value
    if (state?.over) {
      return state.reason === 'checkmate'
        ? t('status.checkmateWin', { winner: colorName(state.winner!) })
        : endMessage(state.reason!)
    }
    if (online.isSpectator.value) return t('status.spectating', { color: colorName(turn.value) })
    const mine = turn.value === online.myColor.value
    if (state?.check) return mine ? t('status.youInCheck') : t('status.opponentInCheck')
    return mine ? t('status.yourTurn') : t('status.waitingMove')
  }

  if (offline.phase.value === 'setup') return t('status.notStarted')
  // Didahulukan dari status papan: partai impor yang berakhir mat tetap
  // "partai impor", dan papannya tidak perlu diredupkan seperti partai usai.
  if (offline.phase.value === 'analysis') {
    return t('status.analysis', { result: importedGame.value?.result ?? '*' })
  }

  const state = offline.status.value
  if (state.over) {
    return state.reason === 'checkmate'
      ? t('status.checkmateWin', { winner: colorName(state.winner!) })
      : endMessage(state.reason!)
  }
  const color = colorName(turn.value)
  return state.check ? t('status.sideInCheck', { color }) : t('status.sideTurn', { color })
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
  if (offline.phase.value === 'setup') return 'draw'
  if (offline.phase.value === 'analysis') return 'normal'

  const state = offline.status.value
  if (state.over) return state.reason === 'checkmate' ? 'win' : 'draw'
  return state.check ? 'check' : 'normal'
})

/**
 * Lapisan redup "partai usai" ditutup lewat tombol "Ulas partai" — ulasan
 * butuh papan yang terlihat. Dibuka lagi begitu riwayatnya berubah (permainan
 * baru, main lagi, undo) atau pindah mode.
 */
const overlayDismissed = ref(false)
watch([plyCount, appMode], () => (overlayDismissed.value = false))

/**
 * Hanya di posisi LIVE: lapisan itu bercerita tentang posisi terakhir partai.
 * Menelusuri riwayat — inti dari mengulas — tidak boleh tertutup olehnya.
 */
/**
 * Badge "giliran" di papan nama hanya bermakna selama partai berjalan dan yang
 * tampil adalah posisi sekarang. Saat menelusuri riwayat, sesudah partai usai,
 * atau di partai impor, ia cuma menunjuk giliran di posisi lama — dan terbaca
 * seolah partainya masih menunggu seseorang.
 */
const turnBadgeVisible = computed(() => {
  if (!isLive.value || analysing.value) return false
  return isOnline.value ? !onlineOver.value : !offline.status.value.over
})

const statusOverlayVisible = computed(
  () =>
    (statusTone.value === 'win' || statusTone.value === 'draw') &&
    isLive.value &&
    !overlayDismissed.value
)

// ---------------------------------------------------------------------------
// Papan nama di atas dan bawah papan
// ---------------------------------------------------------------------------

const topColor = computed<Color>(() => opponent(orientation.value))
const bottomColor = computed<Color>(() => orientation.value)

/**
 * Wajah hanya menempel pada sisi yang dimainkan komputer — dan mengikuti sisi
 * itu, bukan posisi di layar. Biasanya memang papan nama atas, tapi begitu
 * papan diputar atau pemain memilih hitam, mesinnya pindah ke bawah dan
 * wajahnya harus ikut. Sisi manusia tidak punya wajah untuk ditempelkan.
 */
const faceFor = (color: Color): Opponent | null =>
  vsComputer.value && color !== offline.humanColor.value ? host.value : null

/** Nama pemain dari tag PGN partai impor; null bila kosong atau "?" (tanda tidak diketahui di PGN). */
function importedName(color: Color): string | null {
  const name = importedGame.value?.tags[color === 'w' ? 'White' : 'Black']?.trim()
  return name && name !== '?' ? name : null
}

const topFace = computed(() => faceFor(topColor.value))
const bottomFace = computed(() => faceFor(bottomColor.value))

const isThinking = (color: Color): boolean =>
  !isOnline.value && offline.thinking.value && faceFor(color) !== null

function playerLabel(color: Color): string {
  if (isOnline.value) {
    const player = online.roomState.value?.players.find((entry) => entry.seat === color)
    if (!player) return t('player.empty', { color: colorName(color) })
    const you = color === online.myColor.value ? ` (${t('player.you')})` : ''
    const gone = player.connected ? '' : ` — ${t('player.disconnected')}`
    return `${player.name}${you}${gone}`
  }
  if (analysing.value) {
    const name = importedName(color)
    return name ? `${name} (${colorName(color)})` : colorName(color)
  }
  if (offline.mode.value === 'dua-pemain') return colorName(color)
  return color === offline.humanColor.value
    ? t('player.human', { color: colorName(color) })
    : // Sisi mesin memakai nama karakternya, bukan kata "Komputer".
      t('player.computer', { name: host.value.name, color: colorName(color) })
}

const leadFor = (color: Color): number =>
  color === 'w' ? materialLead.value : -materialLead.value

const searchInfo = computed(() => {
  const search = offline.lastSearch.value
  if (isOnline.value || !search || !search.depth) return null
  return t('meta.searchInfo', {
    depth: search.depth,
    nodes: formatNumber(search.nodes),
    ms: search.timeMs
  })
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

// Setiap aksi yang membentuk ulang riwayatnya sendiri mengembalikan
// penelusuran ke posisi sekarang — lihat catatan pada `viewPly` — dan
// membuang anotasi lama, yang digambar untuk papan yang sekarang sudah lain.
const resetGame = () => {
  offline.newGame()
  viewPly.value = null
  clearBoardAnnotations()
}
const startGame = () => {
  offline.startGame()
  viewPly.value = null
  clearBoardAnnotations()
}
const undoMove = () => {
  offline.undo()
  viewPly.value = null
  clearBoardAnnotations()
}
const rematch = () => {
  online.rematch()
  viewPly.value = null
  clearBoardAnnotations()
}

/*
 * Tombol di dalam lapisan redup sendiri: online cuma masuk akal begitu
 * pertandingan benar-benar usai (canRematch) — bukan selagi masih menunggu
 * lawan bergabung, walau lapisan redupnya sama-sama tampil di kedua kondisi.
 * Offline selalu boleh: di fase penyiapan tombolnya "Mulai", selebihnya
 * "Permainan baru".
 */
const overlayActionVisible = computed(() => (isOnline.value ? canRematch.value : true))
const offlineSetup = computed(() => !isOnline.value && offline.phase.value === 'setup')
const overlayActionLabel = computed(() =>
  isOnline.value
    ? t('room.rematch')
    : offlineSetup.value
      ? t('controls.startGame')
      : t('controls.newGame')
)
const overlayAction = () => {
  if (isOnline.value) return rematch()
  return offlineSetup.value ? startGame() : resetGame()
}

const reviewPanelRef = ref<InstanceType<typeof GameReviewPanel> | null>(null)

/**
 * "Ulas partai" dari lapisan partai-usai: mulai ulasan, singkirkan lapisannya
 * supaya papan terlihat, dan bawa panel ulasan ke pandangan — di layar sempit
 * panelnya ada jauh di bawah papan.
 */
function reviewFromOverlay(): void {
  overlayDismissed.value = true
  if (gameReview.status.value === 'idle') void gameReview.start()
  const el = reviewPanelRef.value?.$el as HTMLElement | undefined
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return

  if (event.key.toLowerCase() === 'f') {
    flipBoard()
  } else if (event.key === 'Escape') {
    if (isOnline.value) online.selected.value = null
    else offline.selected.value = null
    cancelPremove()
    viewPly.value = null
    clearBoardAnnotations()
  } else if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    // Shift+panah = lompat antar kesalahan (sama dengan tombol di panel ulasan).
    // Tanpa ulasan, tetap jatuh ke langkah biasa supaya tombolnya tidak "mati".
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const ply = nearestMoment(reviewMarks.value, displayPly.value, direction)
    if (ply !== null) jumpView(ply)
    else if (!reviewMarks.value.length) stepView(direction)
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    // Menelusuri riwayat, bukan membatalkan langkah — berlaku di kedua mode,
    // karena murni tampilan dan tidak menyentuh permainan yang sebenarnya.
    event.preventDefault()
    stepView(event.key === 'ArrowLeft' ? -1 : 1)
  } else if (!isOnline.value && event.ctrlKey && event.key.toLowerCase() === 'z') {
    // Undo hanya untuk permainan lokal — di online, papan milik server.
    event.preventDefault()
    undoMove()
  }
}

// ---------------------------------------------------------------------------
// Efek suara (lihat `sound/`). Yang sulit bukan bunyinya, tapi KAPAN: hanya
// untuk langkah yang baru saja dimainkan — bukan undo, impor PGN, atau
// permainan baru, yang sama-sama mengubah riwayat tapi bukan "langkah".
// ---------------------------------------------------------------------------

/** Dari sudut siapa partai lokal didengar: manusia lawan bot; dua pemain → tidak ada "sendiri". */
const offlineListener = computed<Color | null>(() =>
  offline.mode.value === 'lawan-komputer' ? offline.humanColor.value : null
)

watch(
  () => offline.history.value.length,
  (length, previous) => {
    // Satu atau dua langkah bertambah. Dua: bot menjawab dan premove pemain
    // langsung dijalankan di tick yang sama (`commit` → `runQueuedPremove`),
    // jadi watcher melihatnya sekaligus. Undo memendekkan, permainan baru ke
    // nol, dan impor PGN masuk fase analisis — semuanya diam.
    const added = length - previous
    if (isOnline.value || !soundEnabled.value || added < 1 || added > 2) return
    if (offline.phase.value === 'analysis') return
    const history = offline.history.value
    const sounds = history.slice(previous).flatMap((entry, i) =>
      soundsForMove({
        move: entry.move,
        mover: entry.color,
        // Status hanya diketahui untuk posisi terakhir; langkah sebelumnya
        // dalam deret ini pasti tidak mengakhiri partai, cukup cek skaknya.
        status:
          previous + i === length - 1
            ? offline.status.value
            : { over: false, winner: null, check: entry.san.endsWith('+') },
        me: offlineListener.value
      })
    )
    playSounds(sounds)
  }
)

watch(
  () => offline.phase.value,
  (phase, previous) => {
    if (phase === 'playing' && previous === 'setup' && soundEnabled.value && !isOnline.value) {
      playSounds(['game-start'])
    }
  }
)

/**
 * Online: tiap pesan server membawa potret room utuh, jadi yang berbunyi
 * hanya PERUBAHAN yang berarti antara potret lama dan baru (lihat
 * `sound/onlineSounds.ts`) — bukan bergabung, resync, atau reconnect.
 * Langkah sendiri pun berbunyi saat server mengonfirmasinya, bukan saat
 * diklik: yang didengar selalu langkah yang benar-benar sah.
 */
watch(
  () => online.roomState.value,
  (next, prev) => {
    if (!isOnline.value || !next) return
    const me = online.myColor.value
    const sounds: SoundName[] = []

    const added = appendedPlies(prev ?? null, next)
    if (added) {
      const first = next.history.length - added
      next.history.slice(first).forEach((entry, i) => {
        const ply = first + i
        const isLast = ply === next.history.length - 1
        sounds.push(
          ...soundsForMove({
            move: {
              captured: entry.captured,
              castle: entry.san.startsWith('O-O') ? 'k' : null,
              promotion: entry.move.promotion
            },
            // Partai online selalu dimulai dari posisi awal: ply genap = Putih.
            mover: ply % 2 === 0 ? 'w' : 'b',
            status:
              isLast && online.gameStatus.value
                ? online.gameStatus.value
                : { over: false, winner: null, check: entry.san.endsWith('+') },
            me
          })
        )
      })
      // Giliran kembali ke kita selagi tab di belakang — beri tahu lewat judul.
      if (me && next.history.length % 2 === (me === 'w' ? 0 : 1) && !online.gameStatus.value?.over) {
        alertTab(t('tab.yourTurn'))
      }
    }

    const resigned = justResigned(prev ?? null, next)
    if (resigned) sounds.push(endSound(opponent(resigned), me))

    if (me && opponentJoined(prev ?? null, next)) {
      sounds.push('game-start')
      alertTab(t('tab.opponentJoined'))
    }

    // Main lagi: room yang sama, riwayat kembali kosong, dan tidak sedang menunggu.
    if (prev && prev.roomId === next.roomId && prev.history.length > 0 && !next.history.length && !next.waiting) {
      sounds.push('game-start')
    }

    if (soundEnabled.value) playSounds(sounds)
  }
)

/*
 * Premove: klik halus saat diantre, buzz saat gagal (sudah tidak legal ketika
 * gilirannya tiba). Antreannya dibaca langsung dari composable, BUKAN dari
 * `premoveQueue` di atas — yang itu dikosongkan selama menelusuri riwayat,
 * jadi kembali ke posisi live akan terbaca sebagai "antrean bertambah".
 */
watch(
  () => (isOnline.value ? online.premoveQueue.value.length : offline.premoveQueue.value.length),
  (length, previous) => {
    if (length > previous && soundEnabled.value) playSounds(['premove'])
  }
)
watch(
  () => (isOnline.value ? online.premoveFailed.value : offline.premoveFailed.value),
  (failed) => {
    if (failed && soundEnabled.value) playSounds(['illegal'])
  }
)

onMounted(() => primeAudioOnFirstGesture())

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <OpponentPortrait :opponent="host" />

    <header class="app__header">
      <div class="brand">
        <OpponentHalo :opponent="host" />
        <div>
          <h1 class="app__title">Chess with Mari</h1>
          <p class="app__subtitle">{{ t('app.subtitle') }}</p>
        </div>
      </div>
      <div class="app__tools">
        <nav class="modes">
          <button
            type="button"
            class="modes__item"
            :class="{ 'modes__item--on': appMode === 'offline' }"
            @click="appMode = 'offline'"
          >
            {{ t('app.modeLocal') }}
          </button>
          <button
            type="button"
            class="modes__item"
            :class="{ 'modes__item--on': appMode === 'online' }"
            @click="appMode = 'online'"
          >
            {{ t('app.modeOnline') }}
            <span
              v-if="online.status.value === 'tersambung'"
              class="modes__status"
              :title="t('app.serverOnline')"
              aria-hidden="true"
            />
          </button>
        </nav>
        <LanguageSwitch />
        <SettingsMenu
          v-model:show-hints="showHints"
          v-model:premove-enabled="premoveEnabled"
          v-model:undo-enabled="undoEnabled"
          v-model:show-eval-bar="showEvalBar"
          v-model:show-suggestion="showSuggestion"
          v-model:sound-enabled="soundEnabled"
        />
      </div>
    </header>

    <main class="layout">
      <div class="board-column" :class="{ 'board-column--eval': evalBarVisible }">
        <div class="player">
          <div class="player__id">
            <OpponentFace v-if="topFace" :opponent="topFace" />
            <span class="player__dot" :class="`player__dot--${topColor}`" />
            <span class="player__name">{{ playerLabel(topColor) }}</span>
            <span v-if="turnBadgeVisible && turn === topColor" class="player__turn" :class="{ 'player__turn--thinking': isThinking(topColor) }">
              <span v-if="isThinking(topColor)" class="status__spinner" aria-hidden="true" />
              {{ isThinking(topColor) ? t('player.thinkingBadge') : t('player.turnBadge') }}
            </span>
          </div>
          <CapturedPieces
            :color="opponent(topColor)"
            :pieces="captured[opponent(topColor)]"
            :lead="leadFor(topColor)"
          />
        </div>

        <div class="board-stage">
          <EvalBar v-if="evalBarVisible" :evaluation="shownEvaluation" :orientation="orientation" />

          <div class="board-wrap">
            <ChessBoard
              ref="chessBoardRef"
              :board="board"
              :orientation="orientation"
              :selected="selected"
              :targets="targets"
              :last-move="lastMove"
              :check-square="checkSquare"
              :playable="canPlay"
              :premove-color="premoveColor"
              :premove-queue="premoveQueue"
              :premove-failed="premoveFailed"
              :show-hints="showHints"
              :suggestions="suggestionArrows"
              :move-badge="boardMoveBadge"
              @activate="activateSquare"
              @drop="dropPiece"
              @right-click="cancelPremove"
            />

            <Transition name="board-dim">
              <div v-if="statusOverlayVisible" class="board-dim">
                <div class="status status--center" :class="`status--${statusTone}`">
                  <span>{{ statusText }}</span>
                  <div class="status__actions">
                    <button
                      v-if="overlayActionVisible"
                      type="button"
                      class="status__action"
                      @click="overlayAction"
                    >
                      {{ overlayActionLabel }}
                    </button>
                    <button
                      v-if="reviewAvailable && plyCount > 0"
                      type="button"
                      class="status__action status__action--ghost"
                      @click="reviewFromOverlay"
                    >
                      {{ t('review.start') }}
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div class="player">
          <div class="player__id">
            <OpponentFace v-if="bottomFace" :opponent="bottomFace" />
            <span class="player__dot" :class="`player__dot--${bottomColor}`" />
            <span class="player__name">{{ playerLabel(bottomColor) }}</span>
            <span v-if="turnBadgeVisible && turn === bottomColor" class="player__turn" :class="{ 'player__turn--thinking': isThinking(bottomColor) }">
              <span v-if="isThinking(bottomColor)" class="status__spinner" aria-hidden="true" />
              {{ isThinking(bottomColor) ? t('player.thinkingBadge') : t('player.turnBadge') }}
            </span>
          </div>
          <CapturedPieces
            :color="opponent(bottomColor)"
            :pieces="captured[opponent(bottomColor)]"
            :lead="leadFor(bottomColor)"
          />
        </div>

        <div class="history-slot">
          <MoveHistory
            :rows="historyRows"
            :ply-count="plyCount"
            :active-ply="displayPly"
            :marks="reviewMarks"
            :opening="openingLabel"
            :pgn-feedback="pgnFeedback"
            @jump="jumpView"
            @copy-pgn="copyPgn"
          />
        </div>
      </div>

      <aside class="panel">
        <div v-if="!isLive" class="premove-banner">
          <span>{{ t('history.viewing', { ply: displayPly, total: plyCount }) }}</span>
          <button type="button" class="premove-banner__cancel" @click="backToLive">
            {{ t('history.backToCurrent') }}
          </button>
        </div>

        <div v-else-if="premoveQueue.length" class="premove-banner">
          <span>{{ premoveBannerText }}</span>
          <button type="button" class="premove-banner__cancel" @click="cancelPremove">
            {{ t('premove.cancel') }}
          </button>
        </div>

        <p v-if="isOnline && online.error.value" class="alert" role="alert">
          {{ online.error.value }}
        </p>

        <!-- Paling atas begitu tersedia: sesudah partai usai, inilah yang dicari. -->
        <GameReviewPanel
          v-if="reviewAvailable"
          ref="reviewPanelRef"
          :status="gameReview.status.value"
          :progress="gameReview.progress.value"
          :review="gameReview.review.value"
          :labels="{ w: reviewName('w'), b: reviewName('b') }"
          :scores="gameReview.scores.value"
          :marks="reviewMarks"
          :sans="reviewSans"
          :active-ply="displayPly"
          :pgn-feedback="pgnFeedback"
          @start="gameReview.start"
          @cancel="gameReview.cancel"
          @jump="jumpView"
          @copy-pgn="copyPgn"
        />

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
            @rematch="rematch"
            @leave="online.leaveRoom"
          />
          <button type="button" class="flip" @click="flipBoard">{{ t('board.flip') }}</button>
        </template>

        <GameControls
          v-else
          v-model:mode="offline.mode.value"
          v-model:elo="offline.elo.value"
          :human-color="offline.humanColor.value"
          :can-undo="offline.history.value.length > 0 && !analysing"
          :busy="offline.thinking.value"
          :setup-locked="offline.setupLocked.value"
          :phase="offline.phase.value"
          :undo-enabled="undoEnabled"
          @reset="resetGame"
          @start="startGame"
          @undo="undoMove"
          @flip="flipBoard"
          @play-as="offline.playAs"
        />

        <PgnImport v-if="!isOnline" @load="loadImportedGame" />

        <footer class="meta">
          <p v-if="vsComputer" class="meta__line">
            {{ t('meta.poweredBy') }}
          </p>
          <p v-if="searchInfo" class="meta__line">{{ t('meta.lastSearch') }} {{ searchInfo }}</p>
          <p v-if="!isOnline" class="meta__line meta__fen" :title="viewedPosition?.fen() ?? offline.fen.value">
            FEN: {{ viewedPosition?.fen() ?? offline.fen.value }}
          </p>
          <p class="meta__line meta__keys">
            {{ t('meta.shortcuts') }}
            <kbd>←</kbd><kbd>→</kbd> {{ t('meta.keyBrowse') }} ·
            <template v-if="reviewMarks.length">
              <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd> {{ t('meta.keyMoment') }} ·
            </template>
            <kbd>F</kbd> {{ t('meta.keyFlip') }} · <kbd>Esc</kbd> {{ t('meta.keyDeselect') }}
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

/* Pemilih mode dan pemilih bahasa berdampingan; membungkus ke bawah di layar sempit. */
.app__tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
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
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
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

.modes__status {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  background: #3fb950;
  border-radius: 50%;
  box-shadow: 0 0 0.3rem #3fb950;
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

/* Bilah evaluasi berdiri di kiri papan di dalam `.board-stage`. Supaya papan
   tetap sejajar dengan papan nama pemain dan daftar langkah, baris-baris itu
   digeser sejauh lebar bilah (1.5rem) + selanya (0.5rem). */
.board-stage {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.board-stage .board-wrap {
  flex: 1;
  min-width: 0;
}

.board-column--eval > .player,
.board-column--eval > .history-slot {
  padding-left: 2rem;
}

.player {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  /*
   * Dipatok setinggi baris yang memuat avatar, walau avatarnya sedang tidak
   * ada. Wajah muncul-hilang saat mode berganti; tanpa patokan ini papan ikut
   * bergeser naik-turun setiap kali.
   */
  min-height: 2.5rem;
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
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.4rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 0.3rem;
  flex-shrink: 0;
}

.player__turn--thinking .status__spinner {
  width: 0.6rem;
  height: 0.6rem;
  border-width: 1.5px;
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

.board-wrap {
  position: relative;
}

.board-dim {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: var(--radius);
  z-index: 10;
}

.status--center {
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem 1.3rem;
  background: var(--panel);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}

.status__action {
  padding: 0.5rem 1.1rem;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0.5rem;
  color: var(--on-accent);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.status__action:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.status__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.45rem;
}

/* Aksi kedua: sama tingginya, tapi tidak bersaing dengan aksi utama. */
.status__action--ghost {
  background: transparent;
  color: var(--accent);
}

.status__action--ghost:hover {
  background: var(--accent-soft);
  border-color: var(--accent-hover);
}

.board-dim-enter-active,
.board-dim-leave-active {
  transition: opacity 0.22s ease;
}

.board-dim-enter-active .status--center,
.board-dim-leave-active .status--center {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.board-dim-enter-from,
.board-dim-leave-to {
  opacity: 0;
}

.board-dim-enter-from .status--center,
.board-dim-leave-to .status--center {
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .board-dim-enter-active,
  .board-dim-leave-active,
  .board-dim-enter-active .status--center,
  .board-dim-leave-active .status--center {
    transition: none;
  }
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

/* `.alert` ada di assets/ui.css — dipakai juga oleh OnlineLobby. */

/*
 * Selalu terlihat begitu ada premove diantre — bukan cuma sorotan di papan —
 * supaya jelas ada langkah menunggu dan ada tombol nyata untuk membatalkannya.
 * Klik kanan/Esc tetap jalan, tapi keduanya tidak ada di layar sentuh.
 */
.premove-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
  color: var(--text);
  background: var(--accent-soft);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.premove-banner__cancel {
  padding: 0.3rem 0.6rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
}

.premove-banner__cancel:hover {
  background: var(--surface-hover);
  border-color: var(--text-muted);
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
