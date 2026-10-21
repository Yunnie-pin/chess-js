/**
 * Efek suara: pemilihan suara per langkah (murni) dan pemutarnya dengan
 * AudioContext pengganti — Node tidak punya Web Audio, jadi tes menyuntikkan
 * stand-in yang hanya mencatat node apa yang dijalankan.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { endSound, soundsForMove, type MoveSoundInput } from '../src/sound/moveSound.ts'
import { playSounds, primeAudioOnFirstGesture, setAudioContextFactory } from '../src/sound/synth.ts'
import { appendedPlies, justResigned, opponentJoined } from '../src/sound/onlineSounds.ts'
import { alertTab } from '../src/sound/tabAlert.ts'

const quiet = { over: false, winner: null, check: false } as const
const plain = { captured: null, castle: null, promotion: null } as const

const input = (over: Partial<MoveSoundInput>): MoveSoundInput => ({
  move: plain,
  mover: 'w',
  status: quiet,
  me: 'w',
  ...over
})

test('soundsForMove: langkah sendiri vs lawan; dua pemain selalu "sendiri"', () => {
  assert.deepEqual(soundsForMove(input({})), ['move-self'])
  assert.deepEqual(soundsForMove(input({ mover: 'b' })), ['move-opponent'])
  assert.deepEqual(soundsForMove(input({ mover: 'b', me: null })), ['move-self'])
})

test('soundsForMove: prioritas skak > promosi > rokade > makan', () => {
  assert.deepEqual(soundsForMove(input({ move: { ...plain, captured: 'bp' } })), ['capture'])
  assert.deepEqual(soundsForMove(input({ move: { ...plain, castle: 'k' } })), ['castle'])
  assert.deepEqual(
    soundsForMove(input({ move: { ...plain, captured: 'bn', promotion: 'q' } })),
    ['promote']
  )
  assert.deepEqual(
    soundsForMove(input({ move: { ...plain, captured: 'bn' }, status: { ...quiet, check: true } })),
    ['check']
  )
})

test('soundsForMove: langkah terakhir = bunyi langkah lalu jingle, dari sudut "me"', () => {
  const mate = { over: true, winner: 'w', check: true } as const
  assert.deepEqual(soundsForMove(input({ move: { ...plain, captured: 'bp' }, status: mate })), [
    'capture',
    'game-win'
  ])
  assert.deepEqual(soundsForMove(input({ status: mate, me: 'b' })), ['move-opponent', 'game-lose'])
  assert.deepEqual(soundsForMove(input({ status: { over: true, winner: null, check: false } })), [
    'move-self',
    'game-draw'
  ])
})

test('endSound: remis, dua pemain, menang, kalah', () => {
  assert.equal(endSound(null, 'w'), 'game-draw')
  assert.equal(endSound('w', null), 'game-end')
  assert.equal(endSound('b', 'b'), 'game-win')
  assert.equal(endSound('b', 'w'), 'game-lose')
})

/** AudioContext pengganti: cukup bentuknya, mencatat tiap node yang di-start. */
function fakeAudio(state: AudioContextState = 'running') {
  const started: string[] = []
  let resumed = 0
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}
  })
  const node = (kind: string) => ({
    connect() {},
    start() {
      started.push(kind)
    },
    stop() {},
    gain: param(),
    frequency: param(),
    Q: param(),
    type: '',
    buffer: null
  })
  const ctx = {
    state,
    sampleRate: 8000,
    currentTime: 0,
    destination: {},
    resume() {
      resumed++
      return Promise.resolve()
    },
    createGain: () => node('gain'),
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('noise'),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
  }
  return {
    ctx: ctx as unknown as AudioContext,
    started,
    get resumed() {
      return resumed
    }
  }
}

test('playSounds: tiap suara menjalankan node; deret = gabungan keduanya', () => {
  const fake = fakeAudio()
  setAudioContextFactory(() => fake.ctx)
  playSounds(['move-self'])
  const single = fake.started.length
  assert.ok(single > 0, 'ketukan harus menjalankan node')
  playSounds(['capture', 'game-win'])
  assert.ok(fake.started.length > single * 2)
  setAudioContextFactory(null)
})

test('playSounds: volume 0 / daftar kosong / tanpa AudioContext → diam, tidak melempar', () => {
  const fake = fakeAudio()
  setAudioContextFactory(() => fake.ctx)
  playSounds(['move-self'], 0)
  playSounds([])
  assert.equal(fake.started.length, 0)
  setAudioContextFactory(() => null)
  assert.doesNotThrow(() => playSounds(['check']))
  setAudioContextFactory(() => {
    throw new Error('diblokir')
  })
  assert.doesNotThrow(() => playSounds(['check']))
  setAudioContextFactory(null)
})

test('primeAudioOnFirstGesture: konteks yang tertangguhkan dibuka pada interaksi pertama, sekali saja', () => {
  const fake = fakeAudio('suspended')
  setAudioContextFactory(() => fake.ctx)
  const target = new EventTarget()
  primeAudioOnFirstGesture(target)
  target.dispatchEvent(new Event('pointerdown'))
  assert.equal(fake.resumed, 1)
  target.dispatchEvent(new Event('pointerdown'))
  assert.equal(fake.resumed, 1, 'pendengarnya dilepas sesudah interaksi pertama')
  setAudioContextFactory(null)
})

const room = (history: string[], extra: Partial<{ roomId: string; waiting: boolean; resignedBy: 'w' | 'b' | null }> = {}) => ({
  roomId: 'ABC',
  history: history.map((san) => ({ san })),
  waiting: false,
  resignedBy: null,
  ...extra
})

test('appendedPlies: hanya riwayat yang bertambah di ujung, di room yang sama', () => {
  assert.equal(appendedPlies(room(['e4']), room(['e4', 'e5'])), 1)
  assert.equal(appendedPlies(room(['e4']), room(['e4', 'e5', 'Nf3'])), 2, 'premove / reconnect singkat')
  assert.equal(appendedPlies(null, room(['e4', 'e5'])), 0, 'state pertama sesudah bergabung')
  assert.equal(appendedPlies(room(['e4']), room(['e4', 'e5'], { roomId: 'XYZ' })), 0, 'room lain')
  assert.equal(appendedPlies(room(['e4', 'e5']), room(['e4', 'e5'])), 0, 'resync tanpa perubahan')
  assert.equal(appendedPlies(room(['e4', 'e5']), room([])), 0, 'rematch')
  assert.equal(appendedPlies(room(['e4']), room(['e4', 'e5', 'Nf3', 'Nc6'])), 0, 'lompatan jauh = resync')
  assert.equal(appendedPlies(room(['e4']), room(['d4', 'd5'])), 0, 'awalan berbeda')
})

test('opponentJoined / justResigned: transisi di room yang sama saja', () => {
  assert.equal(opponentJoined(room([], { waiting: true }), room([])), true)
  assert.equal(opponentJoined(null, room([])), false)
  assert.equal(opponentJoined(room([]), room([])), false)
  assert.equal(justResigned(room(['e4']), room(['e4'], { resignedBy: 'b' })), 'b')
  assert.equal(justResigned(room(['e4'], { resignedBy: 'b' }), room(['e4'], { resignedBy: 'b' })), null)
  assert.equal(justResigned(null, room(['e4'], { resignedBy: 'b' })), null)
})

test('alertTab: hanya saat tersembunyi; judul asli pulih saat tab dilihat lagi', () => {
  const doc = Object.assign(new EventTarget(), { hidden: false, title: 'Chess with Mari' })
  alertTab('Giliran Anda', doc)
  assert.equal(doc.title, 'Chess with Mari', 'tab yang sedang dilihat tidak diubah')

  doc.hidden = true
  alertTab('Lawan bergabung', doc)
  alertTab('Giliran Anda', doc)
  assert.equal(doc.title, '● Giliran Anda — Chess with Mari', 'tidak menumpuk penanda')

  doc.hidden = false
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(doc.title, 'Chess with Mari')
})

test('playSounds: suara premove dan ilegal punya resep', () => {
  const fake = fakeAudio()
  setAudioContextFactory(() => fake.ctx)
  playSounds(['premove'])
  playSounds(['illegal'])
  assert.ok(fake.started.length >= 2)
  setAudioContextFactory(null)
})
