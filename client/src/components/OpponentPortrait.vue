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
 */
import { computed } from 'vue'

import { useOptionalImage } from '../composables/useOptionalImage.ts'
import { publicUrl, type Opponent } from '../opponents.ts'

const props = defineProps<{ opponent: Opponent }>()

const source = computed(() => publicUrl(props.opponent.portrait))
const { ready } = useOptionalImage(source)
</script>

<template>
  <!-- Belum ada gambarnya? Cukup menghilang — tanpa ikon gambar rusak. -->
  <div v-if="ready" class="portrait" aria-hidden="true">
    <!-- `key` memaksa elemen baru saat lawan berganti, supaya animasinya terulang. -->
    <img :key="source" class="portrait__img" :src="source" alt="" />
  </div>
</template>

<style scoped>
.portrait {
  display: none;
}

/*
 * Muncul hanya bila ada ruang kosong yang cukup di kanan konten. Isi aplikasi
 * lebarnya maksimal 68rem dan terpusat, jadi sisa ruang tiap sisi adalah
 * (100vw - 68rem) / 2; ambang 92rem memberi sisa minimal 12rem.
 */
@media (min-width: 92rem) {
  .portrait {
    /* --- Dua angka yang mengatur potongannya --- */
    /* Lebar dikunci ke ruang kosong itu, jadi potret tidak pernah menimpa papan. */
    --portrait-width: min(calc((100vw - 68rem) / 2), 28rem);
    /* Tinggi jendela tampil. Naikkan untuk memperlihatkan lebih banyak badan,
       turunkan untuk memotong lebih tinggi. Sekitar setengah badan pada potret
       berdiri biasa. */
    --portrait-height: min(74vh, 42rem);

    display: block;
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
