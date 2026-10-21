/**
 * Efek suara: pemilihan suara per langkah (murni) dan pemutarnya dengan
 * AudioContext pengganti — Node tidak punya Web Audio, jadi tes menyuntikkan
 * stand-in yang hanya mencatat node apa yang dijalankan.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { endSound, soundsForMove, type MoveSoundInput } from '../src/sound/moveSound.ts'
import { playSounds, primeAudioOnFirstGesture, setAudioContextFactory } from '../src/sound/synth.ts'

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
