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
 *
 * `enabled` menahan pemeriksaan itu sendiri, bukan sekadar hasilnya. Bedanya
 * penting: memeriksa berarti mengunduh berkasnya, jadi pemanggil yang gambarnya
 * cuma tampil di sebagian ukuran layar tidak bisa cukup menyembunyikannya lewat
 * CSS — `display: none` tetap membayar unduhannya.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

export function useOptionalImage(src: Ref<string>, enabled?: Ref<boolean>) {
  const ready = ref(false)

  let probe: HTMLImageElement | null = null

  /** Melepas penangan agar pemeriksaan lama tidak menimpa hasil yang baru. */
  function cancel(): void {
    if (!probe) return
    probe.onload = null
    probe.onerror = null
    probe = null
  }

  function check(): void {
    cancel()
    ready.value = false
    const url = src.value
    if (enabled && !enabled.value) return
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

  // Keduanya dilacak: berganti sumber jelas memicu pemeriksaan ulang, dan
  // layar yang baru saja cukup lebar juga — gambarnya belum pernah diunduh.
  watch([src, () => enabled?.value ?? true], check, { immediate: true })
  onScopeDispose(cancel)

  return { ready }
}
