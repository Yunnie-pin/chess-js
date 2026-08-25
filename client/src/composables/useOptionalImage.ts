/**
 * Memeriksa apakah sebuah gambar benar-benar ada, tanpa pernah menampilkan ikon
 * gambar rusak.
 *
 * Polanya sengaja "naik kelas", bukan "turun kelas": yang digambar lebih dulu
 * adalah cadangannya (halo SVG, atau tidak sama sekali), lalu berpindah ke
 * gambar hanya setelah gambar itu terbukti termuat. Kalau urutannya dibalik —
 * pasang <img>, tunggu `error`, baru mundur — setiap pemuatan halaman tanpa
 * berkas gambar menyisakan kedipan kosong selama 404-nya berjalan.
 *
 * Berkas potret memang tidak disimpan di repo, jadi keadaan "belum ada" adalah
 * keadaan normal, bukan kasus tepi.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

export function useOptionalImage(src: Ref<string>) {
  const ready = ref(false)

  let probe: HTMLImageElement | null = null

  /** Melepas penangan agar pemeriksaan lama tidak menimpa hasil yang baru. */
  function cancel(): void {
    if (!probe) return
    probe.onload = null
    probe.onerror = null
    probe = null
  }

  function check(url: string): void {
    cancel()
    ready.value = false
    if (typeof Image === 'undefined' || !url) return

    const current = new Image()
    probe = current
    current.onload = () => {
      // Sumber bisa sudah berganti selagi yang ini masih memuat.
      if (probe === current) ready.value = true
    }
    current.onerror = () => {
      if (probe === current) ready.value = false
    }
    current.src = url
  }

  watch(src, check, { immediate: true })
  onScopeDispose(cancel)

  return { ready }
}
