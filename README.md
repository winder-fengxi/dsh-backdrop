# dsh-backdrop

**中文** | [English](README.en.md)

给 DeepSeek Harness 的 Web 界面加背景图：一张整体壁纸，左侧边栏 / 主内容区 / 右侧边栏还可以各用一张。

## 功能

- **整体背景** —— 一张壁纸铺满整个界面。
- **分区背景** —— 左侧边栏、主内容区、右侧边栏各可指定一张图；不指定的分区透出整体背景。
- **图片效果** —— 不透明度、显示方式、对齐位置、模糊、变暗，以及亮度 / 对比度 / 饱和度。
- **多图轮播** —— 按 30 秒到 1 小时轮换，可随机顺序。
- **界面图标** —— 用当前图片替换浏览器标签页图标。

图片保存在浏览器 IndexedDB 中，不上传，也不写入宿主磁盘。所有设置项都从图片本身的角度描述，
例如「图片不透明度」指这张图显示得多清楚。

## 安装

```powershell
dsh plugin --profile web add dsh-backdrop
```

桌面端将 `web` 换成 `desktop`。安装后重启应用并刷新页面。

本地开发可直接链接源码目录：

```powershell
dsh plugin --profile web add link:<本仓库绝对路径>
```

## 使用

**设置 → `dsh-backdrop（背景）`**

| 分组 | 控件 |
|---|---|
| 图片库 | 点击或拖入添加图片，可多选；超过 2560px 的图片会先缩放。点缩略图设为整体背景，点 × 删除 |
| 整体背景 | 启用 · 图片不透明度 · 显示方式 · 对齐位置 · 模糊 · 变暗 · 更多效果 · 轮播 · 随机顺序 · 用作界面图标 |
| 分区背景 | 左侧边栏 / 主内容区 / 右侧边栏 各一张卡片，字段与整体一致，可选「跟随整体背景」或单独指定图片 |

**显示方式**：填充 / 适应 / 拉伸 / 平铺 / 居中。
**对齐位置**：九宫格。
**更多效果**（默认折叠）：亮度 / 对比度 / 饱和度，默认 100%，不调整时不会写入 CSS `filter`。

分区卡片右上角显示识别结果，例如 `已识别 260×1400`；显示`未识别到该分区`表示该分区当前不可见
（例如右侧栏未打开），打开后会自动重新识别。

## 配置

配置由宿主半边保存，按优先级有两种存储方式，对浏览器是同一个接口：

1. **官方设置层** —— 经 `ctx.settings.update()` 合并进 profile patch（`cordis.patch.yml`）中本插件
   那一行的 `config:`：

   ```yaml
   - id: dsh-backdrop
     name: dsh-backdrop
     config:
       enabled: true
       imgOpacity: 30
       regions:
         sidebar: { on: true }
   ```

2. **独立文件** —— 运行时未提供设置服务时，保存至 `$DSH_HOME/dsh-backdrop/config.json`。

两种方式都是普通文件，可直接编辑或备份。

## 实现说明

**分区定位。** DSH 的类名是 CSS Modules 哈希，布局样式由各包在运行时注入，没有稳定的选择器。
应用外壳是横向的整高列布局，因此 `measureRegions()` 直接量几何：从 `#root` 向下查找一组占满视口
高度、宽度之和覆盖视口的兄弟节点，取覆盖最宽且层级最浅的一组作为外壳，再按 x 排序得到左 / 中 / 右。
窗口尺寸变化或侧栏开合时重新测量；测量失败时分区层整体不显示，全部使用整体背景。

**图片效果。** 亮度、对比度、饱和度直接作用于图层 `filter`；分区图层只包含图片与遮罩，不影响文字。
模糊分两种实现：整体层为全屏图层，直接使用 `blur()`；分区层的模糊会溢出矩形边界，因此在图片载入时
用 canvas 预先烘焙进 data URL。变暗通过遮罩层的 `opacity` 控制强度。

## 开发

```powershell
node tools/smoke-client.cjs     # 在 DOM / React / IndexedDB 桩件上运行 apply() 与设置面板
npm run build:release           # 生成 release/，工作树不干净时拒绝执行
```

宿主半边引用了 `@deepseek-ai/schemastery`。以 `link:` 方式安装时，裸模块名从插件自身目录解析，
需要建立一个本地垫片（已在 `.gitignore` 中）：

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

## 发布

工作树是开发副本，保持 `"private": true`，并由 `prepublishOnly` 钩子阻止直接发布。发布使用暂存副本：

```powershell
npm run build:release
npm publish release
```

`tools/build-release.mjs` 只复制 manifest 中声明的内容，仅在暂存副本中移除 `private`，并要求工作树
处于已提交状态。

## 许可

[MIT](LICENSE)
