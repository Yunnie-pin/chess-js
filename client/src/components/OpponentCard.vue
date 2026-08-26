<script setup lang="ts">
/**
 * Satu kartu lawan di dalam pemilih.
 *
 * Dipisah dari `OpponentPicker` karena tiap kartu memeriksa gambar wajahnya
 * sendiri, dan `useOptionalImage` adalah composable — tidak bisa dipanggil
 * berulang di dalam `v-for` milik induknya.
 *
 * Radio-nya tetap radio sungguhan: `:checked` dan `@change`, bukan `v-model`,
 * supaya induk tetap memegang satu sumber kebenaran sementara browser tetap
 * yang mengurus perpindahan lewat tombol panah.
 */
import { computed } from 'vue'

import { useOptionalImage } from '../composables/useOptionalImage.ts'
import { useI18n } from '../i18n/index.ts'
import { publicUrl, type Opponent } from '../opponents.ts'
import { themeVariables } from '../theme.ts'
import OpponentHalo from './OpponentHalo.vue'

const props = defineProps<{
  opponent: Opponent
  selected: boolean
  /** Nama grup radio; semua kartu dalam satu pemilih memakai nama yang sama. */
  group: string
}>()

const emit = defineEmits<{ select: [] }>()

const { t } = useI18n()

const faceSource = computed(() => publicUrl(props.opponent.face))
const { ready: hasFace } = useOptionalImage(faceSource)
</script>

<template>
  <!-- Palet kartu adalah palet karakternya sendiri, bukan yang sedang aktif —
       daftar ini justru gunanya untuk membandingkan kelimanya berdampingan. -->
  <label class="card" :class="{ 'card--on': selected }" :style="themeVariables(opponent.theme)">
    <input
      class="card__input"
      type="radio"
      :name="group"
      :checked="selected"
      @change="emit('select')"
    />

    <img v-if="hasFace" class="card__face" :src="faceSource" alt="" aria-hidden="true" />

    <OpponentHalo class="card__mark" :opponent="opponent" />
    <span class="card__body">
      <span class="card__name">{{ opponent.name }}</span>
      <span class="card__meta">{{ opponent.elo }} · {{ t(`level.${opponent.elo}`) }}</span>
    </span>
  </label>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  /*
   * Lapang di kanan supaya nama terpanjang pun berhenti — dengan elipsis —
   * sebelum sampai ke bagian wajah yang sudah pekat. Elemen wajahnya sendiri
   * tidak ikut terdorong: ia diposisikan absolut terhadap kotak padding, jadi
   * `right: 0` tetap menempel ke tepi kartu.
   */
  padding: 0.4rem 3.5rem 0.4rem 0.55rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
  /* `padding` dan `box-shadow` ikut ditransisikan karena keduanya yang
     menumbuhkan kartu terpilih — lihat `.card--on`. */
  transition: background 0.18s, border-color 0.18s, padding 0.22s ease-out,
    box-shadow 0.22s ease-out;
  --halo-size: 2.1rem;
}

/* Hover dikurung supaya tidak menempel setelah diketuk; lihat catatannya di App.vue. */
@media (hover: hover) {
  .card:hover {
    background: var(--surface-hover);
  }
}

/*
 * Yang terpilih tidak sekadar berganti warna — ia tumbuh.
 *
 * Tingginya dinaikkan lewat PADDING, bukan `height`. Kartu ini setinggi isinya
 * (`height: auto`), dan nilai `auto` tidak bisa ditransisikan: memberinya
 * tinggi eksplisit hanya akan membuatnya melompat ke ukuran baru, sekaligus
 * mematok angka yang harus disetel ulang tiap kali isinya berubah. Padding
 * bisa dianimasikan dan hasil akhirnya persis sama.
 *
 * Halonya ikut membesar supaya kartu tumbuh sebagai satu kesatuan, bukan
 * sekadar melar di ruang kosongnya. Ukuran halo diteruskan lewat `--halo-size`
 * dan ditransisikan di sisi OpponentHalo.
 */
.card--on {
  border-color: var(--accent);
  background: var(--accent-soft);
  padding-top: 0.85rem;
  padding-bottom: 0.85rem;
  --halo-size: 2.6rem;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
  animation: card-select 0.42s ease-out;
}

/*
 * Denyut tipis sekali jalan saat kartu terpilih.
 *
 * Cincinnya `box-shadow` yang melebar lalu menghilang. `overflow: hidden` di
 * kartu tidak memotongnya — itu mengurung ANAK elemen, bukan bayangan milik
 * elemen itu sendiri. Bayangan tetap milik `.card--on` di atas, jadi
 * animasinya menulis ulang kedua lapisannya sekaligus supaya yang permanen
 * tidak hilang selama denyutnya berjalan.
 */
@keyframes card-select {
  from {
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35), 0 0 0 0 var(--accent);
  }
  to {
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35), 0 0 0 0.6rem transparent;
  }
}

/*
 * Wajah menempel di tepi kanan dan meluruh ke kiri.
 *
 * Peluruhannya pakai `mask-image`, bukan sekadar opacity rendah: opacity saja
 * menyisakan tepi kiri gambar sebagai garis tegak yang terlihat jelas di atas
 * permukaan kartu. Dengan mask, gambarnya benar-benar habis sebelum sampai ke
 * teks — jadi nama dan angka Elo tidak pernah duduk di atas potongan gambar.
 */
.card__face {
  position: absolute;
  right: 0;
  top: 50%;
  /*
   * Di belakang teks tapi tetap di atas latar kartu: latar elemen digambar
   * lebih dulu, baru anak ber-z-index negatif, baru isinya. `isolation` pada
   * kartu mengurung lapisan ini agar tidak merembes ke panel di belakangnya.
   */
  z-index: -1;
  /*
   * LEBAR mengatur seberapa banyak wajah yang terlihat sekaligus.
   *
   * Gambarnya 252x204, kartunya sekitar 285x48 — jauh lebih pipih. Gambar
   * diperbesar sampai selebar elemen ini, lalu kartu memotong atas-bawahnya.
   * Makin lebar, makin besar perbesarannya, makin sempit irisan yang muat:
   *
   * (Angka 48 itu kartu yang TIDAK terpilih. Yang terpilih lebih tinggi, jadi
   * irisan wajah yang tampil di sana memang lebih banyak — disengaja. Yang
   * berubah hanya tingginya; seluruh hitungan mendatar di bawah, termasuk
   * mask-nya, tidak tersentuh.)
   *
   *   lebar 58% -> tinggi 134px -> 36% gambar terlihat -> sisa geser 85px
   *   lebar 36% -> tinggi  83px -> 58% terlihat        -> sisa geser 35px
   *   lebar 30% -> tinggi  69px -> 70% terlihat        -> sisa geser 21px
   *
   * Perhatikan kolom terakhir: cakupan dan ruang geser berbanding TERBALIK.
   * Menyempitkan elemen membuat wajah utuh sekaligus menghabiskan ruang untuk
   * menggesernya. Setel lebar dulu sampai wajahnya pas, baru sentuh geserannya.
   */
  width: 58%;
  /*
   * Tinggi mengikuti bentuk asli gambar, lalu kartu yang memotong — bukan
   * `object-fit: cover` dengan `object-position`.
   *
   * Alasannya satuan. Pada `object-position`, "38%" bukan 38% tinggi gambar
   * melainkan 38% dari sisa geser yang tidak kelihatan di mana pun; di lebar
   * 36% sisa itu cuma 35px, jadi mengubahnya sepuluh poin memindahkan gambar
   * 3px dan terasa seperti tidak berfungsi. Di sini satuannya piksel sungguhan
   * dan bergerak satu banding satu.
   *
   * 0 berarti wajah terpusat di kartu. Positif menggeser gambar ke BAWAH
   * (yang tampil bagian atas: dahi, halo); negatif ke atas (dagu, bahu).
   * Batasnya setengah dari sisa geser di tabel atas — lewat itu muncul ruang
   * kosong di tepi.
   */
  height: auto;
  --face-shift: 0px;
  transform: translateY(calc(-50% + var(--face-shift)));
  opacity: 0.5;
  /*
   * Titik "pekat penuh" harus jatuh di KANAN batas teks, bukan sembarangan.
   *
   * Kartunya ~285px, elemen wajah 58% (165px) menempel di kanan, jadi ia mulai
   * di x=120. Mask pekat penuh di 70% berarti x=235. Teks berhenti di
   * 285 − 3,5rem = 229px — tersisa 6px jarak aman.
   *
   * Sebelumnya mask 58% (pekat di x=216) dengan padding kanan 2,75rem (teks
   * sampai x=241): teks menimpa wajah pekat sejauh 25px. Tidak kentara selama
   * opacity-nya 0,32, langsung terlihat begitu dinaikkan. Kalau salah satu dari
   * ketiga angka ini diubah, hitung ulang ketiganya.
   */
  mask-image: linear-gradient(to right, transparent 0%, #000 70%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 70%);
  pointer-events: none;
  user-select: none;
  transition: opacity 0.18s, transform 0.18s;
}

@media (hover: hover) {
  .card:hover .card__face {
    opacity: 0.65;
  }
}

/* Yang terpilih tampil paling jelas — itu satu-satunya yang sedang kamu lawan. */
.card--on .card__face {
  opacity: 0.8;
  /* Geserannya ikut ditulis ulang: `transform` satu properti, bukan bertumpuk. */
  transform: translateY(calc(-50% + var(--face-shift))) scale(1.04);
}

.card__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.card:has(.card__input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.card__name {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__meta {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.card--on .card__meta {
  color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .card__face {
    transition: none;
  }

  /*
   * Kartu terpilih tetap lebih tinggi — itu informasi, bukan hiasan; yang
   * dibuang hanya perjalanan ke sananya, plus denyut yang murni dekoratif.
   */
  .card--on {
    animation: none;
  }

  /*
   * Yang dibuang hanya pembesarannya, BUKAN seluruh transform: geseran
   * vertikal ikut menumpang di properti yang sama, dan `transform: none`
   * akan menjatuhkan wajahnya setengah keluar dari kartu.
   */
  .card--on .card__face {
    transform: translateY(calc(-50% + var(--face-shift)));
  }
}
</style>
