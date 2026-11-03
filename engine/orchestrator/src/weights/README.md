# 判定权重制品（weights）

> 权重分发通路的制品面：清单规范在代码（`../weights-manifest.ts`），制品描述在此处。
> 本目录**不含权重本体**（只含 `.ts` 源码与测试——判法见 SSOT §五「体量断言」：`git ls-files` 零命中权重后缀）。

## 制品三件套（可复现重放的身份面）

| 件 | 指纹 | 说明 |
|---|---|---|
| 权重制品 | `weightsSha256` | 版本目录级 sha256（`hashDir`，按文件名排序逐文件哈希汇总——确定性） |
| 判定头 | `judgeHeadSha256` | 实现版本锚（与判定回执 `modelIdentity` 对齐） |
| 判据集 | `criteriaVersion` | 判据集版本（与 decision-log provenance 四件同源） |

## remote 字段（远端拉取）

`RemoteSource{url, sha256, bytes?, generation?, revision?}`：
- `generation`：制品代次号（`V2` / `V2.1` 式——非 semver、非仓版本号；写入校验 semver 三段即拒）。
- `revision`：产出锚（钉死 git tag 或 commit——`main` / `master` / 空串即拒，浮动分支不可复现）。

## 来源白名单（可枚举常量 `WEIGHTS_SOURCE_WHITELIST`）

主载域 `huggingface.co` 及其 LFS/CDN 域 + 替代源 `hf-mirror.com`（反向代理）/ `modelscope.cn`（ModelScope 魔搭——同批第二份制品按跨仓交付回执判）。本机回环（localhost/127.0.0.1/[::1]）与 `file://` 本地介质放行（离线导入走同一套 sha256 校验）；非白名单公网源须显式 `allowAnySource=true` 且留痕。

## 模型卡（main01v5 判定件）

- **用途**：FDE 工作流判定点（L1 语义分类）——只输出类型化答案与校准概率，不生成文本。
- **三原语**：choice（全候选分布+熵）/ score（分值+区间）/ noul（真值概率+弃权四态）。
- **校准口径**：分桶温度拟合（v1.7.0 §二）；打包口径的概率偏移实测见 `docs/VALIDATION.md`（串行口径拟合，生产走打包须重拟合）。

### 已知局限（与 `docs/LIMITATIONS.md` 判定底座条目同口径——缺该段即不可发布）

1. **可被 state 操纵 ⇒ 永不进信任地基**：判定输入可被上游构造影响，结论只出建议（grade）；控制回路与安全反射归确定性代码。
2. **域外泛化未验证**：分布外读数 not-measured（空集复扫值不得以数值形态出现）；跨域不迁移，域外能力不得对外声明。
3. **校准依赖数据分布、漂移须重标**：阈值/置信度绑定采集分布；漂移监测在位（超阈提示），漂移后须重校准才可继续消费概率。

## 离线介质导入

`file://` 源走同一套 sha256 强校验与 fail-closed 路径（`fetchVersion` 不区分本地/远端的验证段）——导入不是绕过校验的后门。
