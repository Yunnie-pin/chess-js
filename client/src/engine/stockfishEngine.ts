/**
 * Pembungkus Stockfish sebagai lawan opsional yang jauh lebih kuat dari
 * `STRENGTH_PROFILES` bawaan.
 *
 * Berkas mesinnya sendiri (`public/engine/stockfish-18-lite-single.{js,wasm}`)
 * disalin apa adanya dari paket npm `stockfish` — varian "lite, single-thread"
 * yang dipilih justru karena TIDAK butuh header COOP/COEP (beda dari varian
 * multi-thread yang perlu SharedArrayBuffer), dan ~7 MB alih-alih ~110 MB milik
 * varian NNUE penuh. Berkasnya bukan ES module, jadi dimuat sebagai Worker
 * klasik lewat URL, bukan lewat `import`. Lisensinya GPLv3 (lihat
 * `public/engine/COPYING.txt`) — beda dari lisensi kode aplikasi ini sendiri.
 */

import { fromAlgebraic } from '@chess/shared/chess'
import type { PromotionType, Square } from '@chess/shared/types'

const ENGINE_URL = `${import.meta.env?.BASE_URL ?? '/'}engine/stockfish-18-lite-single.js`

/** Jangkauan UCI_Elo yang didukung Stockfish sendiri — di luar ini opsinya ditolak mesin. */
const STOCKFISH_ELO_MIN = 1320
const STOCKFISH_ELO_MAX = 3190

export interface StockfishMove {
  from: Square
  to: Square
  promotion: PromotionType | null
}

let worker: Worker | null = null
let ready: Promise<void> | null = null

function getWorker(): Worker {
  if (!worker) worker = new Worker(ENGINE_URL)
  return worker
}

/** Kirim "uci" lalu tunggu "uciok", lanjut "isready" lalu tunggu "readyok" — sekali saja per worker. */
function whenReady(): Promise<void> {
  if (ready) return ready
  const engine = getWorker()
  ready = new Promise((resolve) => {
    const onLine = (event: MessageEvent<string>): void => {
      if (event.data === 'uciok') engine.postMessage('isready')
      else if (event.data === 'readyok') {
        engine.removeEventListener('message', onLine)
        resolve()
      }
    }
    engine.addEventListener('message', onLine)
    engine.postMessage('uci')
  })
  return ready
}

/** Notasi UCI polos: "e2e4", atau "e7e8q" untuk promosi. */
function parseUciMove(text: string): StockfishMove | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(text)
  if (!match) return null
  return {
    from: fromAlgebraic(match[1]),
    to: fromAlgebraic(match[2]),
    promotion: (match[3] as PromotionType | undefined) ?? null
  }
}

/**
 * Minta Stockfish memilih langkah untuk `fen`. `elo` dikirim langsung sebagai
 * UCI_Elo miliknya sendiri — `ELO_LEVELS` di shared/src/ai.ts sudah dipatok ke
 * jangkauan yang didukung Stockfish (1320-3190), jadi penjepitan di sini
 * murni jaga-jaga terhadap pemanggil lain, bukan sesuatu yang benar-benar
 * terjadi dari jalur permainan.
 */
export async function findBestMove(
  fen: string,
  elo: number,
  movetimeMs: number
): Promise<StockfishMove | null> {
  await whenReady()
  const engine = getWorker()
  const uciElo = Math.min(STOCKFISH_ELO_MAX, Math.max(STOCKFISH_ELO_MIN, Math.round(elo)))

  return new Promise((resolve) => {
    const onLine = (event: MessageEvent<string>): void => {
      const line = event.data
      if (typeof line !== 'string' || !line.startsWith('bestmove')) return
      engine.removeEventListener('message', onLine)
      const token = line.split(' ')[1]
      resolve(token && token !== '(none)' ? parseUciMove(token) : null)
    }
    engine.addEventListener('message', onLine)
    engine.postMessage('setoption name UCI_LimitStrength value true')
    engine.postMessage(`setoption name UCI_Elo value ${uciElo}`)
    engine.postMessage(`position fen ${fen}`)
    engine.postMessage(`go movetime ${movetimeMs}`)
  })
}

/** Matikan worker sepenuhnya — tidak dipanggil otomatis, karena memuat ulang mesinnya tidak murah. */
export function terminateStockfish(): void {
  worker?.postMessage('quit')
  worker?.terminate()
  worker = null
  ready = null
}

// ---------------------------------------------------------------------------
// Analyser — worker Stockfish KEDUA, khusus menilai posisi yang sedang tampil
// untuk bilah evaluasi.
//
// Sengaja terpisah dari worker langkah di atas: yang satu memilih langkah bot
// pada kekuatan TERBATAS (UCI_LimitStrength), yang ini menilai posisi sekuat
// mungkin pada kedalaman tetap. Menumpang di worker yang sama berarti tiap
// langkah bot dan tiap analisis akan saling menghentikan pencarian — jadi
// dua worker, dengan ongkos satu instans WASM (~7 MB) lagi di memori.
// ---------------------------------------------------------------------------

/** Kedalaman analisis bilah evaluasi — tetap, lepas dari level bot yang dipilih. */
const ANALYSIS_DEPTH = 16

/** Berapa lini teratas yang diminta (MultiPV) — dipakai untuk panah saran berlapis. */
const MULTI_PV = 3

export interface Evaluation {
  /** FEN posisi yang dinilai — supaya pemakainya bisa membuang hasil yang sudah basi. */
  fen: string
  /** Centipawn dari sudut pandang PUTIH (lini TERBAIK saja); null selama belum ada kabar. */
  cp: number | null
  /** Mat dalam N langkah dari sudut Putih (lini terbaik; positif = Putih memberi mat); null bila bukan mat paksa. */
  mate: number | null
  /** Kedalaman baris `info` terakhir dari lini terbaik. */
  depth: number
  /**
   * Langkah pertama tiap lini teratas, terurut dari terbaik — untuk panah saran
   * berlapis. Kosong selama belum ada PV; panjangnya ≤ `MULTI_PV`.
   */
  moves: { from: Square; to: Square }[]
  /**
   * Lini utama LENGKAP dari lini terbaik, dalam UCI ("e2e4 e7e5 …") — untuk
   * "lebih baik: …" di ulasan. Hanya lini 1; alternatif cukup langkah pertamanya.
   */
  line: string[]
}

type EvaluationListener = (evaluation: Evaluation) => void

/**
 * Kedalaman ulasan pasca-partai — sedikit di bawah `ANALYSIS_DEPTH` karena
 * yang dinilai seluruh partai sekaligus (puluhan posisi berturut-turut), dan
 * untuk label langkah selisih dua ply kedalaman nyaris tak mengubah hasil.
 */
export const REVIEW_DEPTH = 14

/**
 * Dua jenis pencarian berbagi SATU worker analisis:
 * - `live`: posisi yang sedang tampil (bilah evaluasi + panah), MultiPV penuh.
 * - `review`: satu posisi dari antrean ulasan partai, MultiPV 1 — label langkah
 *   cuma butuh lini terbaik, dan lini tambahan memperlambat tiap posisi.
 * Live selalu didahulukan: kalau keduanya menunggu, ulasan yang mengalah.
 */
type SearchKind = 'live' | 'review'

let analyser: Worker | null = null
let analyserReady: Promise<void> | null = null
let analysisListener: EvaluationListener | null = null
/** FEN yang benar-benar sedang dicari worker, atau null bila menganggur. */
let searchingFen: string | null = null
/** Jenis pencarian yang sedang jalan — hanya bermakna selama `searchingFen` terisi. */
let searchKind: SearchKind = 'live'
/** FEN terbaru yang diminta tapi belum dimulai — worker masih menghentikan pencarian sebelumnya. */
let pendingFen: string | null = null
/**
 * Pencarian ulasan yang sedang jalan sudah dihentikan paksa (dibatalkan, atau
 * didahului live) — hasilnya terpotong, jadi jangan dicatat sebagai hasil
 * posisi itu. Posisinya tetap di antrean dan diulang nanti.
 */
let discardSearch = false
/** MultiPV yang sedang terpasang di worker — diganti hanya saat menganggur. */
let currentMultiPv = MULTI_PV

interface ReviewJob {
  fens: readonly string[]
  /** Indeks posisi berikutnya yang belum punya hasil. */
  next: number
  onResult: (index: number, evaluation: Evaluation) => void
  resolve: () => void
}
let review: ReviewJob | null = null

// Ringkasan pencarian yang sedang jalan, dipertahankan lintas baris `info` yang
// tak lengkap. Direset di `startAnalysis`.
/** Langkah pertama tiap lini, indeks 0 = lini terbaik (multipv 1). */
let searchMoves: ({ from: Square; to: Square } | undefined)[] = []
let searchCp: number | null = null
let searchMate: number | null = null
let searchDepth = 0
/** Lini utama lengkap (UCI) dari lini terbaik. */
let searchLine: string[] = []

function getAnalyser(): Worker {
  if (!analyser) {
    analyser = new Worker(ENGINE_URL)
    analyser.addEventListener('message', onAnalyserLine)
  }
  return analyser
}

/** Handshake UCI tersendiri untuk worker analisis — sekali saja, sekalian pasang MultiPV. */
function analyserWhenReady(): Promise<void> {
  if (analyserReady) return analyserReady
  const engine = getAnalyser()
  analyserReady = new Promise((resolve) => {
    const onLine = (event: MessageEvent<string>): void => {
      if (event.data === 'uciok') {
        engine.postMessage(`setoption name MultiPV value ${MULTI_PV}`)
        engine.postMessage('isready')
      } else if (event.data === 'readyok') {
        engine.removeEventListener('message', onLine)
        resolve()
      }
    }
    engine.addEventListener('message', onLine)
    engine.postMessage('uci')
  })
  return analyserReady
}

/** Skor Stockfish selalu dari sudut pihak yang jalan — FEN field ke-2 memberi tahu siapa. */
function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

/** Hanya boleh dipanggil saat worker menganggur (`searchingFen === null`). */
function startAnalysis(fen: string, kind: SearchKind): void {
  const engine = getAnalyser()
  searchingFen = fen
  searchKind = kind
  discardSearch = false
  searchMoves = []
  searchCp = null
  searchMate = null
  searchDepth = 0
  searchLine = []
  // `setoption` hanya aman di antara pencarian — dan di sinilah tempatnya,
  // karena fungsi ini memang hanya dipanggil saat worker menganggur.
  const multiPv = kind === 'live' ? MULTI_PV : 1
  if (multiPv !== currentMultiPv) {
    engine.postMessage(`setoption name MultiPV value ${multiPv}`)
    currentMultiPv = multiPv
  }
  engine.postMessage(`position fen ${fen}`)
  engine.postMessage(`go depth ${kind === 'live' ? ANALYSIS_DEPTH : REVIEW_DEPTH}`)
}

/** Worker baru saja menganggur — mulai pekerjaan berikutnya: live dulu, baru antrean ulasan. */
function startNextSearch(): void {
  if (pendingFen) {
    const next = pendingFen
    pendingFen = null
    startAnalysis(next, 'live')
    return
  }
  if (!review) return
  if (review.next < review.fens.length) {
    startAnalysis(review.fens[review.next], 'review')
  } else {
    const done = review
    review = null
    done.resolve()
  }
}

function currentEvaluation(fen: string): Evaluation {
  return {
    fen,
    cp: searchCp,
    mate: searchMate,
    depth: searchDepth,
    // Padatkan: buang celah kalau lini 2 sempat datang sebelum lini 1.
    moves: searchMoves.filter((move): move is { from: Square; to: Square } => move !== undefined),
    line: [...searchLine]
  }
}

function onAnalyserLine(event: MessageEvent<string>): void {
  const line = event.data
  if (typeof line !== 'string') return

  if (line.startsWith('bestmove')) {
    // Pencarian berhenti — entah tuntas sampai kedalamannya, entah karena
    // `stop`. Baru sekarang (sesudah `bestmove`) dijamin tidak ada lagi baris
    // `info` nyasar dari pencarian lama, jadi posisi berikutnya aman dimulai.
    const finished = searchingFen
    // `bestmove (none)` = posisi akhir (mat/remis): Stockfish melapor `depth 0`
    // karena tak ada yang perlu dicari, padahal nilainya eksak. Tanpa ini
    // posisi akhir tak pernah dianggap cukup dalam dan dianalisis ulang terus.
    if (line.startsWith('bestmove (none)')) searchDepth = ANALYSIS_DEPTH
    if (finished && searchKind === 'review' && !discardSearch && review) {
      review.onResult(review.next, currentEvaluation(finished))
      review.next++
    }
    searchingFen = null
    discardSearch = false
    startNextSearch()
    return
  }

  // Selagi berpindah posisi (`pendingFen` terisi) atau membuang pencarian yang
  // dipotong, baris `info` yang masuk masih milik pencarian lama — abaikan
  // sampai `bestmove`-nya lewat.
  if (pendingFen || discardSearch || !searchingFen || !line.startsWith('info ')) return
  if (searchKind === 'live' && !analysisListener) return

  const cpMatch = /\bscore cp (-?\d+)/.exec(line)
  const mateMatch = /\bscore mate (-?\d+)/.exec(line)
  if (!cpMatch && !mateMatch) return

  // `multipv 1` = lini terbaik, `2`/`3` = alternatif. Tanpa token ini anggap lini 1.
  const rank = Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1)
  const flip = sideToMove(searchingFen) === 'b' ? -1 : 1

  // Skor + kedalaman untuk bilah evaluasi hanya dari lini terbaik.
  if (rank === 1) {
    searchCp = cpMatch ? Number(cpMatch[1]) * flip : null
    searchMate = mateMatch ? Number(mateMatch[1]) * flip : null
    const depthMatch = /\bdepth (\d+)/.exec(line)
    if (depthMatch) searchDepth = Number(depthMatch[1])
  }

  // `pv` selalu field terakhir di baris `info`: token pertamanya = langkah
  // pertama lini itu, seluruhnya = lini utama. Tidak semua baris `info`
  // membawanya (mis. `lowerbound`), jadi yang terakhir dipertahankan.
  const pvMatch = /\bpv (.+)$/.exec(line)
  if (pvMatch) {
    const tokens = pvMatch[1].trim().split(/\s+/)
    const move = parseUciMove(tokens[0])
    if (move) searchMoves[rank - 1] = { from: move.from, to: move.to }
    if (rank === 1) searchLine = tokens
  }

  // Ulasan baru dilaporkan sekali, di `bestmove`; live dikabari tiap kedalaman.
  if (searchKind === 'live') analysisListener?.(currentEvaluation(searchingFen))
}

/**
 * Minta bilah evaluasi menilai `fen`, memanggil `onUpdate` tiap kali kedalaman
 * bertambah. Aman dipanggil berulang dengan FEN yang sama (tidak melakukan
 * apa-apa) atau berganti-ganti — pencarian yang sedang jalan dihentikan lebih
 * dulu, dan yang baru menyusul begitu `bestmove` lama lewat. Ulasan partai yang
 * sedang jalan ikut mengalah, lalu dilanjutkan sesudahnya.
 */
export function analysePosition(fen: string, onUpdate: EvaluationListener): void {
  analysisListener = onUpdate
  void analyserWhenReady().then(() => {
    if ((searchingFen === fen && searchKind === 'live') || pendingFen === fen) return
    if (searchingFen === null) {
      startAnalysis(fen, 'live')
    } else {
      pendingFen = fen
      if (searchKind === 'review') discardSearch = true
      getAnalyser().postMessage('stop')
    }
  })
}

/** Hentikan analisis dan lepas pendengarnya — dipanggil saat bilah dimatikan atau keluar dari mode lawan komputer. */
export function stopAnalysis(): void {
  analysisListener = null
  pendingFen = null
  // Hanya pencarian LIVE yang dihentikan — ulasan partai punya umurnya sendiri.
  if (analyser && searchingFen !== null && searchKind === 'live') analyser.postMessage('stop')
}

/**
 * Ulasan pasca-partai: nilai tiap FEN berurutan di worker analisis, kabari
 * `onResult(indeks, hasil)` per posisi begitu pencariannya tuntas. Promise
 * selesai saat seluruh antrean beres — atau langsung, bila dibatalkan lewat
 * `cancelGameAnalysis` (pemanggil yang membatalkan sudah tahu sendiri).
 * Memulai ulasan baru membatalkan yang lama.
 */
export function analyseGame(
  fens: readonly string[],
  onResult: (index: number, evaluation: Evaluation) => void
): Promise<void> {
  cancelGameAnalysis()
  return new Promise((resolve) => {
    const job: ReviewJob = { fens, next: 0, onResult, resolve }
    review = job
    void analyserWhenReady().then(() => {
      // Bisa saja sudah dibatalkan/diganti selagi handshake berlangsung.
      if (review === job && searchingFen === null) startNextSearch()
    })
  })
}

/** Batalkan ulasan partai yang sedang jalan; tidak menyentuh analisis live. */
export function cancelGameAnalysis(): void {
  if (!review) return
  const job = review
  review = null
  job.resolve()
  if (analyser && searchingFen !== null && searchKind === 'review') {
    discardSearch = true
    analyser.postMessage('stop')
  }
}
