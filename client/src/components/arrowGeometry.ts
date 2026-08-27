/**
 * Geometri anotasi papan (panah + cincin klik-kanan), murni — dipisah dari
 * `ChessBoard.vue` supaya bisa diuji tanpa DOM, sama seperti `evalScale.ts`.
 *
 * Semua koordinat dalam satuan viewBox `0..100`: satu petak = 12.5, jadi angka
 * di sini langsung dipakai sebagai `points`/`cx`/`r` pada satu `<svg
 * viewBox="0 0 100 100">`. Orientasi papan dicerminkan persis seperti dulu
 * (`squareRowCol`).
 *
 * Tiap panah digambar sebagai SATU siluet tertutup (batang + kepala jadi satu
 * `<polygon>`), bukan garis + marker — tidak ada ujung bulat yang nyembul di
 * balik kepala, dan tidak ada marker yang ikut ter-skala aneh.
 */

import { fileOf, rankOf } from '@chess/shared/chess'
import type { Color, Square } from '@chess/shared/types'

export interface Point {
  x: number
  y: number
}

export interface Arrow {
  from: Square
  to: Square
}

/** Satu tempat untuk tiap angka yang bisa disetel (satuan viewBox, 1 petak = 12.5). */
export const ARROW_METRICS = {
  /** Lebar batang panah. */
  shaftWidth: 2.6,
  /** Lebar pangkal kepala panah — jelas lebih lebar dari batang. */
  headWidth: 5.4,
  /** Panjang kepala panah, diukur mundur dari ujung. */
  headLength: 4.4,
  /** Geser pangkal panah keluar dari titik tengah petak asal, biar tidak persis di bawah bidak. */
  tailGap: 1.5,
  /** Ujung panah berhenti sedikit sebelum titik tengah petak tujuan. */
  tipGap: 1.0,
  /** Jari-jari cincin tanda petak (setengah petak = 6.25, jadi ini masih menyisakan tepi). */
  markRadius: 5,
  /** Tebal garis cincin tanda petak. */
  markStroke: 0.9
} as const

const SQUARE = 12.5

/** Baris/kolom layar sebuah petak (0..7), mengikuti orientasi papan. */
function squareRowCol(square: Square, orientation: Color): { row: number; col: number } {
  const rank = rankOf(square)
  const file = fileOf(square)
  return orientation === 'w'
    ? { row: rank, col: file }
    : { row: 7 - rank, col: 7 - file }
}

/** Titik tengah sebuah petak dalam satuan viewBox. */
export function squareCenter(square: Square, orientation: Color): Point {
  const { row, col } = squareRowCol(square, orientation)
  return { x: (col + 0.5) * SQUARE, y: (row + 0.5) * SQUARE }
}

/** Perpindahan berpola kuda (1,2) murni dari geometrinya — panahnya jadi siku, bukan lurus. */
export function isKnightShape(from: Square, to: Square): boolean {
  const dr = Math.abs(rankOf(to) - rankOf(from))
  const df = Math.abs(fileOf(to) - fileOf(from))
  return (dr === 1 && df === 2) || (dr === 2 && df === 1)
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
/** Vektor satuan; titik yang berimpit dianggap mengarah ke kanan (tidak akan terjadi dari jalur gambar). */
function unit(v: Point): Point {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}
/** Putar 90° — dipakai untuk sisi kiri/kanan pita batang. */
const perp = (v: Point): Point => ({ x: -v.y, y: v.x })

const round = (n: number): number => Math.round(n * 100) / 100
const roundPoint = (p: Point): Point => ({ x: round(p.x), y: round(p.y) })

/**
 * Titik-titik siluet panah tertutup, urut menyusuri tepinya — cocok langsung
 * untuk `<polygon points>`.
 *
 * - Langkah biasa → 7 titik: pangkal kiri/kanan, leher kiri/kanan, sayap kepala
 *   kiri/kanan, ujung.
 * - Lompatan kuda → 9 titik: menempuh sumbu 2-petak dulu lalu menyiku, dengan
 *   satu sudut miter 90° di tiap sisi pita.
 */
export function arrowOutline(arrow: Arrow, orientation: Color): Point[] {
  const hw = ARROW_METRICS.shaftWidth / 2
  const hh = ARROW_METRICS.headWidth / 2
  const origin = squareCenter(arrow.from, orientation)
  const target = squareCenter(arrow.to, orientation)

  if (isKnightShape(arrow.from, arrow.to)) {
    const bend = knightBend(arrow.from, arrow.to, orientation)
    const d1 = unit(sub(bend, origin))
    const d2 = unit(sub(target, bend))
    const p1 = perp(d1)
    const p2 = perp(d2)

    const tail = add(origin, scale(d1, ARROW_METRICS.tailGap))
    const tip = sub(target, scale(d2, ARROW_METRICS.tipGap))
    const neck = sub(tip, scale(d2, ARROW_METRICS.headLength))

    // Sudut miter di tekukan: B + s·hw·(p1+p2)/(1 + p1·p2). Belokan kuda selalu
    // tepat 90° (p1·p2 = 0), jadi ini terbatas (~1,41·hw) — penjaga di bawah
    // cuma untuk pemanggil lain yang mustahil dari jalur gambar.
    const denom = 1 + dot(p1, p2)
    const miter = Math.abs(denom) < 1e-6 ? p1 : scale(add(p1, p2), 1 / denom)

    return [
      add(tail, scale(p1, hw)),
      add(bend, scale(miter, hw)),
      add(neck, scale(p2, hw)),
      add(neck, scale(p2, hh)),
      tip,
      add(neck, scale(p2, -hh)),
      add(neck, scale(p2, -hw)),
      add(bend, scale(miter, -hw)),
      add(tail, scale(p1, -hw))
    ].map(roundPoint)
  }

  const d = unit(sub(target, origin))
  const p = perp(d)
  const tail = add(origin, scale(d, ARROW_METRICS.tailGap))
  const tip = sub(target, scale(d, ARROW_METRICS.tipGap))
  const neck = sub(tip, scale(d, ARROW_METRICS.headLength))

  return [
    add(tail, scale(p, hw)),
    add(neck, scale(p, hw)),
    add(neck, scale(p, hh)),
    tip,
    add(neck, scale(p, -hh)),
    add(neck, scale(p, -hw)),
    add(tail, scale(p, -hw))
  ].map(roundPoint)
}

/**
 * Titik tekuk panah kuda: tempuh penuh dulu sumbu yang bergerak 2 petak, baru
 * menyamping — persis lintasan kuda melompat, bukan garis lurus yang gampang
 * terbaca sebagai langkah gajah.
 */
function knightBend(from: Square, to: Square, orientation: Color): Point {
  const a = squareRowCol(from, orientation)
  const b = squareRowCol(to, orientation)
  const bendRow = Math.abs(b.row - a.row) === 2 ? b.row : a.row
  const bendCol = Math.abs(b.col - a.col) === 2 ? b.col : a.col
  return { x: (bendCol + 0.5) * SQUARE, y: (bendRow + 0.5) * SQUARE }
}

/** Cincin tanda petak. */
export function markRing(
  square: Square,
  orientation: Color
): { cx: number; cy: number; r: number } {
  const center = squareCenter(square, orientation)
  return { cx: round(center.x), cy: round(center.y), r: ARROW_METRICS.markRadius }
}
