<script setup lang="ts">
import { ref } from 'vue'

/**
 * Potret karakter sebagai latar, hanya di layar lebar.
 *
 * Gambar diambil saat runtime dari folder `public/`, BUKAN lewat import Vite.
 * Sengaja begitu: berkasnya tidak disimpan di repo (artwork-nya berhak cipta),
 * dan `import` statis akan menggagalkan seluruh build kalau berkasnya belum
 * ada. Dengan cara ini aplikasi tetap utuh tanpa gambar, dan langsung
 * memakainya begitu berkas diletakkan — tanpa mengubah kode.
 */
const src = `${import.meta.env.BASE_URL}mari.png`
const failed = ref(false)
</script>

<template>
  <!-- Belum ada gambarnya? Cukup menghilang — tanpa ikon gambar rusak. -->
  <div v-if="!failed" class="portrait" aria-hidden="true">
    <img class="portrait__img" :src="src" alt="" @error="failed = true" />
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
  }
}

@media (prefers-reduced-transparency: reduce) {
  .portrait {
    display: none;
  }
}
</style>
