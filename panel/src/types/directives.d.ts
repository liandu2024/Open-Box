import type { Directive } from 'vue'

declare module 'vue' {
  interface GlobalDirectives {
    vTip: Directive<HTMLElement, string | undefined>
  }
}

export {}
