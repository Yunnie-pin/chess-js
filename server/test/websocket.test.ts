/**
 * Tes integrasi: menjalankan server sungguhan, lalu menyambungkan dua klien
 * WebSocket sungguhan. Yang diuji di sini adalah hal-hal yang tidak terlihat
 * pada tes unit `Room` — pemetaan socket ke room, penyiaran, dan penanganan
 * pesan sampah dari jaringan.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import WebSocket from 'ws'

import { fromAlgebraic } from '@chess/shared/chess'
import type { ClientMessage, ServerMessage } from '@chess/shared/protocol'

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.ts')
const PORT = 8899
const URL = `ws://127.0.0.1:${PORT}`

let child: ChildProcess

/** Menyalakan server pada port tersendiri agar tes tidak bentrok dengan dev server. */
async function startServer(): Promise<void> {
  child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`)
      if (response.ok) return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server tidak siap dalam batas waktu')
}

/** Klien uji: menyimpan setiap pesan agar tes bisa menunggu tipe tertentu. */
class TestClient {
  readonly socket: WebSocket
  readonly received: ServerMessage[] = []

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data) => this.received.push(JSON.parse(data.toString()) as ServerMessage))
  }

  static async connect(): Promise<TestClient> {
    const socket = new WebSocket(URL)
    await once(socket, 'open')
    return new TestClient(socket)
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message))
  }

  /**
   * Menunggu pesan bertipe tertentu, lalu MENGONSUMSINYA dari antrean. Tanpa
   * dikonsumsi, panggilan berikutnya akan menemukan pesan lama yang sama —
   * misalnya 'kondisi' saat pembuat room masuk sendirian — dan tes akan menguji
   * keadaan yang sudah basi.
   */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 4000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const index = this.received.findIndex((message) => message.type === type)
      if (index >= 0) {
        const [found] = this.received.splice(index, 1)
        return found as Extract<ServerMessage, { type: T }>
      }
      await new Promise((r) => setTimeout(r, 15))
    }
    throw new Error(
      `tidak menerima pesan "${type}"; yang masuk: ${this.received.map((m) => m.type).join(', ')}`
    )
  }

  clear(): void {
    this.received.length = 0
  }

  close(): void {
    this.socket.close()
  }
}

const at = fromAlgebraic
const move = (from: string, to: string) => ({ from: at(from), to: at(to), promotion: null })

test.before(startServer)
test.after(() => {
  child?.kill()
})

test('dua pemain bertemu di satu room lewat kodenya', async () => {
  const host = await TestClient.connect()
  host.send({ type: 'buat-room', name: 'Ani', seat: 'w' })
  const created = await host.waitFor('bergabung')

  assert.equal(created.seat, 'w')
  assert.equal(created.state.waiting, true, 'masih menunggu lawan')
  assert.match(created.state.roomId, /^[A-Z0-9]{4}$/)

  const guest = await TestClient.connect()
  guest.send({ type: 'gabung-room', roomId: created.state.roomId, name: 'Budi' })
  const joined = await guest.waitFor('bergabung')

  assert.equal(joined.seat, 'b', 'kursi tersisa diberikan otomatis')
  assert.equal(joined.state.waiting, false)
  assert.deepEqual(
    joined.state.players.map((p) => [p.seat, p.name]),
    [
      ['w', 'Ani'],
      ['b', 'Budi']
    ]
  )

  // Tuan rumah ikut diberi tahu bahwa lawannya sudah datang (pesan 'kondisi'
  // pertama — saat ia masih sendirian — sudah dikonsumsi oleh waitFor).
  const hostUpdate = await host.waitFor('kondisi')
  assert.equal(hostUpdate.state.players.length, 2)

  host.close()
  guest.close()
})

test('langkah disiarkan ke kedua pemain', async () => {
  const host = await TestClient.connect()
  host.send({ type: 'buat-room', name: 'Ani', seat: 'w' })
  const { state } = await host.waitFor('bergabung')

  const guest = await TestClient.connect()
  guest.send({ type: 'gabung-room', roomId: state.roomId, name: 'Budi' })
  await guest.waitFor('bergabung')

  host.clear()
  guest.clear()
  host.send({ type: 'langkah', move: move('e2', 'e4') })

  const forHost = await host.waitFor('langkah-dimainkan')
  const forGuest = await guest.waitFor('langkah-dimainkan')

  assert.equal(forHost.entry.san, 'e4')
  assert.equal(forGuest.entry.san, 'e4', 'lawan menerima langkah yang sama')
  assert.equal(forGuest.by, 'w')
  assert.match(forGuest.fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\//)

  host.close()
  guest.close()
})

test('langkah di luar giliran ditolak dan klien dipaksa sinkron ulang', async () => {
  const host = await TestClient.connect()
  host.send({ type: 'buat-room', name: 'Ani', seat: 'w' })
  const { state } = await host.waitFor('bergabung')

  const guest = await TestClient.connect()
  guest.send({ type: 'gabung-room', roomId: state.roomId, name: 'Budi' })
  await guest.waitFor('bergabung')

  guest.clear()
  guest.send({ type: 'langkah', move: move('e7', 'e5') }) // hitam jalan duluan

  const error = await guest.waitFor('galat')
  assert.equal(error.code, 'bukan-giliran')

  // Klien yang salah dikirimi kondisi sebenarnya, bukan dibiarkan melenceng.
  const resync = await guest.waitFor('kondisi')
  assert.equal(resync.state.history.length, 0)

  host.close()
  guest.close()
})

test('menyambung ulang dengan token yang sama mengembalikan kursi dan papan', async () => {
  const host = await TestClient.connect()
  host.send({ type: 'buat-room', name: 'Ani', seat: 'w' })
  const created = await host.waitFor('bergabung')
  const { roomId } = created.state

  const guest = await TestClient.connect()
  guest.send({ type: 'gabung-room', roomId, name: 'Budi' })
  await guest.waitFor('bergabung')

  host.send({ type: 'langkah', move: move('e2', 'e4') })
  await guest.waitFor('langkah-dimainkan')

  // Tuan rumah "menutup tab", lalu kembali membawa tokennya.
  host.close()
  const returning = await TestClient.connect()
  returning.send({ type: 'gabung-room', roomId, name: 'Ani', token: created.token })
  const back = await returning.waitFor('bergabung')

  assert.equal(back.seat, 'w', 'kursi putih kembali ke pemiliknya')
  assert.equal(back.state.history.length, 1, 'papan tidak hilang')
  assert.equal(back.state.history[0].san, 'e4')
  assert.equal(back.state.players.length, 2, 'tidak muncul pemain kembar')

  returning.close()
  guest.close()
})

test('room yang tidak ada ditolak dengan jelas', async () => {
  const client = await TestClient.connect()
  client.send({ type: 'gabung-room', roomId: 'ZZZZ', name: 'Ani' })

  const error = await client.waitFor('galat')
  assert.equal(error.code, 'room-tidak-ada')
  client.close()
})

test('pesan sampah tidak menjatuhkan server', async () => {
  const client = await TestClient.connect()
  for (const junk of ['bukan json', '{}', '[]', 'null', '{"type":"entah"}', '{"type":"langkah"}']) {
    client.socket.send(junk)
  }
  const error = await client.waitFor('galat')
  assert.equal(error.code, 'pesan-tidak-dikenal')

  // Server harus tetap melayani permintaan yang benar sesudahnya.
  client.clear()
  client.send({ type: 'buat-room', name: 'Ani', seat: 'acak' })
  const joined = await client.waitFor('bergabung')
  assert.ok(joined.state.roomId)

  const health = await fetch(`http://127.0.0.1:${PORT}/health`)
  assert.equal(health.status, 200)
  client.close()
})

test('pemain ketiga masuk sebagai penonton dan tidak bisa menjalankan langkah', async () => {
  const host = await TestClient.connect()
  host.send({ type: 'buat-room', name: 'Ani', seat: 'w' })
  const { state } = await host.waitFor('bergabung')

  const guest = await TestClient.connect()
  guest.send({ type: 'gabung-room', roomId: state.roomId, name: 'Budi' })
  await guest.waitFor('bergabung')

  const watcher = await TestClient.connect()
  watcher.send({ type: 'gabung-room', roomId: state.roomId, name: 'Citra' })
  const asWatcher = await watcher.waitFor('bergabung')
  assert.equal(asWatcher.seat, 'penonton')

  watcher.clear()
  watcher.send({ type: 'langkah', move: move('e2', 'e4') })
  const error = await watcher.waitFor('galat')
  assert.equal(error.code, 'bukan-pemain')

  host.close()
  guest.close()
  watcher.close()
})
