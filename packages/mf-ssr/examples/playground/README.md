# mf-ssr playground

A real-browser, real-Node harness for `mf-ssr`. It runs the full SSR pipeline —
not jsdom with a mocked `fetch` — so it exercises the parts unit tests can't:

- **`createMFReactFragment` on the Node runtime.** The `/fragment` endpoint is a
  real `createMFReactFragment` handler. If the server boots and serves it, the
  Web Streams (`renderToReadableStream`) path works on Node — the exact thing
  that used to throw `Named export 'renderToReadableStream' not found`.
- **`MFBridgeSSR` url mode server render.** The host page server-renders
  `MFBridgeSSR`, which fetches the fragment during SSR and inlines its HTML.
- **`hydrateWithBridge` + prop streaming.** The client hydrates the fragment and
  the host streams a new `label` prop over a `DOMEventBus`.

## Run

Build the packages first (the server imports `dist/`), then start the server:

```bash
npm run build --workspace @mf-toolkit/mf-bridge
npm run build --workspace @mf-toolkit/mf-ssr
npm run playground --workspace @mf-toolkit/mf-ssr
```

Open http://localhost:5200.

## What to check

1. The remote fragment appears server-rendered (view source: `data-mf-app`
   contains the widget HTML, `data-mf-props` holds the serialized props).
2. Type into the remote input and bump its **internal clicks** counter.
3. Click **Stream new props to remote**.

The streamed `label` updates, but the typed text and the click counter survive —
prop streaming is a re-render of the hydrated remote, not a remount.

## Note

This is a plain-React SSR host (no RSC framework), so the host tree itself is not
re-hydrated — only the remote fragment is (`hydrateWithBridge`), and the host
prop-streaming island drives the `DOMEventBus` directly. In a real app the host
uses `MFBridgeHydrated` for that. The goal here is to exercise the mf-ssr
server + fragment + hydration path end to end.
