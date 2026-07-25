import { createElement, useState } from 'react'

/**
 * The remote microfrontend component. Rendered server-side inside the fragment
 * endpoint (createMFReactFragment) AND hydrated on the client (hydrateWithBridge).
 *
 * It owns state the host never streams as props — an uncontrolled <input> and a
 * click counter. After hydration the host streams a new `label`; the typed text
 * and the counter must survive, proving prop streaming is a re-render, not a
 * remount.
 */
export function RemoteWidget({ label }) {
  const [clicks, setClicks] = useState(0)
  return createElement(
    'div',
    { className: 'remote' },
    createElement('h3', null, 'Remote microfrontend'),
    createElement(
      'div',
      { className: 'row' },
      createElement('span', null, 'streamed prop '),
      createElement('code', { 'data-testid': 'remote-label' }, `label = "${label}"`),
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement('span', null, 'uncontrolled input:'),
      createElement('input', { 'data-testid': 'remote-input', placeholder: 'type something…' }),
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
