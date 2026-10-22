/**
 * PGN keluar-masuk (`usePgn`) untuk keempat jenis partai — lokal lawan bot,
 * dua pemain, online, partai impor — plus alur salin ke clipboard. Partai
 * lokal memakai `useChessGame` sungguhan; online cukup tiruan ref.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, effectScope, nextTick, ref, shallowRef } from 'vue'

import { useChessGame } from '../src/composables/useChessGame.ts'
import { usePgn, type UsePgnOptions } from '../src/composables/usePgn.ts'
import { parsePgn, replayMoves, type GameRecord } from '../src/engine/gameRecord.ts'
import { useI18n } from '../src/i18n/index.ts'
import { START_FEN, fromAlgebraic } from '@chess/shared/chess'
import type { GameStatus } from '@chess/shared/types'
import type { RoomState } from '@chess/shared/protocol'

const at = fromAlgebraic
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const { t } = useI18n()

/** Bot tiruan — tes ini tidak pernah memberinya giliran, tapi composable butuh satu. */
const noEngine = async () => null

function setup(overrides: Partial<UsePgnOptions> = {}) {
  const scope = effectScope()
  const roomState = shallowRef<RoomState | null>(null)
  const gameStatus = ref<GameStatus | null>(null)
  const isOnline = ref(false)
  const result = scope.run(() => {
    const game = useChessGame({ findBestMove: noEngine })
    const record = computed<GameRecord>(() =>
      isOnline.value
        ? replayMoves((roomState.value?.history ?? []).map((entry) => entry.move))
        : {
            fens: [START_FEN, ...game.history.value.map((e) => e.fen)],
            moves: game.history.value.map((e) => e.move),
            sans: game.history.value.map((e) => e.san)
          }
    )
    const analysing = computed(() => !isOnline.value && game.phase.value === 'analysis')
    const vsComputer = computed(
      () => !isOnline.value && game.mode.value === 'lawan-komputer' && !analysing.value
    )
    const pgn = usePgn({
      offline: game,
      online: { roomState, gameStatus: computed(() => gameStatus.value) } as UsePgnOptions['online'],
      isOnline,
      analysing,
      vsComputer,
      record,
      hostName: 'Iochi Mari',
      now: () => new Date(2026, 9, 22),
      ...overrides
    })
    return { game, pgn }
  })!
  return { ...result, roomState, gameStatus, isOnline, dispose: () => scope.stop() }
}

const click = (game: ReturnType<typeof useChessGame>, from: string, to: string) => {
  game.activateSquare(at(from))
  game.activateSquare(at(to))
}

test('lawan bot: nama "Anda" vs karakter + Elo; kartu akurasi tanpa Elo; hasil dari papan', () => {
  const { game, pgn, dispose } = setup()
  game.mode.value = 'lawan-komputer'
  game.elo.value = 1320
  game.playAs('b')
  assert.equal(pgn.pgnName('b'), t('player.you'))
  assert.equal(pgn.pgnName('w'), 'Iochi Mari (Stockfish 1320)')
  assert.equal(pgn.reviewName('w'), 'Iochi Mari', 'kartu akurasi: nama saja, tanpa Elo')
  assert.equal(pgn.result.value, '*')
  dispose()
})

test('dua pemain: nama = nama warna; mat mengisi hasil', async () => {
  const { game, pgn, dispose } = setup()
  game.mode.value = 'dua-pemain'
  game.phase.value = 'playing'
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) click(game, from, to)
  await nextTick()
  assert.equal(pgn.pgnName('w'), t('color.w'))
  assert.equal(pgn.result.value, '0-1')
  const text = pgn.buildPgn()
  assert.match(text, /\[Date "2026\.10\.22"\]/)
  assert.match(text, /\[Result "0-1"\]/)
  assert.match(text, /1\. f3 e5 2\. g4 Qh4# 0-1/)
  dispose()
})

test('online: nama dari kursi pemain, menyerah menentukan hasil', () => {
  const { pgn, roomState, gameStatus, isOnline, dispose } = setup()
  isOnline.value = true
  roomState.value = {
    roomId: 'ABCD',
    fen: '',
    history: [],
    players: [
      { name: 'Ani', seat: 'w', connected: true },
      { name: 'Budi', seat: 'b', connected: false }
    ],
    resignedBy: null,
    waiting: false
  } as unknown as RoomState
  assert.equal(pgn.pgnName('w'), 'Ani')
  assert.equal(pgn.pgnName('b'), 'Budi', 'nama polos — tanpa "terputus"')
  assert.equal(pgn.result.value, '*')

  gameStatus.value = { over: true, reason: 'stalemate', winner: null, result: '1/2-1/2', check: false }
  assert.equal(pgn.result.value, '1/2-1/2')
  roomState.value = { ...roomState.value!, resignedBy: 'w' }
  assert.equal(pgn.result.value, '0-1', 'menyerah mengalahkan status papan')
  dispose()
})

test('partai impor: tag nama dan hasil dipakai; "?" berarti tidak diketahui', () => {
  const { game, pgn, dispose } = setup()
  const parsed = parsePgn('[White "Magnus"]\n[Black "?"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 1-0')
  assert.ok(parsed.ok)
  pgn.loadImported(parsed)
  assert.equal(game.phase.value, 'analysis')
  assert.equal(game.history.value.length, 4)
  assert.equal(pgn.importedName('w'), 'Magnus')
  assert.equal(pgn.importedName('b'), null)
  assert.equal(pgn.pgnName('b'), '?')
  assert.equal(pgn.reviewName('w'), 'Magnus', 'partai impor bukan melawan karakter')
  assert.equal(pgn.result.value, '1-0', 'hasil dari tag, bukan dari papan yang belum usai')
  dispose()
})

test('salin: berhasil → "copied", gagal → "failed", lalu hilang sendiri', async () => {
  const written: string[] = []
  const ok = setup({ writeClipboard: async (text) => void written.push(text), feedbackMs: 30 })
  await ok.pgn.copy()
  assert.equal(ok.pgn.feedback.value, 'copied')
  assert.equal(written.length, 1)
  assert.match(written[0], /^\[Event "Chess with Mari"\]/)
  await sleep(60)
  assert.equal(ok.pgn.feedback.value, null)
  ok.dispose()

  const denied = setup({
    writeClipboard: async () => {
      throw new Error('izin ditolak')
    },
    feedbackMs: 30
  })
  await denied.pgn.copy()
  assert.equal(denied.pgn.feedback.value, 'failed')
  denied.dispose()
})
