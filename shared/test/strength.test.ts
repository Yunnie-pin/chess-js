import test from 'node:test'
import assert from 'node:assert/strict'

import { Position } from '../src/chess.ts'
import {
  DEFAULT_ELO,
  ELO_LEVELS,
  STRENGTH_PROFILES,
  analyseRootMoves,
  chooseMove
} from '../src/ai.ts'
import type { EloRating } from '../src/ai.ts'

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
  const { rootMoves } = chooseMove(position, 1200)

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
    const { move } = chooseMove(position, 2000)
    assert.equal(move?.captured, 'bq', `percobaan ${attempt + 1}: menteri gratis harus diambil`)
  }
})

const OPEN_POSITION = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

/** Pembanding tetap kedalaman 4, dipakai untuk menilai langkah SEMUA level. */
const REFERENCE = analyseRootMoves(new Position(OPEN_POSITION), 4)

/**
 * Rata-rata kerugian langkah pilihan sebuah level, dalam centipawn, diukur
 * dengan pembanding tetap di atas.
 *
 * Pembandingnya harus tetap. Mengukur sebuah level dengan pencariannya sendiri
 * tidak bisa dibandingkan antar level: level kedalaman 1 melihat sebaran skor
 * yang jauh lebih sempit daripada kedalaman 3, jadi kerugiannya terlihat kecil
 * padahal langkahnya justru lebih buruk.
 */
function averageLoss(elo: EloRating, runs: number): number {
  const best = REFERENCE[0].score
  let total = 0

  for (let i = 0; i < runs; i++) {
    const { move } = chooseMove(new Position(OPEN_POSITION), elo)
    if (!move) continue
    const rated = REFERENCE.find(
      (entry) =>
        entry.move.from === move.from &&
        entry.move.to === move.to &&
        entry.move.promotion === move.promotion
    )
    total += best - (rated?.score ?? best)
  }
  return total / runs
}

test('level rendah benar-benar memainkan langkah yang lebih buruk', () => {
  const loss = averageLoss(400, 8)
  assert.ok(loss > 0, `level 400 harus rugi skor rata-rata > 0, dapat ${loss.toFixed(1)} cp`)
})

test('makin tinggi Elo, makin kecil kerugiannya terhadap pembanding yang sama', () => {
  // Level 2000 sengaja tidak diikutkan: ia mencari lebih dalam daripada
  // pembandingnya, jadi pembanding kedalaman 4 bukan wasit yang sah untuknya.
  const weak = averageLoss(400, 8)
  const mid = averageLoss(1200, 5)
  const strong = averageLoss(1600, 3)

  assert.ok(
    weak > mid,
    `400 (${weak.toFixed(1)} cp) harus rugi lebih banyak daripada 1200 (${mid.toFixed(1)} cp)`
  )
  assert.ok(
    mid >= strong,
    `1200 (${mid.toFixed(1)} cp) tidak boleh lebih baik daripada 1600 (${strong.toFixed(1)} cp)`
  )
})

test('skor langkah akar bermakna, bukan semuanya seri di batas alpha', () => {
  // Bug yang pernah terjadi: dengan penyempitan alpha, semua langkah yang
  // gagal-rendah melaporkan skor yang sama, sehingga tabel skornya tidak
  // berguna untuk membedakan level.
  const result = chooseMove(new Position(OPEN_POSITION), 1600)
  const distinct = new Set(result.rootMoves.map((entry) => entry.score))

  assert.ok(result.depth >= 2, `pencarian harus lebih dari satu ply, dapat ${result.depth}`)
  assert.ok(
    distinct.size > 1,
    `harus ada lebih dari satu skor berbeda di ${result.rootMoves.length} langkah akar`
  )
})
