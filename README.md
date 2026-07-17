# pi-base

一个 Pi Coding Agent 全局扩展，用于在每次 Agent 执行结束后，在 TUI 底栏显示最近一次执行耗时。

## 功能

- 监听 `agent_start` 和 `agent_end` 生命周期事件。
- 仅在交互式 TUI 模式下记录和显示耗时。
- 在底栏显示：`最近 Agent: 1.2s`。

## 安装

将仓库克隆到 Pi 的全局扩展目录：

```bash
git clone git@github.com:zhouatie/pi-base.git ~/.pi/agent/extensions/pi-base
```

Pi 会自动发现该目录中的 `index.ts`。已运行的 Pi 会话可使用 `/reload` 重新加载扩展。

## 开发

无需构建步骤；Pi 通过 jiti 直接加载 TypeScript：

```bash
pi -e ./index.ts
```

## 项目结构

```text
.
├── index.ts      # 扩展入口
├── package.json  # Pi 扩展元数据
└── README.md
```

## 依赖

运行时由 Pi 提供 `@earendil-works/pi-coding-agent`，本项目将其声明为 peer dependency。
