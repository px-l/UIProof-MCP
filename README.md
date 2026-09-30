# UIProof

**高保真图片 + 页面 URL + 固定视口 → 稳定截图 → 差异标注 → 结构化问题 → HTML 报告 → MCP。**

UIProof 是独立运行的视觉验收工具，面向产品经理、前端开发和 AI 编码客户端。先用 CLI 验证一张设计图，再让 MCP 客户端读取局部证据、定位代码、修复后复验。工作台和业务仓库无需引入本项目源代码。

当前版本：`0.1.0`，本地 stdio MCP。尚未发布 npm 包；支持独立服务器的 SSH stdio 部署，见 [部署说明](docs/deployment.md)。

## 快速体验

需要 Node.js 22+（推荐 24）和 Chromium。

```bash
npm ci
npx playwright install chromium
npm run build
npm run demo
```

演示会启动一个临时本地页面，创建两个参考状态，故意制造“缺失卡片、错误数字、按钮颜色错误”，输出失败报告，再恢复页面并输出通过报告。报告位于终端打印的 `.uiproof/<run-id>/index.html`。演示基准用于测试工具，不代表用户已批准的产品设计。

## CLI 验收自己的页面

在独立的验收工作目录内准备批准过的 `design.png`，图片必须与视口像素尺寸一致（DPR 固定为 1）。新增 `uiproof.json`：

```json
{
  "url": "http://127.0.0.1:3000",
  "viewport": { "width": 1440, "height": 900 },
  "readySelector": "[data-testid=page-ready]",
  "maxDiffRatio": 0.001,
  "states": [{ "name": "default", "baseline": "design.png" }]
}
```

将 `readySelector` 改成实际存在、表示数据已就绪的元素；不需要时删除。

```bash
node /absolute/path/UIProof-MCP/dist/cli.js run --root /absolute/path/acceptance --config uiproof.json
```

输出 JSON 和报告路径。退出码：`0` 通过，`1` 超出差异预算，`2` 配置、采集或证据生成错误。CI 应保留退出码。任何状态报错时整个运行标记为 `error`。

配置与图片路径必须位于 `--root` 内；图片路径相对配置文件。输出固定保存到该根目录的 `.uiproof/`。不会执行任意配置脚本，也不会自动调整设计图尺寸或更新基准。

## MCP 接入

构建后，在支持 stdio MCP 的客户端中添加以下服务（替换两个绝对路径）：

```json
{
  "mcpServers": {
    "UIProof": {
      "command": "node",
      "args": [
        "/absolute/path/UIProof-MCP/dist/mcp.js",
        "--root",
        "/absolute/path/acceptance"
      ]
    }
  }
}
```

| 工具                   | 用途                                           |
| ---------------------- | ---------------------------------------------- |
| `uiproof_verify_image` | 接收已批准图片与上下文，启动远端验收           |
| `uiproof_report`       | 获取图片内嵌的可下载 HTML 报告                 |
| `uiproof_run`          | 读取配置启动验收，立即返回 `jobId`             |
| `uiproof_status`       | 查询任务；完成后获得 `runId` 或导入/分析结果   |
| `uiproof_runs`         | 列出持久化运行记录，支持服务重启后找回         |
| `uiproof_result`       | 获取状态、环境、报告路径和复验结果             |
| `uiproof_issues`       | 分页读取差异区域、附近 DOM 元素和 Figma 节点   |
| `uiproof_evidence`     | 返回问题的 expected / actual / diff PNG 局部图 |
| `uiproof_analyze`      | 显式启用后，启动多模态分析任务                 |
| `uiproof_import_figma` | 启动 Figma 设计快照导入任务                    |
| `uiproof_recheck`      | 使用原运行的基准快照与规则，启动修复复验       |

`uiproof_repair` 是 MCP Prompt，指导编码客户端依据证据修改已获授权的业务仓库，再用相同 `runId` 复验。服务本身不写业务代码，不执行任意 shell，不提交 Git。

所有耗时操作都是后台任务，同一进程一次只执行一个。`job.status=complete` 只表示任务结束，**仍需检查运行的 `passed/failed/error`**。任务状态保留在进程内（最多 100 条），完整运行结果保存在磁盘；中断的任务不会自动恢复。

## 多状态和低误报设置

```json
{
  "url": "http://127.0.0.1:3000",
  "viewport": { "width": 1440, "height": 900 },
  "locale": "zh-CN",
  "timezoneId": "Asia/Shanghai",
  "colorScheme": "light",
  "timeoutMs": 30000,
  "threshold": 0.1,
  "maxDiffRatio": 0.001,
  "includeAA": false,
  "alignment": { "x": 0, "y": 0 },
  "masks": [{ "x": 1200, "y": 20, "width": 160, "height": 30 }],
  "states": [
    { "name": "default", "baseline": "designs/default.png" },
    {
      "name": "dialog",
      "baseline": "designs/dialog.png",
      "steps": [
        { "action": "click", "selector": "#create" },
        { "action": "waitFor", "selector": "[role=dialog]" }
      ]
    }
  ]
}
```

支持 `click`、`fill`、`hover`、`waitFor`，每个状态使用独立浏览器上下文。最多 30 个状态；每个状态都需对应设计基准。不同视口使用不同配置文件。

- `threshold` 控制单像素颜色差异敏感度；`maxDiffRatio` 控制整体可接受差异比例。小于预算的差异仍会列成 warning。
- `includeAA=false` 忽略 pixelmatch 检测到的抗锯齿差异。跨系统字体可能仍有明显差异，请统一操作系统、浏览器和字体。
- `alignment` 是显式整数平移：正 x/y 将实际截图向右/下移动，最大 ±64px。暴露的边缘仍计入失败，避免裁掉问题。没有自动拉伸、旋转或“自动对齐后通过”。
- 蒙版使用设计坐标，同时作用于稳定检查和像素比较，从分子及分母剔除。禁止覆盖整个视口。蒙版是忽略规则，**不是隐私脱敏**，原始图和模型输入仍保留这些内容。
- 页面加载、字体和图片就绪后，关闭动画/过渡，连续三帧一致才接受截图。使用不同采样间隔降低周期动画的混叠；这仍是有限观察窗口，业务异步数据应通过 `readySelector` 保证就绪。

## 多模态分析

支持 OpenAI Chat Completions 图片输入格式及兼容端点，用于缺失内容、文本、布局、颜色和字体的辅助解释。核心 CLI/MCP 不需要模型密钥。

```bash
export UIPROOF_ALLOW_REMOTE_ANALYSIS=true
export UIPROOF_VISION_ENDPOINT=https://api.openai.com/v1/chat/completions
export UIPROOF_VISION_MODEL=YOUR_VISION_MODEL
export UIPROOF_VISION_API_KEY=YOUR_API_KEY
node dist/cli.js analyze RUN_ID --root /absolute/path/acceptance
```

模型需支持图片、JSON object 输出及 `max_completion_tokens` 参数；兼容端点支持范围由提供方决定。HTTP 仅允许 localhost，远程端点要求 HTTPS。密钥从环境变量读取，不写入报告。默认禁用；显式启用会将**完整原型、页面图片、附近 DOM 和设计节点**发给该端点。

模型返回分类、说明、置信度、坐标和修复建议；结构及坐标必须通过校验。结果标记 `needsHumanReview=true`，不能覆盖像素门禁。外部失败不会写入半份分析。模型可能漏报或误判，人工验收仍必要。

## Figma 导入

```bash
export FIGMA_ACCESS_TOKEN=YOUR_TOKEN
node dist/cli.js figma FILE_KEY 12:34 --root /absolute/path/acceptance
```

Token 需要相应文件的 `file_content:read` 权限。可通过 `--version VERSION_ID` 选择版本。工具读取指定节点树，锁定同一版本导出 1× PNG，保存节点文本、名称、相对坐标及图片 SHA-256。凭据不会传给图片 CDN。

把返回的 `baseline`、`designMetadata` 和 `viewport` 放入根目录中的验收配置；如果配置放在子目录，需要相应调整相对路径。`designMetadata` 可选，提供时会校验它确实对应这张基准图，并把关联节点附到差异证据中。模型还会读取设计文本以辅助判断缺失内容。Figma 导入不会自动替换已批准基准。

## 修复闭环与 CI

```bash
# 编码客户端在已授权的业务仓库完成修改及自身检查后
UIPROOF_REVISION=your-current-commit node dist/cli.js recheck RUN_ID --root /absolute/path/acceptance
```

复验使用原运行保存的设计图片和元数据，并校验快照哈希。报告列出差异比例变化、旧区域是否仍有不同像素、新增区域及采集环境变化；空间关联不等于语义上的同一个问题。可通过 `UIPROOF_REVISION` 记录业务提交，GitHub Actions 默认使用 `GITHUB_SHA`。

本仓库的 GitHub Actions 会运行格式、类型、单元/浏览器/MCP 测试、构建及演示，并上传演示报告。业务仓库接入方式见 [CI 文档](docs/ci.md)。不包含部署、自动改基准或自动合并。

## 开发与验证

```bash
npm run check
npm run demo
```

[技术设计](docs/architecture.md) · [验收标准](docs/acceptance.md) · [配置样例](examples/uiproof.example.json) · [MCP 配置样例](examples/mcp.example.json)

真实浏览器验证不需要外部账号；Figma 与多模态适配器有模拟协议测试，真实账号/模型联调需要自行提供凭据。当前仅支持 Chromium、固定视口、普通页面 DOM；不提供完整移动设备模拟、跨浏览器矩阵、登录态导入、跨 iframe/shadow DOM 深度定位、自动源代码修复或长期任务队列。

## 参考

- [Playwright screenshot testing](https://playwright.dev/docs/test-snapshots)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [pixelmatch](https://github.com/mapbox/pixelmatch)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)
- [OpenAI 图片输入文档](https://developers.openai.com/api/docs/guides/images-vision)
- [Figma file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
