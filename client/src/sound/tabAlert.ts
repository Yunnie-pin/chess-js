/**
 * Penanda di judul tab untuk kejadian online yang terjadi selagi tab
 * tersembunyi — lawan bergabung, lawan melangkah. Suara saja tidak cukup:
 * pemain sering membisukan tab atau pergi sebentar, dan judul tab adalah
 * satu-satunya yang masih terlihat dari tab lain.
 *
 * Hanya berlaku saat `document.hidden`; begitu tab dilihat lagi, judul asli
 * dipulihkan. Dokumennya disuntik supaya bisa diuji di Node.
 */

interface DocLike extends EventTarget {
  hidden: boolean
  title: string
}

let original: string | null = null

/** Tandai judul tab dengan `text`, bila tabnya sedang tersembunyi. */
export function alertTab(text: string, doc: DocLike | undefined = globalThis.document): void {
  if (!doc || !doc.hidden) return
  if (original === null) {
    original = doc.title
    const restore = () => {
      if (doc.hidden) return
      doc.title = original ?? doc.title
      original = null
      doc.removeEventListener('visibilitychange', restore)
    }
    doc.addEventListener('visibilitychange', restore)
  }
  doc.title = `● ${text} — ${original}`
}
