<script setup lang="ts">
/**
 * Lambang aplikasi: motif halo Mari digambar ulang secara geometris — bunga
 * enam kelopak di dalam lingkaran dengan enam segitiga di sekelilingnya.
 *
 * Sengaja SVG, bukan potongan `mari.png`: lambang ini selalu ada, tajam di
 * ukuran berapa pun, dan ikut warna tema lewat `currentColor`.
 */

const ANGLES = [0, 60, 120, 180, 240, 300]
</script>

<template>
  <span class="mark" aria-hidden="true">
    <svg class="mark__svg" viewBox="0 0 100 100" role="presentation">
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
    </svg>
  </span>
</template>

<style scoped>
.mark {
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
}

.mark__svg {
  width: 62%;
  height: 62%;
}
</style>
