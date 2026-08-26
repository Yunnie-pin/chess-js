<script setup lang="ts">
/**
 * Potret lawan yang sedang aktif sebagai latar, hanya di layar lebar.
 *
 * Gambar diambil saat runtime dari folder `public/`, BUKAN lewat import Vite.
 * Sengaja begitu: `import` statis akan menggagalkan seluruh build kalau
 * berkasnya belum ada, sedangkan di sini "belum ada" adalah keadaan yang wajar —
 * hanya `mari.png` yang ikut repo, sisanya kamu taruh sendiri. Dengan cara ini
 * aplikasi tetap utuh tanpa gambar, dan langsung memakainya begitu berkas
 * diletakkan, tanpa mengubah kode.
 *
 * Ambang lebarnya hidup DI SINI sebagai media query JS, bukan sebagai `@media`
 * di blok style. Dulu memang di CSS, dan itu menyembunyikan potret dengan
 * `display: none` — padahal `display: none` tidak membatalkan unduhan.
 * Pemeriksaan berkas di `useOptionalImage` tetap berjalan, jadi setiap ponsel
 * ikut menarik potret penuh (yang terbesar 1,3 MB) demi elemen yang mustahil
 * terlihat di lebar itu. Satu ambang di satu tempat menutup celah itu
 * sekaligus: tidak cocok berarti tidak dirender DAN tidak diunduh.
 */
import { computed } from 'vue'

import { useMediaQuery } from '../composables/useMediaQuery.ts'
import { useOptionalImage } from '../composables/useOptionalImage.ts'
import { publicUrl, type Opponent } from '../opponents.ts'

const props = defineProps<{ opponent: Opponent }>()

/*
 * Muncul hanya bila ada ruang kosong yang cukup di kanan konten. Isi aplikasi
 * lebarnya maksimal 68rem dan terpusat, jadi sisa ruang tiap sisi adalah
 * (100vw - 68rem) / 2; ambang 92rem memberi sisa minimal 12rem.
 */
const wide = useMediaQuery('(min-width: 92rem)')

const source = computed(() => publicUrl(props.opponent.portrait))
const { ready } = useOptionalImage(source, wide)
</script>

<template>
  <!-- `ready` sudah mengandung syarat lebar layar (probe-nya digerbang oleh
       `wide`), jadi tidak perlu diuji dua kali di sini. Belum ada gambarnya?
       Cukup menghilang — tanpa ikon gambar rusak. -->
  <div v-if="ready" class="portrait" aria-hidden="true">
    <!-- `key` memaksa elemen baru saat lawan berganti, supaya animasinya terulang. -->
    <img :key="source" class="portrait__img" :src="source" alt="" />
  </div>
</template>

<style scoped>
.portrait {
  /* --- Dua angka yang mengatur potongannya --- */
  /* Lebar dikunci ke ruang kosong di kanan konten, jadi potret tidak pernah
     menimpa papan. Ambangnya sendiri ada di skrip, bukan di sini. */
  --portrait-width: min(calc((100vw - 68rem) / 2), 28rem);
  /* Tinggi jendela tampil. Naikkan untuk memperlihatkan lebih banyak badan,
     turunkan untuk memotong lebih tinggi. Sekitar setengah badan pada potret
     berdiri biasa. */
  --portrait-height: min(74vh, 42rem);

  position: fixed;
  right: 0;
  bottom: 0;
  width: var(--portrait-width);
  height: var(--portrait-height);
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  z-index: 0;
}

.portrait__img {
  width: 100%;
  height: 100%;
  /* Dijangkar di atas: kepala selalu utuh, bagian bawah yang terpotong. */
  object-fit: cover;
  object-position: 50% 0%;
  opacity: 0.5;
  /* Meluruh di ujung bawah supaya potongannya tidak terlihat sebagai garis. */
  mask-image: linear-gradient(to bottom, #000 72%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 72%, transparent 100%);
  animation: portrait-in 0.45s ease-out;
}

/* Berganti lawan berarti berganti potret; muncul mengambang, bukan menyentak. */
@keyframes portrait-in {
  from {
    opacity: 0;
    transform: translateX(1.5rem);
  }
  to {
    opacity: 0.5;
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .portrait {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .portrait__img {
    animation: none;
  }
}
</style>
