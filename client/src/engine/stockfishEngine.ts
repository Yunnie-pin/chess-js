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

export interface Evaluation {
  /** Centipawn dari sudut pandang PUTIH; null selama belum ada kabar dari mesin. */
  cp: number | null
  /** Mat dalam N langkah dari sudut Putih (positif = Putih memberi mat); null bila bukan mat paksa. */
  mate: number | null
  /** Kedalaman baris `info` terakhir. */
  depth: number
  /**
   * Langkah pertama dari principal variation — saran langkah terbaik untuk pihak
   * yang jalan. `undefined` selama belum ada PV; sisanya `{ from, to }`.
   */
  best?: { from: Square; to: Square }
}

type EvaluationListener = (evaluation: Evaluation) => void

let analyser: Worker | null = null
let analyserReady: Promise<void> | null = null
let analysisListener: EvaluationListener | null = null
/** FEN yang benar-benar sedang dicari worker, atau null bila menganggur. */
let searchingFen: string | null = null
/** FEN terbaru yang diminta tapi belum dimulai — worker masih menghentikan pencarian sebelumnya. */
let pendingFen: string | null = null
/** Langkah pertama PV terbaru untuk pencarian yang sedang jalan — dipertahankan lintas baris `info` yang tak bawa `pv`. */
let searchBest: { from: Square; to: Square } | undefined

function getAnalyser(): Worker {
  if (!analyser) {
    analyser = new Worker(ENGINE_URL)
    analyser.addEventListener('message', onAnalyserLine)
  }
  return analyser
}

/** Handshake UCI tersendiri untuk worker analisis — sekali saja. */
function analyserWhenReady(): Promise<void> {
  if (analyserReady) return analyserReady
  const engine = getAnalyser()
  analyserReady = new Promise((resolve) => {
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
  return analyserReady
}

/** Skor Stockfish selalu dari sudut pihak yang jalan — FEN field ke-2 memberi tahu siapa. */
function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

function startAnalysis(fen: string): void {
  const engine = getAnalyser()
  searchingFen = fen
  searchBest = undefined
  engine.postMessage(`position fen ${fen}`)
  engine.postMessage(`go depth ${ANALYSIS_DEPTH}`)
}

function onAnalyserLine(event: MessageEvent<string>): void {
  const line = event.data
  if (typeof line !== 'string') return

  if (line.startsWith('bestmove')) {
    // Pencarian berhenti — entah tuntas sampai ANALYSIS_DEPTH, entah karena
    // `stop`. Baru sekarang (sesudah `bestmove`) dijamin tidak ada lagi baris
    // `info` nyasar dari pencarian lama, jadi posisi berikutnya aman dimulai.
    searchingFen = null
    if (pendingFen) {
      const next = pendingFen
      pendingFen = null
      startAnalysis(next)
    }
    return
  }

  // Selagi berpindah posisi (`pendingFen` terisi) baris `info` yang masuk masih
  // milik posisi lama — abaikan sampai `bestmove`-nya lewat.
  if (pendingFen || !searchingFen || !analysisListener || !line.startsWith('info ')) return

  const cpMatch = /\bscore cp (-?\d+)/.exec(line)
  const mateMatch = /\bscore mate (-?\d+)/.exec(line)
  if (!cpMatch && !mateMatch) return
  const depthMatch = /\bdepth (\d+)/.exec(line)

  // Token pertama sesudah `pv` = langkah terbaik. Tidak semua baris `info`
  // membawanya (mis. `lowerbound`), jadi yang terakhir terlihat dipertahankan.
  const pvMatch = /\bpv (\S+)/.exec(line)
  if (pvMatch) {
    const move = parseUciMove(pvMatch[1])
    if (move) searchBest = { from: move.from, to: move.to }
  }

  const flip = sideToMove(searchingFen) === 'b' ? -1 : 1
  analysisListener({
    cp: cpMatch ? Number(cpMatch[1]) * flip : null,
    mate: mateMatch ? Number(mateMatch[1]) * flip : null,
    depth: depthMatch ? Number(depthMatch[1]) : 0,
    best: searchBest
  })
}

/**
 * Minta bilah evaluasi menilai `fen`, memanggil `onUpdate` tiap kali kedalaman
 * bertambah. Aman dipanggil berulang dengan FEN yang sama (tidak melakukan
 * apa-apa) atau berganti-ganti — pencarian yang sedang jalan dihentikan lebih
 * dulu, dan yang baru menyusul begitu `bestmove` lama lewat.
 */
export function analysePosition(fen: string, onUpdate: EvaluationListener): void {
  analysisListener = onUpdate
  void analyserWhenReady().then(() => {
    if (searchingFen === fen || pendingFen === fen) return
    if (searchingFen === null) {
      startAnalysis(fen)
    } else {
      pendingFen = fen
      getAnalyser().postMessage('stop')
    }
  })
}

/** Hentikan analisis dan lepas pendengarnya — dipanggil saat bilah dimatikan atau keluar dari mode lawan komputer. */
export function stopAnalysis(): void {
  analysisListener = null
  pendingFen = null
  if (analyser && searchingFen !== null) analyser.postMessage('stop')
}
