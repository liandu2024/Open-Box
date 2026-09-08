<template>
  <!-- 新建 / 编辑一台共享网络的服务器。字段按协议切换:SS 有加密方式和密码,VLESS 有 UUID
       和 TLS 开关,TUIC 有 UUID + 密码,Hysteria2 有密码 + 可选混淆,SOCKS5 / HTTP(mixed)
       有可选的用户名 + 密码。凭据都能一键生成。 -->
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
        <!-- 域名/IP:默认取当前打开面板的主机名,只进节点分享链接 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium">{{ $t('serverAddressLabel') }}</label>
          <input
            v-model="form.address"
            type="text"
            class="input input-sm w-full"
            :placeholder="$t('serverAddressPlaceholder')"
            autocomplete="off"
          />
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

        <!-- SOCKS5 / HTTP 的认证是可选的:用户名密码一起填或一起留空 -->
        <div
          v-if="form.protocol === 'mixed'"
          class="flex flex-col gap-1"
        >
          <label class="text-xs font-medium">{{ $t('serverUsernameLabel') }}</label>
          <input
            v-model="form.username"
            type="text"
            class="input input-sm w-full font-mono"
            :placeholder="$t('serverAuthOptional')"
            autocomplete="off"
          />
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
              :placeholder="form.protocol === 'mixed' ? $t('serverAuthOptional') : ''"
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

      <p class="text-base-content/60 text-xs">{{ $t(needsTls ? 'serverTlsHint' : form.protocol === 'mixed' ? 'serverMixedHint' : 'serverPlainHint') }}</p>

      <!-- 分享链接(节点 URI)+ 二维码,填了域名/IP 才有 -->
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
      <img
        v-if="qrDataUrl"
        :src="qrDataUrl"
        class="h-44 w-44 rounded-lg bg-white p-1"
        alt="QR"
      />

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
          :disabled="checking"
          @click="submit"
        >
          <span
            v-if="checking"
            class="loading loading-spinner loading-xs"
          />
          {{ $t('save') }}
        </button>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import { checkServerPort, type OpenboxServer, type OpenboxServerProtocol } from '@/api/openbox'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import { copyText as copyToClipboard } from '@/helper/clipboard'
import { showNotification } from '@/helper/notification'
import {
  buildShareLink,
  defaultHost,
  randomPassword,
  randomServerId,
  randomSs2022Key,
  randomUuid,
} from '@/helper/shareLink'
import { ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/vue/24/outline'
import QRCode from 'qrcode'
import { computed, reactive, ref, watch } from 'vue'

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

const PROTOCOLS: { value: OpenboxServerProtocol; label: string }[] = [
  { value: 'shadowsocks', label: 'Shadowsocks' },
  { value: 'vless', label: 'VLESS' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'hysteria2', label: 'Hysteria2' },
  { value: 'mixed', label: 'SOCKS5 / HTTP' },
]
const SS_METHODS = ['aes-256-gcm', 'aes-128-gcm', 'chacha20-ietf-poly1305', '2022-blake3-aes-256-gcm']
// mixed 用 7080:Nikki / OpenClash 用户习惯的那个口(GitHub #7)
const DEFAULT_PORT: Record<OpenboxServerProtocol, number> = { shadowsocks: 8388, vless: 8443, tuic: 8444, hysteria2: 8445, mixed: 7080 }

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
  address: defaultHost(),
  password: randomPassword(),
  method: 'aes-256-gcm',
  uuid: randomUuid(),
  tls: true,
  obfs: '',
  username: '',
})

const form = reactive<OpenboxServer>(blank())
const checking = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(form, blank(), props.server ? { ...props.server } : {})
    // 老记录没填过地址的,也按当前页面补上默认值
    if (!form.address) form.address = defaultHost()
    // mixed 的认证默认留空(不认证),不要把 blank() 里随机生成的密码带进去
    if (form.protocol === 'mixed') {
      form.username = props.server?.username || ''
      form.password = props.server?.password || ''
    }
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
  if (form.protocol === 'mixed') {
    // 切到 SOCKS5 / HTTP:认证默认关(密码留空),要认证再自己填
    form.username = ''
    form.password = ''
    return
  }
  if (form.protocol === 'shadowsocks' && !form.method) form.method = 'aes-256-gcm'
  if (!form.password) form.password = newPassword()
  if (!form.uuid) form.uuid = randomUuid()
}

const shareLink = computed(() => buildShareLink(form))

const copyText = async (text: string) => {
  if (!text) return
  const ok = await copyToClipboard(text)
  showNotification(ok ? { content: 'copySuccess', type: 'alert-success' } : { content: 'copyFailed', type: 'alert-error' })
}

// 节点链接的二维码
const qrDataUrl = ref('')
watch(
  shareLink,
  async (link) => {
    if (!link) {
      qrDataUrl.value = ''
      return
    }
    try {
      qrDataUrl.value = await QRCode.toDataURL(link, { margin: 1, width: 352 })
    } catch {
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

// 校验失败一律右上角提示(全局统一),不在弹窗里放红字
const fail = (content: string, params?: Record<string, string>) => {
  showNotification({ content, params, type: 'alert-error' })
}

const submit = async () => {
  if (checking.value) return
  const name = form.name.trim()
  if (!name) return fail('serverErrName')
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) return fail('serverErrPort')
  if (props.usedPorts.includes(form.port)) return fail('serverErrPortUsed', { port: String(form.port) })

  const out: OpenboxServer = {
    id: form.id,
    enabled: form.enabled !== false,
    name,
    protocol: form.protocol,
    port: form.port,
    address: (form.address || '').trim(),
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
  if (form.protocol === 'mixed') {
    const username = (form.username || '').trim()
    const password = (form.password || '').trim()
    if (Boolean(username) !== Boolean(password)) return fail('serverErrMixedAuth')
    if (username) {
      out.username = username
      out.password = password
    }
  }
  if ((out.password !== undefined && !out.password) || (out.uuid !== undefined && !out.uuid)) return fail('serverErrCredential')

  // 保存前问后端:端口有没有被面板/内核自用、被别的服务器占、被路由器上其它服务监听
  checking.value = true
  try {
    const r = await checkServerPort(out.port, out.id)
    if (!r.ok) {
      if (r.reason === 'reserved') return fail('serverPortReserved', { port: String(out.port) })
      if (r.reason === 'server') return fail('serverErrPortUsed', { port: String(out.port) })
      if (r.reason === 'listening') return fail('serverPortListening', { port: String(out.port) })
      return fail('serverErrPort')
    }
  } catch (e) {
    return fail('serverPortCheckFailed', { message: e instanceof Error ? e.message : String(e) })
  } finally {
    checking.value = false
  }
  emit('saved', out)
  isOpen.value = false
}
</script>
