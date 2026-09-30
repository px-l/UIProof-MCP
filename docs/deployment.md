# 独立服务器部署（SSH stdio MCP）

服务代码与镜像只属于 `px-l/UIProof-MCP`。工作台 `native_coder` 仅使用官方 MCP 客户端；不会包含本项目源码或容器配置。

## 运行方式

容器名 `uiproof`，非 root 用户运行，数据位于宿主机 `/var/lib/uiproof/workbench`，只读应用文件系统，限制 CPU/内存/进程数量。容器不监听 HTTP 端口。SSH 认证后运行 `/opt/uiproof/bin/mcp`，该脚本通过 `docker exec -i` 启动独立 stdio MCP 进程。

容器使用 host 网络，是为了访问 SSH 反向隧道在服务器 loopback 上提供的页面。仅接入可信单用户客户端；本方案不是多租户隔离服务。服务器上已有的 SSH 用户凭据与主机信任配置不变，不开放公开 MCP HTTP 接口。

## 安装

在有 Docker 的 Linux 主机，独立检出本仓库：

```sh
docker build -t uiproof:YOUR_RELEASE .
# Debian 源较慢时，可只为构建容器指定镜像，保留包签名校验：
# docker build --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com -t uiproof:YOUR_RELEASE .
sh deploy/start.sh uiproof:YOUR_RELEASE
```

需要下载 Chromium、系统依赖和中文字体，请保证磁盘/网络可用。镜像安装字体只能统一远端环境；原型若依赖客户端专有字体，仍需人工审查字体差异。

脚本拒绝默默替换已存在容器。升级时先构建新镜像，确认没有活跃 MCP 任务，停止并重命名旧容器留作回滚，再使用新镜像运行脚本。持久化数据目录独立保留。

## 客户端

支持 stdio 的 MCP 客户端可配置：

```json
{
  "mcpServers": {
    "UIProof": {
      "command": "ssh",
      "args": [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "aliyun",
        "/opt/uiproof/bin/mcp"
      ]
    }
  }
}
```

该例用于服务器可直接访问的 URL。验收本地工作台页面时，Native Coder 自动为当前配置地址建立 `-R 127.0.0.1:49317:127.0.0.1:<local-port>` 的临时隧道，再调用 `uiproof_verify_image`。SSH 会话结束后隧道关闭。不要关闭 SSH 主机指纹校验，不要把本地预览端口向公网开放。

`uiproof_verify_image` 接收基准图片 base64、URL、视口、就绪选择器和任务/原型/代码树标识，保存独立输入并返回 job ID。`uiproof_result` 返回同一上下文供客户端校验；`uiproof_report` 返回嵌入图片的 HTML。图片输入最多 8MiB base64，报告最多 24MiB，超限明确报错。

这两个工具需要可信已认证调用方；基准输入会被保存。没有多租户授权隔离，同一工作目录的认证客户端可以读取其中已有报告。

## 运行维护

```sh
docker inspect uiproof --format '{{.State.Status}}'
docker exec uiproof node --version
# 通过真实 MCP 握手及 screenshot 验收检查功能，容器 Up 不等于验收功能成功。
```

容器设置自动重启，stdio 服务按 SSH 请求启动。镜像停止不会删除证据。备份 `/var/lib/uiproof`；运行记录含截图与页面内容，按团队保留策略清理，当前不自动删除证据。

多模态默认关闭。此部署不传入模型凭据，不向模型提供方发送设计图片。需要分析时再在容器环境明确配置，并按批准范围调用分析工具。
