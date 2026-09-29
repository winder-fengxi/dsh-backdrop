# dsh-backdrop

**中文** | [English](README.en.md)

给 DeepSeek Harness 的 Web 界面加背景图：一张整体壁纸，左侧边栏 / 主内容区 / 右侧边栏还可以各用一张。

## 功能

- 整体背景：一张壁纸铺满整个界面。
- 分区背景：左侧边栏、主内容区、右侧边栏各可指定一张图，未指定的分区透出整体背景。
- 图片效果：不透明度、显示方式、对齐位置、模糊、变暗、亮度 / 对比度 / 饱和度。
- 多图轮播：30 秒至 1 小时，可随机顺序。
- 界面图标：用当前图片替换浏览器标签页图标。
- 图片存储于浏览器 IndexedDB。

## 安装

```powershell
dsh plugin --profile web add dsh-backdrop
```

桌面端将 `web` 换成 `desktop`。安装后重启应用并刷新页面。

```powershell
# 本地开发
dsh plugin --profile web add link:<本仓库绝对路径>
```

## 使用

**设置 → `dsh-backdrop（背景）`**

| 分组 | 控件 |
|---|---|
| 图片库 | 添加图片（可多选，超过 2560px 先缩放）；点缩略图设为整体背景，点 × 删除 |
| 整体背景 | 启用 · 图片不透明度 · 显示方式 · 对齐位置 · 模糊 · 变暗 · 更多效果 · 轮播 · 随机顺序 · 用作界面图标 |
| 分区背景 | 左侧边栏 / 主内容区 / 右侧边栏 各一张卡片，字段与整体一致，可选跟随整体背景或单独指定图片 |

- 显示方式：填充 / 适应 / 拉伸 / 平铺 / 居中。
- 对齐位置：九宫格。
- 更多效果（默认折叠）：亮度 / 对比度 / 饱和度，默认 100%。
- 分区卡片显示识别结果，如 `已识别 260×1400`；分区不可见时显示 `未识别到该分区`。

## 配置

配置保存在以下两处之一：

1. profile patch（`cordis.patch.yml`）中本插件那一行的 `config:`，经 `ctx.settings.update()` 写入：

   ```yaml
   - id: dsh-backdrop
     name: dsh-backdrop
     config:
       enabled: true
       imgOpacity: 30
       regions:
         sidebar: { on: true }
   ```

2. `$DSH_HOME/dsh-backdrop/config.json`，运行时未提供设置服务时使用。

## 实现说明

**分区定位。** `measureRegions()` 从 `#root` 向下查找一组占满视口高度、宽度之和覆盖视口的兄弟节点，
取覆盖最宽且层级最浅的一组作为应用外壳，按 x 排序得到左 / 中 / 右。窗口尺寸变化或侧栏开合时重新测量。
测量失败时分区层不显示。

**图片效果。** 亮度、对比度、饱和度作用于图层 `filter`，分区图层不含文字。整体层为全屏图层，模糊直接
使用 `blur()`；分区层的模糊在图片载入时用 canvas 烘焙进 data URL，避免溢出矩形边界。变暗由遮罩层的
`opacity` 控制。

## 开发

```powershell
node tools/smoke-client.cjs     # 在 DOM / React / IndexedDB 桩件上运行 apply() 与设置面板
npm run build:release           # 生成 release/，工作树不干净时拒绝执行
```

以 `link:` 安装时需要本地垫片（已在 `.gitignore` 中）：

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

## 发布

工作树保持 `"private": true`，并由 `prepublishOnly` 钩子阻止直接发布。发布使用暂存副本：

```powershell
npm run build:release
npm publish release
```

`tools/build-release.mjs` 复制 manifest 中声明的内容，仅在暂存副本中移除 `private`，并要求工作树已提交。

## 许可

[MIT](LICENSE)
