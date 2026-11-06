import { expect, mock, test } from 'claude-code/testing'

test('a session starts with cockpit tools and commands while the cost read and git still hang', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/me' })
  const tools: string[] = []
  const commands: string[] = []
  on('tool.register', (_, e) => {
    tools.push(e.name)
    return { value: { tool: e.name } }
  })
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.exists', () => ({ value: false }))
  on('session.usage', () => new Promise(() => undefined))
  on('process.run', () => new Promise(() => undefined))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  let outcome: unknown = 'still starting'
  void $.session.start({ cwd: '/repos/api/src', surface: 'terminal', isInteractive: true }).then(result => (outcome = result))
  await clock.settle()

  expect(outcome).toEqual({ cwd: '/repos/api/src' })
  expect(tools.sort()).toEqual(['cockpit_changes', 'cockpit_health', 'cockpit_read', 'cockpit_search', 'report_step', 'show'])
  expect(commands.sort()).toEqual(['cockpit', 'todo'])
})

const HOME = '/home/me'
const API = `${HOME}/code/api`
const WEB = `${HOME}/code/web`
const ran = (exitCode: number, stdout = '') => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

test('a checkout a tool moved the session to outlives the slower lookup of the folder it started in', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.config/cockpit/config.json')) return { value: JSON.stringify({ reposDir: '~/code', tickets: { enabled: false } }) }
    throw new Error('ENOENT')
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => {
    if ([API, `${API}/src`, WEB, `${WEB}/src`].includes(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  let answerApi = () => undefined as void
  const apiAnswered = new Promise<void>(resolve => (answerApi = resolve))
  on('process.run', async (_, e) => {
    if (e.argv[0] !== 'git') return { value: ran(1) }
    const dir = e.argv[e.argv.indexOf('-C') + 1] ?? ''
    const top = [API, WEB].find(t => dir === t || dir.startsWith(`${t}/`))
    if (!top) return { value: ran(128) }
    if (top === API) await apiAnswered
    if (e.argv.includes('--show-toplevel')) return { value: ran(0, `${top}\n`) }
    if (e.argv.includes('get-url')) return { value: ran(0, `git@github.com:acme/${top.split('/').pop()}.git\n`) }
    return { value: ran(0, 'feat\n') }
  })
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => new Promise(() => undefined))
  on('tool.call', () => ({ result: {} }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let checkout: unknown = null
  on('state.set', ($, e, next) => {
    if (e.key === 'work') checkout = e.value
    return next(e)
  })

  void $.session.start({ cwd: `${API}/src`, surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: `${WEB}/src/x.ts` })
  answerApi()
  await clock.settle()

  expect(checkout).toEqual({ repo: 'web', dir: WEB })
})
