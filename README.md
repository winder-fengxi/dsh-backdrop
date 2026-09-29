# dsh-backdrop

Wallpaper and per-section background images for the **DeepSeek Harness** web UI.

One overall background, plus an optional image for the **left sidebar**, the **main
area** and the **right sidebar** — each with its own opacity, display mode, alignment
and effects. Images never leave the browser; settings are a plain, hand-editable file.

---

## 中文说明

给 DeepSeek Harness 的 Web 界面加一层你自己的图片：整体一张壁纸，左侧边栏 / 主内容区 /
右侧边栏还可以各用一张图，并且可以分别调不透明度、显示方式、对齐位置和效果。
所有设置都从**图片的视角**描述 —— 滑块调的是「这张图显示成什么样」，不是「面板有多透明」。

图片只存在浏览器里（IndexedDB），不上传、不写宿主磁盘。

### 安装

```powershell
# 从 npm（发布后）
dsh plugin --profile web add dsh-backdrop

# 本地开发：直接链到源码目录，改完刷新即可
dsh plugin --profile web add link:E:\path\to\dsh-backdrop
```

装完重启 `dsh web`（或桌面端），浏览器 F5。

桌面端（Electron）同样支持：分区靠几何测量定位，不依赖任何类名或协议细节。
> 已知差异：桌面端用自定义协议 `dsh-app://` 提供页面，`webServer.tapIndex()` 那类 HTML
> 改写不会生效 —— 本插件不使用它，所以不受影响。

### 使用

**设置 → `dsh-backdrop（背景）`**：

| 分组 | 控件 |
|---|---|
| 图片库 | 点击 / 拖入添加本地图片（可多选，大图自动降到 2560px 以内）；点缩略图设为整体背景，× 删除 |
| 整体背景 | 启用 · 图片不透明度 · 显示方式 · 对齐位置 · 模糊 · 变暗 · 更多效果 · 轮播 · 随机顺序 · 用作界面图标 |
| 分区背景 | 左侧边栏 / 主内容区 / 右侧边栏 各一张卡片，字段与整体一致，外加「跟随整体背景 / 单独指定」 |

- **显示方式**：填充 / 适应 / 拉伸 / 平铺 / 居中（沿用 Windows 壁纸那套词）。
- **对齐位置**：九宫格。
- **更多效果**（默认折叠）：亮度 / 对比度 / 饱和度，默认 100%，不动就不写入 `filter`。
- 分区卡片右上角会显示识别结果，例如 `已识别 260×1400`；显示`未识别到该分区`说明该分区
  当前不可见（比如右侧栏没打开），打开后会自动重新识别。

### 配置存在哪里

配置**不在浏览器里**（图片才在浏览器的 IndexedDB）。它由宿主半边托管，按优先级两条路：

1. **官方设置层**（首选）：`ctx.settings.update(entryId, patch)` 把改动合并进
   **profile patch（`cordis.patch.yml`）里本插件那一行的 `config:`** —— 可读、可手改、
   可进版本库，平台自己的设置界面也能识别：

   ```yaml
   - id: dsh-backdrop
     name: dsh-backdrop
     config:
       enabled: true
       imgOpacity: 30
       regions:
         sidebar: { on: true }
   ```

2. **退路独立文件**：运行时没有设置服务时，退回 `$DSH_HOME/dsh-backdrop/config.json`。

两条路对浏览器是**同一个接口**（`GET` / `PUT /dsh-backdrop/config.json`），客户端不关心
用的是哪条。

---

## Design notes

### Sections are measured, not selected

DSH's class names are CSS Modules hashes (`._boot_1fywu_3`, `.pI_x6G_frame`) and the layout CSS
is injected at runtime as strings from each package's `lib/client.js`, so there is no stable
selector to hook. The app shell is, however, a horizontal full-height column layout:
`measureRegions()` walks down from `#root` looking for a set of siblings that each span the
viewport height and whose widths together cover the viewport, takes the widest and shallowest
such set as the shell, and sorts it by x into left / centre / right.

Rectangles are re-measured on `resize` and on throttled DOM mutations. If nothing can be
measured the section layer stays off and everything falls back to the overall background.

### Why not design tokens

Each DSH region *is* painted from a `--dsw-*` token, but the centre and right columns have no
background of their own (they show the canvas `bg-base`), so tokens cannot tell them apart and
carry no notion of a "section". Token rebinding is still used for one thing: making panels
translucent so the image behind them shows through — that is what **image opacity** drives
internally.

### Effects

- **Brightness / contrast / saturation** go straight into `filter`. Section layers contain only
  the image and a scrim, never text, so nothing else is affected.
- **Blur** is different: the overall layer is full-screen, so it can take `filter: blur()`
  directly (with the box expanded a little to avoid soft edges). Section layers cannot — the
  blur would bleed past the rectangle — so blur is **baked into the image with a canvas** on
  load and cached per section.
- **Darken** is a black scrim div whose `opacity` carries the strength.

### Why the background does not flicker

Three bugs worth not reintroducing:

1. **Layout re-measurement must not repaint the wallpaper.** A chat UI mutates the DOM
   constantly while streaming; running a full repaint per mutation flips the cross-fade layers
   over and over. DOM mutations now only call `refreshRegions()`, which re-measures rectangles
   and returns immediately when no section is enabled.
2. **The same image must never cross-fade again.** `showImage()` compares the image id first and
   only updates fit/alignment when it has not changed; a real change waits for the new image to
   decode before fading in.
3. **A pending pre-blur falls back to the last URL that was actually shown**, otherwise dragging
   the blur slider pops from sharp to blurred.

### Host APIs used

| Purpose | API |
|---|---|
| Configuration channel | `ctx.webServer.register({ kind, path, handler })` |
| Settings persistence / read-back | `ctx.settings.update()` / `ctx.settings.describe()` |
| Lifecycle | `ctx.effect(fn, label)` |

The host half has **no external dependencies** — it imports `node:` builtins only — and looks the
settings service up with `ctx.get("settings")` rather than declaring it in `inject`, so the
plugin still mounts when the service is absent.

`ctx.storageDomain` is deliberately not used: it is the official durable-storage API, but
`defineDomain` requires zod record schemas and zod's major version differs between runtimes.
Plugin settings are user-editable configuration rather than domain records.

---

## Development

```
node tools/smoke-client.cjs
```

The smoke test loads `lib/client.js` against DOM / React / IndexedDB stubs, lays out a fake
three-column shell (260 / 1000 / 300 at a 1560×900 viewport), runs `apply()`, renders the
settings panel, and asserts that the section layer was built with the right rectangles and
background, that disabled sections stay hidden, and that the panel-transparency tokens and
global style are in place.

## Publishing

Before the first publish, replace the placeholder owner in `package.json`:
`repository.url`, `bugs.url` and `homepage` all contain `OWNER`.

```
npm publish --access public
```

## License

[MIT](LICENSE)
