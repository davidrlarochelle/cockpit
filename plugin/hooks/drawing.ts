import { SHOW_TOOL_FULL } from './show'
import { MCP } from './tools'

// Results are drawn with the show tool. A hand-made HTML page opened beside the session, or a claude.ai artifact, is the
// fallback: allowed once show was tried in the turn, when the person asked for that medium, or with a stated reason.

export const DRAWING_SECTION = {
  id: 'cockpit:drawing',
  scope: 'session' as const,
  text: MCP.drawing.map(line => line.replaceAll('{show}', SHOW_TOOL_FULL)).join('\n'),
}

/** What the person's prompt this turn asked for, and whether the show tool ran since. */
export type Turn = { page: boolean; artifact: boolean; shown: boolean }

export const freshTurn = (text = ''): Turn => ({
  page: /\b(html|web ?page|page web|terminal[- ]browser|browser pane)\b/i.test(text),
  artifact: /\b(artifacts?|art[eé]facts?|claude\.ai|shareable|share (it|this|that|the)|publish|publie[rsz]?|partage[rz]?-(la|le|les)|(la|le|les) partager)\b|à partager/i.test(text),
  shown: false,
})

// Origins whose text the person wrote. A notification, a peer or another plugin may still ask, but clears nothing.
const WRITTEN = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'channel', 'slack-ping'])

export type Prompt = { text: string; origin?: { kind: string; name?: string; asUser?: true }; turnId?: string }

const writtenByPerson = ({ origin }: Prompt) =>
  !origin || WRITTEN.has(origin.kind) || (origin.kind === 'plugin' && (origin.asUser === true || origin.name === 'cockpit'))

/** The turn a prompt starts: fresh when the person wrote it, else the last one with what this prompt asks added. */
export const nextTurn = (previous: Turn, prompt: Prompt): Turn => {
  const asked = freshTurn(prompt.text)
  if (writtenByPerson(prompt) && prompt.turnId === undefined) return asked
  return { page: previous.page || asked.page, artifact: previous.artifact || asked.artifact, shown: previous.shown }
}

const FALLBACK = /\bCOCKPIT_SHOW_FALLBACK=("[^"]+"|'[^']+'|\S+)/

/** The local HTML file a Bash command opens beside the session (browse.sh, terminal-browser), if any. */
export function openedPage(command: string): string | undefined {
  for (const part of command.split(/&&|\|\||;|\|/)) {
    if (!/(?:^|[\s/])(?:browse\.sh|terminal-browser)\b/.test(part)) continue
    for (const raw of part.trim().split(/\s+/)) {
      const word = raw.replace(/^['"]|['"]$/g, '')
      if (!/\.html?(?:[?#].*)?$/i.test(word)) continue
      if (/^[a-z][a-z+.-]*:\/\//i.test(word) && !word.toLowerCase().startsWith('file://')) continue
      return word
    }
  }
  return undefined
}

/** The verdict on a Bash call: undefined lets it through, else why it is refused. */
export function pageRefusal(command: string, turn: Turn): string | undefined {
  const page = openedPage(command)
  if (!page || turn.page || turn.shown || FALLBACK.test(command)) return undefined
  return (
    `Draw this with ${SHOW_TOOL_FULL} instead of opening ${page}: stats tiles, line/area/bar/donut charts (stacked, ` +
    'percent, horizontal), tables, flow, Mermaid and sequence diagrams all draw natively beside the session. If no block ' +
    'can draw it, show what it can first, or prefix the command with COCKPIT_SHOW_FALLBACK="<what show cannot draw>".'
  )
}

/** The verdict on an Artifact call: only a publish is held back, as the fallback it is. */
export function artifactRefusal(input: Record<string, unknown>, turn: Turn): string | undefined {
  const action = input.action ?? 'publish'
  if (action !== 'publish' || input.asset === true || turn.artifact || turn.shown) return undefined
  return (
    `Draw results with ${SHOW_TOOL_FULL} in the pane beside the session, not as a claude.ai artifact. Publish one only ` +
    'when the person asks for an artifact or a link to share, or for what no show block can draw, after showing what it can.'
  )
}
