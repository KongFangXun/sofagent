// ============================================================
// command.ts · 阵型 CLI 子命令（v1.5.7 接线批）
// ============================================================
// 用途：给 v1.4.8 交付的阵型**库面**（schema 校验 + 模板实例化）一个可执行入口——
//   此前 `validateFormation` / `parseFormation` / `instantiateFormation` 三函数零生产
//   消费（「地基面已交付、消费入口未接线」，处置记录见 v1.5.4 开发日志〈#29 处置〉）。
// 命令形态（由 cli.ts 的 case 'formation' 转交）：
//   formation --list                        列出六种内置阵型（成员拓扑 + 交接边）
//   formation <config.yml> [--json] [--out <f>]
//       读 formation.yml → schema 校验（fail-closed）→ 实例化 → 打印拓扑
//   formation --name <formation> [--json]   用内置模板实例化（formation.yml 最小形态：只有阵型名）
// 失败语义：schema 非法 / 文件不可读 / 缺来源 → 打印错误并返回 1（禁静默放行——
//   与 validateFormation 同纪律：未识别阵型名列出六合法值）。
// 说明：本命令是**作者自验面**（写完 formation.yml 能立刻跑通并看到拓扑/审计 JSON）；
//   真正的「调度消费面」（编排派发按阵型装配成员）不在本命令范围。
// ============================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import * as yaml from 'js-yaml';
import { FORMATION_NAMES, parseFormation } from './schema';
import { FORMATION_TEMPLATES, instantiateFormation } from './registry';

export interface FormationCommandIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = [
  '用法:',
  '  formation --list                        列出六种内置阵型（成员拓扑 + 交接边）',
  '  formation <config.yml> [--json] [--out <f>]',
  '                                          读 formation.yml → schema 校验 → 实例化 → 打印拓扑',
  '  formation --name <formation> [--json] [--out <f>]',
  '                                          用内置模板实例化（只需阵型名）',
  `  合法阵型名: ${FORMATION_NAMES.join(' | ')}`,
].join('\n');

/** 打印六种内置阵型的成员拓扑与交接边（纯读，不实例化） */
function printList(io: FormationCommandIo): void {
  io.out(`内置阵型 ${FORMATION_NAMES.length} 种（模板来自 formations/registry.ts）：`);
  for (const name of FORMATION_NAMES) {
    const tpl = FORMATION_TEMPLATES[name];
    io.out(`\n■ ${name}`);
    io.out(`  成员: ${tpl.members.map((m) => `${m.role}(${m.agentType})`).join(' · ')}`);
    io.out(
      `  交接: ${tpl.edges.length ? tpl.edges.map((e) => `${e.from}→${e.to}[${e.protocol}]`).join(' · ') : '（无）'}`,
    );
  }
}

/**
 * 阵型子命令入口。
 * @param args 完整 argv（含首项 'formation'）
 * @param io   输出通道（缺省 console；测试注入以捕获输出）
 * @returns 退出码：0 成功 / 1 参数或 schema 错误
 */
export async function runFormationCommand(args: string[], io?: Partial<FormationCommandIo>): Promise<number> {
  const out = io?.out ?? ((s: string) => console.log(s));
  const err = io?.err ?? ((s: string) => console.error(s));
  const rest = args.slice(1);

  if (rest.length === 0 || rest.includes('--help') || rest.includes('-h')) {
    out(USAGE);
    return rest.length === 0 ? 1 : 0;
  }
  if (rest.includes('--list')) {
    printList({ out, err });
    return 0;
  }

  // ── 来源解析：--name <formation> 或首个非 flag 参数 = 配置文件路径 ──
  const nameIdx = rest.indexOf('--name');
  const outIdx = rest.indexOf('--out');
  const asJson = rest.includes('--json');
  const outFile = outIdx !== -1 ? rest[outIdx + 1] : undefined;

  let yamlText: string;
  let sourceLabel: string;
  if (nameIdx !== -1) {
    const name = rest[nameIdx + 1];
    if (!name) {
      err('❌ formation --name 需要阵型名');
      err(USAGE);
      return 1;
    }
    yamlText = `formation: ${name}\n`;
    sourceLabel = `--name ${name}`;
  } else {
    const path = rest.find((a) => !a.startsWith('--'));
    if (!path) {
      err('❌ formation 需要 <config.yml> 或 --name <formation>');
      err(USAGE);
      return 1;
    }
    if (!existsSync(path)) {
      err(`❌ 阵型配置文件不存在: ${path}`);
      return 1;
    }
    yamlText = readFileSync(path, 'utf8');
    sourceLabel = path;
  }

  // ── schema 校验（fail-closed）→ 实例化 → 输出 ──
  const verdict = parseFormation(yamlText, (s) => yaml.load(s));
  if (!verdict.valid) {
    err(`❌ 阵型配置非法（来源: ${sourceLabel}）：`);
    for (const e of verdict.errors) err(`   · ${e}`);
    err(`   合法阵型名: ${FORMATION_NAMES.join(' | ')}`);
    return 1;
  }
  if (!verdict.config) {
    err(`❌ 内部错误：schema 判过但未带出 config（来源: ${sourceLabel}）`);
    return 1;
  }
  const config = verdict.config;
  const instance = instantiateFormation(config);
  const audit = instance.exportFormationAudit();

  if (outFile) {
    const dir = dirname(outFile);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  }
  if (asJson) {
    out(JSON.stringify(audit, null, 2));
  } else {
    out(`✅ 阵型已实例化（来源: ${sourceLabel}）`);
    out(`  阵型: ${audit.formation}`);
    out(`  成员: ${audit.members.map((m) => `${m.role}(${m.agentType},${m.state})`).join(' · ')}`);
    out(`  交接记录: ${audit.handoffs.length} 条（recordHandoff 由调用方按实际派发补记）`);
  }
  if (outFile) out(`📄 审计 JSON 已落盘: ${outFile}`);
  return 0;
}
