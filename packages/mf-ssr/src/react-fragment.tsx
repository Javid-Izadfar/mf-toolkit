import { createElement, type ComponentType } from 'react'
// Import the Web Streams build explicitly. The bare `react-dom/server` specifier
// resolves to the CommonJS Node build under Node's `node` export condition, and
// that build does NOT export `renderToReadableStream` — so `createMFReactFragment`
// throws a "Named export not found" SyntaxError at import time on Node runtimes
// (including Next.js Route Handlers on the default Node runtime). The `.browser`
// build exposes the Web Streams API and runs on any runtime with a global
// `ReadableStream`: Node 18+, Deno, Bun, Cloudflare Workers, and other edges.
import { renderToReadableStream } from 'react-dom/server.browser'
import type { MFFragmentHandler } from './types.js'
import { safeJsonStringify } from './utils.js'

export interface CreateMFReactFragmentOpts {
  id?: string
  /**
   * Value for the `Cache-Control` response header.
   * Default: `'no-store'` — safe for authenticated / personalised fragments.
   * Set to e.g. `'public, s-maxage=60, stale-while-revalidate=30'` for
   * public, cacheable fragments served from a CDN.
   */
  cacheControl?: string
  /**
   * Value for the `Vary` response header.
   * Omitted by default. Typical value when caching public fragments:
   * `'Accept-Language'` or `'Accept-Encoding'`.
   */
  vary?: string
  /**
   * Called when the fragment cannot be produced. Fires for:
   * - a malformed `?props=` query (the fragment still renders with empty props),
   * - a component throw during the shell render (a `500` response is returned),
   * - an error thrown *after* the shell has flushed, inside a streamed Suspense
   *   boundary (the already-sent shell cannot become a 500, but the error is no
   *   longer swallowed).
   *
   * Use for error observability (Sentry, DataDog, etc.).
   */
  onError?: (error: Error) => void
}

export function createMFReactFragment<P extends object>(
  Component: ComponentType<P>,
  opts?: CreateMFReactFragmentOpts,
): MFFragmentHandler {
  const fragmentId = opts?.id ?? Component.displayName ?? Component.name ?? 'mf'
  const cacheControl = opts?.cacheControl ?? 'no-store'

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const rawProps = url.searchParams.get('props')
    let props: P = {} as P
    if (rawProps) {
      try {
        props = JSON.parse(decodeURIComponent(rawProps))
      } catch (err) {
        opts?.onError?.(
          new Error(
            `createMFReactFragment: failed to parse ?props= for "${fragmentId}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
      }
    }

    const safeJson = safeJsonStringify(props)

    function FragmentShell() {
      return createElement(
        'div',
        { 'data-mf-ssr': fragmentId },
        createElement('script', {
          type: 'application/json',
          'data-mf-props': true,
          dangerouslySetInnerHTML: { __html: safeJson },
        }),
        createElement('div', { 'data-mf-app': true },
          createElement(Component, props),
        ),
      )
    }

    try {
      const stream = await renderToReadableStream(createElement(FragmentShell), {
        // Fires for the shell error (which also rejects the await below and
        // becomes a 500) AND for errors thrown after the shell flushed inside a
        // streamed Suspense boundary — those never reject, so without this they
        // were silently swallowed. Reporting here covers both; the catch block
        // only maps a shell failure to a 500 and does not double-report.
        onError(error) {
          opts?.onError?.(error instanceof Error ? error : new Error(String(error)))
        },
      })
      const headers: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': cacheControl,
      }
      if (opts?.vary) headers['Vary'] = opts.vary
      return new Response(stream, { headers })
    } catch {
      // Shell render threw before the first flush — already reported via the
      // onError option above. Return a 500 instead of letting the handler's
      // promise reject (which would crash the remote's request handler or leak
      // a stack trace to the client).
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
  }
}
