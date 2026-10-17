import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑本插件自己的测试，避免扫到 third_party/ 里的第三方用例。
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'third_party/**', 'lib/**', 'docs/**'],
    environment: 'node',
    // 单进程，避免在受限环境下开一堆 worker。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: ['src/**/*.ts'],
      // 浏览器端代码（src/client/*.js）会被 build-client 打包成 lib/client.js，
      // client-hud 测试跑的是打包产物，源码行号对不上 —— 计进来只会得到假数字。
      // types.ts 只有 interface，没有运行时代码。
      exclude: ['src/client/**', 'src/n8n/types.ts']
    }
  }
})
