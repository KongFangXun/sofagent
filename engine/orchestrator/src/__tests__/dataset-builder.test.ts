// ============================================================
// dataset-builder.test.ts · v1.4.2 章一+章二 · 数据管道与版本管理测试
//
// 覆盖：
//   1. data-ingest：CSV 解析（RFC 4180 引号转义/类型推断/空值归一）、
//      JSON / 文本接入、类型推断纯函数
//   2. db-source：SQL 只读白名单、DB 拉取（注入 QueryFn mock——零真实
//      连接）、API 拉取（注入 FetchFn mock——零真实网络）
//   3. dataset-builder：CSV→instruction 训练集、DPO 偏好对 / RL 提示集
//      两条构建路径、训练入口脱敏生效（密钥 → 占位符）、dataset_version
//      落盘（hash+样本数+配置）、两版差异概览
//   4. dataset-validator：质量闸门拦截（样本量不足/字段缺失/标签单一化
//      → 结构化拒绝）
//
// 全部依赖注入 / 临时目录（零真实 DB、零真实下载、零真实进程——
// 对齐 train-env.test.ts 模式）。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

import {
  parseCsv,
  ingestCsv,
  ingestJson,
  ingestText,
  ingestFile,
  inferCellType,
  unzipEntries,
  parseSharedStrings,
  excelColumnToIndex,
  parseSheetXml,
  ingestExcel,
  type IngestRecord,
} from '../train/data-ingest';
import {
  isReadonlySql,
  pullFromDb,
  pullFromApi,
  extractItems,
  parseDbFlavor,
  type QueryFn,
  type FetchFn,
  type DbQueryResult,
} from '../train/db-source';
import {
  buildDataset,
  buildAndPersistDataset,
  inferColumnMapping,
  sanitizeCell,
  datasetDir,
} from '../train/dataset-builder';
import {
  recordDatasetVersion,
  readDatasetVersions,
  listDatasetVersions,
  getDatasetVersion,
  diffDatasetVersions,
  datasetVersionsPath,
} from '../train/dataset-version';
import {
  validateDataset,
  requiredFieldsOf,
  computeLabelDistribution,
} from '../train/dataset-validator';

// ──────────────────────────────────────
// 测试夹具
// ──────────────────────────────────────

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-ds-test-'));
});

/** 造中间格式记录的快捷工厂 */
function rec(id: string, fields: Record<string, string | number | boolean | null>): IngestRecord {
  return { id, source: 'test.csv', fields };
}

// ──────────────────────────────────────
// data-ingest · CSV 解析
// ──────────────────────────────────────

describe('data-ingest · CSV', () => {
  it('test_parseCsv_标准CSV_二维矩阵', () => {
    // 场景：a,b,c 三列两行 → 矩阵含表头共 3 行
    const rows = parseCsv('a,b,c\n1,2,3\nx,y,z\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['x', 'y', 'z'],
    ]);
  });

  it('test_parseCsv_引号包裹_嵌入逗号与转义引号', () => {
    // 场景：RFC 4180——单元格含逗号与 "" 转义引号
    const rows = parseCsv('name,note\n"Smith, John","say ""hi"""\n');
    expect(rows[1]).toEqual(['Smith, John', 'say "hi"']);
  });

  it('test_parseCsv_CRLF换行_兼容', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('test_ingestCsv_类型推断与空值归一', () => {
    // 场景：数字列推断 number、NA 归 null、布尔列推断 boolean
    const result = ingestCsv(
      'question,answer,score,flag\ndefine X,answer is X,3.5,TRUE\nsum 1+1,2,NA,false\n',
      'test.csv',
    );
    expect(result.columns).toEqual(['question', 'answer', 'score', 'flag']);
    expect(result.rowCount).toBe(2);
    const first = result.records[0];
    expect(first?.fields['score']).toBe(3.5);
    expect(first?.fields['flag']).toBe(true);
    const second = result.records[1];
    expect(second?.fields['score']).toBeNull();
    expect(second?.fields['flag']).toBe(false);
    expect(second?.fields['answer']).toBe(2); // 纯数字单元格统一推断 number（列内类型一致）
  });

  it('test_ingestCsv_全空行跳过计数', () => {
    const result = ingestCsv('q,a\n1,2\n,,\n3,4\n', 'test.csv');
    expect(result.rowCount).toBe(2);
    expect(result.skippedEmptyRows).toBe(1);
  });

  it('test_inferCellType_边界形态', () => {
    expect(inferCellType('42')).toBe(42);
    expect(inferCellType('-3.14')).toBe(-3.14);
    expect(inferCellType('1e5')).toBe(100000);
    expect(inferCellType('N/A')).toBeNull();
    expect(inferCellType('hello world')).toBe('hello world');
  });
});

// ──────────────────────────────────────
// data-ingest · JSON / 文本 / 文件路由
// ──────────────────────────────────────

describe('data-ingest · JSON/文本/文件', () => {
  it('test_ingestJson_对象数组_归一记录', () => {
    const json = JSON.stringify([
      { q: 'x', a: 'y' },
      { q: 'z', a: null },
    ]);
    const result = ingestJson(json, 'test.json');
    expect(result.rowCount).toBe(2);
    expect(result.records[1]?.fields['a']).toBeNull();
    expect(result.columns).toContain('q');
  });

  it('test_ingestJson_嵌套对象_JSON串保留', () => {
    const json = JSON.stringify([{ q: 'x', meta: { k: 1 } }]);
    const result = ingestJson(json, 'test.json');
    expect(result.records[0]?.fields['meta']).toBe('{"k":1}');
  });

  it('test_ingestJson_非对象项_结构化拒绝', () => {
    expect(() => ingestJson('[1,2,3]', 'test.json')).toThrow(/不是对象/);
  });

  it('test_ingestText_逐行单字段_空行跳过', () => {
    const result = ingestText('line one\n\nline two\n', 'notes.txt');
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(['text']);
    expect(result.records[0]?.fields['text']).toBe('line one');
  });

  it('test_ingestFile_CSV路由', () => {
    const csvPath = join(dataDir, 'data.csv');
    writeFileSync(csvPath, 'q,a\n1,2\n3,4\n', 'utf8');
    const result = ingestFile(csvPath);
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(['q', 'a']);
  });

  it('test_ingestFile_不支持格式_结构化拒绝', () => {
    const badPath = join(dataDir, 'data.parquet');
    writeFileSync(badPath, 'binary', 'utf8');
    expect(() => ingestFile(badPath)).toThrow(/不支持的数据文件格式/);
  });
});

// ──────────────────────────────────────
// data-ingest · Excel（手写 ZIP + XML 解析器）
// ──────────────────────────────────────

describe('data-ingest · Excel', () => {
  /** 构造最小合法 ZIP（stored 条目——不依赖压缩，专注容器与 XML 解析） */
  function makeZip(files: Array<{ name: string; data: Buffer }>): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      const nameBuf = Buffer.from(f.name, 'utf8');
      const crc = 0; // 本地解析器不校验 CRC——只按中央目录尺寸切片
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(10, 4); // version
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(0, 8); // method 0 = stored
      local.writeUInt16LE(0, 10); // time
      local.writeUInt16LE(0, 12); // date
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(f.data.length, 18); // comp size
      local.writeUInt32LE(f.data.length, 22); // uncomp size
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28); // extra len
      chunks.push(local, nameBuf, f.data);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(10, 4); // version made by
      cd.writeUInt16LE(10, 6); // version needed
      cd.writeUInt16LE(0, 8); // flags
      cd.writeUInt16LE(0, 10); // method
      cd.writeUInt16LE(0, 12);
      cd.writeUInt16LE(0, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(f.data.length, 20);
      cd.writeUInt32LE(f.data.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(offset, 42);
      central.push(cd, nameBuf);
      offset += 30 + nameBuf.length + f.data.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...chunks, centralBuf, eocd]);
  }

  it('test_unzipEntries_stored条目_读出内容', () => {
    const zip = makeZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    const out = unzipEntries(zip);
    expect(out.get('a.txt')?.toString('utf8')).toBe('hello');
  });

  it('test_unzipEntries_非ZIP_结构化拒绝', () => {
    expect(() => unzipEntries(Buffer.from('not a zip'))).toThrow(/EOCD/);
  });

  it('test_parseSharedStrings_富文本拼接', () => {
    const xml = '<sst><si><t>plain</t></si><si><r><t>a</t></r><r><t>b</t></r></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['plain', 'ab']);
  });

  it('test_excelColumnToIndex_字母转列号', () => {
    expect(excelColumnToIndex('A')).toBe(0);
    expect(excelColumnToIndex('Z')).toBe(25);
    expect(excelColumnToIndex('AA')).toBe(26);
  });

  it('test_parseSheetXml_共享串与数值单元格', () => {
    const shared = ['question text', 'answer text'];
    const xml =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>42</v></c></row>' +
      '</sheetData>';
    const rows = parseSheetXml(xml, shared);
    expect(rows[0]).toEqual(['question text', 'answer text']);
    expect(rows[1]).toEqual(['question text', '42']);
  });

  it('test_ingestExcel_端到端_首行表头中间格式', () => {
    // 最小 xlsx：sharedStrings + workbook + rels + sheet1（表头两列均共享串、数据行数值+共享串）
    const shared = ['header-a', 'header-b', 'cell-a1', 'cell-b1'];
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>' +
      '</sheetData></worksheet>';
    const workbook =
      '<workbook><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const rels =
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    const zip = makeZip([
      { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels) },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
    const result = ingestExcel(zip, 'test.xlsx');
    expect(result.columns).toEqual(['header-a', 'header-b']);
    expect(result.rowCount).toBe(1);
    expect(result.records[0]?.fields['header-b']).toBe(42);
  });

  it('test_ingestFile_xlsx路由', () => {
    const shared = ['q', 'a'];
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>';
    const workbook = '<workbook><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
    const zip = makeZip([
      { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels) },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
    const xlsxPath = join(dataDir, 'data.xlsx');
    writeFileSync(xlsxPath, zip);
    const result = ingestFile(xlsxPath);
    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(['q', 'a']);
  });
});

// ──────────────────────────────────────
// db-source · SQL 只读白名单 + DB 拉取
// ──────────────────────────────────────

describe('db-source · SQL 白名单', () => {
  it('test_isReadonlySql_SELECT与WITH放行', () => {
    expect(isReadonlySql('SELECT * FROM t')).toBe(true);
    expect(isReadonlySql('select a,b from t where id=$1')).toBe(true);
    expect(isReadonlySql('WITH c AS (SELECT 1) SELECT * FROM c')).toBe(true);
    expect(isReadonlySql('  -- 注释\nSELECT 1')).toBe(true);
  });

  it('test_isReadonlySql_写入语句拒绝', () => {
    expect(isReadonlySql('DELETE FROM t')).toBe(false);
    expect(isReadonlySql('DROP TABLE t')).toBe(false);
    expect(isReadonlySql('UPDATE t SET a=1')).toBe(false);
    expect(isReadonlySql('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isReadonlySql('')).toBe(false);
  });

  it('test_parseDbFlavor_前缀路由', () => {
    expect(parseDbFlavor('postgres://u:p@h/db')).toBe('postgres');
    expect(parseDbFlavor('postgresql://u:p@h/db')).toBe('postgres');
    expect(parseDbFlavor('mysql://u:p@h/db')).toBe('mysql');
    expect(parseDbFlavor('sqlite://x')).toBeNull();
  });
});

describe('db-source · DB 拉取（QueryFn 注入 mock）', () => {
  /** mock：返回两行固定查询结果 */
  const mockQuery: QueryFn = async () =>
    ({
      columns: ['question', 'answer'],
      rows: [
        { question: 'q1', answer: 'a1' },
        { question: 'q2', answer: 'a2' },
      ],
    }) satisfies DbQueryResult;

  it('test_pullFromDb_只读SELECT_归一中间格式', async () => {
    const result = await pullFromDb({
      connectionString: 'postgres://mock',
      sql: 'SELECT question, answer FROM faq',
      queryFn: mockQuery,
    });
    expect(result.rowCount).toBe(2);
    expect(result.columns).toEqual(['question', 'answer']);
    expect(result.records[0]?.fields['question']).toBe('q1');
    expect(result.source).toContain('db:postgres');
  });

  it('test_pullFromDb_写入SQL_结构化拒绝', async () => {
    await expect(
      pullFromDb({
        connectionString: 'postgres://mock',
        sql: 'DELETE FROM faq',
        queryFn: mockQuery,
      }),
    ).rejects.toThrow(/只读校验未通过/);
  });
});

describe('db-source · API 拉取（FetchFn 注入 mock）', () => {
  const okFetch: FetchFn = async () => ({
    status: 200,
    body: { data: { items: [{ q: 'x', a: 'y' }, { q: 'z', a: 'w' }] } },
  });

  it('test_pullFromApi_itemsPath取数_归一记录', async () => {
    const result = await pullFromApi({
      url: 'https://erp.example.com/api/faq',
      itemsPath: 'data.items',
      fetchFn: okFetch,
    });
    expect(result.rowCount).toBe(2);
    expect(result.records[1]?.fields['q']).toBe('z');
    expect(result.source).toContain('api:');
  });

  it('test_pullFromApi_智能探测首数组字段', async () => {
    // 场景：不指定 itemsPath → 自动取第一个数组值字段
    const result = await pullFromApi({ url: 'https://x/api', fetchFn: okFetch });
    expect(result.rowCount).toBe(2);
  });

  it('test_pullFromApi_非2xx_结构化拒绝', async () => {
    const badFetch: FetchFn = async () => ({ status: 500, body: 'err' });
    await expect(pullFromApi({ url: 'https://x/api', fetchFn: badFetch })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('test_extractItems_提取不到数组_拒绝', () => {
    expect(() => extractItems({ foo: 'bar' })).toThrow(/提取不到记录数组/);
  });
});

// ──────────────────────────────────────
// dataset-builder · 训练集构建 + 脱敏
// ──────────────────────────────────────

describe('dataset-builder · 列映射与脱敏', () => {
  it('test_inferColumnMapping_常见命名约定', () => {
    const m = inferColumnMapping(['id', 'question', 'answer']);
    expect(m.instruction).toBe('question');
    expect(m.output).toBe('answer');
    const m2 = inferColumnMapping(['指令', '输出']);
    expect(m2.instruction).toBe('指令');
    expect(m2.output).toBe('输出');
  });

  it('test_sanitizeCell_密钥脱敏生效', () => {
    // 场景：训练入口脱敏最小版——sk- 密钥串 → 占位（复用审计 REDACTION_PATTERNS）
    // （样本密钥运行时拼接——源码不留完整密钥形态，A2 防线同款纪律）
    const _SK = 'sk-' + 'a'.repeat(36);
    const dirty = `my key is ${_SK} please help`;
    const clean = sanitizeCell(dirty);
    expect(clean).not.toContain(_SK);
    expect(clean.length).toBeGreaterThan(0);
  });

  it('test_sanitizeCell_空值转空串_数字布尔原样', () => {
    expect(sanitizeCell(null)).toBe('');
    expect(sanitizeCell(3.14)).toBe('3.14');
    expect(sanitizeCell(true)).toBe('true');
    expect(sanitizeCell('普通文本')).toBe('普通文本');
  });
});

describe('dataset-builder · 三算法构建', () => {
  it('test_buildDataset_sft_instruction集构建', () => {
    const records = [
      rec('t#1', { question: '什么是电芯SOC', answer: '荷电状态' }),
      rec('t#2', { question: 'CV是什么', answer: '恒压充电' }),
    ];
    const result = buildDataset(records, ['question', 'answer'], { algorithm: 'sft' });
    expect(result.lines).toHaveLength(2);
    const s = result.lines[0]?.sample as { instruction: string; output: string };
    expect(s.instruction).toBe('什么是电芯SOC');
    expect(s.output).toBe('荷电状态');
    expect(result.columnMapping.instruction).toBe('question');
  });

  it('test_buildDataset_dpo_偏好对构建', () => {
    const records = [
      rec('t#1', { prompt: '翻译：hello', chosen: '你好', rejected: '喂' }),
    ];
    const result = buildDataset(records, ['prompt', 'chosen', 'rejected'], {
      algorithm: 'dpo',
    });
    expect(result.lines).toHaveLength(1);
    const s = result.lines[0]?.sample as { prompt: string; chosen: string; rejected: string };
    expect(s.chosen).toBe('你好');
    expect(s.rejected).toBe('喂');
  });

  it('test_buildDataset_grpo_RL提示集构建_参考答案可选', () => {
    const records = [
      rec('t#1', { question: '求解 1+1', answer: '2' }),
      rec('t#2', { question: '求解 2+2' }), // 无参考答案 → 纯 prompt
    ];
    const result = buildDataset(records, ['question', 'answer'], { algorithm: 'grpo' });
    expect(result.lines).toHaveLength(2);
    const withRef = result.lines[0]?.sample as { prompt: string; reference?: string };
    expect(withRef.reference).toBe('2');
    const noRef = result.lines[1]?.sample as { prompt: string; reference?: string };
    expect(noRef.reference).toBeUndefined();
  });

  it('test_buildDataset_必填列缺失行跳过并汇总原因', () => {
    const records = [
      rec('t#1', { question: 'q', answer: 'a' }),
      rec('t#2', { question: '只有问题' }), // output 空 → 跳过
    ];
    const result = buildDataset(records, ['question', 'answer'], { algorithm: 'sft' });
    expect(result.lines).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons.length).toBeGreaterThan(0);
  });

  it('test_buildDataset_样本级脱敏_密钥不进训练集', () => {
    // 样本密钥运行时拼接（ghp_ + 36 位）——源码不留完整密钥形态
    const _GHP = 'ghp_' + 'b'.repeat(36);
    const records = [
      rec('t#1', {
        question: `我的密钥是 ${_GHP} 怎么办`,
        answer: '请联系安全组',
      }),
    ];
    const result = buildDataset(records, ['question', 'answer'], { algorithm: 'sft' });
    const s = result.lines[0]?.sample as { instruction: string };
    expect(s.instruction).not.toContain(_GHP);
  });
});

describe('dataset-builder · 落盘 + dataset_version（章二衔接）', () => {
  it('test_buildAndPersistDataset_JSONL落盘与版本记录', () => {
    const records = [
      rec('t#1', { question: 'q1', answer: 'a1' }),
      rec('t#2', { question: 'q2', answer: 'a2' }),
    ];
    const result = buildAndPersistDataset({
      dataDir,
      enterpriseId: 'ent-test',
      records,
      columns: ['question', 'answer'],
      options: { algorithm: 'sft' },
    });

    // JSONL 落盘可回读，行内样本字段平铺 + __meta 溯源
    expect(existsSync(result.datasetFile)).toBe(true);
    const lines = readFileSync(result.datasetFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first['instruction']).toBe('q1');
    expect((first['__meta'] as Record<string, unknown>)['recordId']).toBe('t#1');

    // dataset_version 记录：hash + 样本数 + 配置（章二验收口径）
    expect(result.version.sampleCount).toBe(2);
    expect(result.version.algorithm).toBe('sft');
    expect(result.version.contentHash).toBe(result.contentHash);
    expect(result.version.version).toBe(result.contentHash.slice(0, 8));

    // 台账可回读
    const versions = readDatasetVersions(dataDir, 'ent-test');
    expect(versions).toHaveLength(1);
    expect(versions[0]?.datasetId).toBe(result.datasetId);
  });

  it('test_recordDatasetVersion_幂等_同版本不重复', () => {
    const base = {
      dataDir,
      enterpriseId: 'ent-test',
      datasetId: 'ds-x',
      contentHash: createHash('sha256').update('v1').digest('hex'),
      sampleCount: 5,
      algorithm: 'sft' as const,
      columnMapping: { instruction: 'q', output: 'a' },
      datasetFile: '/tmp/ds-x/dataset.jsonl',
      createdAt: '2026-08-30T00:00:00.000Z',
    };
    const r1 = recordDatasetVersion(base, 'v1');
    const r2 = recordDatasetVersion({ ...base }, 'v1');
    expect(r2).toEqual(r1);
    expect(readDatasetVersions(dataDir, 'ent-test')).toHaveLength(1);
  });

  it('test_dataset_version_版本链查询与指定版本', () => {
    const mk = (hashSeed: string, at: string, count: number) => ({
      dataDir,
      enterpriseId: 'ent-test',
      datasetId: 'ds-chain',
      contentHash: createHash('sha256').update(hashSeed).digest('hex'),
      sampleCount: count,
      algorithm: 'sft' as const,
      columnMapping: { instruction: 'q', output: 'a' },
      datasetFile: `/tmp/ds-chain/${hashSeed}.jsonl`,
      createdAt: at,
    });
    recordDatasetVersion(mk('seed-1', '2026-08-30T01:00:00.000Z', 10), 'v1');
    recordDatasetVersion(mk('seed-2', '2026-08-30T02:00:00.000Z', 25), 'v2');

    const chain = listDatasetVersions(dataDir, 'ent-test', 'ds-chain');
    expect(chain.map((v) => v.version)).toEqual(['v1', 'v2']);

    const v2 = getDatasetVersion(dataDir, 'ent-test', 'ds-chain', 'v2');
    expect(v2?.sampleCount).toBe(25);
    expect(getDatasetVersion(dataDir, 'ent-test', 'ds-chain', 'v9')).toBeNull();
  });

  it('test_diffDatasetVersions_两版差异概览', () => {
    const from = {
      version: 'v1',
      datasetId: 'ds-d',
      enterpriseId: 'ent-test',
      contentHash: 'a'.repeat(64),
      sampleCount: 100,
      algorithm: 'sft' as const,
      columnMapping: {},
      datasetFile: '/x',
      createdAt: '2026-08-30T01:00:00.000Z',
    };
    const to = {
      ...from,
      version: 'v2',
      contentHash: 'b'.repeat(64),
      sampleCount: 180,
    };
    const diff = diffDatasetVersions(from, to);
    expect(diff.contentChanged).toBe(true);
    expect(diff.sampleCountDelta).toBe(80);
    expect(diff.algorithmChanged).toBe(false);
    expect(diff.summary).toContain('内容已变化');

    // 算法切换 → 不可比标注
    const diffAlgo = diffDatasetVersions(from, { ...to, algorithm: 'dpo' });
    expect(diffAlgo.algorithmChanged).toBe(true);
    expect(diffAlgo.summary).toContain('不可直接对比');
  });
});

// ──────────────────────────────────────
// dataset-validator · 质量闸门
// ──────────────────────────────────────

describe('dataset-validator · 质量闸门', () => {
  /** 造 sft 样本行 */
  const sftLine = (instruction: string, output: string) => ({
    sample: { instruction, input: '', output },
    meta: { source: 'test', recordId: `r-${instruction}` },
  });

  it('test_requiredFieldsOf_按算法三态', () => {
    expect(requiredFieldsOf('sft')).toEqual(['instruction', 'output']);
    expect(requiredFieldsOf('dpo')).toEqual(['prompt', 'chosen', 'rejected']);
    expect(requiredFieldsOf('grpo')).toEqual(['prompt']);
  });

  it('test_validateDataset_达标放行', () => {
    const lines = Array.from({ length: 12 }, (_, i) => sftLine(`q${i}`, `a${i}`));
    const result = validateDataset(lines, 'sft');
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('test_validateDataset_空数据集_结构化拒绝', () => {
    const result = validateDataset([], 'sft');
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.code).toBe('empty_dataset');
  });

  it('test_validateDataset_样本量不足_拒绝', () => {
    // 场景：5 条 < 最低 10 → insufficient_samples 拒绝提交
    const lines = Array.from({ length: 5 }, (_, i) => sftLine(`q${i}`, `a${i}`));
    const result = validateDataset(lines, 'sft');
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.code === 'insufficient_samples')).toBe(true);
    expect(result.violations[0]?.message).toContain('样本量不足');
  });

  it('test_validateDataset_字段缺失_拒绝并给出规模', () => {
    // 场景：12 条中 4 条 output 空 → missing_fields
    const lines = Array.from({ length: 12 }, (_, i) =>
      sftLine(`q${i}`, i < 4 ? '' : `a${i}`),
    );
    const result = validateDataset(lines, 'sft');
    expect(result.passed).toBe(false);
    const v = result.violations.find((x) => x.code === 'missing_fields');
    expect(v).toBeDefined();
    expect(v?.message).toContain('output');
    expect(v?.count).toBe(4);
  });

  it('test_validateDataset_标签单一化_拒绝', () => {
    // 场景：26 条里 25 条同标签 → 占比 96.2% 超上限 95% → 拒绝提交
    const lines = Array.from({ length: 26 }, (_, i) => ({
      sample: { instruction: `q${i}`, input: '', output: i < 25 ? 'A类' : 'B类' },
      meta: { source: 't', recordId: `r${i}` },
    }));
    const result = validateDataset(lines, 'sft', { labelColumn: 'output' });
    expect(result.passed).toBe(false);
    const v = result.violations.find((x) => x.code === 'label_imbalance');
    expect(v).toBeDefined();
    expect(result.labelDistribution?.[0]?.label).toBe('A类');
  });

  it('test_validateDataset_标签列不存在_告警不阻断', () => {
    const lines = Array.from({ length: 12 }, (_, i) => sftLine(`q${i}`, `a${i}`));
    const result = validateDataset(lines, 'sft', { labelColumn: '不存在的列' });
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.code === 'label_column_missing')).toBe(true);
  });

  it('test_validateDataset_接近下限_告警', () => {
    const lines = Array.from({ length: 12 }, (_, i) => sftLine(`q${i}`, `a${i}`));
    const result = validateDataset(lines, 'sft', { minSamples: 10 });
    // 12 条 ≥ 10 放行，但 < 20（2 倍）→ near_min_samples 告警
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.code === 'near_min_samples')).toBe(true);
  });

  it('test_computeLabelDistribution_计数与占比', () => {
    const lines = [
      { sample: { prompt: 'p' }, meta: { source: 't', recordId: 'r1' } },
      { sample: { prompt: 'p' }, meta: { source: 't', recordId: 'r2' } },
    ];
    const dist = computeLabelDistribution(lines, 'prompt');
    expect(dist).toEqual([{ label: 'p', count: 2, ratio: 1 }]);
  });
});

// ──────────────────────────────────────
// 端到端：CSV → 训练集 → 闸门 → 版本（章一验收主链路）
// ──────────────────────────────────────

describe('数据管道端到端（CSV → instruction → 闸门 → 版本）', () => {
  it('test_端到端_CSV文件到带版本训练集_闸门通过', () => {
    // 1. CSV 落盘 → 接入
    const csvPath = join(dataDir, 'faq.csv');
    const rows = Array.from(
      { length: 15 },
      (_, i) => `question-${i},answer-${i}`,
    ).join('\n');
    writeFileSync(csvPath, `question,answer\n${rows}\n`, 'utf8');
    const ingested = ingestFile(csvPath);
    expect(ingested.rowCount).toBe(15);

    // 2. 构建 + 落盘 + 版本
    const built = buildAndPersistDataset({
      dataDir,
      enterpriseId: 'ent-e2e',
      records: ingested.records,
      columns: ingested.columns,
      options: { algorithm: 'sft' },
    });
    expect(built.sampleCount).toBe(15);

    // 3. 质量闸门（读回样本再验——闸门输入是 DatasetLine 形态）
    const jsonl = readFileSync(built.datasetFile, 'utf-8').trim().split('\n');
    const lines = jsonl.map((l) => JSON.parse(l) as Record<string, unknown>);
    const gate = validateDataset(
      lines.map((l) => ({
        sample: l as unknown as { instruction: string; output: string },
        meta: (l['__meta'] ?? {}) as { source: string; recordId: string },
      })),
      'sft',
    );
    expect(gate.passed).toBe(true);

    // 4. eval 可引用版本（章二：可复现）
    const version = getDatasetVersion(dataDir, 'ent-e2e', built.datasetId, built.version.version);
    expect(version?.sampleCount).toBe(15);
  });

  it('test_datasetDir_企业分区路径', () => {
    const dir = datasetDir(dataDir, 'acme', 'ds-1');
    expect(dir).toContain(join('train', 'acme', 'datasets', 'ds-1'));
  });

  it('test_datasetVersionsPath_台账落点', () => {
    const p = datasetVersionsPath(dataDir, 'acme');
    expect(p.endsWith(join('train', 'acme', 'datasets', 'versions.jsonl'))).toBe(true);
  });

  it('test_端到端_空行数据_闸门拒绝提交', () => {
    // 场景：只有表头没有数据行 → 管道 0 记录 → 闸门 empty_dataset 拒绝
    const csvPath = join(dataDir, 'empty.csv');
    writeFileSync(csvPath, 'question,answer\n', 'utf8');
    const ingested = ingestFile(csvPath);
    expect(ingested.rowCount).toBe(0);
    const gate = validateDataset([], 'sft');
    expect(gate.passed).toBe(false);
    expect(gate.violations[0]?.code).toBe('empty_dataset');
  });
});
