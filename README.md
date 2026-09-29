# dsh-backdrop

给 DeepSeek Harness 的 Web 界面加背景图。

**中文** · [English](README.en.md)

## 功能

- 添加或拖入多张本地图片，随时切换。
- 整体背景之外，左侧边栏、主内容区、右侧边栏可各用一张图。
- 调整图片不透明度、显示方式、对齐位置、模糊、变暗、亮度 / 对比度 / 饱和度。
- 多图轮播，30 秒至 1 小时，可随机顺序。
- 用当前图片替换浏览器标签页图标。
- 图片保存在当前浏览器的 IndexedDB 中，不上传到 DSH 服务端。

## 安装

在 DSH 仓库中执行：

```sh
dsh plugin --profile web add dsh-backdrop
dsh web
```

打开界面左下角 **设置**，选择 **dsh-backdrop（背景）**。

要安装本地开发副本：

```sh
dsh plugin --profile web add "<本仓库绝对路径>"
```

要卸载：

```sh
dsh plugin --profile web remove dsh-backdrop
```

桌面端将 `web` 换成 `desktop`，安装后需重启应用。

## 数据与限制

- 超过 2560px 的图片会先缩放到 2560px 以内再保存。
- 图片保存在当前浏览器的 IndexedDB 中，按浏览器与站点来源隔离。换浏览器、换端口或换访问地址都需要重新添加。
- 清除该站点的浏览器数据会一并删除已保存的图片。
- 配置保存在 profile patch（`cordis.patch.yml`）中本插件那一行的 `config:`：

  ```yaml
  - id: dsh-backdrop
    name: dsh-backdrop
    config:
      enabled: true
      imgOpacity: 30
      regions:
        sidebar: { on: true }
  ```

  运行时未提供设置服务时，改为保存在 `$DSH_HOME/dsh-backdrop/config.json`。

## 从源码构建

要求 Node.js 20.19 或更高版本。

```sh
node tools/smoke-client.cjs
npm run build:release
```

以 `link:` 方式安装时需要本地垫片（已在 `.gitignore` 中）：

```powershell
New-Item -ItemType Junction -Path .\node_modules\@deepseek-ai `
  -Target $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai
```

发布使用 `release/` 暂存副本，需要已提交的工作树：

```sh
npm run build:release
npm publish release
```

## 许可

[MIT](LICENSE)
