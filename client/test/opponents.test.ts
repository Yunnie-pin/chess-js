/**
 * Tes daftar lawan, terutama warnanya.
 *
 * Palet papan yang ada disetel hati-hati: komentar di `assets/main.css`
 * mencatat bahwa petak gelap harus tetap cukup terang agar bidak hitam terbaca
 * di atasnya — papan hijau standar memberi rasio sekitar 4,3:1, dan emas tua di
 * sana menyamainya. Begitu tiap karakter membawa warna papannya sendiri, aturan
 * itu berubah dari "satu kali disetel" menjadi "gampang dilanggar tanpa sadar".
 * Karena itu setiap tema di sini diukur, bukan sekadar dipercaya.
 *
 * Warna yang TIDAK ikut bertema (bidak, permukaan panel) dibaca langsung dari
 * main.css, supaya tes ini ikut bergerak kalau nilai di sana diubah — bukan
 * membandingkan dengan salinan yang perlahan basi.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { ELO_LEVELS, STRENGTH_PROFILES } from '@chess/shared/ai'
import { HOST, OPPONENTS, OPPONENT_LIST } from '../src/opponents.ts'
import { themeVariables } from '../src/theme.ts'
import { id } from '../src/i18n/id.ts'

const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/main.css')
const css = readFileSync(cssPath, 'utf8')

/** Membaca satu variabel warna heksa dari main.css. */
function cssColor(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(match, `variabel --${name} tidak ditemukan di main.css`)
  return match![1]
}

// --- Kontras relatif menurut WCAG 2.1 ---------------------------------------

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const v = hex.replace('#', '')
  const r = channel(parseInt(v.slice(0, 2), 16))
  const g = channel(parseInt(v.slice(2, 4), 16))
  const b = channel(parseInt(v.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

// --- Jarak warna yang kira-kira sesuai penglihatan (CIE76) --------------------

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** CIELAB dengan titik putih D65. */
function lab(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  const r = linear(parseInt(v.slice(0, 2), 16) / 255)
  const g = linear(parseInt(v.slice(2, 4), 16) / 255)
  const b = linear(parseInt(v.slice(4, 6), 16) / 255)

  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function deltaE(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

test('jarak warna cocok dengan nilai yang sudah diketahui', () => {
  assert.equal(Math.round(deltaE('#000000', '#ffffff')), 100)
  assert.equal(deltaE('#3fc09b', '#3fc09b'), 0)
})

test('perhitungan kontras cocok dengan nilai yang sudah diketahui', () => {
  // Penjaga bagi penjaganya: hitam-putih tepat 21:1, dan warna yang sama 1:1.
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21)
  assert.equal(contrast('#7a7a7a', '#7a7a7a'), 1)
})

test('tiap tingkat Elo punya satu lawan, dan sebaliknya', () => {
  assert.equal(OPPONENT_LIST.length, ELO_LEVELS.length)
  for (const elo of ELO_LEVELS) {
    const opponent = OPPONENTS[elo]
    assert.ok(opponent, `Elo ${elo} tidak punya lawan`)
    assert.equal(opponent.elo, elo, 'elo di dalam objek harus cocok dengan kuncinya')
    assert.ok(opponent.name.trim().length > 0)
    assert.ok(STRENGTH_PROFILES[elo], `Elo ${elo} tidak punya profil kekuatan di shared`)
  }
})

test('daftar lawan urut menaik mengikuti tangga Elo', () => {
  const order = OPPONENT_LIST.map((entry) => entry.elo)
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.deepEqual(order, [...ELO_LEVELS])
})

test('id, nama, dan berkas tiap lawan unik', () => {
  for (const field of ['id', 'name', 'portrait', 'face', 'halo'] as const) {
    const values = OPPONENT_LIST.map((entry) => entry[field])
    assert.equal(new Set(values).size, values.length, `nilai "${field}" ada yang kembar`)
  }
})

test('nama berkas mengikuti pola <id>-<jenis>', () => {
  /*
   * Berkas artwork ditaruh manual ke `client/public/`, dan penamaannya sempat
   * campur — dua memakai garis bawah (`mari_face.webp`), sisanya tanda hubung.
   * Selama tidak ada kode yang menyebutnya, itu tak terasa; begitu disebut,
   * satu yang meleset berarti gambarnya diam-diam tidak muncul.
   */
  for (const opponent of OPPONENT_LIST) {
    assert.equal(opponent.portrait, `${opponent.id}-full.webp`)
    assert.equal(opponent.face, `${opponent.id}-face.webp`)
    assert.equal(opponent.halo, `halo-${opponent.id}.png`)
  }
})

test('tiap tingkat punya keterangan di kedua kamus', () => {
  for (const elo of ELO_LEVELS) {
    assert.ok(id[`level.${elo}`], `kunci level.${elo} tidak ada di kamus`)
  }
})

test('aksen tiap lawan jelas berbeda satu sama lain', () => {
  /*
   * Pemilih lawan menampilkan kelimanya berdampingan, masing-masing dengan
   * warnanya sendiri; dua yang mirip membuat daftar itu kehilangan gunanya.
   *
   * Diukur dengan jarak Lab, BUKAN selisih rona. Aksen Yuuka dan Himari cuma
   * berjarak 3 derajat rona, tapi yang satu violet pekat dan yang lain perak
   * nyaris kelabu — mustahil tertukar. Ukuran rona akan menandai keduanya
   * sebagai bermasalah, padahal tidak.
   */
  const accents = OPPONENT_LIST.map((entry) => [entry.name, entry.theme.accent] as const)

  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      const distance = deltaE(accents[i][1], accents[j][1])
      assert.ok(
        distance >= 25,
        `${accents[i][0]} dan ${accents[j][0]} terlalu mirip (ΔE ${distance.toFixed(1)})`
      )
    }
  }
})

test('bidak hitam tetap terbaca di petak gelap, di semua tema', () => {
  // Patokannya papan hijau standar, seperti dicatat di main.css.
  const pieceDark = cssColor('piece-dark')
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.squareDark, pieceDark)
    assert.ok(
      ratio >= 4.3,
      `${opponent.name}: petak gelap ${opponent.theme.squareDark} vs bidak hitam ` +
        `hanya ${ratio.toFixed(2)}:1, di bawah patokan 4,3:1`
    )
  }
})

test('bidak putih tetap terbaca di petak terang, di semua tema', () => {
  // Bidak putih punya garis tepi gelap yang menanggung sebagian besar bebannya,
  // jadi ambangnya lebih longgar — tapi tetap harus ada.
  const pieceLightStroke = cssColor('piece-light-stroke')
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.squareLight, pieceLightStroke)
    assert.ok(
      ratio >= 4.5,
      `${opponent.name}: garis bidak putih di petak terang hanya ${ratio.toFixed(2)}:1`
    )
  }
})

test('dua warna petak selalu bisa dibedakan', () => {
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.squareLight, opponent.theme.squareDark)
    assert.ok(
      ratio >= 1.8,
      `${opponent.name}: petak terang dan gelap terlalu mirip (${ratio.toFixed(2)}:1)`
    )
  }
})

test('teks di atas bidang beraksen terbaca, di semua tema', () => {
  // Tombol utama memakai pasangan ini; ambang teks normal WCAG AA adalah 4,5:1.
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.accent, opponent.theme.onAccent)
    assert.ok(
      ratio >= 4.5,
      `${opponent.name}: teks ${opponent.theme.onAccent} di atas aksen ` +
        `${opponent.theme.accent} hanya ${ratio.toFixed(2)}:1`
    )
  }
})

test('aksen menonjol di atas permukaan panel yang gelap', () => {
  // Aksen dipakai sebagai garis tepi dan teks kecil di atas --surface.
  const surface = cssColor('surface')
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.accent, surface)
    assert.ok(
      ratio >= 3,
      `${opponent.name}: aksen ${opponent.theme.accent} di atas panel hanya ${ratio.toFixed(2)}:1`
    )
  }
})

test('pendar halaman tetap gelap, agar teks di atasnya tidak tenggelam', () => {
  // --text hanyalah alias var(--mari-ivory); yang punya nilai heksa itu asalnya.
  const text = cssColor('mari-ivory')
  for (const opponent of OPPONENT_LIST) {
    const ratio = contrast(opponent.theme.glow, text)
    assert.ok(
      ratio >= 7,
      `${opponent.name}: pendar ${opponent.theme.glow} terlalu terang (${ratio.toFixed(2)}:1)`
    )
  }
})

test('tema Mari sama persis dengan nilai bawaan di main.css', () => {
  // Halaman harus sudah benar sebelum JavaScript sempat memasang tema apa pun;
  // kalau keduanya melenceng, pemuatan pertama akan berkedip ganti warna.
  const defaults: Record<string, string> = {
    '--accent': cssColor('mari-gold'),
    '--accent-hover': cssColor('mari-gold-bright'),
    '--on-accent': cssColor('on-accent'),
    '--orange': cssColor('mari-orange'),
    '--square-light': cssColor('square-light'),
    '--square-dark': cssColor('square-dark'),
    '--glow': cssColor('glow')
  }

  const applied = themeVariables(HOST.theme)
  for (const [name, expected] of Object.entries(defaults)) {
    assert.equal(applied[name], expected, `${name} berbeda antara main.css dan tema Mari`)
  }
})
