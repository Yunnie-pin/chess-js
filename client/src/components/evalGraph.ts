/**
 * Geometri grafik evaluasi partai, murni — dipisah dari `EvalGraph.vue`
 * supaya bisa diuji tanpa DOM, sama seperti `arrowGeometry.ts`.
 *
 * Satuan viewBox `GRAPH_WIDTH × GRAPH_HEIGHT`. Sumbu x = indeks posisi (0 =
 * posisi awal, i = sesudah i ply), sumbu y = bagian Putih dari `whiteShare` —
 * kurva yang sama dengan bilah evaluasi, jadi grafik dan bilah tidak pernah
 * berselisih soal "seberapa unggul". Putih di BAWAH (area terang dari dasar
 * naik ke garis), meniru bilah evaluasi saat papan tidak diputar.
 */

export const GRAPH_WIDTH = 300
export const GRAPH_HEIGHT = 90

export interface GraphPoint {
  /** Indeks posisi. */
  index: number
  x: number
  y: number
}

/** x untuk indeks posisi ke-`index` dari `count` posisi. Satu posisi saja → di tengah. */
export function xAt(index: number, count: number): number {
  return count <= 1 ? GRAPH_WIDTH / 2 : (index / (count - 1)) * GRAPH_WIDTH
}

/** y untuk bagian Putih 0..1: 1 = puncak atas (Putih menang penuh), 0 = dasar. */
export function yAt(share: number): number {
  return (1 - share) * GRAPH_HEIGHT
}

/**
 * Titik-titik grafik, dipecah jadi ruas-ruas bersambung. Posisi yang belum
 * dinilai (`null`, mis. selagi ulasan masih jalan) memutus garis alih-alih
 * ditarik lurus melewatinya — garis lurus akan mengarang evaluasi yang tidak
 * pernah dihitung.
 */
export function graphSegments(shares: readonly (number | null)[]): GraphPoint[][] {
  const segments: GraphPoint[][] = []
  let current: GraphPoint[] = []
  shares.forEach((share, index) => {
    if (share === null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push({ index, x: xAt(index, shares.length), y: yAt(share) })
  })
  if (current.length) segments.push(current)
  return segments
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100)

/** Garis satu ruas sebagai `d` untuk `<path>`. */
export function linePath(segment: readonly GraphPoint[]): string {
  return segment.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ')
}

/**
 * Area satu ruas, tertutup: milik Putih dari garis turun ke dasar, milik Hitam
 * dari garis naik ke puncak. Keduanya per ruas — bukan Hitam sebagai latar
 * penuh — supaya bagian yang belum dinilai tetap netral, tidak terbaca
 * seolah Hitam unggul.
 */
export function areaPath(segment: readonly GraphPoint[], side: 'w' | 'b' = 'w'): string {
  if (!segment.length) return ''
  const first = segment[0]
  const last = segment[segment.length - 1]
  const edge = side === 'w' ? GRAPH_HEIGHT : 0
  return `${linePath(segment)} L${fmt(last.x)} ${edge} L${fmt(first.x)} ${edge} Z`
}

/**
 * Indeks posisi terdekat dari x (satuan viewBox) — crosshair "menempel" ke
 * posisi terdekat, pembaca tidak perlu membidik garis setebal 2px.
 */
export function indexAtX(x: number, count: number): number {
  if (count <= 1) return 0
  const raw = Math.round((x / GRAPH_WIDTH) * (count - 1))
  return Math.min(count - 1, Math.max(0, raw))
}
