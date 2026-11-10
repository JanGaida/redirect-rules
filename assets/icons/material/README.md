# Material Icons — Source & License Notice

All SVG files in this directory are **Material Symbols (Outlined)** icons taken
from <https://fonts.google.com/icons>. Glyph paths are used unmodified; files
fetched in their raw Material Symbols form are normalized to this set's file
format (24dp viewBox, source fill `#e3e3e3`).

## License

Material Symbols are developed by Google and released under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

> Copyright 2024 Google LLC
> Licensed under the Apache License, Version 2.0.

No brand names, no Google wordmarks — glyphs only.

## File naming convention

`<name>_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`

| Fragment  | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `<name>`  | Material Symbols glyph id (e.g. `content_copy`)                     |
| `24dp`    | 24dp design size                                                    |
| `E3E3E3`  | `fill="#e3e3e3"` (Google download default color — render UNCHANGED) |
| `FILL0`   | Outline variant (unfilled)                                          |
| `wght400` | Weight 400                                                          |
| `GRAD0`   | Grade 0                                                             |
| `opsz24`  | Optical size 24                                                     |

## Inventory

| File name fragment        | Used for                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `add`                     | Add-site / add-rule ghost-accent buttons                                                  |
| `add_link`                | Rule kind `appendQuery` segment option                                                    |
| `auto_fix_high`           | Site-gate escape toggle (magic wand)                                                      |
| `autorenew`               | Header refresh button                                                                     |
| `balance`                 | About tab: GPL-3.0 license icon                                                           |
| `bolt`                    | Autosave speed — fast (pill, badge, settings option)                                      |
| `brightness_auto`         | Theme Auto (rail pill, settings option, hero badge)                                       |
| `bug_report`              | About tab: Create issue button; log level Debug                                           |
| `build`                   | System tab: Advanced card icon                                                            |
| `chat_info`               | About tab: changelog card icon                                                            |
| `check`                   | Selected stacked ChoiceGroup option                                                       |
| `close`                   | Close (header) + chat popover close                                                       |
| `content_copy`            | Clone rule / site group (explorer rows)                                                   |
| `dark_mode`               | Theme Dark (rail pill, settings option, hero badge)                                       |
| `dashboard`               | System tab: Appearance card icon                                                          |
| `database`                | Reserved for a future data-management card (currently unused)                             |
| `delete`                  | Delete rule / site group (explorer rows)                                                  |
| `developer_guide`         | Rules tab icon                                                                            |
| `drag_indicator`          | Row drag grip (explorer + preview reordering)                                             |
| `edit`                    | Caption pencil (site/preview description editor)                                          |
| `error`                   | Log level Error                                                                           |
| `fast_forward`            | Motion Fast (settings option, hero badge)                                                 |
| `find_replace`            | Rule kind `replace` segment option                                                        |
| `flag`                    | Rule kind `checkpoint` segment option                                                     |
| `hourglass_top`           | Autosave speed — slow (pill, badge, settings option)                                      |
| `info`                    | About tab rail icon + details card + RegexManual/TokenReference info icon; log level Info |
| `keyboard_arrow_right`    | Explorer accordion chevron (CSS-rotated when open)                                        |
| `light_mode`              | Theme Light (rail pill, settings option, hero badge)                                      |
| `link`                    | Dashboard host: fixed URL                                                                 |
| `local_fire_department`   | Hotreload dev disclaimer banner (dev-only)                                                |
| `mode_heat`               | HMR dev disclaimer chip (dev-only)                                                        |
| `motion_photos_off`       | Motion Off (settings option, hero badge)                                                  |
| `notifications_off`       | Log level Silent                                                                          |
| `open_in_new`             | About tab: open build commit on GitHub                                                    |
| `play_arrow`              | Motion Normal (settings option, hero badge); checkpoint mode `continue` segment option    |
| `query_stats`             | Stats tab icon                                                                            |
| `settings`                | System tab: General card icon                                                             |
| `settings_backup_restore` | Per-card Reset button                                                                     |
| `slow_motion_video`       | Motion Slow (settings option, hero badge)                                                 |
| `stop_circle`             | Checkpoint mode `stop` segment option                                                     |
| `smart_toy`               | Assistant tab icon (robot)                                                                |
| `tab`                     | Dashboard host: about:blank                                                               |
| `terminal_add`            | DEV dev disclaimer chip (dev-only)                                                        |
| `timer`                   | Autosave speed — normal (pill, badge, settings option)                                    |
| `toggle_off`              | Site group off switch (disabled state)                                                    |
| `toggle_on`               | Site group off switch (enabled state)                                                     |
| `translate`               | Settings tab: Language group legend                                                       |
| `travel_explore`          | Stats tab: sites card icon                                                                |
| `tune`                    | System tab icon (sliders)                                                                 |
| `undo`                    | Header undo button                                                                        |
| `unfold_less`             | Fold-all toggle folded state (chain toolbar)                                              |
| `unfold_more`             | Fold-all toggle unfolded state (chain toolbar)                                            |
| `warning`                 | Log level Warning                                                                         |

The icons are inlined into the built userscript via Vite `?raw` imports
(see `src/lib/gui/icon.ts`) — nothing is fetched at runtime and nothing is
referenced by URL at runtime. The Vite dev console (`index.html`) reuses the same
registry through its `icons` export and its own `.rr-icon` rule. The `#e3e3e3`
fill above is the source value; the generic `.rr-icon svg { fill: currentColor }`
rule overrides it at render time, with scoped accent/danger/faint overrides where
needed.
