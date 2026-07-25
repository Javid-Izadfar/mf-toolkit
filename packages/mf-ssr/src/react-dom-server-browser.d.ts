// @types/react-dom (v18) ships `server.d.ts` — which declares
// `renderToReadableStream` — but no `server.browser.d.ts`. The `.browser`
// runtime entry exposes the same API surface, so re-export the existing server
// types for it. This lets us import the Web Streams build (which actually
// exposes `renderToReadableStream` on Node, unlike the bare `react-dom/server`
// CommonJS node build) with full typings.
declare module 'react-dom/server.browser' {
  export * from 'react-dom/server'
}
