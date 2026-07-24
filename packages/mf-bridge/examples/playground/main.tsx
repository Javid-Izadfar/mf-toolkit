import { createElement, useState, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MFBridge } from '../../src/index.js'
import { register } from './remote.js'

/**
 * Host shell. It streams a single `label` prop to the remote and re-streams a
 * fresh value on every button click. The remote's own state (typed input text,
 * focus, click counter) is never part of `props`, so it can only survive if a
 * prop update is a re-render rather than a remount.
 *
 * Manual test:
 *   1. Type into the remote input and bump its "internal clicks" counter.
 *   2. Click "Stream new props" a few times.
 *   3. The label updates, but your typed text, caret/focus, and click count
 *      all stay put. (Before the fix they reset to empty / 0 on every update.)
 */
function HostApp() {
  const [version, setVersion] = useState(1)

  return createElement(
    'div',
    { className: 'host' },
    createElement('h2', null, 'Host shell'),
    createElement(
      'p',
      { className: 'hint' },
      'Type in the remote input, bump its counter, then stream new props. ' +
        'Internal state must survive the update.',
    ),
    createElement(
      'div',
      { className: 'row' },
      createElement(
        'button',
        {
          'data-testid': 'stream-props',
          onClick: () => setVersion((v) => v + 1),
        },
        'Stream new props to remote',
      ),
      createElement('span', { className: 'hint' }, `prop updates streamed: ${version - 1}`),
    ),
    // A new props object each render → MFBridge streams a propsChanged event.
    createElement(MFBridge, { register, props: { label: `v${version}` } }),
  )
}

createRoot(document.getElementById('root')!).render(
  createElement(StrictMode, null, createElement(HostApp)),
)
