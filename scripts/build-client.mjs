/**
 * dsh-n8n-lg 客户端 bundle 构建。
 *
 * 把 src/client/*.js（普通脚本，零依赖，挂到 globalThis.__DSH_N8N_HUD__）拼成
 * DSH 浏览器模块加载器期望的单个 bundle：lib/client.js。
 *
 * 用法：node scripts/build-client.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const pkg = JSON.parse(read('package.json'))

// 拼接顺序有语义：store（数据/接口）→ ui（视图与交互，含 apply/inject/name）。
const SOURCES = ['src/client/store.js', 'src/client/ui.js']

const banner = `/*
 * ${pkg.name} v${pkg.version} — browser bundle (glass HUD).
 * GENERATED FILE: built by scripts/build-client.mjs from ${SOURCES.join(', ')}.
 * Do not edit directly; edit src/client/ and re-run \`npm run build\`.
 */
window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`

const footer = `
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\texports.name = name;
\t\treturn module.exports;
\t}
});
`

const body = SOURCES.map((rel) => `\n/* ==== ${rel} ==== */\n${read(rel)}\n;`).join('\n')

const out = banner + body + footer
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), out, 'utf8')

console.log(`[dsh-n8n-lg] built lib/client.js — ${out.length} bytes from ${SOURCES.length} sources`)
