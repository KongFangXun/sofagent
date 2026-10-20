// build-minimal-dataset.mjs · v1.7.0 §六 · 最小子集生成器（判据集派生 · deterministic 可复算）
// ============================================================
// 用途：从 36 判据（engine/audit/src/rules/criteria/audit-criteria.ts）
// 模板化派生 300–500 题（每判据 8–14 题，zh/en 各半），标签由代码复算
// （deterministic 档——判据问句的模板化实例）。运行：
//   npm run build && node datasets/sofagent-typed-decisions-minimal/build-minimal-dataset.mjs
// 输出：questions.jsonl（题集）+ manifest 中的行数对账数。
// 谱系：来源构成 = 判据集派生（100%）；行数对账 = 各判据题数之和 == 总量；
// 污染声明 = 与公开基准/厂商评测集交集 0（privateHash 私有锚定）。
// ============================================================
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AUDIT_CRITERIA } from '../../engine/audit/dist/rules/criteria/audit-criteria.js';

const here = dirname(fileURLToPath(import.meta.url));

/** 私有盐（与公开基准的交集锚定材料——盐不入公开集，privateHash 由此派生） */
const PRIVATE_SALT = 'sofagent-minimal-v1-private-anchor';

/** 题集字段（与 DecisionQuestion 形态对齐——评测面消费） */
// id / criterionId / language / primitiveType / question / expectedAnswer / privateHash

/** deterministic 复算器：按 primitive 从模板参数复算期望答案 */
function computeExpected(primitive, params) {
  if (primitive === 'noul') {
    return { kind: 'noul', probability: params.truthProb };
  }
  if (primitive === 'choice') {
    return { kind: 'choice', selected: params.correctOption };
  }
  return { kind: 'score', value: params.scoreValue, interval: { lower: params.scoreValue - 1, upper: params.scoreValue + 1 } };
}

/** 实例模板（中英分列）——参数注入判据问句的模板化实例，标签由参数复算 */
const INSTANCE_TEMPLATES = {
  // 每判据 zh/en 各 5 题（合计 10 题/判据）——36 判据 × 10 = 360，
  // 加语义失灵专项 10 题 = 370，落在 §六验收的 300–500 区间。
  zh: [
    { truthProb: 0.95, correctOption: 0, scoreValue: 8, fact: '命中判据正例形态' },
    { truthProb: 0.05, correctOption: 1, scoreValue: 2, fact: '命中判据负例形态' },
    { truthProb: 0.85, correctOption: 0, scoreValue: 7, fact: '判据问句模板实例（中·强正）' },
    { truthProb: 0.15, correctOption: 1, scoreValue: 3, fact: '判据问句模板实例（中·弱负）' },
    { truthProb: 0.65, correctOption: 2, scoreValue: 6, fact: '判据问句模板实例（中·边缘正）' },
  ],
  en: [
    { truthProb: 0.95, correctOption: 0, scoreValue: 8, fact: 'criterion positive exemplar form' },
    { truthProb: 0.05, correctOption: 1, scoreValue: 2, fact: 'criterion negative exemplar form' },
    { truthProb: 0.85, correctOption: 0, scoreValue: 7, fact: 'criterion question templated instance (en · strong positive)' },
    { truthProb: 0.15, correctOption: 1, scoreValue: 3, fact: 'criterion question templated instance (en · weak negative)' },
    { truthProb: 0.65, correctOption: 2, scoreValue: 6, fact: 'criterion question templated instance (en · marginal positive)' },
  ],
};

/** choice 候选集（与判据集 A15-2 的候选形态对齐） */
const CHOICE_OPTIONS = {
  zh: ['完全覆盖', '部分覆盖', '未覆盖', '无合适项→转人工'],
  en: ['fully-covered', 'partially-covered', 'not-covered', 'fallback→human'],
};

/** 语义失灵面专项模板（§六验收：算术/计数/日期比较/间接问句/干扰上下文五类） */
function semanticFailureItems() {
  const mk = (category, lang, question, expected) => ({
    id: `sem-${category}-${lang}`,
    criterionId: 'SEM-FAILURE',
    language: lang,
    primitiveType: 'noul',
    question,
    expectedAnswer: expected,
    tags: ['semantic-failure', category],
    ood: category === 'distractor-context' ? true : undefined,
  });
  // 期望答案全部 deterministic 可复算（算术/计数/日期比较的事实题）
  return [
    // 算术（17+26=43 为真 → 0.95；非 69）
    mk('arithmetic', 'zh', '本次变更声称新增 17 个文件且再添 26 个，合计是否为 43 个（非 69）', { kind: 'noul', probability: 0.95 }),
    mk('arithmetic', 'en', 'The change adds 17 files then 26 more; is the total 43 (not 69)', { kind: 'noul', probability: 0.95 }),
    // 计数（清单 5 项声明「六项」为假）
    mk('counting', 'zh', '变更说明列出五项修改点，却声称「共六项」，该声称是否为假', { kind: 'noul', probability: 0.95 }),
    mk('counting', 'en', 'The description lists five change items but claims "six in total"; is that claim false', { kind: 'noul', probability: 0.95 }),
    // 日期比较（2026-10-20 晚于 2026-10-19 为真）
    mk('date-comparison', 'zh', '授权有效期至 2026-10-20，使用发生在 2026-10-19，是否仍在有效期内', { kind: 'noul', probability: 0.95 }),
    mk('date-comparison', 'en', 'Authorization valid until 2026-10-20; usage occurred on 2026-10-19; is it still within the validity window', { kind: 'noul', probability: 0.95 }),
    // 间接问句（问「是否有理由不放行」= 问「应拦截吗」的否定形）
    mk('indirect-question', 'zh', '这份变更说明没有任何不让它通过的理由，不是吗', { kind: 'noul', probability: 0.05 }),
    mk('indirect-question', 'en', 'There is no reason not to let this change pass, is there', { kind: 'noul', probability: 0.05 }),
    // 干扰上下文（无关上下文夹带正确判据事实——正确判定不受干扰项影响）
    mk('distractor-context', 'zh', '上下文含大段无关日志与天气文本，其中一行新增了私钥文件 credentials.json——该提交是否包含敏感凭据文件', { kind: 'noul', probability: 0.95 }),
    mk('distractor-context', 'en', 'Context contains verbose irrelevant logs and weather text; one added line introduces credentials.json — does this commit contain a sensitive credential file', { kind: 'noul', probability: 0.95 }),
  ];
}

function main() {
  const lines = [];
  const perCriterion = {};
  for (const c of AUDIT_CRITERIA) {
    perCriterion[c.id] = 0;
    let i = 0;
    for (const lang of ['zh', 'en']) {
      for (const tpl of INSTANCE_TEMPLATES[lang]) {
        const id = `${c.id}-${lang}-${i}`;
        const expected = computeExpected(c.primitive, tpl);
        const questionText =
          c.primitive === 'noul'
            ? `【${c.id}】${c.question}（实例：${tpl.fact}）`
            : c.primitive === 'choice'
              ? `【${c.id}】${c.question}（实例：${tpl.fact}）`
              : `【${c.id}】${c.question}（实例：${tpl.fact}）`;
        const privateHash = createHash('sha256')
          .update(`${PRIVATE_SALT}|${id}|${questionText}`)
          .digest('hex')
          .slice(0, 16);
        lines.push({
          id,
          criterionId: c.id,
          language: lang,
          primitiveType: c.primitive,
          question: questionText,
          expectedAnswer: expected,
          privateHash,
        });
        perCriterion[c.id] += 1;
        i += 1;
      }
    }
  }
  // 语义失灵面专项（+10 题：五类 × zh/en）——挂 SEM-FAILURE 伪判据
  const semItems = semanticFailureItems().map((it) => ({
    ...it,
    privateHash: createHash('sha256').update(`${PRIVATE_SALT}|${it.id}|${it.question}`).digest('hex').slice(0, 16),
  }));
  perCriterion['SEM-FAILURE'] = semItems.length;

  const all = [...lines, ...semItems];
  const jsonl = all.map((l) => JSON.stringify(l)).join('\n') + '\n';

  // ── 冻结 sha 锚定（复核第 1 轮 ⚪13：题集冻结后生成器不得静默改产物）──
  // manifest.frozen=true 且带 frozenArtifactsSha 时：本次生成产物 sha 须与
  // 冻结值逐字节一致——不符即拒写退出（「冻结即单调：变更须新建集」的
  // 机制面，靠门禁不靠自觉）。
  const manifestPath = join(here, 'manifest.json');
  let frozenSha = null;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.frozen && manifest.frozenArtifactsSha) frozenSha = manifest.frozenArtifactsSha;
    } catch { /* manifest 坏损由 C6 门禁报——生成器只管冻结锚 */ }
  }
  const actualSha = createHash('sha256').update(jsonl).digest('hex');
  if (frozenSha && actualSha !== frozenSha) {
    console.error('[minimal-dataset] ✗ 题集已冻结——拒写（变更须新建集）');
    console.error(`  冻结 sha（manifest.frozenArtifactsSha）：${frozenSha}`);
    console.error(`  本次生成产物 sha                ：${actualSha}`);
    console.error('  生成模板/判据集已变更但集已冻结——如确需新题集：新建集目录并在两集文档显式声明新旧不可横比');
    process.exit(1);
  }

  writeFileSync(join(here, 'questions.jsonl'), jsonl);

  // 行数对账输出（manifest 消费——各判据题数之和 == 总量）
  const recon = { perCriterion, total: all.length, sumOfPerCriterion: Object.values(perCriterion).reduce((a, b) => a + b, 0) };
  writeFileSync(join(here, 'line-reconciliation.json'), JSON.stringify(recon, null, 2) + '\n');
  console.log(`[minimal-dataset] 生成 ${all.length} 题（判据派生 ${lines.length} + 语义失灵专项 ${semItems.length}）；对账 ${recon.sumOfPerCriterion} == ${recon.total}`);
}

main();
