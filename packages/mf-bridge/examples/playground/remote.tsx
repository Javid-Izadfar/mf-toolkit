import { createElement, useState } from 'react'
import { createMFEntry } from '../../src/index.js'

/**
 * A remote component that OWNS internal state the host never streams as props:
 *   - an uncontrolled <input> (typed text + caret + focus)
 *   - a click counter held in useState
 *
 * The host only streams `label`. If a prop update tears the subtree down and
 * remounts it, the typed text, the focus, and the counter all reset — that was
 * the bug. With the fix a prop update is a plain re-render, so all three survive.
 */
function RemoteWidget({ label }: { label: string }) {
  const [clicks, setClicks] = useState(0)

  return createElement(
    'div',
    { className: 'remote' },
    createElement('h3', null, 'Remote microfrontend'),
    createElement(
      'div',
      { className: 'row' },
      createElement('span', null, 'Streamed prop '),
      createElement('code', { 'data-testid': 'remote-label' }, `label = "${label}"`),
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement('span', null, 'Uncontrolled input:'),
      createElement('input', {
        'data-testid': 'remote-input',
        placeholder: 'type something…',
        autoFocus: true,
      }),
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement(
        'button',
        { 'data-testid': 'remote-clicks', onClick: () => setClicks((c) => c + 1) },
        `internal clicks: ${clicks}`,
      ),
    ),
  )
}

export const register = createMFEntry(RemoteWidget)
