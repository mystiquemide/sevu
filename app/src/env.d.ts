/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}
interface Window {
  ethereum?: Eip1193
}
