/**
 * PGN keluar-masuk: hasil partai, nama pemain untuk tag, isi PGN yang
 * disalin, dan tag partai impor. Dulu tersebar di `App.vue` sebagai fungsi
 * lepas yang tak pernah dites — padahal cabangnya banyak: lokal lawan bot,
 * dua pemain, online (termasuk menyerah), dan partai impor.
 *
 * Format PGN-nya sendiri (`toPgn`/`parsePgn`) ada di `engine/gameRecord.ts`;
 * di sini hanya "partai yang sedang tampil → argumen untuk toPgn".
 */

import { computed, onScopeDispose, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'

import type { Color } from '@chess/shared/types'
import { toPgn, type GameRecord, type PgnParseResult, type PgnResult } from '../engine/gameRecord.ts'
import { openingName } from '../engine/openings.ts'
import { useI18n } from '../i18n/index.ts'
import type { ChessGame } from './useChessGame.ts'
import type { OnlineGame } from './useOnlineGame.ts'

export type ImportedPgn = Extract<PgnParseResult, { ok: true }>
export type PgnFeedback = 'copied' | 'failed' | null

export interface UsePgnOptions {
  offline: Pick<ChessGame, 'status' | 'mode' | 'humanColor' | 'elo' | 'importGame'>
  online: Pick<OnlineGame, 'roomState' | 'gameStatus'>
  isOnline: MaybeRefOrGetter<boolean>
  /** Partai impor di fase `analysis`. */
  analysing: MaybeRefOrGetter<boolean>
  /** Benar-benar melawan bot sekarang (bukan partai impor). */
  vsComputer: MaybeRefOrGetter<boolean>
  /** Partai yang sedang tampil: FEN tiap posisi, langkah, SAN. */
  record: MaybeRefOrGetter<GameRecord>
  /** Nama karakter lawan yang sedang menemani. */
  hostName: MaybeRefOrGetter<string>
  /** Disuntik tes; bawaannya `navigator.clipboard.writeText`. */
  writeClipboard?: (text: string) => Promise<void>
  /** Disuntik tes; bawaannya waktu sekarang. */
  now?: () => Date
  /** Berapa lama "Tersalin"/"Gagal menyalin" bertahan di tombol. */
  feedbackMs?: number
}

export function usePgn(options: UsePgnOptions) {
  const { offline, online } = options
  const { t } = useI18n()
  const writeClipboard = options.writeClipboard ?? ((text: string) => navigator.clipboard.writeText(text))
  const now = options.now ?? (() => new Date())
  const feedbackMs = options.feedbackMs ?? 2000

  const isOnline = () => toValue(options.isOnline)
  const analysing = () => toValue(options.analysing)
  const colorName = (color: Color): string => t(`color.${color}`)

  /** Tag PGN partai impor — nama pemain dan hasil — selama fase analisis. */
  const importedGame = shallowRef<{ tags: Record<string, string>; result: PgnResult } | null>(null)

  /** Simpan tag partai impor lalu muat langkahnya ke fase analisis. */
  function loadImported(game: ImportedPgn): void {
    importedGame.value = { tags: game.tags, result: game.result }
    offline.importGame(game.moves)
  }

  /** Nama pemain dari tag PGN partai impor; null bila kosong atau "?" (tanda tidak diketahui di PGN). */
  function importedName(color: Color): string | null {
    const name = importedGame.value?.tags[color === 'w' ? 'White' : 'Black']?.trim()
    return name && name !== '?' ? name : null
  }

  /** Hasil dalam notasi PGN; '*' selama partai belum usai. */
  const result = computed<PgnResult>(() => {
    if (analysing()) return importedGame.value?.result ?? '*'
    if (!isOnline()) return offline.status.value.result
    const resigned = online.roomState.value?.resignedBy
    if (resigned) return resigned === 'w' ? '0-1' : '1-0'
    return online.gameStatus.value?.result ?? '*'
  })

  /**
   * Nama pemain untuk tag PGN — polos, tanpa "(Anda)" atau "— terputus" yang
   * dipakai papan nama di layar. Sisi mesin dicatat dengan Elo-nya, seperti
   * kebiasaan PGN dari partai lawan komputer.
   */
  function pgnName(color: Color): string {
    if (isOnline()) {
      return online.roomState.value?.players.find((entry) => entry.seat === color)?.name ?? '?'
    }
    if (analysing()) return importedName(color) ?? '?'
    if (offline.mode.value === 'dua-pemain') return colorName(color)
    if (color === offline.humanColor.value) return t('player.you')
    return `${toValue(options.hostName)} (Stockfish ${offline.elo.value})`
  }

  /**
   * Nama di kartu akurasi: tanpa "(Putih)" — titik warna di kartu sudah
   * mengatakannya — dan tanpa Elo, supaya muat di setengah lebar panel.
   */
  function reviewName(color: Color): string {
    if (toValue(options.vsComputer) && color !== offline.humanColor.value) return toValue(options.hostName)
    return pgnName(color)
  }

  /** PGN lengkap partai yang sedang tampil. */
  function buildPgn(): string {
    const record = toValue(options.record)
    const opening = openingName(record.fens)
    return toPgn({
      sans: record.sans,
      result: result.value,
      white: pgnName('w'),
      black: pgnName('b'),
      date: now(),
      event: 'Chess with Mari',
      extraTags: opening ? { Opening: opening } : {}
    })
  }

  /** Umpan balik singkat sesudah PGN disalin. */
  const feedback = ref<PgnFeedback>(null)
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null

  async function copy(): Promise<void> {
    try {
      await writeClipboard(buildPgn())
      feedback.value = 'copied'
    } catch {
      // Clipboard ditolak (izin, konteks tidak aman, dsb.) — katakan terus terang.
      feedback.value = 'failed'
    }
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => (feedback.value = null), feedbackMs)
  }

  onScopeDispose(() => {
    if (feedbackTimer) clearTimeout(feedbackTimer)
  })

  return { importedGame, loadImported, importedName, result, pgnName, reviewName, buildPgn, copy, feedback }
}
