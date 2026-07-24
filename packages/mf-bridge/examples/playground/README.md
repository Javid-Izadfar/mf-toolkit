# mf-bridge playground

A tiny, real-browser harness for `mf-bridge` prop streaming. It exists to verify
— in an actual browser with real React and real DOM CustomEvents, not jsdom —
that streaming new props to a remote is a **re-render, not a remount**, so the
remote keeps its internal state.

## Run

```bash
npx vite packages/mf-bridge/examples/playground
```

Then open http://localhost:5199.

## What to check

1. Type into the remote's **uncontrolled input**.
2. Click its **internal clicks** button a few times.
3. Click **Stream new props to remote** in the host.

The streamed `label` updates, but the typed text, the caret/focus, and the click
counter all **stay put**. Before the boundary-key fix in `createMFEntry`, every
prop update remounted the subtree and reset all three to empty / `0`.

The host renders under `<StrictMode>` so the mount/unmount double-invoke path is
exercised too.
