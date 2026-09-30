# CI 与业务仓库接入

本仓库 `.github/workflows/ci.yml` 运行代码质量检查、真实浏览器/MCP 测试和演示。演示明确验证“故意改错→失败、还原→通过”，上传的只是合成示例页面。

在业务仓库接入时，把 UIProof 放在独立工具目录，固定已审核的 UIProof 提交；依次安装并构建工具、启动业务测试服务、运行验收，最后无论成功失败都上传 `.uiproof`。基准需由设计/产品负责人审核并随版本管理，不要在 CI 中用当前页面重新生成批准基准。

示例步骤（在业务仓库现有 job 中添加，业务构建和启动步骤使用该项目自己的命令）：

```yaml
- uses: actions/checkout@v7
- uses: actions/setup-node@v7
  with:
    node-version: 24
- name: Checkout approved UIProof version
  uses: actions/checkout@v7
  with:
    repository: px-l/UIProof-MCP
    ref: YOUR_REVIEWED_UIPROOF_COMMIT
    path: .tools/uiproof
    persist-credentials: false
- name: Prepare UIProof
  working-directory: .tools/uiproof
  run: |
    npm ci
    npx playwright install --with-deps chromium
    npm run build
# 在这里按业务仓库约定构建、启动本地服务并等待健康检查成功。
- name: Visual acceptance
  run: node .tools/uiproof/dist/cli.js run --root "$GITHUB_WORKSPACE" --config uiproof.json
- name: Upload evidence
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: uiproof-evidence
    path: .uiproof/
    include-hidden-files: true
    retention-days: 7
```

这是接入示例，需要填写已审核的提交、业务启动命令、配置和基准，不会自动修改任何业务仓库。私有 UIProof 仓库的跨仓库 checkout 还需要恰当的只读凭据。

保持 CLI 原始退出码，不使用 `continue-on-error` 放行差异。正式环境应固定 OS/浏览器/字体；不要把跨系统抗锯齿差异直接当作业务回归。仅上传经过确认可共享的截图，正式页面可能含有客户数据。

MCP 修复循环：`run → status → issues/evidence → 客户端改业务代码 → 业务检查 → recheck → status/result`。UIProof 记录和验证证据，客户端负责在授权范围内改代码，人工负责批准基准和最终合并。
