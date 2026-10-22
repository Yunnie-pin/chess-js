/**
 * Pemicu efek suara (`useGameSounds`) dengan permainan lokal SUNGGUHAN —
 * `useChessGame` dengan mesin tiruan — dan perekam di tempat synth Web Audio.
 * Yang diuji: kapan berbunyi dan kapan diam (undo, impor, permainan baru),
 * termasuk kasus premove yang mendarat di tick yang sama dengan balasan bot.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, effectScope, nextTick, ref, shallowRef } from 'vue'

import { useChessGame } from '../src/composables/useChessGame.ts'
import { useGameSounds, type UseGameSoundsOptions } from '../src/composables/useGameSounds.ts'
import type { SoundName } from '../src/sound/moveSound.ts'
import { Position, fromAlgebraic } from '@chess/shared/chess'
import type { Color, GameStatus } from '@chess/shared/types'
import type { RoomState } from '@chess/shared/protocol'

type Game = ReturnType<typeof useChessGame>

const at = fromAlgebraic
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mesin tiruan: langkah legal pertama — perilakunya yang diuji, bukan kekuatannya. */
async function stubFindBestMove(fen: string) {
  const move = new Position(fen).legalMoves()[0]
  return move ? { from: move.from, to: move.to, promotion: move.promotion } : null
}

async function waitForReply(game: Game, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (game.thinking.value && Date.now() < deadline) await sleep(20)
  assert.equal(game.thinking.value, false, 'komputer tidak selesai berpikir dalam batas waktu')
}

const click = (game: Game, from: string, to: string) => {
  game.activateSquare(at(from))
  game.activateSquare(at(to))
}

/** Tiruan bagian online yang dibaca useGameSounds — cukup ref yang bisa disetel tes. */
function fakeOnline() {
  const roomState = shallowRef<RoomState | null>(null)
  const myColor = ref<Color | null>(null)
  const gameStatus = ref<GameStatus | null>(null)
  const online = {
    roomState,
    myColor: computed(() => myColor.value),
    gameStatus: computed(() => gameStatus.value),
    premoveQueue: ref([]),
    premoveFailed: shallowRef(null)
  } as unknown as UseGameSoundsOptions['online']
  return { online, roomState, myColor, gameStatus }
}

/**
 * Satu partai lokal + pemicu suara di effect scope sendiri. `played` mencatat
 * tiap panggilan `play` (satu entri = satu deret suara), `alerts` tiap penanda tab.
 */
async function withSounds(
  run: (ctx: {
    game: Game
    played: SoundName[][]
    alerts: string[]
    sounds: ReturnType<typeof useGameSounds>
    isOnline: { value: boolean }
    enabled: { value: boolean }
    fake: ReturnType<typeof fakeOnline>
  }) => Promise<void> | void
): Promise<void> {
  const scope = effectScope()
  const played: SoundName[][] = []
  const alerts: string[] = []
  const isOnline = ref(false)
  const enabled = ref(true)
  const fake = fakeOnline()
  const result = scope.run(() => {
    const game = useChessGame({ findBestMove: stubFindBestMove })
    game.mode.value = 'dua-pemain'
    const sounds = useGameSounds({
      offline: game,
      online: fake.online,
      isOnline,
      enabled,
      play: (names) => played.push(names),
      alert: (text) => alerts.push(text)
    })
    return run({ game, played, alerts, sounds, isOnline, enabled, fake })
  })
  try {
    await result
  } finally {
    scope.stop()
  }
}

test('lokal: "Mulai" berbunyi, langkah berbunyi, undo dan permainan baru diam', () =>
  withSounds(async ({ game, played }) => {
    game.startGame()
    await nextTick()
    assert.deepEqual(played, [['game-start']])

    click(game, 'e2', 'e4')
    await nextTick()
    assert.deepEqual(played.at(-1), ['move-self'])

    const before = played.length
    game.undo()
    await nextTick()
    game.newGame()
    await nextTick()
    assert.equal(played.length, before, 'undo dan permainan baru tidak boleh berbunyi')
  }))

test('lokal: impor PGN (fase analisis) diam, termasuk impor satu langkah', () =>
  withSounds(async ({ game, played }) => {
    const position = new Position()
    const e4 = position.legalMoves().find((m) => m.from === at('e2') && m.to === at('e4'))!
    game.importGame([e4])
    await nextTick()
    assert.deepEqual(played, [])
  }))

test('lokal: sakelar mati → diam; nyala lagi → berbunyi', () =>
  withSounds(async ({ game, played, enabled }) => {
    game.phase.value = 'playing'
    await nextTick()
    played.length = 0 // setup → playing sah berbunyi "mulai"; bukan yang diuji di sini
    enabled.value = false
    click(game, 'e2', 'e4')
    await nextTick()
    assert.deepEqual(played, [])
    enabled.value = true
    click(game, 'e7', 'e5')
    await nextTick()
    assert.deepEqual(played, [['move-self']])
  }))

test('lokal: mat — bunyi langkah lalu jingle netral (dua pemain)', () =>
  withSounds(async ({ game, played }) => {
    game.phase.value = 'playing'
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
      click(game, from, to)
      await nextTick()
    }
    assert.deepEqual(played.at(-1), ['move-self', 'game-end'])
  }))

test('lawan bot: balasan bot terdengar "lawan", premove yang ikut mendarat di tick yang sama ikut berbunyi', () =>
  withSounds(async ({ game, played }) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    game.phase.value = 'playing'
    await nextTick()

    click(game, 'e2', 'e4')
    await nextTick()
    assert.deepEqual(played.at(-1), ['move-self'])

    // Diantre selagi bot berpikir → klik halus. d2-d4 tak mungkin terganggu
    // balasan hitam mana pun sesudah 1.e4 (lihat tes premove di game.test.ts).
    click(game, 'd2', 'd4')
    await nextTick()
    assert.deepEqual(played.at(-1), ['premove'])

    await waitForReply(game)
    await nextTick()
    // Balasan bot + premove dijalankan sinkron di `commit` → satu deret berisi
    // keduanya, bukan diam (bug yang dulu lolos di App.vue).
    assert.ok(
      played.some((call) => call.join() === 'move-opponent,move-self'),
      `deret balasan+premove tidak ditemukan: ${JSON.stringify(played)}`
    )
  }))

test('penelusuran dan seret-lepas: onStep memutar ulang langkah, onDropRejected = buzz', () =>
  withSounds(async ({ game, played, sounds }) => {
    game.phase.value = 'playing'
    click(game, 'e2', 'e4')
    click(game, 'd7', 'd5')
    click(game, 'e4', 'd5')
    await nextTick()
    played.length = 0

    sounds.onStep(2, 3) // maju ke exd5
    sounds.onStep(3, 2) // mundur: exd5 ditarik — bunyinya sama
    sounds.onStep(1, 1) // tidak bergerak
    sounds.onStep(0, 0)
    sounds.onDropRejected()
    assert.deepEqual(played, [['capture'], ['capture'], ['illegal']])
  }))

/** Potret room minimal untuk tes online. */
function room(sans: string[], extra: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'ABCD',
    fen: '',
    history: sans.map((san) => ({ san, move: { from: 0, to: 0, promotion: null }, captured: null })),
    players: [],
    resignedBy: null,
    waiting: false,
    ...extra
  }
}

test('online: bergabung/resync diam, langkah baru berbunyi, giliran kembali menandai tab', () =>
  withSounds(async ({ played, alerts, isOnline, fake }) => {
    isOnline.value = true
    fake.myColor.value = 'w'
    await nextTick()

    fake.roomState.value = room(['e4', 'e5'], { waiting: false }) // potret pertama: bergabung
    await nextTick()
    fake.roomState.value = room(['e4', 'e5']) // resync, isi sama
    await nextTick()
    assert.deepEqual(played, [])

    fake.roomState.value = room(['e4', 'e5', 'Nf3']) // langkah putih (kita) dikonfirmasi
    await nextTick()
    fake.roomState.value = room(['e4', 'e5', 'Nf3', 'Nc6']) // langkah lawan
    await nextTick()
    assert.deepEqual(played, [['move-self'], ['move-opponent']])
    assert.equal(alerts.length, 1, 'hanya saat giliran kembali ke kita')
  }))

test('online: lawan bergabung, menyerah, dan main lagi', () =>
  withSounds(async ({ played, alerts, isOnline, fake }) => {
    isOnline.value = true
    fake.myColor.value = 'w'
    fake.roomState.value = room([], { waiting: true })
    await nextTick()
    fake.roomState.value = room([])
    await nextTick()
    assert.deepEqual(played, [['game-start']])
    assert.equal(alerts.length, 1)

    fake.roomState.value = room(['e4'])
    await nextTick()
    fake.roomState.value = room(['e4'], { resignedBy: 'b' })
    await nextTick()
    assert.deepEqual(played.at(-1), ['game-win'])

    fake.roomState.value = room([])
    await nextTick()
    assert.deepEqual(played.at(-1), ['game-start'], 'main lagi')
  }))

test('online tidak berbunyi selagi mode lokal, dan sebaliknya', () =>
  withSounds(async ({ game, played, fake }) => {
    fake.myColor.value = 'w'
    fake.roomState.value = room(['e4'])
    await nextTick()
    fake.roomState.value = room(['e4', 'e5'])
    await nextTick()
    assert.deepEqual(played, [], 'state online saat mode lokal diabaikan')

    game.phase.value = 'playing'
    await nextTick()
    played.length = 0 // nada "mulai" dari setup → playing
    click(game, 'e2', 'e4')
    await nextTick()
    assert.deepEqual(played, [['move-self']])
  }))
