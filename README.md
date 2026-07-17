# pi-base

个人 Pi Coding Agent 配置包。该仓库集中维护自定义扩展、skills、prompt templates 与 themes。

## 目录

```text
pi-base/
├── extensions/
│   ├── agent-duration/              # TUI 底栏显示 Agent 执行耗时
│   ├── kitty-tab-status/            # 以标题标记显示 Pi 状态的 Kitty 标签页状态
│   └── openai-codex-fast-minimal/   # OpenAI Codex Fast 自定义 provider
├── skills/
├── prompts/
└── themes/
```

## 安装

以本地 Pi Package 安装：

```bash
pi install /Users/zhoushitie/My/pi-base
```

Pi 在 `~/.pi/agent/settings.json` 中记录该本地路径，不复制仓库文件。更新扩展、skills、prompts 或 themes 后，重启 Pi 或在会话中执行 `/reload`。

## 开发

- 扩展入口由 `package.json` 的 `pi.extensions` 清单注册。
- 运行时由 Pi 提供 `@earendil-works/pi-coding-agent`。
- 认证信息和 Pi 的全局运行时设置留在 `~/.pi/agent/`，不要提交到此仓库。
