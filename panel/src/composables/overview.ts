import { ref } from 'vue'

type IPInfo = {
  ip: string[]
  ipWithPrivacy: string[]
}

export const ipForChina = ref<IPInfo>({
  ip: [],
  ipWithPrivacy: [],
})
export const ipForGlobal = ref<IPInfo>({
  ip: [],
  ipWithPrivacy: [],
})

export const baiduLatency = ref('')
export const githubLatency = ref('')
export const youtubeLatency = ref('')
export const cloudflareLatency = ref('')
