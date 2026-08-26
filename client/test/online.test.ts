/**
 * Tes ujung-ke-ujung: composable klien yang sesungguhnya berbicara dengan server
 * yang sesungguhnya lewat WebSocket. Ini yang membuktikan seluruh rantai
 * tersambung — protokol, penjaga pesan, rekonstruksi papan dari FEN, dan aturan
 * siapa boleh jalan — bukan sekadar tiap potongan yang benar sendiri-sendiri.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { effectScope } from 'vue'

import { fromAlgebraic } from '@chess/shared/chess'
import { useOnlineGame } from '../src/composables/useOnlineGame.ts'

type Online = ReturnType<typeof useOnlineGame>

const serverEntry = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../server/src/index.ts'
)
const PORT = 8901
const URL = `ws://127.0.0.1:${PORT}`

let child: ChildProcess
const scopes: ReturnType<typeof effectScope>[] = []

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Menunggu sampai sebuah kondisi terpenuhi, dengan batas waktu yang jelas. */
async function waitUntil(check: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await sleep(20)
  }
  throw new Error(`batas waktu terlampaui saat menunggu: ${label}`)
}

/** Membuat klien di dalam effect scope-nya sendiri, seperti saat dipakai komponen. */
function makeClient(): Online {
  const scope = effectScope()
  scopes.push(scope)
  const client = scope.run(() => useOnlineGame(URL))!
  client.connect()
  return client
}

test.before(async () => {
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return
    } catch {
      await sleep(100)
    }
  }
  throw new Error('server tidak siap')
})

test.after(() => {
  for (const scope of scopes) scope.stop()
  child?.kill()
})

const at = fromAlgebraic

/** Dua klien yang sudah duduk di satu room, putih dan hitam. */
async function pairedClients(): Promise<{ white: Online; black: Online; roomId: string }> {
  const host = makeClient()
  host.createRoom('Ani', 'w')
  await waitUntil(() => host.inRoom.value, 'tuan rumah masuk room')

  const roomId = host.roomId.value!
  const guest = makeClient()
  guest.joinRoom(roomId, 'Budi')
  await waitUntil(() => guest.inRoom.value, 'tamu masuk room')
  await waitUntil(() => host.roomState.value?.players.length === 2, 'tuan rumah melihat lawannya')

  return { white: host, black: guest, roomId }
}

test('membuat room memberi kode dan menandai masih menunggu', async () => {
  const client = makeClient()
  client.createRoom('Ani', 'w')
  await waitUntil(() => client.inRoom.value, 'masuk room')

  assert.match(client.roomId.value!, /^[A-Z0-9]{4}$/)
  assert.equal(client.myColor.value, 'w')
  assert.equal(client.roomState.value!.waiting, true)
  assert.equal(client.canPlay.value, null, 'belum boleh jalan sebelum lawan datang')
})

test('dua klien melihat papan yang sama setelah sebuah langkah', async () => {
  const { white, black } = await pairedClients()

  assert.equal(white.canPlay.value, 'w', 'putih boleh jalan')
  assert.equal(black.canPlay.value, null, 'hitam menunggu giliran')

  white.activateSquare(at('e2'))
  white.activateSquare(at('e4'))

  await waitUntil(() => black.historyRows.value.length === 1, 'lawan menerima langkah')

  assert.equal(black.historyRows.value[0].white?.san, 'e4')
  assert.equal(black.board.value[at('e4')], 'wp')
  assert.equal(white.board.value[at('e4')], 'wp')
  assert.equal(black.turn.value, 'b')
  assert.equal(black.canPlay.value, 'b', 'sekarang giliran hitam')
  assert.equal(white.canPlay.value, null)
})

test('klien tidak bisa menjalankan bidak lawan', async () => {
  const { black } = await pairedClients()

  // Hitam mencoba memilih pion putih sebelum gilirannya.
  black.activateSquare(at('e2'))
  assert.equal(black.selected.value, null, 'bidak lawan tidak bisa dipilih')
})

test('langkah tidak sah tidak mengubah papan siapa pun', async () => {
  const { white, black } = await pairedClients()
  const before = white.roomState.value!.fen

  // Menembus lapisan klik dan mengirim langkah mustahil langsung ke server.
  white.playMove({ from: at('e2'), to: at('e5'), promotion: null })
  await sleep(400)

  assert.equal(white.roomState.value!.fen, before)
  assert.equal(black.roomState.value!.fen, before)
  assert.equal(white.historyRows.value.length, 0)
})

test('menyerah mengakhiri pertandingan bagi kedua pemain', async () => {
  const { white, black } = await pairedClients()
  black.resign()

  await waitUntil(() => white.roomState.value?.resignedBy === 'b', 'putih melihat lawannya menyerah')

  assert.equal(black.roomState.value!.resignedBy, 'b')
  assert.equal(white.canPlay.value, null, 'papan terkunci setelah menyerah')
})

test('main lagi mengosongkan papan dan menukar warna', async () => {
  const { white, black } = await pairedClients()
  white.activateSquare(at('e2'))
  white.activateSquare(at('e4'))
  await waitUntil(() => black.historyRows.value.length === 1, 'langkah tercatat')

  black.resign()
  await waitUntil(() => white.roomState.value?.resignedBy === 'b', 'pertandingan usai')

  white.rematch()
  await waitUntil(() => white.myColor.value === 'b', 'warna ditukar setelah main lagi')

  assert.equal(black.myColor.value, 'w')
  assert.equal(white.historyRows.value.length, 0)
  assert.equal(white.roomState.value!.resignedBy, null)
})

test('bidak tertangkap ikut terkirim ke kedua klien', async () => {
  const { white, black } = await pairedClients()
  const play = async (client: Online, from: string, to: string, expectedPlies: number) => {
    client.activateSquare(at(from))
    client.activateSquare(at(to))
    await waitUntil(
      () => (white.roomState.value?.history.length ?? 0) === expectedPlies,
      `langkah ${from}${to} sampai ke server`
    )
  }

  // 1. e4 d5 2. exd5 — putih menangkap pion hitam.
  await play(white, 'e2', 'e4', 1)
  await play(black, 'd7', 'd5', 2)
  await play(white, 'e4', 'd5', 3)

  assert.deepEqual(white.captured.value.b, ['p'], 'satu pion hitam tertangkap')
  assert.deepEqual(black.captured.value.b, ['p'], 'lawan melihat hal yang sama')
  assert.equal(white.materialLead.value, 1)
})

test('room yang salah kode memberi pesan yang jelas', async () => {
  const client = makeClient()
  client.joinRoom('ZZZZ', 'Ani')

  await waitUntil(() => client.error.value !== null, 'pesan galat diterima')
  // Kodenya yang diperiksa, bukan bunyi kalimatnya: teks galat ikut bahasa yang
  // dipilih pemain, sedangkan kode ini bagian dari protokol.
  assert.equal(client.errorCode.value, 'room-tidak-ada')
  assert.match(client.error.value!, /tidak ditemukan/i, 'teks bawaan tetap bahasa Indonesia')
  assert.equal(client.inRoom.value, false)
})

test('pemain ketiga menjadi penonton dan papannya terkunci', async () => {
  const { white, roomId } = await pairedClients()

  const watcher = makeClient()
  watcher.joinRoom(roomId, 'Citra')
  await waitUntil(() => watcher.inRoom.value, 'penonton masuk')

  assert.equal(watcher.isSpectator.value, true)
  assert.equal(watcher.myColor.value, null)
  assert.equal(watcher.canPlay.value, null)

  // Tapi ia tetap melihat jalannya pertandingan.
  white.activateSquare(at('d2'))
  white.activateSquare(at('d4'))
  await waitUntil(() => watcher.historyRows.value.length === 1, 'penonton mengikuti langkah')
  assert.equal(watcher.historyRows.value[0].white?.san, 'd4')
})

// ---------------------------------------------------------------------------
// Premove
// ---------------------------------------------------------------------------

test('premove online diantre selagi giliran lawan, lalu terkirim otomatis begitu giliran sendiri tiba', async () => {
  const { white, black } = await pairedClients()

  // Hitam menyiapkan premove selagi masih giliran putih.
  black.activateSquare(at('e7'))
  black.activateSquare(at('e5'))
  assert.equal(black.premoveQueue.value.length, 1)
  assert.deepEqual(black.premoveQueue.value[0], { from: at('e7'), to: at('e5'), promotion: null })
  assert.equal(black.premoveColor.value, 'b')

  white.activateSquare(at('e2'))
  white.activateSquare(at('e4'))
  await waitUntil(
    () => (white.roomState.value?.history.length ?? 0) === 2,
    'premove hitam terkirim dan tercatat server'
  )

  assert.equal(black.premoveQueue.value.length, 0)
  assert.equal(white.roomState.value?.history[1]?.san, 'e5')
  assert.equal(black.roomState.value?.history[1]?.san, 'e5', 'kedua klien melihat hasil yang sama')
})

test('premove online yang sudah tidak legal gagal, bukan dikirim diam-diam', async () => {
  const { white, black } = await pairedClients()

  // 1. e4 d6 — d6 sekadar mengisi giliran pertama hitam, supaya pion e7 tetap
  // di tempat untuk premove berikutnya.
  white.activateSquare(at('e2'))
  white.activateSquare(at('e4'))
  await waitUntil(() => (white.roomState.value?.history.length ?? 0) === 1, 'langkah 1 putih sampai')

  black.activateSquare(at('d7'))
  black.activateSquare(at('d6'))
  await waitUntil(() => (white.roomState.value?.history.length ?? 0) === 2, 'langkah 1 hitam sampai')

  // Hitam mengantre e7-e5 sekarang, selagi e5 masih kosong.
  black.activateSquare(at('e7'))
  black.activateSquare(at('e5'))
  assert.equal(black.premoveQueue.value.length, 1)

  // Tapi putih justru mendorong pionnya sendiri ke e5 lebih dulu...
  white.activateSquare(at('e4'))
  white.activateSquare(at('e5'))
  await waitUntil(() => (white.roomState.value?.history.length ?? 0) === 3, 'langkah 2 putih sampai')

  // ...jadi begitu giliran hitam benar-benar tiba, dorongan lurus e7-e5 sudah
  // tidak legal (petaknya terisi bidak lawan, dan pion tidak bisa menangkap lurus).
  await waitUntil(() => black.premoveQueue.value.length === 0, 'premove yang gagal dibuang dari antrean')
  assert.deepEqual(black.premoveFailed.value, { from: at('e7'), to: at('e5') })
  assert.equal(white.roomState.value?.history.length, 3, 'tidak ada langkah hitam tambahan yang terkirim')
})

test('premove online bisa dibatalkan lewat cancelPremove sebelum giliran sendiri tiba', async () => {
  const { white, black } = await pairedClients()

  black.activateSquare(at('e7'))
  black.activateSquare(at('e5'))
  assert.equal(black.premoveQueue.value.length, 1)

  black.cancelPremove()
  assert.equal(black.premoveQueue.value.length, 0)

  white.activateSquare(at('e2'))
  white.activateSquare(at('e4'))
  await waitUntil(() => (white.roomState.value?.history.length ?? 0) === 1, 'langkah putih sampai')

  // Sengaja diberi jeda: kalau premove yang sudah dibatalkan ternyata masih
  // terkirim, ini akan menangkapnya.
  await sleep(300)
  assert.equal(white.roomState.value?.history.length, 1, 'premove yang sudah dibatalkan tidak ikut terkirim')
})

test('mengetuk ulang petak asal premove online membatalkannya', async () => {
  const { black } = await pairedClients()

  black.activateSquare(at('e7'))
  black.activateSquare(at('e5'))
  assert.equal(black.premoveQueue.value.length, 1)

  black.activateSquare(at('e7')) // ketuk ulang petak asal, tanpa seleksi lain aktif
  assert.equal(black.premoveQueue.value.length, 0)
  assert.equal(black.selected.value, null)
})

test('premove online bisa diantre berantai, dihitung dari papan bayangan langkah sebelumnya', async () => {
  const { black } = await pairedClients()

  // e7-e5 diantre dulu, lalu e5-e4 disusun seolah bidaknya sudah di e5 —
  // pion hitam melangkah maju ke arah rank yang mengecil, bukan membesar.
  black.activateSquare(at('e7'))
  black.activateSquare(at('e5'))
  black.activateSquare(at('e5'))
  black.activateSquare(at('e4'))

  assert.deepEqual(
    black.premoveQueue.value.map((step) => [step.from, step.to]),
    [
      [at('e7'), at('e5')],
      [at('e5'), at('e4')]
    ]
  )
  assert.equal(black.displayBoard.value[at('e4')], 'bp')
  assert.equal(black.displayBoard.value[at('e7')], null)
  assert.equal(black.board.value[at('e7')], 'bp', 'posisi sungguhan belum berubah')
})
