<script setup lang="ts">
/**
 * Lambang lawan yang sedang aktif: halo-nya, digambar ulang secara geometris.
 *
 * JUJUR SOAL AKURASI: bentuk-bentuk di bawah adalah tafsir bergaya, bukan
 * salinan desain resmi tiap karakter. Yang dikejar adalah tiap halo bisa
 * dibedakan sekilas dan tetap satu keluarga secara visual — bukan kemiripan
 * satu banding satu. Kalau kamu punya gambar yang benar, taruh saja sebagai
 * `public/halo-<id>.png`; berkas itu otomatis dipakai menggantikan SVG di sini,
 * tanpa mengubah kode.
 *
 * Sengaja SVG sebagai bawaan, bukan potongan gambar: lambang ini selalu ada,
 * tajam di ukuran berapa pun, dan ikut warna tema lewat `currentColor`.
 */
import { computed, toRef } from 'vue'

import { useOptionalImage } from '../composables/useOptionalImage.ts'
import { publicUrl, type Opponent } from '../opponents.ts'

const props = defineProps<{ opponent: Opponent }>()

const source = computed(() => publicUrl(props.opponent.halo))
const { ready: hasImage } = useOptionalImage(source)

/** Enam arah, dipakai ulang oleh beberapa motif. */
const ANGLES = [0, 60, 120, 180, 240, 300]

const id = toRef(() => props.opponent.id)
</script>

<template>
  <span class="mark" aria-hidden="true">
    <img v-if="hasImage" class="mark__img" :src="source" alt="" />

    <svg v-else class="mark__svg" viewBox="0 0 100 100" role="presentation">
      <!-- Mari — bunga enam kelopak di dalam lingkaran, dengan enam duri. -->
      <template v-if="id === 'mari'">
        <g fill="currentColor">
          <polygon
            v-for="angle in ANGLES"
            :key="`spike-${angle}`"
            points="50,3 45.5,15 54.5,15"
            :transform="`rotate(${angle} 50 50)`"
          />
        </g>
        <circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" stroke-width="3.5" />
        <g fill="currentColor" opacity="0.9">
          <ellipse
            v-for="angle in ANGLES"
            :key="`petal-${angle}`"
            cx="50"
            cy="37"
            rx="6.5"
            ry="11"
            :transform="`rotate(${angle} 50 50)`"
          />
        </g>
      </template>

      <!-- Toki — segi enam bersudut tajam, dengan mata belah ketupat di tengah. -->
      <template v-else-if="id === 'toki'">
        <polygon
          points="50,14 81,32 81,68 50,86 19,68 19,32"
          fill="none"
          stroke="currentColor"
          stroke-width="4"
          stroke-linejoin="miter"
        />
        <polygon points="50,33 64,50 50,67 36,50" fill="currentColor" />
        <g fill="currentColor" opacity="0.75">
          <polygon
            v-for="angle in [0, 180]"
            :key="`fang-${angle}`"
            points="50,2 44,12 56,12"
            :transform="`rotate(${angle} 50 50)`"
          />
        </g>
      </template>

      <!-- Kisaki — cincin yang terputus-putus, dengan satu bilah di puncaknya. -->
      <template v-else-if="id === 'kisaki'">
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="none"
          stroke="currentColor"
          stroke-width="5"
          stroke-dasharray="26 9.6"
          stroke-linecap="butt"
        />
        <circle cx="50" cy="50" r="21" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.65" />
        <polygon points="50,4 42,20 58,20" fill="currentColor" />
        <circle cx="50" cy="50" r="5" fill="currentColor" />
      </template>

      <!-- Yuuka — tanda tambah tegas di dalam cincin; ia yang berurusan dengan angka. -->
      <template v-else-if="id === 'yuuka'">
        <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="4" />
        <g fill="currentColor">
          <rect x="45.5" y="28" width="9" height="44" rx="2.5" />
          <rect x="28" y="45.5" width="44" height="9" rx="2.5" />
        </g>
      </template>

      <!-- Himari — inti dengan enam simpul yang mengelilinginya. -->
      <template v-else>
        <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" stroke-width="3" opacity="0.8" />
        <g fill="currentColor">
          <circle
            v-for="angle in ANGLES"
            :key="`node-${angle}`"
            cx="50"
            cy="19"
            r="5.5"
            :transform="`rotate(${angle} 50 50)`"
          />
        </g>
        <circle cx="50" cy="50" r="10" fill="currentColor" />
      </template>
    </svg>
  </span>
</template>

<style scoped>
.mark {
  /* Ukurannya diatur pemakai: 3rem di kepala halaman, lebih kecil di kartu lawan. */
  width: var(--halo-size, 3rem);
  height: var(--halo-size, 3rem);
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
  overflow: hidden;
  /* Warna dan pendar ikut berganti bersama lawan; jangan sampai terasa melompat. */
  transition: color 0.25s, box-shadow 0.25s;
}

.mark__svg {
  width: 62%;
  height: 62%;
}

.mark__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .mark {
    transition: none;
  }
}
</style>
