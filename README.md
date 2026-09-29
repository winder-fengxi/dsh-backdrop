# dsh-backdrop

**中文** | [English](README.en.md)

给 DeepSeek Harness 的 Web 界面加背景图：一张整体壁纸，左侧边栏 / 主内容区 / 右侧边栏还可以各用一张，
分别设置不透明度、显示方式、对齐位置与效果。

所有设置都从**图片的视角**描述 —— 滑块调的是「这张图显示成什么样」，不是「面板有多透明」。
图片只存在浏览器本地（IndexedDB），不上传、不写宿主磁盘。

## 安装

```powershell
dsh plugin --profile web add dsh-backdrop
```

桌面端把 `web` 换成 `desktop`。装完重启对应的应用，再刷新页面。

本地开发时可以直接链到源码目录：

```powershell
dsh plugin --profile web add link:<本仓库绝对路径>
```

## 使用

**设置 → `dsh-backdrop（背景）`**

| 分组 | 控件 |
|---|---|
| 图片库 | 点击或拖入添加图片（可多选，大图自动降到 2560px 以内）；点缩略图设为整体背景，右上角 × 删除 |
| 整体背景 | 启用 · 图片不透明度 · 显示方式 · 对齐位置 · 模糊 · 变暗 · 更多效果 · 轮播 · 随机顺序 · 用作界面图标 |
| 分区背景 | 左侧边栏 / 主内容区 / 右侧边栏 各一张卡片，字段与整体一致，外加「跟随整体背景 / 单独指定」 |

- **显示方式**：填充 / 适应 / 拉伸 / 平铺 / 居中。
- **对齐位置**：九宫格。
- **更多效果**（默认折叠）：亮度 / 对比度 / 饱和度，默认 100%，不动就不写入 `filter`。
- 分区卡片右上角显示识别结果，例如 `已识别 260×1400`；显示`未识别到该分区`表示该分区当前不可见
  （比如右侧栏没打开），打开后会自动重新识别。

## 配置

配置由宿主半边托管，按优先级两条路，对浏览器是**同一个接口**：

1. **官方设置层** —— `ctx.settings.update()` 把改动合并进 profile patch
   （`cordis.patch.yml`）里本插件那一行的 `config:`：

   ```yaml
   - id: dsh-backdrop
     name: dsh-backdrop
     config:
       enabled: true
       imgOpacity: 30
       regions:
         sidebar: { on: true }
   ```

2. **退路独立文件** —— 运行时没有设置服务时，落在 `$DSH_HOME/dsh-backdrop/config.json`。

配置是普通文件，可读、可手改、可备份。

## 说明

**分区怎么定位。** DSH 的类名是 CSS Modules 哈希，布局 CSS 还是运行时注入的字符串，没有稳定选择器可用。
应用外壳是横向的整高列布局，所以直接量几何：从 `#root` 往下找「一组占满视口高度、宽度加起来覆盖视口」
的兄弟节点，取覆盖最宽、层级最浅的那组当外壳，再按 x 排序得到左 / 中 / 右。矩形随窗口尺寸与侧栏开合
自动重算；量不到就整块不显示，全部退回整体背景。

**效果怎么实现。** 亮度 / 对比度 / 饱和度直接下 `filter`（分区层里只有图和遮罩，没有文字）。模糊分两种：
整体层全屏可以直接 `blur()`；分区层不行（会糊出边界），改成入图时用 canvas 预烤进 data URL。变暗是
一层黑色遮罩的 `opacity`。

**为什么背景不会闪。** 三条踩过的坑：布局重算只刷分区、不重画壁纸；同一张图绝不重做交叉淡入；预模糊
没烤好时沿用上一次真正显示过的图。

## 开发

```powershell
node tools/smoke-client.cjs     # 用 DOM / React / IndexedDB 桩件跑一遍 apply() 与设置面板
npm run build:release           # 产出 release/（脏工作树上会拒绝执行）
```

宿主半边 import 了 `@deepseek-ai/schemastery`。`link:` 安装在插件自己的目录里解析裸模块名，所以需要
一个本地垫片（已在 `.gitignore` 中）：

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

## 发布

工作树是**开发副本**，永远 `"private": true`，并且有两道锁防止误发（npm 直接拒绝 + `prepublishOnly`
钩子）。发布走单独的暂存目录：

```powershell
npm run build:release
npm publish release
```

`tools/build-release.mjs` 只拷贝 manifest 声明的文件、只在暂存副本里去掉 `private`，并且**脏工作树上
拒绝执行** —— 上到 registry 的永远是一个 commit。

## 许可

[MIT](LICENSE)
