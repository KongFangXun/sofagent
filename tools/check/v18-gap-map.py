#!/usr/bin/env python3
"""v18-gap-map.py · v1.8.0.md 84 留白的 G-1/G-3 对号表（F6.1 检查点⑤/⑥）

为什么要脚本而不是手写表：84 条是**行号锚**，手抄必然与文件漂移（F5 的 63→96 教训）。
本脚本每次从 `docs/changelog/v1.8/v1.8.0.md` 现读行号与勾选态，期望值与处置写在下面的
两张表里（唯一人工判断处），机械输出对号表；`--apply` 只对 `TICK` 集合翻勾。

口径（自查用）：
  · 条目源 = 该文件全部 `- [ ]` / `- [x]` 行（git 跟踪文件、单文件全量，不含子目录）
  · G-1 = §一/§三/§四 未勾（42 条）· G-3 = §二 未勾（23 条）· G-2 = §五/§六 未勾（19 条，正本已分配）
  · 补勾判据 = 有**可重跑的 F5/F6.1 证据**（命令或测试名可指名），否则只登记落点、不翻勾
"""
from __future__ import annotations

import argparse
import re
import sys

SRC = "docs/changelog/v1.8/v1.8.0.md"

# ── 补勾集合：行号 → 证据（证据必须是可重跑的东西，不是「看起来做了」）──
TICK = {
    63: "decision-channel.test.ts 16/16（F5 S2 R1 亲跑）；三后端同契约：fake/laya/HF 均经 provider.mjs 实跑",
    66: "DEFAULT_TRIAGE_CONFIG.cloudAllowed=false + l2Fallback 需 l2Policy==='cloud-strong' 且 cloudAllowed 双条件（f6-degradation D4 反向锚）",
    68: "f6-degradation 5/5：通道不可用/协议污染 ⇒ 同落 L0·ASK·本地，不按错误类型漂移",
    71: "runner `--strategy lazy|preload` 为公开参数（--help 可见），非私有常量",
    72: "S1M-RUNNER-READINGS §一：冷加载 lazy 15.177s / preload 15.701s（n=2，六项元数据齐）",
    73: "同上 §一：稳态 RSS 745.6 MiB（n=4，ps 口径下界）",
    74: "同上 §一：20 次冷加载失败率 0/20（n=20）",
    75: "跨仓两条：runner `--backend fake` 已跑（NDJSON 协议取自 stdio-decision-channel.ts 头）+ 三读数均实测值（见 §一）",
    81: "f5-judge-state S1/S2/S3：live 无对账 ⇒ 拒绝启用；shadow ⇒ applied=false 且 effective=baseline（行为逐字段同）",
    82: "assertContract 强校验 DecisionResult 只许四键（授权/执行字段多一个即 type-mismatch）；f5 契约测试在位",
    131: "f5-judge-state H1：同一输入两条路径序列化字节相同；buildJudgeState 为唯一导出",
    132: "H2：policy.prefixFields 白名单，调用点多余字段进不去",
    133: "H3：键排序 + 噪音字段剔除（含嵌套）",
    134: "H4：toolCalls 保持数组/对象结构，不压散文",
    135: "H5：超 maxChars ⇒ ok:false reason=over-limit，不返回被截断 state（且 runner 侧超上下文 fail-loud）",
    136: "H6：state 内祈使句逐字节保留、不解析不执行；meta.truncated=false",
    137: "f5-judge-state D1：发什么/发多少/什么绝不发 三件在 policy 内声明并有断言",
    138: "D1/D4：敏感字段与 NEVER_SEND_FIELDS 命中即替换为粗特征/占位并留痕",
    139: "D2：解码序 base64→percent→QP(仅大写)→HTML，解码后再筛",
    140: "D4：绝不发送类字段本地判，`[REDACTED:never-send]` + 留痕 field:<name>",
    141: "f5-policy-layer 6/6（人裁案一①：政策层不读 state）+ J3:141 措辞已订正（2d7978b43）",
    142: "decision-log 含 payload_sha256 全值 + content:false + stateConstructor，可重建送判定内容",
    143: "runner --dump-prompt 实拍：prompt 无 question id（INTERNAL_RULE_A9 不出现）",
    144: "见 81 同批（S1/S2/S3 影子门三档）",
    145: "decision-log content:false + payload_sha256 全值（不落原文）",
    146: "decision-log 含 criteriaSetVersion 与 currentCriteriaSetVersion（不匹配时 advisory=true）",
}

# ── 余项落点：行号 → (落点, 一句话结论) ──
GAP = {
    # §一（G-1）
    64: ("F6.3", "云端 provider 默认关闭已由 66 覆盖；剩余「留痕」在 routeReason/fallback 字段，随可观测面验"),
    69: ("F6.3", "decision-log 有概率与 status；缺 grade(四态) 与 routeReason ⇒ 落可观测面补字段"),
    70: ("F6.4", "intent-triage 有 kind='decision' 租约，但「主模型授予数恒 0」缺专项断言"),
    76: ("F6.3", "契约扩展位是否已在本版预留，未见占位证据"),
    77: ("F6.5", "docs/DECISION-POINTS.md 是否逐点六要素未核"),
    78: ("F6.5", "未采纳点理由清单未核"),
    79: ("F6.5", "未采纳点豁免三要素口径未核"),
    80: ("F6.3", "回执五件：日志有模型身份/概率/版本锚/指纹，缺「证据引用」与「确定性基线」"),
    83: ("F6.1#3", "npm test 全绿 ⇒ 本轮全仓分批收敛"),
    # §二（G-3）
    147: ("F6.3", "门槛参数随判定落痕：日志无阈值字段"),
    148: ("F6.3", "校准参数随判定落痕：日志无 temperature/ece 字段"),
    149: ("F6.5", "留痕可脱离原模型回放：缺回放工具面"),
    150: ("F6.5", "留痕写时锚定：缺链式签名/写时断言"),
    151: ("F6.4", "动作输入取结构化参数向量（bash -lc 拆分）：缺单测"),
    152: ("F6.4", "执行体路径绑定（精确匹配/basename 白名单）：缺单测"),
    153: ("F6.1#3", "npm test 全绿 ⇒ 本轮全仓分批收敛"),
    # §三（G-1）
    220: ("F6.3", "打包决策按字段数判定 + 0.74× 反向劣化落数"),
    221: ("F6.3", "批内同伴无关性（A+B vs A+C）可复现闸门"),
    222: ("F6.4", "类型约束在解码层生效（畸形输出不可能产生）"),
    223: ("F6.4", "独立问句并行/依赖问句串行"),
    224: ("F6.3", "关联判定组「整组全对率」"),
    225: ("F6.3", "版本对比四列并列"),
    226: ("F6.4", "判定走独立槽位通道（行为锁）"),
    227: ("F6.4", "离线环境可加载并推理（不联络外部服务）"),
    228: ("F6.3", "无 GPU 单机档延迟/吞吐/内存档对照表 —— U-1/U-2 not-measured 挂账"),
    229: ("F6.1", "契约测试以接口为准（换实现路线不改契约）—— 与 §一63 同族"),
    230: ("F6.4", "超词表上界选项集分块打分 + 末轮归一"),
    231: ("F6.4", "零微调下单 token 可编码性断言"),
    232: ("F6.4", "稳定化重读默认关闭（按 v1.7.0 §四 挂接）"),
    233: ("F6.3", "稳定化重读开启时延迟含重读开销"),
    234: ("F6.3", "延迟曲线同时给「可承担职责层级」+ 永不进控制回路"),
    235: ("F6.3", "延迟/吞吐/并发劣化曲线进 docs/VALIDATION.md"),
    236: ("F6.5", "路线选型四道筛落文档 + 校准缺口交付指向"),
    237: ("F6.2", "打分头输出未校准前不得作概率消费 —— 本批语义标记即此条落地"),
    238: ("F6.4", "条件路线（扩散）以硬件档为启用条件"),
    239: ("F6.1#3", "npm test 全绿 ⇒ 本轮全仓分批收敛"),
    # §四（G-1）
    271: ("F6.4", "判定档不参与自动路由矩阵（须上游显式请求）"),
    273: ("F6.3", "判定档调用量/延迟/失败率/降级次数可观测"),
    274: ("F6.5", "三档分工边界进 docs/ARCHITECTURE.md"),
    275: ("F6.1#3", "npm test 全绿 ⇒ 本轮全仓分批收敛"),
}


def scan(path: str = SRC):
    sec = "?"
    rows = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            m = re.match(r"^##\s+([一二三四五六七八九十]+)、", line)
            if m:
                sec = m.group(1)
                continue
            m = re.match(r"^\s*-\s*\[([ xX])\]\s*(.+)$", line)
            if m:
                rows.append((i, sec, m.group(1).lower() == "x", m.group(2).strip()))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="对 TICK 集合翻勾（- [ ] → - [x]）")
    ap.add_argument("--table", action="store_true", help="输出 markdown 对号表")
    a = ap.parse_args()

    rows = scan()
    gaps = [r for r in rows if not r[2]]
    by_sec: dict[str, list] = {}
    for r in gaps:
        by_sec.setdefault(r[1], []).append(r)
    print(
        f"条目 {len(rows)} · 已勾 {sum(1 for r in rows if r[2])} · 留白 {len(gaps)}"
        f"（§一{len(by_sec.get('一', []))} §二{len(by_sec.get('二', []))} §三{len(by_sec.get('三', []))}"
        f" §四{len(by_sec.get('四', []))} §五{len(by_sec.get('五', []))} §六{len(by_sec.get('六', []))}）",
        file=sys.stderr,
    )

    # 覆盖自检：每个 G-1/G-3 条目必须恰属 TICK 或 GAP 之一
    g13 = [r for r in gaps if r[1] in ("一", "二", "三", "四")]
    tick = {r[0] for r in g13 if r[0] in TICK}
    gap = {r[0] for r in g13 if r[0] in GAP}
    missing = [r[0] for r in g13 if r[0] not in TICK and r[0] not in GAP]
    both = sorted(tick & gap)
    print(f"G-1/G-3 条目 {len(g13)} · 补勾 {len(tick)} · 落点 {len(gap)} · 未覆盖 {missing} · 双重 {both}", file=sys.stderr)
    if missing or both:
        print("✗ 对号表不完整（每条必须有且仅有一个处置）", file=sys.stderr)
        return 1

    if a.apply:
        out = []
        with open(SRC, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if i in TICK and re.match(r"^\s*-\s*\[ \]", line):
                    out.append(re.sub(r"^(\s*-\s*)\[ \]", r"\1[x]", line))
                else:
                    out.append(line)
        with open(SRC, "w", encoding="utf-8") as f:
            f.writelines(out)
        after = scan()
        print(f"已翻勾 {len(tick)} 条 → 现勾选 {sum(1 for r in after if r[2])}/{len(after)}", file=sys.stderr)

    if a.table:
        print("| 行 | 章 | 条目（摘要） | 处置 | 依据 / 落点 |")
        print("|---|---|---|---|---|")
        for ln, sec, _c, text in g13:
            t = re.sub(r"[`*|]", "", text)[:46].replace("\n", " ")
            if ln in TICK:
                print(f"| {ln} | §{sec} | {t} | **补勾** | {TICK[ln]} |")
            else:
                where, why = GAP[ln]
                print(f"| {ln} | §{sec} | {t} | → {where} | {why} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
