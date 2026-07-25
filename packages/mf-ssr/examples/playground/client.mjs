import { hydrateWithBridge } from '@mf-toolkit/mf-bridge/hydrate'
import { DOMEventBus } from '@mf-toolkit/mf-bridge'
import { RemoteWidget } from './remote-widget.mjs'

// Hydrate the server-rendered fragment: makes the input + counter interactive
// and subscribes to `propsChanged` events streamed by the host.
hydrateWithBridge(RemoteWidget, { namespace: 'checkout' })

// Host prop-streaming island. In a real app this is the host client component
// (MFBridgeHydrated); here we drive the same DOMEventBus directly so the demo
// stays a single bundle.
const wrapper = document.querySelector('[data-mf-namespace="checkout"]')
const bus = new DOMEventBus(wrapper, 'checkout')

let v = window.__V || 1
const btn = document.getElementById('stream-btn')
const count = document.getElementById('stream-count')
btn.addEventListener('click', () => {
  v++
  bus.send('propsChanged', { label: `v${v}` })
  count.textContent = `prop updates streamed: ${v - 1}`
})
