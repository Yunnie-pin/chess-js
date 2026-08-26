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
