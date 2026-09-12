// 与 server/engine/test-url.mjs 一致：保留 HTTP / HTTPS 和完整检测地址。
// 随包内核已支持通过 Clash API 使用 HTTP 测速。
export const kernelTestUrl = (raw: string | undefined | null): string => (raw ?? '').trim()
