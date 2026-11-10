# Brand Icons — Source & License Notice

All SVG files in this directory are **brand glyphs** taken from
[Simple Icons](https://simpleicons.org/) via the jsDelivr CDN
(`https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg`),
fetched on **2026-11-04**. Files are normalized to `<svg viewBox="0 0 24 24">`
with a single `<path>`; the source `role`, `<title>` and any `fill` attribute
are removed so the glyph inherits `currentColor`.

## License

Simple Icons is released under the
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
license.

## Trademarks

CC0 covers the **SVG path data**, not the brands themselves. All logos are
trademarks or registered trademarks of their respective owners. They are used
here only to identify the service a link points to (nominative use). Verify
production/redistribution requirements before shipping in a context where
implied endorsement could be read.

## File naming convention

`<slug>.svg`, where `<slug>` is the Simple Icons slug (e.g. `openai.svg`,
`githubcopilot.svg`).

## Inventory

| File                | Service    | Link target                      |
| ------------------- | ---------- | -------------------------------- |
| `openai.svg`        | ChatGPT    | `https://chatgpt.com/`           |
| `claude.svg`        | Claude     | `https://claude.ai/`             |
| `githubcopilot.svg` | Copilot    | `https://copilot.microsoft.com/` |
| `googlegemini.svg`  | Gemini     | `https://gemini.google.com/`     |
| `mistralai.svg`     | Mistral    | `https://chat.mistral.ai/`       |
| `kimi.svg`          | Kimi       | `https://www.kimi.com/`          |
| `deepseek.svg`      | DeepSeek   | `https://chat.deepseek.com/`     |
| `qwen.svg`          | Qwen       | `https://chat.qwen.ai/`          |
| `perplexity.svg`    | Perplexity | `https://www.perplexity.ai/`     |

The icons are inlined into the built userscript via Vite `?raw` imports (see
`src/lib/gui/brand-icons.ts`) — nothing is fetched at runtime and nothing is
referenced by URL at runtime.
