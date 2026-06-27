#!/usr/bin/env python3
"""
FDE 客户审计工具 — 生成结构化审计问卷与报告

用法:
    python client_audit.py --industry manufacturing --output audit_report.md
    python client_audit.py --interactive        # 交互式问答模式
    python client_audit.py --list-industries    # 列出支持的行业

行业支持: manufacturing, agriculture, finance, healthcare, retail, energy, general
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path


# ==================== 行业特定审计问题 ====================

INDUSTRY_QUESTIONS = {
    "general": {
        "label": "通用",
        "business": [
            "请描述贵公司的核心业务模式和主要收入来源？",
            "当前最让你头疼的三个业务问题是什么？",
            "如果有一个 AI 魔法可以解决一个问题，你最希望解决什么？",
            "这个项目的发起人是谁？预算来自哪个部门？",
            "项目的成功如何衡量？（具体指标）",
        ],
        "process": [
            "请绘制核心业务的端到端流程图（从输入到输出）",
            "目前流程中哪个环节的人工介入最多？",
            "平均处理一个业务单元需要多长时间？",
            "流程中有多少审批/检查节点？哪些是合规要求的？",
        ],
        "data": [
            "你们有哪些数据系统？（ERP/CRM/MES/WMS/自建系统）",
            "数据存储在什么位置？（本地/私有云/公有云）",
            "数据量级和增长速度？",
            "数据是否有统一的 ID 关联不同系统？",
            "数据质量如何？（缺失率、重复率、时效性）",
        ],
        "tech": [
            "当前技术栈是什么？（编程语言、数据库、基础设施）",
            "有没有用过 AI/ML 相关技术？效果如何？",
            "IT 团队规模和能力？",
            "有什么技术约束？（私有化部署、国产化、合规等）",
        ],
        "people": [
            "关键决策者是谁？他们的核心关切是什么？",
            "谁会受益于这个项目？谁可能反对？",
            "一线使用者的技术接受度如何？",
            "有没有内部 Champion 可以推动项目？",
        ],
    },
    "manufacturing": {
        "label": "制造业",
        "business": [
            "当前产线/工厂的核心 KPI 是什么？（OEE、良率、换线时间）",
            "质检环节的漏检率和过杀率？",
            "排产/调度是人工还是系统？效率瓶颈在哪？",
            "设备故障导致的停机时间？有没有预测维护需求？",
        ],
        "process": [
            "从原材料到成品的完整工艺流程是什么？",
            "哪些环节是瓶颈？（物理瓶颈 vs 数据瓶颈）",
            "换线调机的完整流程和耗时？",
        ],
        "data": [
            "MES/SCADA 系统的数据情况？（采集频率、存储时长）",
            "有没有产品缺陷样本库（图片/传感器数据）？",
            "设备 IoT 传感器的数据覆盖率和质量？",
        ],
        "tech": [
            "PLC 控制系统型号和协议？（Siemens/Mitsubishi/Rockwell）",
            "边缘计算能力？（工控机配置、GPU 可用性）",
            "产线网络环境？（有线/无线、延迟要求）",
        ],
        "people": [
            "产线工人对新技术的接受度？",
            "工厂长/生产经理的核心关切？",
            "IT 和 OT 团队的分工和协作模式？",
        ],
    },
    "agriculture": {
        "label": "农业",
        "business": [
            "主要作物/养殖品类和规模？",
            "当前作业方式（人工/机械化/自动化）比例？",
            "最大的成本项是什么？（人力/农资/能耗）",
        ],
        "process": [
            "从种植/养殖到收获/出栏的完整作业流程？",
            "哪些环节依赖经验判断？判断失误的代价？",
        ],
        "data": [
            "有没有农田/养殖场的传感器数据？（土壤、气象、水质）",
            "历史产量和农资使用记录？",
            "卫星/无人机遥感数据可用性？",
        ],
        "tech": [
            "农田/养殖场的网络覆盖情况？（4G/5G/WiFi）",
            "农机/设备的自动化和联网程度？",
            "边缘计算设备的可行性和电源条件？",
        ],
        "people": [
            "农场主/养殖户对 AI 技术的认知和接受度？",
            "是否有技术人员可以维护系统？",
        ],
    },
    "finance": {
        "label": "金融",
        "business": [
            "核心业务领域？（银行/证券/保险/基金）",
            "当前监管合规的主要压力来源？",
            "客户投诉和纠纷的主要类型？",
        ],
        "process": [
            "信贷/理赔/交易的完整审批流程？",
            "合规审查的人工参与比例和耗时？",
        ],
        "data": [
            "数据存储是否满足监管要求（等保/数据不出境）？",
            "敏感数据（客户信息、交易记录）的脱敏方案？",
            "内部系统间的数据打通程度？",
        ],
        "tech": [
            "技术栈的信创/国产化要求？",
            "是否允许调用外部 API（如大模型 API）？",
            "模型可解释性是否有监管要求？",
        ],
        "people": [
            "合规部门对新技术的态度？",
            "IT 安全团队的核心关切？",
        ],
    },
    "healthcare": {
        "label": "医疗",
        "business": [
            "医院等级和核心科室？",
            "日门诊量和住院量？",
            "是否有医疗器械注册经验？",
        ],
        "process": [
            "医生工作站/电子病历的使用情况？",
            "哪些环节是医生最耗时间的重复性工作？",
        ],
        "data": [
            "PACS（影像）/LIS（检验）/HIS（医院信息系统）数据情况？",
            "数据脱敏方案？（HIPAA/个人信息保护法合规）",
            "历史病例数据的结构化程度？",
        ],
        "tech": [
            "医院内网环境？（是否可访问外网）",
            "GPU 服务器可用性？",
            "是否接受容器化部署？",
        ],
        "people": [
            "科室主任对 AI 辅助诊断的接受度？",
            "信息科的技术能力和配合度？",
        ],
    },
    "retail": {
        "label": "零售",
        "business": [
            "线上/线下渠道比例？",
            "SKU 数量和上新频率？",
            "客服团队规模和响应时间要求？",
        ],
        "process": [
            "从下单到履约的完整流程？",
            "客服/退货/投诉的处理流程？",
        ],
        "data": [
            "用户行为数据的采集和存储情况？",
            "商品/库存/订单数据的一致性？",
            "是否有 CDP/数据中台？",
        ],
        "tech": [
            "当前使用的电商平台和 CRM 系统？",
            "是否使用云服务？（阿里云/腾讯云/AWS）",
        ],
        "people": [
            "运营/客服团队对新工具的接受度？",
            "核心 KPI 的考核方式？",
        ],
    },
    "energy": {
        "label": "能源",
        "business": [
            "能源类型？（电力/石油/天然气/新能源）",
            "核心资产规模和分布？",
            "安全合规要求等级？",
        ],
        "process": [
            "设备巡检和运维的完整流程？",
            "故障响应的 SLA 要求？",
        ],
        "data": [
            "SCADA/IoT 传感器的数据采集频率和存储？",
            "历史故障记录的数据质量？",
            "是否有设备台账和维修记录？",
        ],
        "tech": [
            "工业控制系统的隔离要求？（安全一区/二区/三区）",
            "边缘计算/边缘推理的可行性？",
        ],
        "people": [
            "运维团队的技术能力和规模？",
            "安全部门的核心关切？",
        ],
    },
}


def generate_questionnaire(industry: str) -> str:
    """根据行业生成结构化的审计问卷"""
    questions = INDUSTRY_QUESTIONS.get(industry, INDUSTRY_QUESTIONS["general"])
    label = questions["label"]

    lines = [
        f"# FDE 客户审计问卷 — {label}行业",
        f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "---",
        "",
    ]

    sections = [
        ("一、业务背景与目标", "business"),
        ("二、业务流程梳理", "process"),
        ("三、数据资产盘点", "data"),
        ("四、技术环境评估", "tech"),
        ("五、人员与组织", "people"),
    ]

    for title, key in sections:
        lines.append(f"## {title}")
        lines.append("")
        qs = questions.get(key, [])
        for i, q in enumerate(qs, 1):
            lines.append(f"{i}. {q}")
            lines.append(f"   - **回答**：___")
            lines.append("")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 六、审计总结")
    lines.append("")
    lines.append("1. **核心发现**（3-5 条）：___")
    lines.append("2. **优先级建议**：___")
    lines.append("3. **下一步行动**：___")
    lines.append("4. **风险关注**：___")
    lines.append("")

    return "\n".join(lines)


def interactive_mode(industry: str):
    """交互式审计问答模式"""
    questions = INDUSTRY_QUESTIONS.get(industry, INDUSTRY_QUESTIONS["general"])
    label = questions["label"]

    print(f"\n{'='*60}")
    print(f"  FDE 客户审计 — {label}行业 — 交互模式")
    print(f"{'='*60}\n")
    print("请逐项回答以下问题（直接回车跳过）：\n")

    answers = {}
    sections = [
        ("业务背景与目标", "business"),
        ("业务流程梳理", "process"),
        ("数据资产盘点", "data"),
        ("技术环境评估", "tech"),
        ("人员与组织", "people"),
    ]

    for section_title, key in sections:
        print(f"\n{'─'*40}")
        print(f"  [{section_title}]")
        print(f"{'─'*40}\n")
        qs = questions.get(key, [])
        for q in qs:
            answer = input(f"  {q}\n  > ").strip()
            answers[q] = answer
            print()

    # 生成简要报告
    print(f"\n{'='*60}")
    print(f"  审计数据收集完成！")
    print(f"  共收集 {len([a for a in answers.values() if a])} 条有效回答")
    print(f"{'='*60}\n")

    total = len(answers)
    answered = len([a for a in answers.values() if a])
    print(f"回答率：{answered}/{total} ({answered*100//total if total else 0}%)")
    print("\n未回答的问题（需要补充了解）：")
    for q, a in answers.items():
        if not a:
            print(f"  - {q}")

    return answers


def output_report(industry: str, output_path: str):
    """生成审计问卷并输出到文件"""
    content = generate_questionnaire(industry)
    path = Path(output_path)
    path.write_text(content, encoding="utf-8")
    print(f"✅ 审计问卷已生成：{path.absolute()}")
    return path


def main():
    parser = argparse.ArgumentParser(
        description="FDE 客户审计工具 — 生成结构化审计问卷",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python client_audit.py --industry manufacturing --output audit.md
  python client_audit.py --interactive --industry finance
  python client_audit.py --list-industries
        """,
    )
    parser.add_argument(
        "--industry", "-i",
        default="general",
        choices=list(INDUSTRY_QUESTIONS.keys()),
        help="行业类型 (default: general)",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="输出文件路径 (default: 输出到 stdout)",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="交互式问答模式",
    )
    parser.add_argument(
        "--list-industries",
        action="store_true",
        help="列出支持的行业",
    )

    args = parser.parse_args()

    if args.list_industries:
        print("支持的行业：")
        for key, val in INDUSTRY_QUESTIONS.items():
            print(f"  {key:20s} — {val['label']}")
        return

    if args.interactive:
        answers = interactive_mode(args.industry)
        if args.output:
            # 同时输出到文件
            output_report(args.industry, args.output)
        return

    content = generate_questionnaire(args.industry)

    if args.output:
        output_report(args.industry, args.output)
    else:
        print(content)


if __name__ == "__main__":
    main()
