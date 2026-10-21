/**
 * Efek suara, disintesis dengan Web Audio — tanpa satu pun berkas audio.
 *
 * Kenapa sintesis, bukan rekaman: repo ini tidak berlisensi dan menulis
 * semuanya sendiri; suara situs catur besar berhak cipta, dan rekaman pihak
 * ketiga membawa urusan lisensinya masing-masing. Ketukan kayu cukup didekati
 * dengan noise pendek yang disaring band-pass plus nada "badan" rendah, dan
 * jingle cukup dua-empat nada segitiga. Bonusnya: nol byte untuk diunduh.
 *
 * `AudioContext` dibuat malas dan dibuka (`resume`) pada interaksi pertama
 * pengguna — kebijakan autoplay browser (terutama Safari iOS) membungkam
 * konteks yang dibuat sebelum itu. Di Node (tes) `AudioContext` tidak ada,
 * jadi semuanya diam tanpa melempar; tes menyuntikkan pengganti lewat
 * `setAudioContextFactory`.
 */

import type { SoundName } from './moveSound.ts'

type ContextFactory = () => AudioContext | null

const defaultFactory: ContextFactory = () =>
  typeof AudioContext === 'undefined' ? null : new AudioContext()

let factory: ContextFactory = defaultFactory
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

/** Untuk tes: ganti pembuat konteks (dan buang konteks lama). */
export function setAudioContextFactory(next: ContextFactory | null): void {
  factory = next ?? defaultFactory
  ctx = null
  noise = null
}

function context(): AudioContext | null {
  if (!ctx) ctx = factory()
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/**
 * Pasang pembuka konteks pada interaksi pertama. Langkah bot datang tanpa
 * klik — kalau konteksnya belum pernah dibuka oleh klik pemain, bunyinya
 * hilang. Dipanggil sekali dari App saat terpasang.
 */
export function primeAudioOnFirstGesture(target: EventTarget = window): void {
  const unlock = () => {
    context()
    target.removeEventListener('pointerdown', unlock)
    target.removeEventListener('keydown', unlock)
  }
  target.addEventListener('pointerdown', unlock)
  target.addEventListener('keydown', unlock)
}

/** 0.25 detik white noise, dibuat sekali lalu dipakai ulang semua ketukan. */
function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noise) return noise
  const length = Math.floor(audio.sampleRate * 0.25)
  noise = audio.createBuffer(1, length, audio.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

/** Selubung serang-cepat/luruh-eksponensial: tanpa klik di awal, tanpa ekor terpotong. */
function envelope(audio: AudioContext, at: number, peak: number, decay: number, out: AudioNode): GainNode {
  const gain = audio.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.linearRampToValueAtTime(peak, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  gain.connect(out)
  return gain
}

/**
 * Satu ketukan kayu: noise band-pass (tekstur) + sinus rendah (badan).
 * `pitch` menggeser keduanya — langkah lawan sedikit lebih rendah dari
 * langkah sendiri, makan bidak lebih tajam dan lebih keras.
 */
function knock(audio: AudioContext, at: number, out: AudioNode, pitch: number, level: number): void {
  const source = audio.createBufferSource()
  source.buffer = noiseBuffer(audio)
  const filter = audio.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = pitch
  filter.Q.value = 9
  source.connect(filter)
  filter.connect(envelope(audio, at, 0.9 * level, 0.07, out))
  source.start(at)
  source.stop(at + 0.09)

  const body = audio.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(pitch * 0.28, at)
  body.frequency.exponentialRampToValueAtTime(pitch * 0.2, at + 0.06)
  body.connect(envelope(audio, at, 0.5 * level, 0.08, out))
  body.start(at)
  body.stop(at + 0.1)
}

/** Satu nada segitiga untuk jingle dan peringatan. */
function tone(audio: AudioContext, at: number, out: AudioNode, freq: number, length: number, level: number): void {
  const osc = audio.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = freq
  osc.connect(envelope(audio, at, level, length, out))
  osc.start(at)
  osc.stop(at + length + 0.02)
}

/** Resep tiap suara. `t` = waktu mulai; semua jadwal relatif terhadapnya. */
const RECIPES: Record<SoundName, (audio: AudioContext, t: number, out: AudioNode) => void> = {
  'move-self': (a, t, o) => knock(a, t, o, 1900, 0.8),
  'move-opponent': (a, t, o) => knock(a, t, o, 1450, 0.8),
  capture: (a, t, o) => {
    knock(a, t, o, 2700, 1)
    knock(a, t + 0.012, o, 1300, 0.7)
  },
  castle: (a, t, o) => {
    knock(a, t, o, 1800, 0.75)
    knock(a, t + 0.09, o, 1600, 0.75)
  },
  promote: (a, t, o) => {
    knock(a, t, o, 1900, 0.8)
    tone(a, t + 0.05, o, 784, 0.12, 0.18)
    tone(a, t + 0.13, o, 1175, 0.16, 0.18)
  },
  check: (a, t, o) => {
    knock(a, t, o, 1900, 0.7)
    tone(a, t + 0.02, o, 988, 0.09, 0.22)
    tone(a, t + 0.1, o, 1319, 0.12, 0.2)
  },
  'game-start': (a, t, o) => {
    tone(a, t, o, 523, 0.14, 0.2)
    tone(a, t + 0.11, o, 784, 0.22, 0.2)
  },
  'game-win': (a, t, o) => {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.09, o, f, i === 3 ? 0.4 : 0.14, 0.22))
  },
  'game-lose': (a, t, o) => {
    ;[392, 330, 262].forEach((f, i) => tone(a, t + i * 0.14, o, f, i === 2 ? 0.45 : 0.18, 0.22))
  },
  'game-draw': (a, t, o) => {
    tone(a, t, o, 659, 0.16, 0.2)
    tone(a, t + 0.14, o, 523, 0.3, 0.2)
  },
  'game-end': (a, t, o) => {
    ;[523, 784, 1047].forEach((f, i) => tone(a, t + i * 0.1, o, f, i === 2 ? 0.35 : 0.14, 0.2))
  },
  // Premove diantre: ketukan kecil bernada tinggi — "tercatat", bukan "dimainkan".
  premove: (a, t, o) => knock(a, t, o, 3200, 0.35),
  illegal: (a, t, o) => {
    const osc = a.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 150
    osc.connect(envelope(a, t, 0.06, 0.09, o))
    osc.start(t)
    osc.stop(t + 0.11)
  }
}

/** Jeda antar suara dalam satu deret — jingle akhir menunggu bunyi langkahnya selesai. */
const SEQUENCE_GAP = 0.16

/**
 * Putar satu atau beberapa suara berurutan. Diam (tidak melempar) bila audio
 * tidak tersedia atau gagal — efek suara tidak boleh pernah merusak permainan.
 */
export function playSounds(names: readonly SoundName[], volume = 0.6): void {
  if (!names.length || volume <= 0) return
  try {
    const audio = context()
    if (!audio) return
    const master = audio.createGain()
    master.gain.value = volume
    master.connect(audio.destination)
    const start = audio.currentTime + 0.005
    names.forEach((name, i) => RECIPES[name](audio, start + i * SEQUENCE_GAP, master))
  } catch {
    // Audio diblokir/tidak didukung — permainan jalan terus tanpa suara.
  }
}
