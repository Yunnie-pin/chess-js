<script setup lang="ts">
/**
 * Pemilih lawan komputer.
 *
 * Dibangun dari <input type="radio"> sungguhan yang disembunyikan secara visual,
 * bukan dari sekumpulan <button> ber-aria: dengan begitu perpindahan lewat tombol
 * panah, pengelompokan, dan pengumuman "1 dari 5" datang gratis dari browser.
 * Meniru semua itu di atas tombol biasa butuh roving tabindex, dan hampir selalu
 * ada satu bagian yang terlewat.
 *
 * Tampilan tiap barisnya ada di `OpponentCard`; di sini hanya kelompoknya.
 */
import { useI18n } from '../i18n/index.ts'
import { OPPONENT_LIST } from '../opponents.ts'
import OpponentCard from './OpponentCard.vue'
import type { EloRating } from '@chess/shared/ai'

const elo = defineModel<EloRating>({ required: true })

/** Terkunci selagi pertandingan berjalan; lihat `setupLocked` di useChessGame. */
defineProps<{ locked?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <!--
    `disabled` pada <fieldset> mematikan seluruh radio di dalamnya sekaligus —
    benar-benar mati, bukan sekadar terlihat pudar. Ia juga keluar dari urutan
    tab dan diumumkan sebagai nonaktif oleh pembaca layar. Menandai satu per satu
    memberi hasil yang sama hanya kalau tidak ada satu pun yang terlewat.
  -->
  <fieldset class="picker" :disabled="locked">
    <legend class="picker__legend">{{ t('controls.strength') }}</legend>

    <OpponentCard
      v-for="option in OPPONENT_LIST"
      :key="option.id"
      :opponent="option"
      :selected="elo === option.elo"
      group="lawan"
      @select="elo = option.elo"
    />
    <!-- Keterangan kuncinya ada di GameControls, di bawah pemilih warna: kunci
         yang sama menaungi keduanya, jadi penjelasannya ditaruh setelah dua-duanya. -->
  </fieldset>
</template>

<style scoped>
/* <fieldset> datang dengan bingkai dan jarak bawaan browser; dikosongkan dulu. */
.picker {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  border: none;
}

.picker__legend {
  padding: 0;
  margin-bottom: 0.35rem;
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/*
 * Saat terkunci: yang tidak terpilih meredup, yang terpilih tetap terang penuh.
 * Pemain masih perlu melihat sedang melawan siapa — meredupkan semuanya justru
 * menghapus satu-satunya keterangan yang masih berguna di sini.
 *
 * `:deep()` karena kartunya komponen anak dengan gaya ber-scope sendiri.
 */
.picker[disabled] :deep(.card) {
  cursor: default;
  opacity: 0.45;
}

.picker[disabled] :deep(.card:hover) {
  background: var(--surface);
}

.picker[disabled] :deep(.card--on) {
  opacity: 1;
}

</style>
