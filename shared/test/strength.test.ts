import test from 'node:test'
import assert from 'node:assert/strict'

import { Position } from '../src/chess.ts'
import {
  DEFAULT_ELO,
  ELO_LEVELS,
  STRENGTH_PROFILES,
  analyseRootMoves,
  chooseMove,
  resetRandomSource,
  setRandomSource
} from '../src/ai.ts'


test('setiap level punya profil, dan makin tinggi Elo makin tidak toleran salah', () => {
  let previousMargin = Infinity
  let previousBlunder = Infinity

  for (const elo of ELO_LEVELS) {
    const profile = STRENGTH_PROFILES[elo]
    assert.ok(profile, `level ${elo} harus punya profil`)
    assert.ok(profile.maxDepth >= 1)
    assert.ok(profile.timeMs > 0)

    // Ini yang bikin urutan levelnya bermakna: level lebih tinggi tidak boleh
    // lebih longgar toleransi salahnya.
    assert.ok(
      profile.errorMargin <= previousMargin,
      `errorMargin ${elo} (${profile.errorMargin}) harus <= level sebelumnya (${previousMargin})`
    )
    assert.ok(
      profile.blunderChance <= previousBlunder,
      `blunderChance ${elo} harus <= level sebelumnya`
    )
    previousMargin = profile.errorMargin
    previousBlunder = profile.blunderChance
  }
})

test('level tertinggi tidak pernah sengaja salah', () => {
  const top = ELO_LEVELS[ELO_LEVELS.length - 1]
  assert.equal(STRENGTH_PROFILES[top].errorMargin, 0)
  assert.equal(STRENGTH_PROFILES[top].blunderChance, 0)
})

test('level bawaan ada dalam daftar', () => {
  assert.ok((ELO_LEVELS as readonly number[]).includes(DEFAULT_ELO))
})

test('hasil pencarian menyertakan skor tiap langkah akar, terurut dari terbaik', () => {
  const position = new Position()
  const { rootMoves } = chooseMove(position, 2200)

  assert.equal(rootMoves.length, 20, 'posisi awal punya 20 langkah legal')
  for (let i = 1; i < rootMoves.length; i++) {
    assert.ok(
      rootMoves[i - 1].score >= rootMoves[i].score,
      `rootMoves harus terurut menurun, tapi ${rootMoves[i - 1].score} < ${rootMoves[i].score}`
    )
  }
})

test('semua level tetap mengembalikan langkah yang legal', () => {
  // Posisi berantakan dengan taktik di mana-mana; level lemah pun tidak boleh
  // mengembalikan langkah ngawur yang tidak ada di daftar legal.
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'

  for (const elo of ELO_LEVELS) {
    // Yang perlu diulang hanya level yang pemilihannya acak. Level mahal dan
    // deterministik cukup sekali — kalau tidak, tes ini sendirian menghabiskan
    // belasan detik di CI.
    const profile = STRENGTH_PROFILES[elo]
    const random = profile.blunderChance > 0 || profile.errorMargin > 0
    const attempts = random && profile.timeMs <= 700 ? 4 : 1

    for (let attempt = 0; attempt < attempts; attempt++) {
      const position = new Position(fen)
      const legal = position.legalMoves()
      const { move } = chooseMove(position, elo)
      assert.ok(move, `level ${elo} harus mengembalikan langkah`)

      const match = legal.find(
        (m) => m.from === move!.from && m.to === move!.to && m.promotion === move!.promotion
      )
      assert.ok(match, `level ${elo} mengembalikan langkah di luar daftar legal`)
      // Isinya harus utuh — bukan sekadar from/to yang kebetulan cocok, tapi
      // juga bidak dan tangkapannya, supaya papan tidak salah diperbarui.
      assert.deepEqual(move, match, `level ${elo} mengembalikan langkah yang datanya tidak utuh`)
    }
  }
})

test('level maksimal selalu memilih langkah terbaik menurut pencariannya', () => {
  // Menteri hitam di d5 gratis. Level tertinggi tidak boleh melewatkannya.
  for (let attempt = 0; attempt < 5; attempt++) {
    const position = new Position('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1')
    const { move } = chooseMove(position, 3190)
    assert.equal(move?.captured, 'bq', `percobaan ${attempt + 1}: menteri gratis harus diambil`)
  }
})

const OPEN_POSITION = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

/*
 * CATATAN soal apa yang TIDAK diuji di sini.
 *
 * Tangga kekuatan antar level pernah diuji dengan mengukur rata-rata kerugian
 * tiap level lalu membandingkannya. Dua kali gagal dibuat andal, dan penyebabnya
 * mendasar: pencarian dibatasi WAKTU, jadi kedalaman yang tercapai berbeda tiap
 * jalan, dan skor akarnya ikut bergeser. Mematok sumber acak tidak menolong —
 * variasinya datang dari jam, bukan dari acak.
 *
 * Jaminan tangganya sekarang datang dari tiga tes deterministik di berkas ini:
 * errorMargin menurun monoton, langkah pilihan tidak pernah melewati errorMargin
 * levelnya, dan level teratas selalu mengambil langkah terbaik. Ketiganya
 * bersama-sama sudah menyiratkan urutan kekuatannya.
 *
 * Semua ini menguji mesin sendiri (`chooseMove` di ai.ts), bukan lawan
 * sungguhan di aplikasi — itu Stockfish sekarang, lewat UCI_Elo miliknya
 * sendiri, bukan tabel STRENGTH_PROFILES di berkas ini.
 */

/**
 * Menjalankan `run` dengan sumber acak yang dipatok pada satu nilai, supaya
 * cabang mana yang diambil `pickByStrength` bisa dipilih dengan pasti.
 */
function withRandom<T>(value: number, run: () => T): T {
  setRandomSource(() => value)
  try {
    return run()
  } finally {
    resetRandomSource()
  }
}

/**
 * `0.999` mengambil kandidat paling ujung — langkah TERBURUK yang masih
 * diizinkan `errorMargin`. Sekaligus tidak pernah memicu blunder, karena
 * `0.999 < blunderChance` selalu salah.
 */
const WORST_ALLOWED = 0.999

test('langkah terburuk yang boleh dipilih tetap dalam batas errorMargin', () => {
  // Ini kontrak sesungguhnya dari sistem level, dan berlaku pada SETIAP
  // pemilihan — bukan cuma rata-rata. Level dengan errorMargin 0 dilewati:
  // sudah diuji terpisah, dan pencariannya paling mahal.
  for (const elo of ELO_LEVELS) {
    const profile = STRENGTH_PROFILES[elo]
    if (profile.errorMargin === 0) continue

    const result = withRandom(WORST_ALLOWED, () => chooseMove(new Position(OPEN_POSITION), elo))
    const chosen = result.rootMoves.find(
      (entry) =>
        entry.move.from === result.move!.from &&
        entry.move.to === result.move!.to &&
        entry.move.promotion === result.move!.promotion
    )
    assert.ok(chosen, `level ${elo}: langkah pilihan harus ada di daftar akar`)

    const loss = result.rootMoves[0].score - chosen!.score
    assert.ok(
      loss <= profile.errorMargin,
      `level ${elo} memilih langkah ${loss} cp lebih buruk, melebihi batas ${profile.errorMargin} cp`
    )
  }
})

test('analyseRootMoves memberi skor untuk setiap langkah legal, terurut', () => {
  const position = new Position(OPEN_POSITION)
  const legalCount = position.legalMoves().length
  const analysed = analyseRootMoves(position, 2)

  assert.equal(analysed.length, legalCount, 'setiap langkah legal harus dapat skor')
  for (let i = 1; i < analysed.length; i++) {
    assert.ok(analysed[i - 1].score >= analysed[i].score, 'harus terurut menurun')
  }
  // Jendela penuh: skornya harus benar-benar berbeda-beda, bukan seri di alpha.
  assert.ok(new Set(analysed.map((entry) => entry.score)).size > 1)
})

test('jalur blunder tetap mengembalikan langkah legal', () => {
  // `0` selalu memicu blunder di level yang punya blunderChance > 0. Jalur ini
  // sengaja melewati errorMargin, jadi yang dijamin hanya legalitasnya.
  for (const elo of ELO_LEVELS) {
    if (STRENGTH_PROFILES[elo].blunderChance === 0) continue

    const position = new Position(OPEN_POSITION)
    const legal = position.legalMoves()
    const { move } = withRandom(0, () => chooseMove(position, elo))

    assert.ok(move, `level ${elo} harus tetap mengembalikan langkah`)
    assert.ok(
      legal.some(
        (m) => m.from === move!.from && m.to === move!.to && m.promotion === move!.promotion
      ),
      `level ${elo} mengembalikan langkah tidak legal lewat jalur blunder`
    )
  }
})

test('skor langkah akar bermakna, bukan semuanya seri di batas alpha', () => {
  // Bug yang pernah terjadi: dengan penyempitan alpha, semua langkah yang
  // gagal-rendah melaporkan skor yang sama, sehingga tabel skornya tidak
  // berguna untuk membedakan level.
  const result = chooseMove(new Position(OPEN_POSITION), 2600)
  const distinct = new Set(result.rootMoves.map((entry) => entry.score))

  assert.ok(result.depth >= 2, `pencarian harus lebih dari satu ply, dapat ${result.depth}`)
  assert.ok(
    distinct.size > 1,
    `harus ada lebih dari satu skor berbeda di ${result.rootMoves.length} langkah akar`
  )
})
