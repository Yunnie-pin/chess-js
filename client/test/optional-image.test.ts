/**
 * Tes gerbang unduhan pada `useOptionalImage`.
 *
 * Ada karena satu bug yang tidak terlihat di layar sama sekali: potret lawan
 * hanya tampil di layar lebar, dan dulu itu diatur murni lewat `@media` di CSS.
 * `display: none` memang menyembunyikannya — tapi tidak membatalkan unduhannya.
 * Pemeriksaan keberadaan berkas tetap berjalan, jadi setiap ponsel ikut menarik
 * potret penuh (`mari-full.webp` sendiri 1,3 MB) demi elemen yang mustahil
 * terlihat di sana.
 *
 * Bug seperti ini tidak akan pernah muncul sebagai tampilan yang salah, jadi
 * tidak ada yang menangkapnya selain tes yang memang menghitung permintaan
 * jaringannya. Itu yang dilakukan di sini: `Image` diganti tiruan yang mencatat
 * setiap `src` yang sungguh-sungguh diminta.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'

import { useOptionalImage } from '../src/composables/useOptionalImage.ts'

const PORTRAIT = '/mari-full.webp'

/** Berdiri sebagai `Image` peramban; yang dicatat hanya src yang benar-benar diminta. */
class FakeImage {
  static requested: string[] = []
  /** Tiruan terakhir yang dibuat, supaya tes bisa memicu `onload` sendiri. */
  static last: FakeImage | null = null

  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    FakeImage.last = this
  }

  set src(value: string) {
    FakeImage.requested.push(value)
  }
}

/** Node tidak punya `Image`, dan composable-nya memang menyerah kalau begitu — jadi tanpa tiruan ini tesnya lolos karena alasan yang salah. */
async function withFakeImage(body: () => Promise<void>): Promise<void> {
  const host = globalThis as { Image?: unknown }
  const original = host.Image
  host.Image = FakeImage
  FakeImage.requested = []
  FakeImage.last = null
  try {
    await body()
  } finally {
    host.Image = original
  }
}

/** Composable-nya memakai `onScopeDispose`, jadi ia butuh scope yang hidup. */
async function inScope(body: () => void): Promise<void> {
  const scope = effectScope()
  scope.run(body)
  await nextTick()
  scope.stop()
}

test('tanpa gerbang, gambar langsung diperiksa seperti biasa', async () => {
  await withFakeImage(async () => {
    await inScope(() => {
      useOptionalImage(ref(PORTRAIT))
    })
    assert.deepEqual(FakeImage.requested, [PORTRAIT])
  })
})

test('gerbang tertutup berarti tidak ada unduhan sama sekali', async () => {
  await withFakeImage(async () => {
    await inScope(() => {
      useOptionalImage(ref(PORTRAIT), ref(false))
    })
    assert.deepEqual(FakeImage.requested, [])
  })
})

test('berganti sumber selagi gerbang tertutup tetap tidak mengunduh', async () => {
  await withFakeImage(async () => {
    const source = ref(PORTRAIT)
    const scope = effectScope()
    scope.run(() => useOptionalImage(source, ref(false)))
    await nextTick()

    source.value = '/himari-full.webp'
    await nextTick()

    assert.deepEqual(FakeImage.requested, [])
    scope.stop()
  })
})

test('gerbang yang kemudian terbuka baru mengunduh — layar yang melebar tidak berakhir kosong', async () => {
  await withFakeImage(async () => {
    const enabled = ref(false)
    const scope = effectScope()
    scope.run(() => useOptionalImage(ref(PORTRAIT), enabled))
    await nextTick()
    assert.deepEqual(FakeImage.requested, [], 'belum boleh ada unduhan selagi tertutup')

    enabled.value = true
    await nextTick()
    assert.deepEqual(FakeImage.requested, [PORTRAIT])

    scope.stop()
  })
})

test('gerbang terbuka: jalur normalnya utuh, `ready` menyala begitu gambar termuat', async () => {
  // Menahan unduhan tidak ada gunanya kalau yang lolos gerbang malah berhenti
  // bekerja — potretnya akan hilang dari desktop juga.
  await withFakeImage(async () => {
    const scope = effectScope()
    const result = scope.run(() => useOptionalImage(ref(PORTRAIT), ref(true)))
    await nextTick()
    assert.equal(result?.ready.value, false, 'belum termuat, jadi belum siap')

    FakeImage.last?.onload?.()
    assert.equal(result?.ready.value, true)

    scope.stop()
  })
})
