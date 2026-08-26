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
import { computed } from 'vue'
import { useI18n } from '../i18n/index.ts'
import { OPPONENT_LIST } from '../opponents.ts'
import OpponentCard from './OpponentCard.vue'
import type { EloRating } from '@chess/shared/ai'

const elo = defineModel<EloRating>({ required: true })

/** Terkunci selagi pertandingan berjalan; lihat `setupLocked` di useChessGame. */
const props = defineProps<{ locked?: boolean }>()

const { t } = useI18n()

/** Terkunci: hanya lawan yang sedang dipakai yang tersisa untuk ditampilkan. */
const visibleOpponents = computed(() =>
  props.locked ? OPPONENT_LIST.filter((option) => option.elo === elo.value) : OPPONENT_LIST
)
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

    <TransitionGroup name="opp-card">
      <OpponentCard
        v-for="option in visibleOpponents"
        :key="option.id"
        :opponent="option"
        :selected="elo === option.elo"
        group="lawan"
        @select="elo = option.elo"
      />
    </TransitionGroup>
    <!-- Keterangan kuncinya ada di GameControls, di bawah pemilih warna: kunci
         yang sama menaungi keduanya, jadi penjelasannya ditaruh setelah dua-duanya. -->
  </fieldset>
</template>

<style scoped>
/* <fieldset> datang dengan bingkai dan jarak bawaan browser; dikosongkan dulu. */
.picker {
  position: relative;
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  border: none;
}

/*
 * Yang keluar (empat kartu tidak terpilih, begitu terkunci) meluruh di tempat
 * lalu dilepas dari alur grid — supaya kartu yang tersisa naik lewat animasi
 * `move`, bukan meloncat begitu elemen-elemen lain lenyap serentak.
 */
.opp-card-leave-active {
  position: absolute;
  width: 100%;
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.opp-card-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.opp-card-move {
  transition: transform 0.22s ease;
}

@media (prefers-reduced-motion: reduce) {
  .opp-card-leave-active,
  .opp-card-move {
    transition: none;
  }
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
 * Saat terkunci, kartu yang tidak terpilih dihapus dari DOM lewat v-if
 * (bukan sekadar diredupkan) — pemain tidak bisa menggantinya lagi, jadi
 * empat pilihan yang tidak relevan hanya menghabiskan tempat di sidebar.
 *
 * `:deep()` karena kartunya komponen anak dengan gaya ber-scope sendiri.
 */
.picker[disabled] :deep(.card) {
  cursor: default;
}

.picker[disabled] :deep(.card:hover) {
  background: var(--surface);
}
</style>
