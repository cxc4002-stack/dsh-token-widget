// Verification harness: exercises the shipped artifacts the way DSH does.
//
// 1. Discovery   — read package.json, apply the same rules the client-modules
//                  scan applies (dsh.client.platform, exports["./client"], dsh.bundle.patch).
// 2. Host half   — import lib/index.js, register the projection into a fake
//                  sessionProjections registry, replay events, assert the fold.
// 3. Client half — evaluate client.js against a minimal __ModuleLoader__ with a
//                  stub React, then mount the component and assert rendered text.

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const failures = []
function check(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL  ${name}\n        ${error.message}`)
  }
}

console.log(`\n== 1. discovery contract (${pkg.name}@${pkg.version}) ==`)

check('package name is a published name, not a @local placeholder', () => {
  assert.ok(!pkg.name.startsWith('@local/'), `name is still a placeholder: ${pkg.name}`)
  assert.equal(pkg.private, undefined, 'private:true blocks publishing')
})

check('dsh.client declares web platform', () => {
  assert.equal(pkg.dsh?.client?.platform, 'web')
})

check('exports["./client"] is present (the scan throws without it)', () => {
  assert.equal(typeof pkg.exports?.['./client'], 'string')
})

check('dsh.bundle.patch points at a file that exists', () => {
  const patch = pkg.dsh?.bundle?.patch
  assert.ok(patch, 'dsh.bundle.patch is missing')
  const text = readFileSync(join(root, patch), 'utf8')
  assert.match(text, /name:\s*dsh-token-widget/, 'patch does not insert this package')
})

check('files[] covers every runtime entry point', () => {
  const files = pkg.files ?? []
  for (const needed of ['client.js', 'lib/index.js', 'cordis.patch.yml']) {
    assert.ok(files.includes(needed), `files[] omits ${needed}`)
  }
})

check('zod is a real dependency (the host half imports it)', () => {
  assert.ok(pkg.dependencies?.zod, 'zod missing from dependencies')
})

check('dsh.client.inject names the package that declares shell.overlay', () => {
  const inject = pkg.dsh?.client?.inject ?? []
  assert.ok(
    inject.includes('@deepseek-ai/dsh-client-ui-layout'),
    'shell.overlay is declared by ui-layout; the edge must name it',
  )
  for (const name of inject) {
    assert.ok(
      !name.includes('client-runtime'),
      `${name} is not installed anywhere; a row edge to it is unresolvable`,
    )
  }
})

console.log('\n== 2. host half: projection registration and fold ==')

const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)

check('exports an apply() function', () => {
  assert.equal(typeof host.apply, 'function')
})

const registered = []
const projectionCtx = {
  sessionProjections: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
}
const injected = []
host.apply({
  inject(services, fn) {
    injected.push(...services)
    fn(projectionCtx)
  },
})

check('injects sessionProjections and registers exactly one projection', () => {
  assert.deepEqual(injected, ['sessionProjections'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].key, 'tokenUsageBySource')
})

const definition = registered[0]
const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
})

function replay(events) {
  let state = definition.init()
  for (const event of events) state = definition.apply(state, event)
  return state
}

const header = (provider, model) => ({
  type: 'request/header',
  data: { header: { config: { provider, model } } },
})
const chunkUsage = (turn, step, u) => ({
  type: 'assistant/chunk',
  data: { turn, step, chunk: { type: 'usage', usage: u } },
})
const message = (turn, step, u) => ({
  type: 'assistant/message',
  data: { turn, step, usage: u },
})

check('accumulates usage per provider/model source', () => {
  const state = replay([
    header('buddy', 'deepseek-v4.1-flash'),
    chunkUsage(0, 0, usage(100, 20)),
    message(0, 0, usage(100, 20)),
    message(1, 0, usage(300, 50, 10, 5)),
  ])
  assert.deepEqual(state.bySource['buddy/deepseek-v4.1-flash'], {
    uncachedInputTokens: 400,
    outputTokens: 70,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
  })
})

check('same turn/step resample replaces instead of double counting', () => {
  const state = replay([
    header('p', 'm'),
    chunkUsage(0, 0, usage(100, 20)),
    message(0, 0, usage(100, 20)),
  ])
  assert.equal(state.bySource['p/m'].uncachedInputTokens, 100, 'input was double counted')
  assert.equal(state.bySource['p/m'].outputTokens, 20, 'output was double counted')
})

check('usage with no known provider is ignored', () => {
  const state = replay([chunkUsage(0, 0, usage(100, 20))])
  assert.deepEqual(state.bySource, {})
})

check('provider is tracked from request/context too', () => {
  const state = replay([
    { type: 'request/context', data: { provider: 'other', model: 'x' } },
    message(0, 0, usage(7, 3)),
  ])
  assert.deepEqual(state.bySource['other/x'], {
    uncachedInputTokens: 7,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  })
})

check('wire view exposes { sources } and matches state', () => {
  const state = replay([header('p', 'm'), message(0, 0, usage(1, 2))])
  const view = definition.wire.view(state)
  assert.deepEqual(Object.keys(view), ['sources'])
  assert.deepEqual(view.sources, state.bySource)
})

console.log('\n== 3. client half: bundle registration and render ==')

const loaderRegistrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      loaderRegistrations.push(registration)
    },
  },
}

const clientSource = readFileSync(join(root, 'client.js'), 'utf8')
// Evaluate as a classic script: client.js is a bundle, not an ES module.
new Function(clientSource)()

check('bundle registers exactly one module through __ModuleLoader__.load', () => {
  assert.equal(loaderRegistrations.length, 1)
})

const registration = loaderRegistrations[0]

check('registered module id equals the package name (loader cross-checks this)', () => {
  assert.equal(
    registration.id,
    pkg.name,
    `bundle registers "${registration.id}" but the manifest says "${pkg.name}"; `
      + 'the client module system rejects this as "loaded without registering"',
  )
})

// Minimal React stub: createElement keeps the tree inspectable.
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [initial, () => {}],
  useMemo: (fn) => fn(),
}
const moduleExports = registration.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require("${name}")`)
})

check('client half exports apply and inject', () => {
  assert.equal(typeof moduleExports.apply, 'function')
  assert.ok(Array.isArray(moduleExports.inject))
})

const slotRegistrations = []
const opened = []
moduleExports.apply({
  slots: {
    inject(name, fn) {
      slotRegistrations.push({ declared: name, install: fn })
    },
    register(options, Component) {
      slotRegistrations.push({ registered: options, Component })
      return () => {}
    },
  },
  sessions: {
    open(id) {
      opened.push(id)
      return () => {}
    },
  },
})

check('registers into the declared shell.overlay slot', () => {
  const install = slotRegistrations.find((entry) => entry.declared)
  assert.ok(install, 'apply never called slots.inject')
  assert.equal(install.declared, 'shell.overlay', 'floating overlays belong in shell.overlay')
  install.install()
  const registrationEntry = slotRegistrations.find((entry) => entry.registered)
  assert.ok(registrationEntry, 'slots.inject callback did not register anything')
  assert.equal(registrationEntry.registered.name, 'shell.overlay')
  assert.equal(registrationEntry.registered.id, 'token-widget')
})

const Component = slotRegistrations.find((entry) => entry.Component).Component

check('renderer is a component function', () => {
  assert.equal(typeof Component, 'function')
})

const sampleSessions = {
  byId: {
    a: {
      id: 'a',
      displayTitle: '主会话',
      running: true,
      projectionValues: {
        tokenUsageBySource: {
          sources: {
            'buddy/deepseek-v4.1-flash': {
              uncachedInputTokens: 1000,
              outputTokens: 500,
              cacheReadTokens: 2000,
              cacheWriteTokens: 0,
            },
          },
        },
        tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
        sessionStats: { turns: 3, steps: 9 },
        contextPressure: { projectedTokens: 50000, contextWindow: 100000 },
      },
    },
    b: { id: 'b', displayTitle: '子会话', origin: 'subagent', projectionValues: {} },
    blank: { id: 'blank', blank: true, projectionValues: {} },
  },
  ids: ['a', 'blank', 'b'],
  current: 'a',
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}

const tree = Component({
  useSessions: (selector) => selector(sampleSessions),
  openSession: (id) => opened.push(id),
})
const rendered = textOf(tree)

check('blank sessions are filtered out of the list', () => {
  assert.ok(!rendered.includes('blank'), 'a blank session leaked into the widget')
})

check('totals sum billed input and output across sessions', () => {
  // billed input = 1000 uncached + 2000 cache read; output = 500 -> 3500
  assert.ok(rendered.includes('3.5K'), `total 3.5K missing from render: ${rendered}`)
})

check('per-session metadata renders', () => {
  assert.ok(rendered.includes('运行中'), 'running state missing')
  assert.ok(rendered.includes('9 步 / 3 轮'), 'step/turn counts missing')
  assert.ok(rendered.includes('50%'), 'context percentage missing')
  assert.ok(rendered.includes('主会话'), 'session title missing')
})

check('subagent sessions are marked', () => {
  assert.ok(rendered.includes('↳'), 'subagent marker missing')
})

check('per-source chips render the provider/model key', () => {
  assert.ok(rendered.includes('buddy/deepseek-v4.1-flash'), 'source key missing from render')
})

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('All checks passed.')
