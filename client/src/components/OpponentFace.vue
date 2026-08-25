<script setup lang="ts">
/**
 * Wajah lawan sebagai avatar bulat kecil, dipakai di papan nama sisi komputer.
 *
 * Berbeda dari latar di kartu pemilih: di sana bingkainya sangat pipih sehingga
 * gambar harus dipotong keras atas-bawah, sedangkan di sini bingkainya bujur
 * sangkar. Gambar wajahnya 252x204 — lebih lebar daripada tinggi — jadi `cover`
 * pada kotak bujur sangkar mengisi berdasarkan TINGGI: seluruh tinggi gambar
 * masuk utuh, dan yang terpotong sedikit justru sisi kiri-kanannya. Karena itu
 * kepalanya selalu utuh di sini tanpa perlu disetel sama sekali.
 *
 * Konsekuensinya `object-position` vertikal tidak ada gunanya di sini — tidak
 * ada kelebihan tinggi untuk digeser. Jangan tambahkan; ia hanya akan jadi knob
 * mati seperti yang sudah pernah terjadi di kartu pemilih.
 */
import { computed } from 'vue'

import { useOptionalImage } from '../composables/useOptionalImage.ts'
import { publicUrl, type Opponent } from '../opponents.ts'

const props = defineProps<{ opponent: Opponent }>()

const source = computed(() => publicUrl(props.opponent.face))
const { ready } = useOptionalImage(source)
</script>

<template>
  <!-- Namanya sudah tertulis persis di sebelahnya, jadi avatar ini dekoratif:
       memberinya alt hanya akan membuat pembaca layar menyebut nama dua kali. -->
  <img
    v-if="ready"
    class="face"
    :src="source"
    :key="source"
    alt=""
    aria-hidden="true"
  />
</template>

<style scoped>
.face {
  width: 2.1rem;
  height: 2.1rem;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface);
  border: 1px solid var(--border);
  /* Lingkaran tipis berwarna aksen, senada dengan halo di kepala halaman. */
  box-shadow: 0 0 0 2px var(--accent-soft), 0 1px 4px rgb(0 0 0 / 0.35);
  animation: face-in 0.35s ease-out;
}

@keyframes face-in {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
}

@media (prefers-reduced-motion: reduce) {
  .face {
    animation: none;
  }
}
</style>
