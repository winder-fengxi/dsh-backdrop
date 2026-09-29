# dsh-backdrop

Background images for the DeepSeek Harness web UI.

[中文](./README.md) · **English**

## Features

- Upload or drag in multiple local images and switch between them instantly.
- Beyond the overall background, the left sidebar, the main area and the right sidebar can each use their own image.
- Adjust image opacity, display mode, alignment, blur, darken, and brightness / contrast / saturation.
- Carousel between images every 30 seconds to 1 hour, optionally in random order.
- Use the current image as the browser tab icon.
- Keep images in the current browser's IndexedDB. Nothing is uploaded to the DSH server.

## Install

Run the following commands in the DeepSeek Harness repository:

```sh
dsh plugin --profile web add dsh-backdrop
dsh web
```

Open **Settings** in the lower-left corner of the Web interface, then select **dsh-backdrop (background)**.

To install a local development copy instead:

```sh
dsh plugin --profile web add "/absolute/path/to/dsh-backdrop"
```

To uninstall:

```sh
dsh plugin --profile web remove dsh-backdrop
```

For the Desktop app, use `desktop` instead of `web` and restart the app afterwards.

## Data and limitations

- Images wider than 2560px are scaled down to 2560px before being saved.
- Images live in the current browser's IndexedDB and are isolated by browser and site origin. Opening DSH in another browser, on another port or at a remote address means adding them again.
- Clearing the site's browser data also removes the saved images.
- Preferences live in the `config:` block of this plugin's own row in the profile patch (`cordis.patch.yml`):

  ```yaml
  - id: dsh-backdrop
    name: dsh-backdrop
    config:
      enabled: true
      imgOpacity: 30
      regions:
        sidebar: { on: true }
  ```

  When the runtime exposes no settings service, they are written to `$DSH_HOME/dsh-backdrop/config.json` instead.

## Build from source

Requirements: Node.js 20.19 or later.

```sh
node tools/smoke-client.cjs
npm run build:release
```

A `link:` install requires a local shim (gitignored):

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

Publishing uses the staged `release/` copy and requires a committed working tree:

```sh
npm run build:release
npm publish release
```

## License

[MIT](./LICENSE)
