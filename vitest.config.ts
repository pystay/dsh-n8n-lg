import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑本插件自己的测试，避免扫到 third_party/ 里的第三方用例。
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'third_party/**', 'lib/**', 'docs/**'],
    environment: 'node',
    // 单进程，避免在受限环境下开一堆 worker。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
})
