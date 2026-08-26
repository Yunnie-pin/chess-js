import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick } from 'vue'

import { MIN_REPLY_MS, useChessGame } from '../src/composables/useChessGame.ts'
import { Position, fromAlgebraic } from '@chess/shared/chess'

type Game = ReturnType<typeof useChessGame>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Menunggu komputer selesai berpikir, dengan batas waktu agar tes tidak menggantung. */
async function waitForReply(game: Game, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (game.thinking.value && Date.now() < deadline) await sleep(20)
  assert.equal(game.thinking.value, false, 'komputer tidak selesai berpikir dalam batas waktu')
}

/**
 * Pengganti Stockfish untuk tes. Node tidak punya `Worker`/WASM, dan lawan
 * komputer sengaja tidak lagi punya jalur cadangan ke mesin buatan sendiri
 * (`shared/src/ai.ts`) — jadi tesnya menyuntikkan mesin sinkron-deterministik
 * ini lewat `useChessGame({ findBestMove })`. Selalu memilih langkah legal
 * pertama karena tes-tes di sini menguji perilaku composable-nya (jeda,
 * pembatalan, penguncian setup), bukan kekuatan langkah yang dipilih.
 */
async function stubFindBestMove(fen: string) {
  const move = new Position(fen).legalMoves()[0]
  return move ? { from: move.from, to: move.to, promotion: move.promotion } : null
}

/**
 * Menjalankan composable di dalam effect scope tersendiri, persis seperti saat
 * dipakai komponen. Ditandai "sudah dimulai" di sini karena tes-tes di berkas
 * ini menguji perilaku permainan sesudah "Permainan baru" ditekan, bukan
 * keadaan sebelum itu — itu diuji terpisah lewat `withFreshGame`.
 */
function withGame(run: (game: Game) => void | Promise<void>): Promise<void> {
  const scope = effectScope()
  let result: void | Promise<void>
  scope.run(() => {
    const game = useChessGame({ findBestMove: stubFindBestMove })
    game.mode.value = 'dua-pemain' // matikan komputer kecuali tes memintanya
    game.started.value = true
    result = run(game)
  })
  return Promise.resolve(result).finally(() => scope.stop())
}

/** Sama seperti `withGame`, tapi TANPA menandai sudah dimulai — untuk menguji keadaan sebelum "Permainan baru". */
function withFreshGame(run: (game: Game) => void | Promise<void>): Promise<void> {
  const scope = effectScope()
  let result: void | Promise<void>
  scope.run(() => {
    const game = useChessGame({ findBestMove: stubFindBestMove })
    result = run(game)
  })
  return Promise.resolve(result).finally(() => scope.stop())
}

const at = fromAlgebraic

/** Meniru klik pemain: pilih petak asal lalu petak tujuan. */
const click = (game: Game, from: string, to: string) => {
  game.activateSquare(at(from))
  game.activateSquare(at(to))
}

test('memilih bidak menampilkan petak tujuan yang sah', () =>
  withGame((game) => {
    game.activateSquare(at('e2'))
    assert.equal(game.selected.value, at('e2'))
    assert.deepEqual([...game.targets.value.keys()].sort(), [at('e4'), at('e3')].sort())

    // Bidak lawan tidak boleh dipilih saat bukan gilirannya.
    game.activateSquare(at('e7'))
    assert.equal(game.selected.value, null)
  }))

test('klik dua kali menjalankan langkah dan mencatat riwayat', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    assert.equal(game.history.value.length, 1)
    assert.equal(game.history.value[0].san, 'e4')
    assert.equal(game.turn.value, 'b')
    assert.equal(game.selected.value, null)
    assert.equal(game.lastMove.value?.to, at('e4'))
  }))

test('langkah tidak sah diabaikan', () =>
  withGame((game) => {
    click(game, 'e2', 'e5')
    assert.equal(game.history.value.length, 0)
  }))

test('menggeser bidak setara dengan mengklik', () =>
  withGame((game) => {
    game.dropPiece(at('g1'), at('f3'))
    assert.equal(game.history.value[0]?.san, 'Nf3')
  }))

test('riwayat dikelompokkan per nomor langkah', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    click(game, 'e7', 'e5')
    click(game, 'g1', 'f3')

    assert.deepEqual(
      game.historyRows.value.map((row) => [row.number, row.white?.san, row.black?.san]),
      [
        [1, 'e4', 'e5'],
        [2, 'Nf3', undefined]
      ]
    )
  }))

test('promosi membuka dialog dan menunggu pilihan pemain', () =>
  withGame((game) => {
    game.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')

    click(game, 'a7', 'a8')
    assert.ok(game.pendingPromotion.value, 'dialog harus terbuka')
    assert.equal(game.history.value.length, 0, 'langkah belum dijalankan')
    assert.equal(game.pendingPromotion.value!.options.length, 4)

    game.completePromotion('n')
    assert.equal(game.pendingPromotion.value, null)
    assert.equal(game.history.value[0].san, 'a8=N')
    assert.equal(game.board.value[at('a8')], 'wn')
  }))

test('membatalkan promosi mengembalikan posisi seperti semula', () =>
  withGame((game) => {
    game.reset('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')
    const before = game.fen.value

    click(game, 'a7', 'a8')
    game.cancelPromotion()

    assert.equal(game.pendingPromotion.value, null)
    assert.equal(game.selected.value, null)
    assert.equal(game.fen.value, before)
  }))

test('undo mengembalikan satu langkah pada mode dua pemain', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    click(game, 'e7', 'e5')
    game.undo()

    assert.equal(game.history.value.length, 1)
    assert.equal(game.turn.value, 'b')
    assert.equal(game.lastMove.value?.to, at('e4'))
  }))

test('bidak tertangkap dan selisih materi ikut terhitung', () =>
  withGame((game) => {
    game.reset('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1')
    click(game, 'e4', 'd5')

    assert.deepEqual(game.captured.value.b, ['q'])
    assert.equal(game.materialLead.value, 1) // pion putih tersisa, menteri hitam hilang
  }))

test('skak dan skakmat tercermin di status', () =>
  withGame((game) => {
    game.reset('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1')
    click(game, 'a1', 'a8')

    const status = game.status.value
    assert.equal(status.over, true)
    assert.equal(status.reason, 'checkmate')
    assert.equal(status.winner, 'w')
    assert.equal(game.canPlay.value, null, 'papan terkunci setelah permainan usai')
    assert.equal(game.checkSquare.value, at('g8'))
  }))

test('permainan baru mengosongkan riwayat dan posisi', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    game.reset()

    assert.equal(game.history.value.length, 0)
    assert.equal(game.lastMove.value, null)
    assert.equal(game.turn.value, 'w')
    assert.equal(game.fen.value, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  }))

test('memutar papan hanya mengubah sudut pandang', () =>
  withGame((game) => {
    const fen = game.fen.value
    game.flipBoard()
    assert.equal(game.orientation.value, 'b')
    assert.equal(game.fen.value, fen)
  }))

test('komputer menjawab langkah pemain', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    assert.equal(game.thinking.value, true, 'indikator berpikir harus menyala')
    assert.equal(game.canPlay.value, null, 'pemain tidak boleh jalan selagi komputer berpikir')

    await waitForReply(game)

    assert.equal(game.thinking.value, false)
    assert.equal(game.history.value.length, 2, 'komputer sudah menjawab')
    assert.equal(game.history.value[1].color, 'b')
    assert.equal(game.turn.value, 'w')
    assert.equal(game.canPlay.value, 'w')
  }))

test('komputer menahan jawabannya selama jeda minimum', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320 // level tercepat: anggaran waktunya paling kecil
    game.playAs('w')
    await nextTick()

    const started = Date.now()
    click(game, 'e2', 'e4')

    // Di tengah jeda: belum ada jawaban, indikator masih menyala.
    await sleep(MIN_REPLY_MS / 2)
    assert.equal(game.history.value.length, 1, 'komputer tidak boleh menjawab seketika')
    assert.equal(game.thinking.value, true)

    await waitForReply(game)
    assert.equal(game.history.value.length, 2)
    assert.ok(
      Date.now() - started >= MIN_REPLY_MS,
      `jawaban datang setelah ${Date.now() - started} ms, minimal ${MIN_REPLY_MS} ms`
    )
  }))

test('membatalkan langkah selagi jeda berjalan menggugurkan jawaban komputer', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    await sleep(MIN_REPLY_MS / 2)
    game.undo()

    // Jawaban yang tertunda tidak boleh muncul belakangan.
    await sleep(MIN_REPLY_MS * 2)
    assert.equal(game.history.value.length, 0)
    assert.equal(game.thinking.value, false)
    assert.equal(game.turn.value, 'w')
  }))

test('undo pada mode lawan komputer membatalkan sepasang langkah', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'd2', 'd4')
    await waitForReply(game)
    assert.equal(game.history.value.length, 2)

    game.undo()
    assert.equal(game.history.value.length, 0, 'langkah komputer dan pemain sama-sama dibatalkan')
    assert.equal(game.turn.value, 'w')
    assert.equal(game.thinking.value, false)
  }))

test('lawan terkunci begitu pemain menjalankan langkah pertamanya', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    assert.equal(game.setupLocked.value, false, 'papan masih kosong, lawan bebas diganti')

    click(game, 'e2', 'e4')
    assert.equal(game.setupLocked.value, true, 'pemain sudah jalan, lawan terkunci')

    await waitForReply(game)
    assert.equal(game.setupLocked.value, true, 'tetap terkunci setelah komputer menjawab')
  }))

test('lawan masih bebas diganti walau komputer sudah jalan lebih dulu', () =>
  withGame(async (game) => {
    // Kasus inilah yang menentukan bentuk aturannya. Pemain memegang hitam, jadi
    // papan sudah punya satu langkah sebelum ia sempat menyentuh apa pun. Kalau
    // kuncinya dipasang pada langkah pertama PAPAN, lawan tidak akan pernah bisa
    // diganti: "Permainan baru" pun langsung disusul langkah komputer.
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('b')
    await nextTick()
    await waitForReply(game)

    assert.equal(game.history.value.length, 1, 'komputer sudah membuka permainan')
    assert.equal(game.history.value[0].color, 'w')
    assert.equal(game.setupLocked.value, false, 'pemain belum jalan, jadi belum terkunci')

    click(game, 'e7', 'e5')
    assert.equal(game.setupLocked.value, true)
  }))

test('membatalkan langkah sampai habis membuka kunci lawan lagi', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'd2', 'd4')
    await waitForReply(game)
    assert.equal(game.setupLocked.value, true)

    game.undo()
    assert.equal(game.history.value.length, 0)
    assert.equal(game.setupLocked.value, false, 'tidak ada langkah pemain tersisa')
  }))

test('permainan baru membuka kunci lawan', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    assert.equal(game.setupLocked.value, true)

    game.reset()
    assert.equal(game.setupLocked.value, false)
  }))

test('mode dua pemain tidak punya lawan untuk dikunci', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    click(game, 'e7', 'e5')
    assert.equal(game.history.value.length, 2)
    assert.equal(game.setupLocked.value, false)
  }))

test('warna tidak bisa ditukar setelah pertandingan berjalan', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()
    assert.equal(game.humanColor.value, 'w')

    click(game, 'e2', 'e4')
    await waitForReply(game)
    assert.equal(game.setupLocked.value, true)

    const before = game.history.value.length
    game.playAs('b')

    // Ditolak di composable, bukan cuma di tombol: papannya tidak boleh
    // berpindah tangan di tengah jalan.
    assert.equal(game.humanColor.value, 'w', 'pemain tetap memegang putih')
    assert.equal(game.history.value.length, before, 'tidak ada langkah tambahan')
  }))

test('warna masih bisa dipilih sebelum pemain jalan', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    game.playAs('b')
    assert.equal(game.humanColor.value, 'b', 'papan masih kosong, warna bebas dipilih')
  }))

test('permainan baru mengembalikan kebebasan memilih warna', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    await waitForReply(game)
    game.playAs('b')
    assert.equal(game.humanColor.value, 'w', 'masih terkunci')

    game.reset()
    game.playAs('b')
    assert.equal(game.humanColor.value, 'b')
  }))

// ---------------------------------------------------------------------------
// Premove
// ---------------------------------------------------------------------------

test('premove diantre selagi giliran mesin, lalu dijalankan otomatis begitu giliran sendiri tiba', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4') // langkah sungguhan; giliran sekarang milik mesin
    assert.equal(game.thinking.value, true)

    // Diantre selagi mesin masih berpikir — bukan langkah sungguhan.
    click(game, 'd2', 'd4')
    assert.equal(game.premoveQueue.value.length, 1)
    assert.deepEqual(game.premoveQueue.value[0], { from: at('d2'), to: at('d4'), promotion: null })
    assert.equal(game.history.value.length, 1, 'premove belum benar-benar jalan')
    assert.equal(game.selected.value, null)

    // d2-d4 mustahil terganggu balasan hitam mana pun dari posisi awal —
    // tidak ada bidak hitam yang bisa menjangkau d2/d4 dalam satu langkah
    // sesudah 1.e4 — jadi hasilnya bisa dipastikan tanpa menebak keputusan
    // pencarian mesin.
    await waitForReply(game)

    assert.equal(game.premoveQueue.value.length, 0, 'premove sudah dieksekusi dan dibuang dari antrean')
    assert.equal(game.history.value.length, 4, 'e4, balasan mesin, d4 (premove), balasan mesin lagi')
    assert.equal(game.history.value[2].san, 'd4')
    assert.equal(game.history.value[2].color, 'w')
  }))

test('premove yang sudah tidak legal gagal dan menyalakan sorotan gagal, bukan dijalankan diam-diam', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    // Raja hitam terkurung total (nol langkah legal, dan bukan skak), sehingga
    // pion a7 adalah SATU-SATUNYA langkah legal di seluruh posisi: a7-a6.
    // Balasan mesin jadi bisa dipastikan 100%, di level berapa pun.
    game.reset('k7/p1K5/8/P7/8/8/8/8 b - - 0 1')

    // a5-a6 sah diantre SEKARANG karena a6 masih kosong.
    click(game, 'a5', 'a6')
    assert.equal(game.premoveQueue.value.length, 1)

    await waitForReply(game)

    // ...tapi begitu mesin terpaksa memainkan a7-a6, a6 terisi bidak lawan,
    // dan pion putih tidak bisa lagi mendorong lurus ke petak yang terisi.
    assert.equal(game.premoveQueue.value.length, 0, 'premove yang gagal dibuang dari antrean')
    assert.equal(game.history.value.length, 1, 'tidak ada langkah putih tambahan yang jalan')
    assert.equal(game.history.value[0].san, 'a6')
    assert.equal(game.history.value[0].color, 'b')
    assert.deepEqual(game.premoveFailed.value, { from: at('a5'), to: at('a6') })
  }))

test('premove bisa dibatalkan lewat cancelPremove sebelum giliran sendiri tiba', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    click(game, 'd2', 'd4')
    assert.equal(game.premoveQueue.value.length, 1)

    game.cancelPremove()
    assert.equal(game.premoveQueue.value.length, 0)

    await waitForReply(game)
    assert.equal(game.history.value.length, 2, 'premove yang sudah dibatalkan tidak ikut jalan')
  }))

test('mengetuk ulang petak asal premove membatalkannya', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    click(game, 'd2', 'd4')
    assert.equal(game.premoveQueue.value.length, 1)

    game.activateSquare(at('d2')) // ketuk ulang petak asal, tanpa seleksi lain aktif
    assert.equal(game.premoveQueue.value.length, 0)
    assert.equal(game.selected.value, null)
  }))

test('premove bisa diantre berantai, dihitung dari papan bayangan langkah sebelumnya', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4') // langkah sungguhan
    // e4-e5 diantre dulu, lalu e5-e6 disusun seolah bidaknya sudah di e5.
    click(game, 'e4', 'e5')
    click(game, 'e5', 'e6')

    assert.deepEqual(
      game.premoveQueue.value.map((step) => [step.from, step.to]),
      [
        [at('e4'), at('e5')],
        [at('e5'), at('e6')]
      ]
    )
    // Papan bayangan menampilkan bidak sudah di e6; posisi sungguhan belum tersentuh.
    assert.equal(game.displayBoard.value[at('e6')], 'wp')
    assert.equal(game.displayBoard.value[at('e4')], null)
    assert.equal(game.board.value[at('e4')], 'wp', 'posisi sungguhan belum berubah')
  }))

test('antrean premove dibatasi panjangnya', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    // Posisi dengan banyak ruang kosong di depan raja agar mudah menyusun
    // rentetan langkah raja yang masing-masing tetap legal secara pseudo.
    // Pion h7 sekadar mencegah posisi ini dianggap remis materi tidak cukup
    // (raja lawan raja saja) — jauh dari e1/e2, tidak ikut campur.
    game.reset('4k3/7p/8/8/8/8/8/4K3 w - - 0 1')
    game.playAs('w')
    await nextTick()

    click(game, 'e1', 'e2') // langkah sungguhan, giliran berpindah ke hitam
    // Raja bolak-balik antar dua petak — tiap langkah tetap pseudo-legal di
    // papan bayangannya sendiri, sehingga antrean bisa tumbuh sampai batasnya.
    // Lima langkah berturut-turut mengisi antrean sampai penuh (MAX = 5).
    click(game, 'e2', 'e1')
    click(game, 'e1', 'e2')
    click(game, 'e2', 'e1')
    click(game, 'e1', 'e2')
    click(game, 'e2', 'e1')

    assert.equal(game.premoveQueue.value.length, 5, 'sudah mencapai MAX_PREMOVE_QUEUE')

    click(game, 'e1', 'e2') // langkah keenam ditolak, antrean sudah penuh
    assert.equal(game.premoveQueue.value.length, 5)
  }))

test('mematikan sakelar premove membatalkan yang sudah diantre', () =>
  withGame(async (game) => {
    game.mode.value = 'lawan-komputer'
    game.elo.value = 1320
    game.playAs('w')
    await nextTick()

    click(game, 'e2', 'e4')
    click(game, 'd2', 'd4')
    assert.equal(game.premoveQueue.value.length, 1)

    game.premoveEnabled.value = false
    await nextTick() // watch(premoveEnabled, ...) berjalan pada tick berikutnya
    assert.equal(game.premoveQueue.value.length, 0, 'antrean dibuang begitu sakelar dimatikan')

    // Dan selagi mati, tidak ada premove baru yang bisa diantre.
    click(game, 'g1', 'f3')
    assert.equal(game.premoveQueue.value.length, 0)
  }))

test('mematikan sakelar undo membuat undo() tidak melakukan apa-apa', () =>
  withGame((game) => {
    click(game, 'e2', 'e4')
    assert.equal(game.history.value.length, 1)

    game.undoEnabled.value = false
    game.undo()
    assert.equal(game.history.value.length, 1, 'undo tidak boleh berjalan selagi sakelarnya mati')

    game.undoEnabled.value = true
    game.undo()
    assert.equal(game.history.value.length, 0, 'menyala lagi, undo berjalan seperti biasa')
  }))

// ---------------------------------------------------------------------------
// Belum dimulai
// ---------------------------------------------------------------------------

test('papan belum bisa disentuh sebelum "Permainan baru" ditekan', () =>
  withFreshGame((game) => {
    assert.equal(game.canPlay.value, null, 'terkunci walau posisi awal sudah tergambar')

    click(game, 'e2', 'e4')
    assert.equal(game.history.value.length, 0, 'klik tidak boleh menjalankan apa pun')
    assert.equal(game.selected.value, null, 'bidak juga tidak boleh sekadar terpilih')
  }))

test('mesin tidak jalan lebih dulu sebelum "Permainan baru", walau pemain sudah memilih hitam', () =>
  withFreshGame(async (game) => {
    game.playAs('b') // mesin (putih) seharusnya jalan lebih dulu begitu dimulai
    await nextTick()
    await sleep(300)

    assert.equal(game.thinking.value, false, 'mesin tidak boleh mulai berpikir sebelum dimulai')
    assert.equal(game.history.value.length, 0)
  }))

test('"Permainan baru" membuka papan untuk mulai dimainkan', () =>
  withFreshGame((game) => {
    assert.equal(game.canPlay.value, null)

    game.reset()
    assert.equal(game.canPlay.value, 'w', 'putih boleh jalan begitu permainan dimulai')

    click(game, 'e2', 'e4')
    assert.equal(game.history.value.length, 1)
  }))
