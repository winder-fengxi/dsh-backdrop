# dsh-backdrop

[中文](README.md) | **English**

Background images for the DeepSeek Harness web UI: one overall wallpaper, plus an optional image for the
left sidebar, the main area and the right sidebar — each with its own opacity, display mode, alignment and
effects.

Every setting is phrased from the **image's** point of view: the sliders describe how the picture looks, not
how transparent the panels are. Images stay in the browser (IndexedDB) — nothing is uploaded and nothing is
written to the host.

## Install

```powershell
dsh plugin --profile web add dsh-backdrop
```

Use `desktop` instead of `web` for the Desktop app. Restart the app afterwards, then reload the page.

While developing, link the checkout directly:

```powershell
dsh plugin --profile web add link:<absolute-path-to-this-repository>
```

## Usage

**Settings → `dsh-backdrop (background)`**

| Group | Controls |
|---|---|
| Library | Click or drop images (multiple allowed; large ones are scaled to 2560px). Click a thumbnail to make it the overall background, click × to delete |
| Overall background | Enable · image opacity · display mode · alignment · blur · darken · more effects · carousel · shuffle · use as app icon |
| Section backgrounds | One card each for left sidebar / main area / right sidebar, same fields plus "follow the overall image" or "pick its own" |

- **Display mode**: fill / fit / stretch / tile / center.
- **Alignment**: a 3×3 grid.
- **More effects** (collapsed by default): brightness / contrast / saturation, 100% leaves `filter` untouched.
- Each section card shows what it detected, e.g. `detected 260×1400`. `section not detected` means that
  section is not currently visible (the right sidebar is closed, say); it is re-detected automatically.

## Configuration

The host half owns the configuration. There are two stores, in order of preference, and the browser sees a
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

2. **A standalone file** — when the runtime exposes no settings service, the configuration lands in
   `$DSH_HOME/dsh-backdrop/config.json`.

Either way it is a plain file: readable, hand-editable, easy to back up.

## How it works

**Sections are measured, not selected.** DSH's class names are CSS Modules hashes and the layout CSS is
injected at runtime as strings, so there is no stable selector. The app shell is a horizontal full-height
column layout, so the plugin measures it: starting at `#root`, it looks for siblings that each span the
viewport height and whose widths together cover the viewport, takes the widest and shallowest set as the
shell, and sorts it by x into left / centre / right. Rectangles are re-measured as the window resizes or
sidebars open and close; when nothing can be measured the section layer stays off and everything falls back
to the overall background.

**Effects.** Brightness, contrast and saturation go straight into `filter` — a section layer holds only the
image and a scrim, never text. Blur is different: the overall layer is full-screen so it can take `blur()`
directly, but a section layer would bleed past its rectangle, so blur is baked into the image with a canvas
on load. Darken is a black scrim whose `opacity` carries the strength.

**Why it does not flicker.** Three bugs worth not reintroducing: layout re-measurement refreshes sections
only and never repaints the wallpaper; the same image never cross-fades again; and a pending pre-blur falls
back to the last image that was actually shown.

## Development

```powershell
node tools/smoke-client.cjs     # runs apply() and the settings panel against DOM/React/IndexedDB stubs
npm run build:release           # writes release/ (refuses on a dirty working tree)
```

The host half imports `@deepseek-ai/schemastery`. A `link:`-installed plugin resolves bare specifiers from
its own directory, so it needs a local shim (gitignored):

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

## Publishing

The working tree is the **development copy**: it stays `"private": true` and two independent locks keep it
from being published by accident (npm refuses outright, and a `prepublishOnly` hook fails with the correct
path). Publishing goes through a staged copy:

```powershell
npm run build:release
npm publish release
```

`tools/build-release.mjs` copies exactly the files the manifest declares, drops `private` in the staged copy
only, and refuses to run unless the working tree is a clean commit — so what reaches the registry is always
exactly a commit.

## License

[MIT](LICENSE)
