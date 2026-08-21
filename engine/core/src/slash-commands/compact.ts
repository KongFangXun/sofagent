// ============================================================
// slash-commands/compact.ts · /compact 命令实现
// v1.3.9 新建 · 功能 ②
//
// 手动上下文压缩——用户侧减压阀：
//   1. 读取当前 data/task/logs/*.md + think.md
//   2. 调轻量模型生成摘要
//   3. 写回 think.md 的"已压缩"段（保留"验证证据"段不压缩）
//   4. 不删原始文件（审计留痕）
//   5. 压缩操作写入审计日志
//
// 模型配置：复用 SOFAGENT_LLM_GOAL_EVAL（缺省 fallback 到 SOFAGENT_LLM），
// 与 goal 评估共用轻量模型通道，不新增独立环境变量。
// ============================================================

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { SlashCommand, SlashCommandContext } from '../slash-registry';
import { THINK_MD, TASK_LOGS_DIR, AUDIT_HISTORY } from '../data-paths';

/** /compact 默认保留最近消息条数 */
const DEFAULT_KEEP_RECENT = 10;

/** 摘要 prompt 模板 */
function buildCompactPrompt(content: string): string {
  return [
    '你是一个上下文压缩助手。请对以下内容生成简洁摘要：',
    '',
    '要求：',
    '1. 保留关键决策、已完成任务、发现的问题',
    '2. 丢弃冗余的中间过程描述',
    '3. 保留"验证证据"段落原样不压缩（标记为 ### 验证证据 的段落）',
    '4. 摘要长度不超过原文的 30%',
    '5. 输出纯文本，不要 YAML/JSON 包装',
    '',
    '--- 原始内容 ---',
    content,
  ].join('\n');
}

/**
 * /compact 命令实现。
 *
 * 用法：/compact [保留条数]
 *   /compact        → 保留最近 10 条消息上下文
 *   /compact 5      → 保留最近 5 条
 */
export class CompactCommand implements SlashCommand {
  readonly name = 'compact';
  readonly description = '手动压缩上下文——读取 task/logs + think.md，调轻量模型生成摘要写回';
  readonly usage = '/compact [保留条数]';

  async execute(args: string[], ctx: SlashCommandContext): Promise<string> {
    const keepRecent = args.length > 0 ? Math.max(1, parseInt(args[0]!, 10) || DEFAULT_KEEP_RECENT) : DEFAULT_KEEP_RECENT;

    const dataDir = ctx.dataDir;
    const thinkPath = THINK_MD; // 默认 ~/.sofagent/data/think.md
    const taskLogsDir = TASK_LOGS_DIR;

    // 1. 收集要压缩的内容
    const pieces: string[] = [];

    // 读取 think.md
    if (existsSync(thinkPath)) {
      const thinkContent = readFileSync(thinkPath, 'utf-8');
      pieces.push(`## think.md\n\n${thinkContent}`);
    }

    // 读取 task/logs/*.md（最近 N 条）
    if (existsSync(taskLogsDir)) {
      try {
        const files = readdirSync(taskLogsDir)
          .filter((f) => f.endsWith('.md'))
          .sort()
          .reverse()
          .slice(0, keepRecent);
        for (const f of files) {
          const content = readFileSync(join(taskLogsDir, f), 'utf-8');
          pieces.push(`## ${f}\n\n${content}`);
        }
      } catch {
        // 读取失败跳过
      }
    }

    if (pieces.length === 0) {
      return 'ℹ️ 没有可压缩的内容（think.md 和 task/logs/ 均为空）';
    }

    const fullContent = pieces.join('\n\n---\n\n');

    // 2. 调轻量模型生成摘要
    const summary = await this.generateSummary(fullContent);

    if (!summary) {
      return '⚠️ 压缩失败——轻量模型不可用（未配置 SOFAGENT_LLM 或 SOFAGENT_LLM_GOAL_EVAL）';
    }

    // 3. 提取验证证据段（不压缩）
    const evidenceSections = this.extractEvidenceSections(fullContent);

    // 4. 写回 think.md（追加压缩段，保留原文不删）
    const timestamp = new Date().toISOString();
    const compactSection = [
      '',
      `<!-- compact ${timestamp} -->`,
      `## [${timestamp}] 上下文压缩摘要（保留最近 ${keepRecent} 条）`,
      '',
      summary,
      '',
    ];

    if (evidenceSections.length > 0) {
      compactSection.push('### 验证证据（未压缩）', '');
      compactSection.push(...evidenceSections);
      compactSection.push('');
    }

    // 确保 dataDir 存在
    const thinkDir = join(thinkPath, '..');
    if (!existsSync(thinkDir)) mkdirSync(thinkDir, { recursive: true, mode: 0o700 });

    if (existsSync(thinkPath)) {
      appendFileSync(thinkPath, '\n' + compactSection.join('\n'));
    } else {
      writeFileSync(thinkPath, compactSection.join('\n'));
    }

    // 5. 压缩操作写入审计日志
    this.logCompact(dataDir, keepRecent, fullContent.length, summary.length);

    return `✅ 上下文已压缩——原始 ${fullContent.length} 字符 → 摘要 ${summary.length} 字符（保留最近 ${keepRecent} 条）\n验证证据段已保留（${evidenceSections.length} 段）`;
  }

  /**
   * 调轻量模型生成摘要。
   * 模型配置：SOFAGENT_LLM_GOAL_EVAL > SOFAGENT_LLM（fallback）。
   * 模型不可用时返回 null。
   */
  private async generateSummary(content: string): Promise<string | null> {
    // 解析轻量模型配置
    const evalLlm = process.env.SOFAGENT_LLM_GOAL_EVAL ?? process.env.SOFAGENT_LLM;
    if (!evalLlm) return null;

    const [provider, modelName] = evalLlm.split(':');
    const providerKey = provider ?? '';

    const LLM_PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
      glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4/', defaultModel: 'glm-4-flash' },
      kimi: { baseURL: 'https://api.moonshot.cn/v1/', defaultModel: 'moonshot-v1-8k' },
      deepseek: { baseURL: 'https://api.deepseek.com/v1/', defaultModel: 'deepseek-chat' },
    };

    let baseURL: string;
    if (providerKey === 'custom') {
      baseURL = process.env.SOFAGENT_LLM_BASE_URL ?? '';
      if (!baseURL) return null;
    } else {
      const config = LLM_PROVIDERS[providerKey];
      if (!config) return null;
      baseURL = config.baseURL;
    }

    const apiKey = process.env.SOFAGENT_LLM_GOAL_EVAL_API_KEY
      ?? process.env.SOFAGENT_LLM_API_KEY
      ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
      const { ChatOpenAI } = await import('@langchain/openai');
      const model = new ChatOpenAI({
        modelName: modelName || LLM_PROVIDERS[providerKey]?.defaultModel || 'gpt-4o-mini',
        configuration: { baseURL },
        openAIApiKey: apiKey,
      });
      const response = await model.invoke([
        { role: 'system', content: '你是上下文压缩助手，输出简洁摘要。' },
        { role: 'user', content: buildCompactPrompt(content) },
      ]);
      const text = typeof response === 'string'
        ? response
        : (response as { content?: string })?.content ?? String(response);
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * 从内容中提取验证证据段（### 验证证据 开头的段落不压缩）。
   */
  private extractEvidenceSections(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split('\n');
    let inEvidence = false;
    let current: string[] = [];

    for (const line of lines) {
      if (/^###\s*验证证据/.test(line.trim())) {
        inEvidence = true;
        current = [line];
        continue;
      }
      if (inEvidence) {
        // 下一个 ## 或 ### 标题结束当前段
        if (/^#{2,3}\s/.test(line.trim()) && !/^###\s*验证证据/.test(line.trim())) {
          if (current.length > 1) sections.push(current.join('\n'));
          inEvidence = false;
          current = [];
        } else {
          current.push(line);
        }
      }
    }
    if (inEvidence && current.length > 1) sections.push(current.join('\n'));
    return sections;
  }

  /**
   * 将压缩操作写入审计日志（审计留痕）。
   */
  private logCompact(dataDir: string, keepRecent: number, originalLen: number, summaryLen: number): void {
    try {
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        action: 'compact',
        keepRecent,
        originalLength: originalLen,
        summaryLength: summaryLen,
        compressionRatio: originalLen > 0 ? (summaryLen / originalLen).toFixed(2) : '0',
      }) + '\n';
      const logDir = join(dataDir, 'audit');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true, mode: 0o700 });
      appendFileSync(AUDIT_HISTORY, entry);
    } catch (err) {
      // v1.3.1 #43: 不静默跳过——至少输出 warn，让审计写入失败可见。
      console.warn('[compact] 审计写入失败:', err instanceof Error ? err.message : String(err));
    }
  }
}
