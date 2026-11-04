# DSH Qoder CN Bridge

实验性 DSH 模型供应商插件，将本机已登录的 Qoder CN CLI 接入模型选择器。

## 安装

```powershell
$env:DSH_HOME = 'H:\.dsh'
& 'H:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'H:\.dsh\plugins\dsh-qoder-bridge'
```

重启 DSH 后，模型选择器会列出账号当前可用的 Qoder CN 模型。插件启动时调用 CLI 的 `--list-models`，之后每五分钟刷新；所选模型标识直接传入 CLI 的 `--model`。

插件配置提供 executable、configDir、model 三个字段。默认使用 H 盘本次安装的 CLI 和配置目录。旧会话的 `qoder-cn` 标识继续使用配置中的 model 值，但已从选择器隐藏；选择器只列出账号实际模型。

## 登录

```powershell
& 'H:\.dsh\tools\qoder-cn\qoderclicn.exe' --config-dir 'H:\.dsh\tools\qoder-cn\config' login
```

凭证由 Qoder 管理，插件不复制、展示或记录凭证。回环服务使用随机令牌，只监听 127.0.0.1，随插件卸载关闭。

## 工作方式与当前限制

- 每次请求独立调用 CLI，传入 DSH 对话历史，关闭 CLI 内置工具与会话持久化。
- 使用提示协议要求模型生成 JSON，再转成 DSH 的外部工具调用；这不是 Qoder 官方原生函数调用接口，可能出现格式失败，遇到失败会明确报错。
- 兼容 `<tool_call>` 外层包装和对象形式的工具参数。损坏的工具语法会触发最多两次格式重生成；仍不合法时明确失败。工具名称必须在 DSH 本次提供的列表中，未知工具不会转发执行。
- 仅支持文本。图片输入会报错，不会被静默丢弃。
- CLI 生成结束后一次性返回 SSE，暂不支持逐 token 实时输出。
- 对话和工具定义通过 UTF-8 标准输入传递，不占用 Windows 命令行参数长度；仍受请求体 1 MiB 上限及上游上下文容量约束。
- 每次请求最多 180 秒，取消时终止子进程。输出上限 8 MiB，请求上限 1 MiB。
- 暂未接入额度、实际 token 用量和上下文压缩；模型显示的 32768 上下文与 4096 输出是适配器声明，不代表上游承诺。
- 单次生成消耗已登录账号的额度。

## 验证

`node --test` 验证协议校验、外部工具消息、图片拒绝、进程失败、取消及超时。

`verify-host.cjs` 使用本机 DSH Electron/Node 运行时，核对实际宿主模块导入和模型适配器注册。单独运行普通 Node 时，DSH 的宿主依赖可能无法解析。

已完成真实账号的文本请求、长输入以及 HTTP/SSE 结构化工具调用和结果回传测试。`verify-tools.cjs` 可重跑后两项；尚需在 DSH 对话界面验证完整常见工具场景。
