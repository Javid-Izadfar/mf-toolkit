import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToReadableStream } from 'react-dom/server.browser'
import { build } from 'esbuild'
import { createMFReactFragment } from '../../dist/react-fragment.js'
import { MFBridgeSSR } from '../../dist/index.js'
import { RemoteWidget } from './remote-widget.mjs'

const PORT = 5200
const __dirname = dirname(fileURLToPath(import.meta.url))

// Remote fragment endpoint — the exact createMFReactFragment path that used to
// throw "renderToReadableStream not found" on Node. If this server boots and
// serves /fragment, the Node-runtime fix holds.
const fragmentHandler = createMFReactFragment(RemoteWidget, { id: 'checkout' })

const CSS = `
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #e2e8f0; }
  h2, h3 { margin: 0 0 .5rem; }
  button { font: inherit; padding: .4rem .8rem; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #e2e8f0; cursor: pointer; }
  button:hover { background: #334155; }
  input { font: inherit; padding: .35rem .5rem; border-radius: 6px; border: 1px solid #475569; background: #0b1220; color: #e2e8f0; }
  .host { border: 1px dashed #475569; border-radius: 10px; padding: 1rem 1.25rem; max-width: 640px; }
  .remote { margin-top: 1rem; border: 1px solid #38bdf8; border-radius: 10px; padding: 1rem 1.25rem; background: #0b1220; }
  .row { display: flex; gap: .75rem; align-items: center; margin: .5rem 0; }
  .hint { color: #94a3b8; font-size: 13px; }
  code { background: #1e293b; padding: 1px 5px; border-radius: 4px; }
`

function HostShell({ version }) {
  return createElement(
    'div',
    { className: 'host' },
    createElement('h2', null, 'Host shell (server-rendered)'),
    createElement(
      'div',
      { className: 'row' },
      createElement('button', { id: 'stream-btn' }, 'Stream new props to remote'),
      createElement('span', { id: 'stream-count', className: 'hint' }, 'prop updates streamed: 0'),
    ),
    // MFBridgeSSR url mode: fetches the fragment during SSR and inlines it.
    createElement(MFBridgeSSR, {
      url: `http://localhost:${PORT}/fragment`,
      namespace: 'checkout',
      props: { label: `v${version}` },
      fallback: createElement('p', null, 'loading fragment…'),
    }),
  )
}

function HostDoc({ version }) {
  return createElement(
    'html',
    { lang: 'en' },
    createElement(
      'head',
      null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('title', null, 'mf-ssr · playground'),
      createElement('style', { dangerouslySetInnerHTML: { __html: CSS } }),
    ),
    createElement(
      'body',
      null,
      createElement(HostShell, { version }),
      createElement('script', { dangerouslySetInnerHTML: { __html: `window.__V=${version}` } }),
      createElement('script', { type: 'module', src: '/client.js' }),
    ),
  )
}

// Bundle the client once at boot (react + react-dom/client + mf-bridge + widget).
let clientJs = ''
async function buildClient() {
  const res = await build({
    entryPoints: [join(__dirname, 'client.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  clientJs = res.outputFiles[0].text
}

await buildClient()

createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)

  if (u.pathname === '/fragment') {
    const fres = await fragmentHandler(new Request(u.toString()))
    res.writeHead(fres.status, Object.fromEntries(fres.headers))
    Readable.fromWeb(fres.body).pipe(res)
    return
  }

  if (u.pathname === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    res.end(clientJs)
    return
  }

  if (u.pathname === '/') {
    const version = Number(u.searchParams.get('v') || '1')
    try {
      const stream = await renderToReadableStream(createElement(HostDoc, { version }))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.write('<!doctype html>')
      Readable.fromWeb(stream).pipe(res)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`SSR error: ${err?.stack || err}`)
    }
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
}).listen(PORT, () => {
  console.log(`mf-ssr playground → http://localhost:${PORT}`)
})
