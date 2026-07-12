# Contributing to XR Search

Thanks for your interest in XR Search — an open-source, AI-powered immersive
(VR/AR/360) web browser, search engine, and advertising platform. Contributions
of all kinds are welcome: bug reports, features, docs, and design.

## Getting Started

```bash
git clone <your-fork-url>
cd "XR SEARCH ENGINE"
npm install
npm run dev
```

`npm run dev` starts the Vite dev server with hot-module reload. Open the printed
local URL in a WebXR-capable browser to try immersive mode.

## Tech Stack

- **Frontend** — [Vite](https://vitejs.dev/) + vanilla JavaScript (ES modules),
  no UI framework.
- **3D / XR** — [Three.js](https://threejs.org/) with WebXR for the immersive
  VR/AR/360 experience.
- **Backend** — [Supabase](https://supabase.com/) (Postgres, auth, storage,
  edge functions).

## Project Structure

```
src/            Application source (ES modules)
  main.js       Entry point
  scene/        Three.js scene, camera, XR session setup
  ui/           2D and in-XR UI components
  search/       Search engine client + result rendering
  ads/          Advertising platform integration
  lib/          Shared helpers (Supabase client, utils)
public/         Static assets served as-is
index.html      Vite HTML entry
```

Exact layout may evolve — browse `src/` to get your bearings before starting.

## Coding Style

- **ES modules only** — use `import` / `export`, no CommonJS.
- **No framework** — keep it vanilla JS. Don't reach for React/Vue/Svelte.
- **Dependency-light** — prefer the standard library and existing dependencies.
  Every new dependency is a cost; justify it in your PR.
- Keep functions small and focused; favor readable code over clever code.
- Match the formatting and naming conventions of the files you touch.

## Building

```bash
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

Please make sure `npm run build` completes cleanly before opening a PR.

## Submitting a Pull Request

1. Fork the repo and create a branch off `main`
   (e.g. `feat/360-video-tiles` or `fix/search-latency`).
2. Make focused commits with clear messages.
3. Verify `npm run build` passes and test your change in the browser.
4. Open a PR describing **what** changed and **why**. Link any related issues.
5. Be responsive to review feedback — we aim to keep the loop quick and friendly.

For large or architectural changes, open an issue first to discuss the approach
before investing significant time.

## License

XR Search is licensed under **AGPL-3.0-only**. By submitting a contribution, you
agree that your work is provided under the same license. See [LICENSE](LICENSE)
for the full text.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it. Report concerns to g@luvlab.io.

Happy hacking — see you in the metaverse.
