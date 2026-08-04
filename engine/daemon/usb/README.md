# daemon/usb · U 盘便携启动脚本

本目录包含 sofagent U 盘便携模式的启动脚本（Linux / macOS / Windows）。

## ⚠️ 装配说明

这些脚本依赖的运行时文件**不包含在仓库中**，需要由 `sofagent-daemon create-usb-key` 命令在 U 盘上生成完整的便携目录结构：

```
usb/
├── runtime/
│   └── node              ← 便携版 Node.js（由 create-usb-key 下载/链接）
├── engine/
│   └── daemon/
│       └── dist/
│           └── cli.js    ← daemon 编译产物（由 create-usb-key 复制）
├── start.sh              ← Linux 启动脚本
├── start.command          ← macOS 启动脚本
└── start.bat             ← Windows 启动脚本
```

## 使用方式

1. 运行 `sofagent-daemon create-usb-key /path/to/usb` 创建 U 盘便携目录
2. 将 U 盘插入目标机器
3. 根据平台运行对应的启动脚本：
   - Linux: `./start.sh` 或双击
   - macOS: 双击 `start.command`
   - Windows: 双击 `start.bat`

## 贡献者注意

- `runtime/node` 和 `engine/daemon/dist/` 是**运行时生成**的，不会出现在 git 中
- 修改启动脚本逻辑时，三个平台脚本（`.sh` / `.command` / `.bat`）需同步修改
- U 盘便携模式设计为零残留——不写 `~/.sofagent` 或 `~/.openclaw`
