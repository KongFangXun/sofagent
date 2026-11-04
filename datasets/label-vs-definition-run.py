#!/usr/bin/env python3
# ============================================================
# label-vs-definition-run.py · USC「标签>定义」实验在 zh-decision-bench 上的复刻
# 协议（对齐 USC 论文三条件）：
#   A 原文    ：label + definition（基线）
#   B 删定义  ：label + 空定义（""）——检验「定义是否被读」
#   C 换标签  ：无语义标签（A1/A2/...）+ 保留定义——检验「标签语义 vs 定义」
# 判据（论文口径）：
#   1) B≈A 或 B>A ⇒ 模型主要读标签，定义形同虚设
#   2) C 明显掉 ⇒ 模型依赖标签字面语义
#   3) 逐题翻转统计（A对B错 / B对A错）⇒ 定义对哪些题有边际贡献
# 输出：JSON 报告（三面 acc + 翻转明细 + 按题型/难度切片）
# ============================================================
import json, sys, time, random
from laya import Agent  # 实测版：laya 0.4.2（PyPI）——复刻须同版

# 路径三参可覆盖（环境变量或 argv[1..3]=BENCH,WEIGHTS,OUT）——默认给维护者本机值（评测产物，非运行时）
import os
BENCH = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LVD_BENCH", "/Users/kongfangxun/Workbuddy/datasets/external/zh-decision-bench")
WEIGHTS = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("LVD_WEIGHTS", "/Users/kongfangxun/Workbuddy/models/laya-official/multilingual")
OUT = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("LVD_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "v17-eval-reports", "label-vs-definition-20261104.json"))

ANON = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]  # 无语义标签池（中文字面无域语义）

def load():
    rows = []
    for fn in ["voice_routing.jsonl", "business_scenarios.jsonl"]:
        with open(f"{BENCH}/{fn}") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows

def variants(item):
    """生成 A/B/C 三面的 questions 变体（choice 题才有标签实验意义；score/noul 记跳过）"""
    qs = item["questions"]
    a, b, c, qids = {}, {}, {}, []
    for qid, q in qs.items():
        if q.get("type") != "choice":
            continue
        crit = q["criteria"]; labels = list(crit.keys())
        a[qid] = {"type": "choice", "instructions": q["instructions"], "criteria": {k: crit[k] for k in labels}}
        b[qid] = {"type": "choice", "instructions": q["instructions"], "criteria": {k: "" for k in labels}}
        c[qid] = {"type": "choice", "instructions": q["instructions"],
                  "criteria": {ANON[i]: crit[k] for i, k in enumerate(labels)}}
        qids.append(qid)
    # gold 重映射：C 面的 gold 须换成匿名标签
    gold_a = {q: item["gold"][q] for q in qids}
    label2anon = {}
    for qid in qids:
        labels = list(qs[qid]["criteria"].keys())
        label2anon[qid] = {k: ANON[i] for i, k in enumerate(labels)}
    gold_c = {q: label2anon[q][item["gold"][q]] for q in qids}
    return a, b, c, qids, gold_a, gold_c, label2anon

def run(agent, rows, limit=None):
    res = {"A": {"ok": 0, "n": 0}, "B": {"ok": 0, "n": 0}, "C": {"ok": 0, "n": 0}}
    flips, skipped = [], {"score_noul": 0}
    byq = {}
    t0 = time.time()
    n_items = 0
    for item in rows:
        a, b, c, qids, gold_a, gold_c, l2a = variants(item)
        if not qids:
            skipped["score_noul"] += 1
            continue
        if limit and n_items >= limit:
            break
        n_items += 1
        outs = {}
        for face, qs, gold in (("A", a, gold_a), ("B", b, gold_a), ("C", c, gold_c)):
            try:
                r = agent.predict(item["state"], qs)
                outs[face] = r
            except Exception as e:
                print(f"  [err] {item['id']} face {face}: {e}", file=sys.stderr)
                outs[face] = None
        for qid in qids:
            row = {"id": item["id"], "qid": qid, "domain": item.get("domain"), "difficulty": item.get("difficulty")}
            for face in ("A", "B", "C"):
                r = outs[face]
                if r is None:
                    row[face] = None; continue
                ans = r["answers"].get(qid, {})
                pick = ans.get("choice") if isinstance(ans, dict) else None
                gold = (gold_a if face in "AB" else gold_c)[qid]
                row[face] = {"pick": pick, "gold": gold, "ok": pick == gold,
                             "p": (ans.get("probabilities") or {}).get(pick) if isinstance(ans, dict) else None}
                res[face]["n"] += 1
                res[face]["ok"] += row[face]["ok"]
            if row.get("A") and row.get("B"):
                flips.append({"id": row["id"], "qid": qid, "A_ok": row["A"]["ok"], "B_ok": row["B"]["ok"],
                              "A_p": row["A"]["p"], "B_p": row["B"]["p"]})
            byq[qid] = byq.get(qid, 0) + 1
    dt = time.time() - t0
    acc = {f: (res[f]["ok"] / res[f]["n"] if res[f]["n"] else None) for f in "ABC"}
    ab = {"A_right_B_wrong": sum(1 for x in flips if x["A_ok"] and not x["B_ok"]),
          "B_right_A_wrong": sum(1 for x in flips if x["B_ok"] and not x["A_ok"])}
    return {"acc": acc, "counts": res, "flips_AB": ab, "flip_details": [x for x in flips if x["A_ok"] != x["B_ok"]][:80],
            "n_items": n_items, "skipped": skipped, "elapsed_s": round(dt, 1), "per_qid_n": byq}

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    print("loading agent (cpu)...")
    agent = Agent(model_id_or_path=WEIGHTS, device="cpu")
    print("loading bench...")
    rows = load()
    print(f"items={len(rows)} limit={limit}")
    rep = run(agent, rows, limit)
    rep["_meta"] = {"model": "laya multilingual (local)", "weights": WEIGHTS, "bench": "zh-decision-bench v0.2",
                    "protocol": "A=原文 B=删定义(空串) C=无语义标签(甲乙丙…)+原定义", "anon_pool": ANON,
                    "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    with open(OUT, "w") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print(json.dumps({"acc": rep["acc"], "flips_AB": rep["flips_AB"], "n_items": rep["n_items"],
                      "elapsed_s": rep["elapsed_s"], "out": OUT}, ensure_ascii=False, indent=1))
