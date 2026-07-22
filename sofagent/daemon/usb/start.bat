@echo off
rem ============================================================
rem sofagent U 盘启动脚本（Windows · 双击 start.bat）
rem v1.1.9 加固
rem
rem 与 start.command / start.sh 同逻辑——调 U 盘自带 Node 便携版
rem 启动 daemon（USB 便携模式）：验签 → 内存解密 knowledge/ →
rem 便携化 env → 联邦在线。零残留：不写 %USERPROFILE%\.sofagent。
rem ============================================================

setlocal
cd /d "%~dp0"
set "USB_ROOT=%CD%"
set "NODE_BIN=%USB_ROOT%\runtime\node.exe"
set "CLI_JS=%USB_ROOT%\sofagent\daemon\dist\cli.js"

if not exist "%NODE_BIN%" (
  echo ❌ 未找到 Node 便携版：%NODE_BIN%
  echo    请确认 U 盘由 sofagent-daemon create-usb-key 写入且平台为 Windows。
  pause
  exit /b 1
)

if not exist "%CLI_JS%" (
  echo ❌ 未找到 sofagent daemon：%CLI_JS%
  echo    U 盘内容可能不完整（验签会 fail-closed 拒绝启动）。
  pause
  exit /b 1
)

echo sofagent U 盘运行时 — 启动中（USB 根：%USB_ROOT%）
echo 停止：Ctrl+C 或关闭本窗口；拔盘前请先停止。
echo.

"%NODE_BIN%" "%CLI_JS%" start --usb-root "%USB_ROOT%"
if errorlevel 1 pause
endlocal
