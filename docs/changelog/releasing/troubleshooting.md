# 发布链故障排查手册（网络 / 凭证 / 并发 / 产物恢复）

> 从 09-publish 拆分的异常路径处置集——正常发布路径见 [09-publish.md](./09-publish.md)。
> 本手册跨阶段复用：阶段九（push/tag/publish）、阶段十（分发）、阶段十一（收尾）的同类故障均指向此处。

## 🔴 桌面发布物恢复预案（文件消失时）

`gh release create --notes-file` 报 no such file（桌面被清理/iCloud 同步）时，**从 devlog「Release Notes」段重提取重建**：
起于 🎯 定位行、止于「### 文档质量评分」节、滤 `> **形态归属**` 内部标注行——重建后跑工序二自检五查（结构/数字/链接全绝对）再用。
前提纪律：**body 的修正必须同批改 devlog 源**（提取源同步），否则重提取会复活旧错。

## 🔴 网络断连自动重试范式（域名级故障）

github.com 域名级 443 不通而 api.github.com 通道正常时（运营商路由故障特征），挂后台循环：
`nohup bash -c 'for i in $(seq 1 N); do git push … && { 链式下一步; break; }; sleep 600; done'`
要点：①重试间隔 ≥10 分钟（抖动窗分钟级自愈）②成功即链式推进（push→等 CI→tag 三验→tag push→release）③日志落 /tmp 可查进度④**Git Data API 快照推禁用**（压平历史违反审计链）。

## 网络降级策略

### 直连 push 与 HTTP/1.1

> push 常见三连失败：①git config 死代理 → ②直连 443 超时/「HTTP2 framing layer」→ ③HTTP/1.1 + 速度限制后成功。**经验：curl 能通 ≠ git 能通**（git 走 HTTP/2 + 慢连接更脆弱），git 侧强制 HTTP/1.1 + 慢速兜底最稳。

```bash
# 全配置一键直连（git config 代理 + 环境变量代理全剥）：
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 \
  -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 \
  push origin main
```

> curl 探测代理端口存活：`curl -s -o /dev/null -w "%{http_code}" -x http://127.0.0.1:<端口> https://github.com`——200 = 端口可用（但 git 仍可能因 HTTP/2 失败，直接上 HTTP/1.1）。

### 🔴 多 session 并发期禁用 git add -A

发布流水线跨多 session（本 session 收尾 + 其他 session 在途）时，`git add -A` 会把**其他 session 的在途改动**一并吞进本任务 commit（曾一次吞 19 文件含他人 package.json 与 2041 行 lock 删除——审计 A3/A11 警告才暴露，若已 push 将污染远端）。**收编一律逐文件 add**（任务清单内的文件显式列出）；审计 A3「不改越界」警告是最后的拦截线——**警告出现即说明混入了清单外文件，必须 reset 拆分重提，禁止带病 push**。

### 🔴 凭证类 403 的诊断序（push 被拒 ≠ 网络问题）

> 症状：`git push` 报 `remote: Permission to <owner>/<repo>.git denied to <owner>` + `403`，
> 而 `gh api user` 正常、`gh api repos/... --jq .permissions` 显示 `push:true`。
> **注意：API 的 permissions 位反映的是「账号对该仓的能力」，不是「当前 token 的能力」**——拿它当判据必误判。

三步定性（按序做，前一步不能确定才进下一步）：

1. **测 token 的写权限（唯一可信判据）**：用 Contents API 做一次最小写
   `curl -X PUT -H "Authorization: Bearer $(gh auth token)" .../contents/_perm-test.txt -d '{"message":"perm test","content":"dGVzdA=="}'`
   ——返回 `Resource not accessible by personal access token` = **fine-grained token 的 Contents 权限是 Read-only**（高频默认值），
   须去 token 设置页把 `Contents` 与 `Workflows` 改为 Read and write（可原位编辑，token 串不变）。
   写成功记得 DELETE 清理（会留下两个测试 commit，内容已删，属可接受留痕）。
2. **看 git 实际用了哪个凭证**：`GIT_TRACE=1 GIT_CURL_VERBOSE=1 git push ...` 看 `run_command: '... git-credential get'`
   ——命中 `git-credential-osxkeychain` 说明**钥匙串旧凭证优先于 gh 的 token**；
   修法 = `git config --global --unset-all credential.helper` 后按序重加 `!gh auth git-credential` → `osxkeychain`，
   并 `printf 'protocol=https\nhost=github.com\n' | git credential-osxkeychain erase` 清旧条目。
3. **才轮到网络层**（前两步都通过）：`git -c http.version=HTTP/1.1 push`；仍失败且 `curl https://github.com` 返 `000` = 出口网络问题。

> 🔴 **权限拒绝与网络抖动必须分开处置**：网络问题表现为 `Failed to connect` / `Error in the HTTP2 framing layer` /
> `Recv failure` / curl 返 `000`；**权限问题固定为 `denied to <owner>` + `403`——后者重试一万次也不会好**。

### 🔴 重试循环与退出码测量（单次命令不够——网络失败是间歇性的）

单次降级 push 成功≠网络稳定——失败形态会轮换（SSL timeout / Connection reset / Empty reply / lowSpeed 超时），**必须重试循环**（每轮重新评测，成功即退）：

```bash
for i in 1 2 3 4 5 6; do
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
    git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 \
    -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 \
    push origin main > /tmp/push-retry.log 2>&1
  RC=$?
  [ $RC -eq 0 ] && { echo "✅ 第 $i 次成功"; break; }
  echo "第 $i 次 RC=$RC: $(tail -1 /tmp/push-retry.log)"
  sleep 30
done
```

> 🔴 **退出码测量禁管道**：`cmd | tail -2; echo $?` 的 `$?` 是 tail 的退出码——push 失败会被误报为成功。测量一律「输出重定向到文件 + 独立 echo $?」，或 `PIPESTATUS` 数组。多 session 并发期尤其要重试循环兜底——并发 session 的 commit 交错合流（无冲突时快进），中间态 HEAD 被推上去无害。

git push 超时时，gh CLI / clawhub / skillhub 走独立 API 通道不受影响：

```bash
# 确认 tag 已在远端
gh api repos/KongFangXun/sofagent/git/refs/tags/vX.Y.Z --jq '.object.sha'

# 先走 API 通道完成 release + Skill 分发（不依赖 main push）
gh release create vX.Y.Z ...
clawhub skill publish ...

# main push 后台重试
GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=15 git push origin main
```

sandbox 代理拦截 git HTTPS（exit 137）时：

```bash
# 剥离代理环境变量
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git push --no-thin origin main

# tag 仍被 SIGKILL 时，用 gh api 建 tag（前提：commit 已在远端）
gh api repos/KongFangXun/sofagent/git/tags -X POST \
  -f tag=vX.Y.Z -f message="vX.Y.Z" \
  -f object="$(git rev-parse HEAD)" -f type=commit
gh api repos/KongFangXun/sofagent/git/refs -X POST \
  -f ref="refs/tags/vX.Y.Z" -f sha="$(git rev-parse HEAD)"
```


### main push 完全走 Git Data API（git push 死代理时）

> 🛠 **优先用固化脚本**：`node tools/release/gitdata-push.mjs`——上述流程（blobs→trees→commits→refs PATCH + tree 一致性验收 + 删除补删 + mode 保真）已工具化，前置检查（工作树干净/远端实时 SHA）内置。**手工流程仅在脚本不可用时走下方步骤**（三坑/四坑原理同样适用脚本维护者）。

git push 彻底走不了（代理端口连不上）时，用 Git Data API 把本地 commit 内容推上去。核心 = 以远端 HEAD 为 parent 建「压平 commit」（blobs→tree→commit→ref，fast-forward 非 force）：

```bash
# 1. 对比本地 HEAD vs 远端 HEAD，算出需上传的 blob（path→本地 git blob sha）
#    注意：用 git ls-tree -r HEAD 拿本地 blob sha，不用工作区文件（见三坑②）
# 2. 逐文件上传 blob（⚠️ 三坑，见下）
gh api repos/O/R/git/blobs -X POST --input - -f /dev/stdin  # content 走 stdin
# 3. 建 tree：base_tree=远端HEAD的tree + 变更项（sha=新blob；删除项 sha=null）
gh api repos/O/R/git/trees -X POST --input tree.json
# 4. 建 commit：parent=远端HEAD，message 传完整正文（只传 subject 会致 SHA 不符）
gh api repos/O/R/git/commits -X POST --input commit.json
# 5. 更新 ref（fast-forward，parent 已=远端 HEAD 无需 force）
gh api repos/O/R/git/refs/heads/main -X PATCH -f sha=<新commit>
```

**🔴 三坑（务必按此做）**：
1. **base64 内容禁用 `-f content=` 传参**——大文件 base64 超 ARG_MAX 报 `Argument list too long`。必须 `--input -` 从 stdin 传 JSON body（`{"content":"<base64>","encoding":"base64"}`）
2. **`.gitattributes` 的 eol 转换**——`*.ps1 text eol=crlf` 会让 git 存 LF 规范化 blob，工作区是 CRLF。上传必须用 `git cat-file blob <本地git sha>` 拿规范内容，不能读工作区文件（否则 sha 不一致）。**验证铁证：建 tree 后远端 tree sha == 本地 `git rev-parse HEAD^{tree}` = 逐字节一致**
3. **cat-file 必须用本地 git blob sha**——不能用「上传后 GitHub 返回的 sha」去 cat-file（本地无此对象 → 输出空 → 上传空 blob，sha 变 e69de29b）。修正时用 `git ls-tree` 重新拿本地 sha

**🔴 四坑（verify CI 失败根因）——tree 条目 mode 必须用本地真实值**：tree 每一项带 mode（`100644` 普通 / `100755` 可执行），**硬编码 `100644` 会让所有 .sh/.mjs 丢失执行位**——推送前 `git ls-tree -r HEAD | grep "^100755"` 列出全部可执行文件，tree 条目逐项用本地 mode。丢失后 verify CI 报「cleanup.sh 缺失或不可执行」（find 找到文件但 `-x` 检查失败）。
**恢复只需一次操作**：blob SHA 只依赖内容，同一文件的 755 与 644 版本 blob SHA 相同——建一个只含 N 个 100755 条目的新 tree（base_tree=当前远端 tree，sha 引用已存在 blob）→ 建 commit → 更新 ref，无需重传内容。**推送完成必验**：远端 tree sha == 本地 `git rev-parse HEAD^{tree}`。
> 另：Git Data API 的 create-tree **无法表达删除条目**——rename（R100）在 diff 里是「新路径新增」，旧路径永远留在 base_tree；含删除/rename 的 commit 推送后必须用 Contents API（`gh api repos/O/R/contents/<path> -X DELETE -f sha=<file sha>`）逐个补删，最后同样以 tree sha 一致性收尾。

**🔴 第五坑（连续推送）——tree 参数必须 stdin JSON**：gh CLI 命令行拼 `tree[][path]=…` 数组参数，17 文件 = 68 个参数直接报 `accepts 1 arg(s), received 69`——tree 创建必须 `--input -` 从 stdin 传 `{"base_tree":…,"tree":[…]}` JSON（gitdata-push.mjs 已内置）。
另：连续 API 推送时本地无上次 API commit 对象，`git diff <remoteSha>..HEAD` 炸——脚本用 compare API 兜底取变更清单（status=diverged 时拒绝盲推）。
