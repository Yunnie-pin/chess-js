/**
 * Server multiplayer: HTTP untuk health check, WebSocket untuk pertandingan.
 *
 * Semua aturan catur ditegakkan di `Room` (server otoritatif). Berkas ini hanya
 * mengurus sambungan: memetakan socket ke room, menyiarkan perubahan, dan
 * membersihkan yang terputus.
 */

import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

import { parseClientMessage } from '@chess/shared/protocol'
import type { ClientMessage, ServerErrorCode, ServerMessage } from '@chess/shared/protocol'
import { Room, sanitizeName } from './room.ts'
import { RoomRegistry, randomToken } from './rooms.ts'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const SWEEP_INTERVAL_MS = 60_000
const HEARTBEAT_MS = 30_000

const registry = new RoomRegistry()

/** Data per sambungan; disimpan di sisi server, tidak pernah dipercaya dari klien. */
interface Session {
  token: string
  room: Room | null
  alive: boolean
}

const sessions = new Map<WebSocket, Session>()

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

const sendError = (socket: WebSocket, code: ServerErrorCode, message: string): void =>
  send(socket, { type: 'galat', code, message })

/** Menyiarkan ke semua socket di room tersebut, kecuali `except` bila diberikan. */
function broadcast(room: Room, message: ServerMessage, except?: WebSocket): void {
  for (const [socket, session] of sessions) {
    if (session.room === room && socket !== except) send(socket, message)
  }
}

/**
 * Kondisi room dikirim per socket, bukan satu objek untuk semua, karena setiap
 * penerima perlu diberi tahu kursinya sendiri — dan kursi bisa bertukar saat
 * "main lagi".
 */
function broadcastState(room: Room, except?: WebSocket): void {
  const state = room.state()
  for (const [socket, session] of sessions) {
    if (session.room !== room || socket === except) continue
    send(socket, { type: 'kondisi', yourSeat: room.getPlayer(session.token)?.seat ?? null, state })
  }
}

function handleJoin(socket: WebSocket, session: Session, room: Room, name: string, seat: 'w' | 'b' | 'acak'): void {
  const result = room.join(session.token, name, seat)
  if (!result.ok) {
    sendError(socket, result.code, 'Room ini sudah penuh.')
    return
  }

  session.room = room
  send(socket, {
    type: 'bergabung',
    seat: result.player.seat,
    token: session.token,
    state: room.state()
  })
  // Hanya peserta lain yang perlu diberi tahu — yang baru masuk sudah menerima
  // state lengkap di dalam pesan 'bergabung' barusan.
  broadcastState(room, socket)
}

function handleMessage(socket: WebSocket, session: Session, message: ClientMessage): void {
  switch (message.type) {
    case 'buat-room': {
      const room = registry.create()
      handleJoin(socket, session, room, sanitizeName(message.name, 'Pemain'), message.seat)
      return
    }

    case 'gabung-room': {
      const room = registry.find(message.roomId)
      if (!room) {
        sendError(socket, 'room-tidak-ada', `Room "${message.roomId}" tidak ditemukan.`)
        return
      }
      // Token dari klien hanya boleh dipakai untuk merebut kembali kursi di room
      // ini; kalau tidak dikenal, ia diperlakukan sebagai pendatang baru.
      if (message.token && room.getPlayer(message.token)) session.token = message.token
      handleJoin(socket, session, room, sanitizeName(message.name, 'Pemain'), 'acak')
      return
    }

    case 'langkah': {
      const room = session.room
      if (!room) {
        sendError(socket, 'bukan-pemain', 'Anda belum berada di room mana pun.')
        return
      }
      const result = room.playMove(session.token, message.move)
      if (!result.ok) {
        sendError(socket, result.code, ERROR_TEXT[result.code])
        // Klien mungkin sudah menggambar langkah itu — paksa ia kembali sinkron.
        send(socket, {
          type: 'kondisi',
          yourSeat: room.getPlayer(session.token)?.seat ?? null,
          state: room.state()
        })
        return
      }
      broadcast(room, {
        type: 'langkah-dimainkan',
        entry: result.entry,
        fen: result.fen,
        by: result.by
      })
      broadcastState(room)
      return
    }

    case 'menyerah': {
      const room = session.room
      if (!room) return
      if (room.resign(session.token)) broadcastState(room)
      return
    }

    case 'main-lagi': {
      const room = session.room
      if (!room) return
      if (room.rematch(session.token)) broadcastState(room)
      return
    }

    case 'keluar': {
      const room = session.room
      if (!room) return
      room.leave(session.token)
      session.room = null
      broadcastState(room)
      return
    }
  }
}

const ERROR_TEXT: Record<string, string> = {
  'bukan-pemain': 'Anda menonton pertandingan ini, bukan memainkannya.',
  'bukan-giliran': 'Sekarang bukan giliran Anda.',
  'langkah-tidak-sah': 'Langkah itu tidak sah.',
  'permainan-usai': 'Pertandingan sudah selesai.'
}

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', ...registry.stats() }))
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('Server catur. Sambungkan lewat WebSocket ke / untuk bermain.')
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (socket: WebSocket) => {
  const session: Session = { token: randomToken(), room: null, alive: true }
  sessions.set(socket, session)

  socket.on('pong', () => {
    session.alive = true
  })

  socket.on('message', (data) => {
    const message = parseClientMessage(data.toString())
    if (!message) {
      sendError(socket, 'pesan-tidak-dikenal', 'Pesan tidak dikenali.')
      return
    }
    try {
      handleMessage(socket, session, message)
    } catch (error) {
      // Satu klien bermasalah tidak boleh menjatuhkan server untuk semua orang.
      console.error('[catur] gagal memproses pesan:', error)
    }
  })

  socket.on('close', () => {
    const room = session.room
    sessions.delete(socket)
    if (!room) return
    room.disconnect(session.token)
    broadcastState(room)
  })

  socket.on('error', () => socket.close())
})

/** Socket yang mati tanpa event close (kabel dicabut, tidur) hanya ketahuan lewat ping. */
const heartbeat = setInterval(() => {
  for (const [socket, session] of sessions) {
    if (!session.alive) {
      socket.terminate()
      continue
    }
    session.alive = false
    socket.ping()
  }
}, HEARTBEAT_MS)

const sweeper = setInterval(() => {
  const removed = registry.sweep()
  if (removed) console.log(`[catur] ${removed} room menganggur dibersihkan`)
}, SWEEP_INTERVAL_MS)

httpServer.listen(PORT, HOST, () => {
  console.log(`[catur] server siap di http://${HOST}:${PORT} (WebSocket di port yang sama)`)
})

const shutdown = (signal: string) => {
  console.log(`[catur] ${signal} diterima, menutup server…`)
  clearInterval(heartbeat)
  clearInterval(sweeper)
  for (const socket of sessions.keys()) socket.close(1001, 'Server dimatikan')
  wss.close()
  httpServer.close(() => process.exit(0))
  // Jangan menggantung selamanya bila ada socket yang enggan tertutup.
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
