/**
 * Kapan efek suara berbunyi — seluruh pemicunya, offline dan online, di satu
 * tempat yang bisa diuji di Node. Dulu tinggal sebagai watcher di `App.vue`,
 * yang tidak pernah dites — dan premove yang mendarat tanpa bunyi memang
 * lahir di sana, ketahuan dari membaca kode, bukan dari tes.
 *
 * Bunyinya sendiri di `sound/synth.ts`, pilihan suara per langkah di
 * `sound/moveSound.ts`, dan aturan "langkah baru vs resync" online di
 * `sound/onlineSounds.ts`. Composable ini hanya menyambungkan semuanya ke
 * state permainan.
 */

import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { opponent } from '@chess/shared/chess'
import type { Color } from '@chess/shared/types'
import { useI18n } from '../i18n/index.ts'
import { endSound, soundsForMove, type SoundName } from '../sound/moveSound.ts'
import { appendedPlies, justResigned, opponentJoined } from '../sound/onlineSounds.ts'
import { playSounds } from '../sound/synth.ts'
import { alertTab } from '../sound/tabAlert.ts'
import type { ChessGame } from './useChessGame.ts'
import type { OnlineGame } from './useOnlineGame.ts'

export interface UseGameSoundsOptions {
  /** Hanya bagian yang dibaca — tes boleh memberi tiruan online yang ringan. */
  offline: Pick<
    ChessGame,
    'history' | 'phase' | 'status' | 'mode' | 'humanColor' | 'premoveQueue' | 'premoveFailed'
  >
  online: Pick<OnlineGame, 'roomState' | 'myColor' | 'gameStatus' | 'premoveQueue' | 'premoveFailed'>
  isOnline: MaybeRefOrGetter<boolean>
  /** Sakelar "Efek suara". Penanda judul tab TIDAK ikut sakelar ini — justru berguna saat tab dibisukan. */
  enabled: MaybeRefOrGetter<boolean>
  /** Disuntik tes; bawaannya synth Web Audio. */
  play?: (names: SoundName[]) => void
  /** Disuntik tes; bawaannya judul tab dokumen. */
  alert?: (text: string) => void
}

export function useGameSounds(options: UseGameSoundsOptions) {
  const { offline, online } = options
  const play = options.play ?? playSounds
  const alert = options.alert ?? alertTab
  const { t } = useI18n()

  const isOnline = () => toValue(options.isOnline)
  const enabled = () => toValue(options.enabled)
  /** Satu pintu untuk semua bunyi: sakelar dan deret kosong diperiksa di sini saja. */
  const emit = (names: SoundName[]) => {
    if (names.length && enabled()) play(names)
  }

  /** Dari sudut siapa partai lokal didengar: manusia lawan bot; dua pemain → tidak ada "sendiri". */
  const offlineListener = computed<Color | null>(() =>
    offline.mode.value === 'lawan-komputer' ? offline.humanColor.value : null
  )

  // ---------------------------------------------------------------- offline

  watch(
    () => offline.history.value.length,
    (length, previous) => {
      // Satu atau dua langkah bertambah. Dua: bot menjawab dan premove pemain
      // langsung dijalankan di tick yang sama (`commit` → `runQueuedPremove`),
      // jadi watcher melihatnya sekaligus. Undo memendekkan, permainan baru ke
      // nol, dan impor PGN masuk fase analisis — semuanya diam.
      const added = length - previous
      if (isOnline() || added < 1 || added > 2 || offline.phase.value === 'analysis') return
      emit(
        offline.history.value.slice(previous).flatMap((entry, i) =>
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
      )
    }
  )

  watch(
    () => offline.phase.value,
    (phase, previous) => {
      if (!isOnline() && phase === 'playing' && previous === 'setup') emit(['game-start'])
    }
  )

  // ----------------------------------------------------------------- online

  /*
   * Tiap pesan server membawa potret room UTUH, jadi yang berbunyi hanya
   * perubahan yang berarti antara potret lama dan baru — bukan bergabung,
   * resync, atau reconnect. Langkah sendiri berbunyi saat server
   * mengonfirmasinya, bukan saat diklik: yang didengar selalu langkah sah.
   */
  watch(
    () => online.roomState.value,
    (next, prev) => {
      if (!isOnline() || !next) return
      const before = prev ?? null
      const me = online.myColor.value
      const sounds: SoundName[] = []

      const added = appendedPlies(before, next)
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
        const myTurn = next.history.length % 2 === (me === 'w' ? 0 : 1)
        if (me && myTurn && !online.gameStatus.value?.over) alert(t('tab.yourTurn'))
      }

      const resigned = justResigned(before, next)
      if (resigned) sounds.push(endSound(opponent(resigned), me))

      if (me && opponentJoined(before, next)) {
        sounds.push('game-start')
        alert(t('tab.opponentJoined'))
      }

      // Main lagi: room yang sama, riwayat kembali kosong, dan tidak sedang menunggu.
      const rematch =
        before !== null &&
        before.roomId === next.roomId &&
        before.history.length > 0 &&
        next.history.length === 0 &&
        !next.waiting
      if (rematch) sounds.push('game-start')

      emit(sounds)
    }
  )

  // ---------------------------------------------------------------- premove

  /*
   * Klik halus saat diantre, buzz saat gagal. Antreannya dibaca langsung dari
   * composable permainan, BUKAN dari antrean tampilan di App — yang itu
   * dikosongkan selama menelusuri riwayat, jadi kembali ke posisi live akan
   * terbaca sebagai "antrean bertambah".
   */
  watch(
    () => (isOnline() ? online.premoveQueue.value.length : offline.premoveQueue.value.length),
    (length, previous) => {
      if (length > previous) emit(['premove'])
    }
  )
  watch(
    () => (isOnline() ? online.premoveFailed.value : offline.premoveFailed.value),
    (failed) => {
      if (failed) emit(['illegal'])
    }
  )

  // ------------------------------------------------------ dipanggil dari App

  /**
   * Bunyi satu ply saat menelusuri riwayat: langkahnya saja (atau skak), tanpa
   * jingle akhir — memutar ulang langkah terakhir bukan "partai usai lagi".
   */
  function plySounds(ply: number): SoundName[] {
    if (ply < 1) return []
    const mover: Color = ply % 2 === 1 ? 'w' : 'b'
    if (isOnline()) {
      const entry = online.roomState.value?.history[ply - 1]
      if (!entry) return []
      return soundsForMove({
        move: {
          captured: entry.captured,
          castle: entry.san.startsWith('O-O') ? 'k' : null,
          promotion: entry.move.promotion
        },
        mover,
        status: { over: false, winner: null, check: /[+#]$/.test(entry.san) },
        me: online.myColor.value
      })
    }
    const entry = offline.history.value[ply - 1]
    if (!entry) return []
    return soundsForMove({
      move: entry.move,
      mover: entry.color,
      status: { over: false, winner: null, check: /[+#]$/.test(entry.san) },
      me: offlineListener.value
    })
  }

  return {
    /**
     * Penelusuran satu langkah dari ply `from` ke `to`. Maju: langkah yang baru
     * tampil; mundur: langkah yang baru ditarik — seperti memutar ulang partai.
     * Lompatan (klik daftar/grafik) memang tidak memanggil ini.
     */
    onStep(from: number, to: number): void {
      if (from !== to) emit(plySounds(Math.max(from, to)))
    },
    /** Seret-lepas yang ditolak. Klik biasa yang cuma mengganti pilihan bukan "ilegal". */
    onDropRejected(): void {
      emit(['illegal'])
    }
  }
}
