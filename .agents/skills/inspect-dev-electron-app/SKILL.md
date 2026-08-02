---
name: inspect-dev-electron-app
description: Use when asked to query the running Soxial app, inspect or navigate its DOM, click or fill controls, verify UI state, or take Electron screenshots through the local CDP endpoint.
---

# Query Soxial

The Soxial development app exposes Chrome DevTools Protocol at:

```text
http://127.0.0.1:9229
```

Use any available CDP-capable tooling to inspect the DOM, interact with the renderer, or take screenshots. The endpoint exists only in development and is bound to localhost.
