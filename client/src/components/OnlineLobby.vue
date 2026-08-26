<script setup lang="ts">
import { computed, ref } from 'vue'

import { ROOM_CODE_LENGTH } from '@chess/shared/protocol'
import { useI18n } from '../i18n/index.ts'
import type { ConnectionStatus } from '../composables/useOnlineGame.ts'
import type { Color } from '@chess/shared/types'

const { t } = useI18n()

const props = defineProps<{
  status: ConnectionStatus
  error: string | null
  initialName: string
}>()

const emit = defineEmits<{
  create: [name: string, seat: Color | 'acak']
  join: [code: string, name: string]
}>()

const name = ref(props.initialName)
const code = ref('')
const seat = ref<Color | 'acak'>('acak')

const codeReady = computed(() => code.value.trim().length === ROOM_CODE_LENGTH)
const busy = computed(() => props.status === 'menyambung')

/** 'acak' dan 'w'/'b' adalah nilai protokol; hanya labelnya yang ikut bahasa. */
const SEATS = computed<{ value: Color | 'acak'; label: string }[]>(() => [
  { value: 'acak', label: t('lobby.seatRandom') },
  { value: 'w', label: t('color.w') },
  { value: 'b', label: t('color.b') }
])

/** Kode room selalu huruf besar, dan tidak menerima karakter di luar alfabetnya. */
function onCodeInput(event: Event): void {
  const input = event.target as HTMLInputElement
  code.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH)
  input.value = code.value
}

const submitJoin = () => {
  if (codeReady.value) emit('join', code.value, name.value)
}
</script>

<template>
  <section class="lobby">
    <header class="lobby__head">
      <h2 class="lobby__title">{{ t('lobby.title') }}</h2>
      <p class="lobby__sub">{{ t('lobby.subtitle') }}</p>
    </header>

    <label class="field">
      <span class="field__label">{{ t('lobby.yourName') }}</span>
      <input
        v-model="name"
        class="input"
        type="text"
        maxlength="24"
        :placeholder="t('lobby.namePlaceholder')"
      />
    </label>

    <div class="block">
      <span class="field__label">{{ t('lobby.createHeading') }}</span>
      <div class="segmented">
        <button
          v-for="option in SEATS"
          :key="option.value"
          type="button"
          class="segmented__item"
          :class="{ 'segmented__item--on': seat === option.value }"
          @click="seat = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="emit('create', name, seat)">
        {{ t('lobby.createButton') }}
      </button>
    </div>

    <div class="divider"><span>{{ t('lobby.or') }}</span></div>

    <form class="block" @submit.prevent="submitJoin">
      <label class="field__label" for="room-code">{{ t('lobby.joinHeading') }}</label>
      <input
        id="room-code"
        class="input input--code"
        type="text"
        inputmode="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="'-'.repeat(ROOM_CODE_LENGTH)"
        :value="code"
        @input="onCodeInput"
      />
      <button type="submit" class="btn" :disabled="!codeReady || busy">
        {{ t('lobby.joinButton') }}
      </button>
    </form>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="status === 'menyambung'" class="hint">{{ t('lobby.connecting') }}</p>
    <p v-else-if="status === 'gagal'" class="alert" role="alert">
      {{ t('lobby.serverUnreachable') }} <code>npm run dev:server</code>.
    </p>
  </section>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.lobby__head {
  display: grid;
  gap: 0.2rem;
}

.lobby__title {
  margin: 0;
  font-size: 1.05rem;
}

.lobby__sub {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.block {
  display: grid;
  gap: 0.45rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field__label {
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.input {
  padding: 0.55rem 0.7rem;
  font: inherit;
  font-size: 0.9rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  color: var(--text);
  width: 100%;
}

.input--code {
  font-family: var(--font-mono);
  font-size: 1.35rem;
  letter-spacing: 0.4em;
  text-align: center;
  text-indent: 0.4em; /* mengimbangi letter-spacing pada karakter terakhir */
}

.segmented {
  display: flex;
  gap: 0.25rem;
  padding: 0.22rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
}

.segmented__item {
  flex: 1;
  padding: 0.42rem 0.5rem;
  font-size: 0.82rem;
  background: none;
  border: none;
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
}

.segmented__item--on {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.btn {
  padding: 0.6rem 0.8rem;
  font: inherit;
  font-size: 0.86rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  color: var(--text);
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

.btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}

.divider {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.alert {
  margin: 0;
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
  color: var(--danger-text);
  background: var(--danger-soft);
  border: 1px solid var(--danger-line);
  border-radius: 0.5rem;
}

.alert code {
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
}
</style>
