# dsh-backdrop

[中文](README.md) | **English**

Background images for the DeepSeek Harness web UI: one overall wallpaper, plus an optional image for the
left sidebar, the main area and the right sidebar.

## Features

- **Overall background** — one wallpaper across the whole interface.
- **Section backgrounds** — the left sidebar, the main area and the right sidebar can each use their own
  image; a section without one shows the overall background.
- **Image effects** — opacity, display mode, alignment, blur, darken, plus brightness / contrast / saturation.
- **Carousel** — rotate between images every 30 seconds to 1 hour, optionally in random order.
- **App icon** — use the current image as the browser tab icon.

Images are stored in the browser's IndexedDB. Nothing is uploaded and nothing is written to the host.
Every setting is phrased from the image's point of view: "image opacity", for example, describes how visible
the picture is.

## Install

```powershell
dsh plugin --profile web add dsh-backdrop
```

Use `desktop` instead of `web` for the Desktop app. Restart the app afterwards and reload the page.

While developing, link the checkout directly:

```powershell
dsh plugin --profile web add link:<absolute-path-to-this-repository>
```

## Usage

**Settings → `dsh-backdrop (background)`**

| Group | Controls |
|---|---|
| Library | Click or drop images, multiple allowed; anything wider than 2560px is scaled down. Click a thumbnail to make it the overall background, click × to delete |
| Overall background | Enable · image opacity · display mode · alignment · blur · darken · more effects · carousel · shuffle · use as app icon |
| Section backgrounds | One card each for the left sidebar, the main area and the right sidebar; same fields, plus "follow the overall image" or pick a specific one |

**Display mode**: fill / fit / stretch / tile / center.
**Alignment**: a 3×3 grid.
**More effects** (collapsed by default): brightness / contrast / saturation. At 100% no CSS `filter` is
written.

Each section card shows what it detected, for example `detected 260×1400`. `section not detected` means that
section is not currently visible — the right sidebar is closed, say — and it is re-detected automatically.

## Configuration

The host half stores the configuration. There are two stores, in order of preference, and the browser sees a
single interface either way:

1. **The official settings layer** — `ctx.settings.update()` merges changes into this plugin's own row in the
   profile patch (`cordis.patch.yml`):

   ```yaml
   - id: dsh-backdrop
     name: dsh-backdrop
     config:
       enabled: true
       imgOpacity: 30
       regions:
         sidebar: { on: true }
   ```

2. **A standalone file** — when the runtime exposes no settings service, the configuration is written to
   `$DSH_HOME/dsh-backdrop/config.json`.

Either way it is a plain file that can be edited or backed up directly.

## How it works

**Locating sections.** DSH's class names are CSS Modules hashes and the layout styles are injected at runtime
by each package, so no stable selector exists. The app shell is a horizontal full-height column layout, so
`measureRegions()` measures it directly: starting at `#root` it looks for siblings that each span the viewport
height and whose widths together cover the viewport, takes the widest and shallowest set as the shell, and
sorts it by x into left / centre / right. Rectangles are re-measured when the window resizes or sidebars open
and close. When nothing can be measured the section layer stays hidden and the overall background is used
everywhere.

**Image effects.** Brightness, contrast and saturation are applied to the layer's `filter`; a section layer
contains only the image and a scrim, so text is unaffected. Blur has two implementations: the overall layer is
full-screen and uses `blur()` directly, while a section layer would bleed past its rectangle, so its blur is
baked into the data URL with a canvas when the image loads. Darken is driven by a scrim layer's `opacity`.

## Development

```powershell
node tools/smoke-client.cjs     # runs apply() and the settings panel against DOM/React/IndexedDB stubs
npm run build:release           # writes release/; refuses to run on a dirty working tree
```

The host half imports `@deepseek-ai/schemastery`. A `link:`-installed plugin resolves bare specifiers from its
own directory, so a local shim is required (gitignored):

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

## Publishing

The working tree is the development copy. It stays `"private": true`, and a `prepublishOnly` hook blocks
publishing from it. Publishing uses a staged copy:

```powershell
npm run build:release
npm publish release
```

`tools/build-release.mjs` copies only what the manifest declares, removes `private` in the staged copy alone,
and requires a committed working tree.

## License

[MIT](LICENSE)
