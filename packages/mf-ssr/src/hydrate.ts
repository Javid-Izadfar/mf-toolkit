import { createElement, type ComponentType } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import type { HydrateRemoteOpts } from './types.js'

/**
 * Hydrates every server-rendered fragment matched by the selector.
 *
 * Returns a teardown function that unmounts all roots it created — call it when
 * the fragments are removed from the DOM (client-side route change, dynamic
 * remove) to release React state and listeners. Safe to call in SSR / non-DOM
 * environments: returns a no-op teardown.
 */
export function hydrateRemote<P extends object>(
  Component: ComponentType<P>,
  opts?: HydrateRemoteOpts,
): () => void {
  if (typeof document === 'undefined') return () => {}

  const selector = opts?.selector
    ?? (opts?.id ? `[data-mf-ssr="${opts.id}"]` : '[data-mf-ssr]')

  const wrappers = document.querySelectorAll(selector)
  const roots: Root[] = []

  for (const wrapper of wrappers) {
    const propsEl = wrapper.querySelector('script[data-mf-props]')
    const appEl = wrapper.querySelector('[data-mf-app]')
    if (!appEl) continue

    let props: P = {} as P
    if (propsEl?.textContent) {
      try {
        props = JSON.parse(propsEl.textContent)
      } catch (err) {
        const id = wrapper.getAttribute('data-mf-ssr') ?? ''
        opts?.onError?.(
          new Error(
            `hydrateRemote: failed to parse [data-mf-props]${id ? ` for "${id}"` : ''}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
      }
    }

    roots.push(hydrateRoot(appEl as HTMLElement, createElement(Component, props)))
  }

  return () => {
    for (const root of roots) root.unmount()
  }
}
