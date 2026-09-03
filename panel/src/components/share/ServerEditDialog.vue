<template>
  <!-- 新建 / 编辑一台共享网络的服务器。字段按协议切换:SS 有加密方式和密码,VLESS 有 UUID
       和 TLS 开关,TUIC 有 UUID + 密码,Hysteria2 有密码 + 可选混淆。凭据都能一键生成。 -->
  <DialogWrapper
    v-model="isOpen"
    :title="$t(server ? 'serverEditTitle' : 'serverAddTitle')"
    box-class="w-full max-w-xl"
  >
    <div class="flex flex-col gap-4 text-sm">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('serverNameLabel') }}</label>
          <input
            v-model="form.name"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('serverNamePlaceholder')"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('serverProtocolLabel') }}</label>
          <select
            v-model="form.protocol"
            class="select select-sm w-full"
            @change="onProtocolChange"
          >
            <option
              v-for="p in PROTOCOLS"
              :key="p.value"
              :value="p.value"
            >
              {{ p.label }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('serverPortLabel') }}</label>
          <input
            v-model.number="form.port"
            type="number"
            min="1"
            max="65535"
            class="input input-sm w-full"
          />
        </div>
        <!-- 访问协议 + 域名/IP:默认取当前打开面板的地址。域名/IP 进节点分享链接,
             协议只给订阅链接用(订阅链接是面板自己提供的 http 接口)。 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('serverAddressLabel') }}</label>
          <div class="join w-full">
            <select
              v-model="form.scheme"
              class="select select-sm join-item w-28 shrink-0"
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
            <input
              v-model="form.address"
              type="text"
              class="input input-sm join-item w-full"
              :placeholder="$t('serverAddressPlaceholder')"
              autocomplete="off"
            />
          </div>
        </div>

        <div
          v-if="form.protocol === 'shadowsocks'"
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">{{ $t('serverMethodLabel') }}</label>
          <select
            v-model="form.method"
            class="select select-sm w-full"
            @change="onMethodChange"
          >
            <option
              v-for="m in SS_METHODS"
              :key="m"
              :value="m"
            >
              {{ m }}
            </option>
          </select>
        </div>

        <div
          v-if="needsUuid"
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">UUID</label>
          <div class="join w-full">
            <input
              v-model="form.uuid"
              type="text"
              class="input input-sm join-item w-full font-mono"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn btn-sm join-item"
              v-tip="$t('serverGenerate')"
              @click="form.uuid = randomUuid()"
            >
              <ArrowPathIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          v-if="needsPassword"
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">{{ $t('serverPasswordLabel') }}</label>
          <div class="join w-full">
            <input
              v-model="form.password"
              type="text"
              class="input input-sm join-item w-full font-mono"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn btn-sm join-item"
              v-tip="$t('serverGenerate')"
              @click="form.password = newPassword()"
            >
              <ArrowPathIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          v-if="form.protocol === 'hysteria2'"
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">{{ $t('serverObfsLabel') }}</label>
          <div class="join w-full">
            <input
              v-model="form.obfs"
              type="text"
              class="input input-sm join-item w-full font-mono"
              :placeholder="$t('serverObfsPlaceholder')"
              autocomplete="off"
            />
            <button
              type="button"
              class="btn btn-sm join-item"
              v-tip="$t('serverGenerate')"
              @click="form.obfs = randomPassword(12)"
            >
              <ArrowPathIcon class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          v-if="form.protocol === 'vless'"
          class="flex items-center gap-3 pt-5"
        >
          <input
            id="server-tls"
            v-model="form.tls"
            type="checkbox"
            class="toggle toggle-sm"
          />
          <label
            for="server-tls"
            class="text-sm"
          >{{ $t('serverTlsLabel') }}</label>
        </div>
      </div>

      <p class="text-base-content/60 text-xs">{{ $t(needsTls ? 'serverTlsHint' : 'serverPlainHint') }}</p>

      <!-- 分享链接(节点 URI)和订阅链接(面板提供的 http 接口),各自可复制;
           下面是二维码,可切换扫哪一个。订阅链接要保存过一次才有令牌。 -->
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('serverShareLinkLabel') }}</label>
        <div class="join w-full">
          <input
            :value="shareLink || $t('serverShareLinkNeedAddress')"
            type="text"
            readonly
            class="input input-sm join-item w-full font-mono text-xs"
          />
          <button
            type="button"
            class="btn btn-sm join-item"
            :disabled="!shareLink"
            v-tip="$t('copyLink')"
            @click="copyText(shareLink)"
          >
            <ClipboardDocumentIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium">{{ $t('serverSubscribeLinkLabel') }}</label>
        <div class="join w-full">
          <input
            :value="subscribeUrl || $t(shareLink ? 'serverSubscribeNeedSave' : 'serverShareLinkNeedAddress')"
            type="text"
            readonly
            class="input input-sm join-item w-full font-mono text-xs"
          />
          <button
            type="button"
            class="btn btn-sm join-item"
            :disabled="!subscribeUrl"
            v-tip="$t('copyLink')"
            @click="copyText(subscribeUrl)"
          >
            <ClipboardDocumentIcon class="h-4 w-4" />
          </button>
        </div>
        <p class="text-base-content/50 text-xs">{{ $t('serverSubscribeHint') }}</p>
      </div>

      <div
        v-if="shareLink"
        class="flex flex-col items-start gap-2"
      >
        <div
          role="tablist"
          class="tabs-box tabs tabs-xs"
        >
          <a
            role="tab"
            class="tab"
            :class="qrTarget === 'share' && 'tab-active'"
            @click="qrTarget = 'share'"
          >{{ $t('serverQrShare') }}</a>
          <a
            role="tab"
            class="tab"
            :class="[qrTarget === 'subscribe' && 'tab-active', !subscribeUrl && 'tab-disabled']"
            @click="subscribeUrl && (qrTarget = 'subscribe')"
          >{{ $t('serverQrSubscribe') }}</a>
        </div>
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          class="h-44 w-44 rounded-lg bg-white p-1"
          alt="QR"
        />
      </div>

      <p
        v-if="error"
        class="text-error text-xs"
      >
        {{ error }}
      </p>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-sm"
          @click="isOpen = false"
        >
          {{ $t('cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="submit"
        >
          {{ $t('save') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import type { OpenboxServer, OpenboxServerProtocol } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { showNotification } from '@/helper/notification'
import {
  buildShareLink,
  buildSubscriptionUrl,
  defaultHost,
  defaultScheme,
  randomPassword,
  randomServerId,
  randomSs2022Key,
  randomUuid,
} from '@/helper/shareLink'
import { ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/vue/24/outline'
import QRCode from 'qrcode'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
  // 编辑时传入;新建时为 null
  server: OpenboxServer | null
  // 其它服务器占用的端口,用来提示重复
  usedPorts: number[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [server: OpenboxServer]
}>()

const { t } = useI18n()

const PROTOCOLS: { value: OpenboxServerProtocol; label: string }[] = [
  { value: 'shadowsocks', label: 'Shadowsocks' },
  { value: 'vless', label: 'VLESS' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'hysteria2', label: 'Hysteria2' },
]
const SS_METHODS = ['aes-256-gcm', 'aes-128-gcm', 'chacha20-ietf-poly1305', '2022-blake3-aes-256-gcm']
const DEFAULT_PORT: Record<OpenboxServerProtocol, number> = { shadowsocks: 8388, vless: 8443, tuic: 8444, hysteria2: 8445 }

const isOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const blank = (): OpenboxServer => ({
  id: randomServerId(),
  enabled: true,
  name: '',
  protocol: 'shadowsocks',
  port: DEFAULT_PORT.shadowsocks,
  scheme: defaultScheme(),
  address: defaultHost(),
  password: randomPassword(),
  method: 'aes-256-gcm',
  uuid: randomUuid(),
  tls: true,
  obfs: '',
})

const form = reactive<OpenboxServer>(blank())
const error = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    Object.assign(form, blank(), props.server ? { ...props.server } : {})
    // 老记录没填过地址/协议的,也按当前页面补上默认值
    if (!form.address) form.address = defaultHost()
    if (!form.scheme) form.scheme = defaultScheme()
    qrTarget.value = 'share'
  },
)

const needsUuid = computed(() => form.protocol === 'vless' || form.protocol === 'tuic')
const needsPassword = computed(() => form.protocol !== 'vless')
const needsTls = computed(() => form.protocol === 'tuic' || form.protocol === 'hysteria2' || (form.protocol === 'vless' && form.tls))

const newPassword = () => (form.protocol === 'shadowsocks' && form.method === '2022-blake3-aes-256-gcm' ? randomSs2022Key() : randomPassword())
const onMethodChange = () => {
  form.password = newPassword()
}
const onProtocolChange = () => {
  // 换协议时端口按协议给个默认值(编辑已有的也一样),凭据保留
  form.port = DEFAULT_PORT[form.protocol]
  if (form.protocol === 'shadowsocks' && !form.method) form.method = 'aes-256-gcm'
  if (!form.password) form.password = newPassword()
  if (!form.uuid) form.uuid = randomUuid()
}

const shareLink = computed(() => buildShareLink(form))
const subscribeUrl = computed(() => buildSubscriptionUrl(form))

const copyText = async (text: string) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    showNotification({ content: 'copySuccess', type: 'alert-success' })
  } catch {
    showNotification({ content: 'copyFailed', type: 'alert-error' })
  }
}

// 二维码:扫节点链接或订阅链接
const qrTarget = ref<'share' | 'subscribe'>('share')
const qrDataUrl = ref('')
watch(
  [shareLink, subscribeUrl, qrTarget],
  async ([link, sub, target]) => {
    const text = target === 'subscribe' ? sub : link
    if (!text) {
      qrDataUrl.value = ''
      return
    }
    try {
      qrDataUrl.value = await QRCode.toDataURL(text, { margin: 1, width: 352 })
    } catch {
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

const submit = () => {
  const name = form.name.trim()
  if (!name) {
    error.value = t('serverErrName')
    return
  }
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) {
    error.value = t('serverErrPort')
    return
  }
  if (props.usedPorts.includes(form.port)) {
    error.value = t('serverErrPortUsed', { port: form.port })
    return
  }
  const out: OpenboxServer = {
    id: form.id,
    enabled: form.enabled !== false,
    name,
    protocol: form.protocol,
    port: form.port,
    address: (form.address || '').trim(),
    scheme: form.scheme === 'https' ? 'https' : 'http',
  }
  if (form.protocol === 'shadowsocks') {
    out.method = form.method || 'aes-256-gcm'
    out.password = (form.password || '').trim()
  }
  if (form.protocol === 'vless') {
    out.uuid = (form.uuid || '').trim()
    out.tls = form.tls !== false
  }
  if (form.protocol === 'tuic') {
    out.uuid = (form.uuid || '').trim()
    out.password = (form.password || '').trim()
  }
  if (form.protocol === 'hysteria2') {
    out.password = (form.password || '').trim()
    if ((form.obfs || '').trim()) out.obfs = (form.obfs || '').trim()
  }
  if ((out.password !== undefined && !out.password) || (out.uuid !== undefined && !out.uuid)) {
    error.value = t('serverErrCredential')
    return
  }
  emit('saved', out)
  isOpen.value = false
}
</script>
