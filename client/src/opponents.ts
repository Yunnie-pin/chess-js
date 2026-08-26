/**
 * Daftar lawan komputer: satu karakter untuk tiap tingkat Elo.
 *
 * Berkas ini murni presentasi dan hanya milik klien. Kekuatan sesungguhnya
 * datang dari Stockfish, lewat `UCI_Elo` yang dipetakan langsung dari `elo` di
 * bawah (lihat `scheduleAi` di `useChessGame.ts`) — bukan tidak tahu-menahu
 * soal karakter, tapi juga tidak tahu-menahu soal cara Stockfish memutuskan
 * langkahnya. Mengganti nama atau warna di sini tidak mengubah cara mesin
 * bermain sedikit pun; mengganti `elo` di bawah pun cuma boleh nilai yang
 * memang didukung Stockfish sendiri (lihat `ELO_LEVELS` di shared/src/ai.ts).
 *
 * Nama karakter adalah nama diri: tidak pernah diterjemahkan, jadi tidak masuk
 * kamus i18n. Yang diterjemahkan hanya keterangan tingkatnya ('Pemula',
 * 'Beginner', …) lewat kunci `level.1320` dan seterusnya.
 */

import { ELO_LEVELS } from '@chess/shared/ai'
import type { EloRating } from '@chess/shared/ai'

export type OpponentId = 'mari' | 'toki' | 'kisaki' | 'yuuka' | 'himari'

/**
 * Warna yang ikut berganti bersama lawan.
 *
 * Hanya aksen, papan, dan sorotan yang ada di sini. Permukaan gelap aplikasi
 * (--bg, --panel, --surface, --border) sengaja TIDAK ikut berganti: itu "rumah"
 * yang menaungi semua karakter, dan menukarnya tiap kali lawan diganti membuat
 * seluruh halaman berkedip tanpa memberi informasi apa pun.
 *
 * PENTING: `squareDark` harus tetap cukup terang agar bidak hitam terbaca di
 * atasnya. Papan hijau standar memberi rasio sekitar 4,3:1; itu patokan yang
 * dijaga `client/test/opponents.test.ts` untuk SETIAP tema di sini.
 */
export interface OpponentTheme {
  /** Aksen utama: tombol, sorotan terpilih, garis fokus. */
  accent: string
  accentHover: string
  /** Teks di atas bidang beraksen — gelap atau terang, tergantung aksennya. */
  onAccent: string
  /** Ujung kedua gradasi judul, dan nada pendukung di sana-sini. */
  secondary: string
  squareLight: string
  squareDark: string
  /** Pendar di puncak halaman, seperti cahaya dari halo-nya. */
  glow: string
}

export interface Opponent {
  id: OpponentId
  elo: EloRating
  /** Nama diri; tidak diterjemahkan. */
  name: string
  /**
   * Berkas potret opsional di `client/public/`. Bila belum ada, potret latar
   * tidak muncul sama sekali — bukan ikon gambar rusak.
   */
  portrait: string
  /**
   * Potongan wajah, dipakai sebagai latar di kartu pemilih lawan. Opsional
   * dengan cara yang sama: tanpa berkasnya kartu tetap utuh, hanya polos.
   */
  face: string
  /**
   * Berkas halo opsional di `client/public/`. Bila ada, ia menimpa gambar SVG
   * bawaan; bila tidak, SVG-nya yang dipakai. Jadi aplikasi selalu punya halo.
   */
  halo: string
  theme: OpponentTheme
}

/**
 * Palet tiap karakter diambil dari potret di `client/public/`, bukan dari
 * ingatan — versi pertama berkas ini menebak, dan tebakannya meleset jauh:
 * Kisaki sempat dibuat merah crimson padahal desainnya biru tua dengan
 * kupu-kupu jade, dan Yuuka sempat merah muda padahal rambutnya violet.
 *
 * Aturan mainnya: ambil warna yang paling menandai karakter itu (halo, rambut,
 * aksesori yang mencolok), lalu geser seperlunya sampai lolos ambang kontras di
 * `client/test/opponents.test.ts`. Kalau artwork-nya diganti, palet ini yang
 * harus menyusul, bukan sebaliknya.
 */
export const OPPONENTS: Record<EloRating, Opponent> = {
  1320: {
    id: 'mari',
    elo: 1320,
    name: 'Iochi Mari',
    portrait: 'mari-full.webp',
    face: 'mari-face.webp',
    halo: 'halo-mari.png',
    // Palet asal aplikasi: jubah gading, trim emas, rambut oranye.
    theme: {
      accent: '#ddb65c',
      accentHover: '#efcb77',
      onAccent: '#241c0d',
      secondary: '#e8853f',
      squareLight: '#f2e9d7',
      squareDark: '#9d8557',
      glow: '#2e2413'
    }
  },
  1800: {
    id: 'toki',
    elo: 1800,
    name: 'Asuma Toki',
    portrait: 'toki-full.webp',
    face: 'toki-face.webp',
    halo: 'halo-toki.png',
    // Sian terang dari halo dan pita lehernya; nada kedua dari rambut pirang pucat.
    theme: {
      accent: '#63c9e0',
      accentHover: '#82d8ea',
      onAccent: '#07222b',
      secondary: '#e8d9a8',
      squareLight: '#e2eef2',
      squareDark: '#7ba4b0',
      glow: '#122328'
    }
  },
  2200: {
    id: 'kisaki',
    elo: 2200,
    name: 'Ryuuge Kisaki',
    portrait: 'kisaki-full.webp',
    face: 'kisaki-face.webp',
    halo: 'halo-kisaki.png',
    /*
     * Jade dari kupu-kupu di rambutnya — satu-satunya warna cerah pada desain
     * yang selebihnya biru tua. Nada kedua diambil dari matanya yang kelabu
     * kebiruan, dan pendarnya sengaja paling gelap di antara semua tema.
     */
    theme: {
      accent: '#3fc09b',
      accentHover: '#5fd0af',
      onAccent: '#06231c',
      secondary: '#8fa8c8',
      squareLight: '#e3ebe7',
      squareDark: '#7d9c92',
      glow: '#101f23'
    }
  },
  2600: {
    id: 'yuuka',
    elo: 2600,
    name: 'Hayase Yuuka',
    portrait: 'yuuka-full.webp',
    face: 'yuuka-face.webp',
    halo: 'halo-yuuka.png',
    // Violet pekat dari rambutnya, dengan biru dasi seragamnya sebagai nada kedua.
    theme: {
      accent: '#9585e8',
      accentHover: '#ada0ef',
      onAccent: '#150e2e',
      secondary: '#5fa8d8',
      squareLight: '#e8e4f2',
      squareDark: '#8b83b0',
      glow: '#1b1733'
    }
  },
  3190: {
    id: 'himari',
    elo: 3190,
    name: 'Akeboshi Himari',
    portrait: 'himari-full.webp',
    face: 'himari-face.webp',
    halo: 'halo-himari.png',
    /*
     * Perak platinum dari rambutnya, nyaris tanpa rona. Rona aksennya memang
     * berdekatan dengan Yuuka (beda 3 derajat), tapi keduanya tidak pernah
     * tertukar karena kejenuhannya jauh berbeda — 7% lawan 43%. Itu sebabnya
     * tes memakai jarak Lab, bukan selisih rona: rona saja menyesatkan di sini.
     */
    theme: {
      accent: '#c9c6d4',
      accentHover: '#dedbe6',
      onAccent: '#1d1b24',
      secondary: '#c0aed8',
      squareLight: '#eeecf0',
      squareDark: '#9a97a4',
      glow: '#1c1b22'
    }
  }
}

/** Lawan bawaan sekaligus tuan rumah aplikasi saat tidak melawan komputer. */
export const HOST_ELO: EloRating = 1320
export const HOST: Opponent = OPPONENTS[HOST_ELO]

/** Urut menaik, mengikuti tangga Elo di shared — bukan urutan tulis objek di atas. */
export const OPPONENT_LIST: Opponent[] = ELO_LEVELS.map((elo) => OPPONENTS[elo])

export const opponentFor = (elo: EloRating): Opponent => OPPONENTS[elo] ?? HOST

/**
 * Alamat berkas di `public/`, menghormati `base` yang dipakai saat build.
 *
 * `import.meta.env` hanya ada setelah melewati Vite; di Node (saat tes berkas
 * ini diimpor) nilainya tidak ada, jadi diambil jalur akar sebagai cadangan.
 */
export const publicUrl = (file: string): string =>
  `${import.meta.env?.BASE_URL ?? '/'}${file}`
