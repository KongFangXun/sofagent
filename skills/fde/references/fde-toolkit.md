# FDE 技术工具包

## 一、AI/ML 技术栈选型

### 1.1 大模型应用开发

| 场景 | 推荐方案 | 适用条件 |
|------|---------|---------|
| 知识问答/客服 | RAG + LangChain/LlamaIndex | 有结构化/非结构化文档 |
| 文档处理 | Unstructured + Embedding + 向量库 | PDF/Word/图片 OCR |
| 代码助手 | Copilot/Cursor API 集成 | 开发效率工具 |
| 数据分析 NL2SQL | Text-to-SQL + Agent | 数据库查询场景 |
| 工作流自动化 | LangGraph / n8n | 多步骤业务流程 |

### 1.2 RAG 系统搭建速查

```python
# RAG 最小可行实现
# 1. 文档加载
from langchain.document_loaders import DirectoryLoader
loader = DirectoryLoader("./docs/", glob="**/*.pdf")
documents = loader.load()

# 2. 文档切分
from langchain.text_splitter import RecursiveCharacterTextSplitter
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
chunks = splitter.split_documents(documents)

# 3. 向量存储（推荐 Chroma 用于原型，Milvus 用于生产）
from langchain.vectorstores import Chroma
from langchain.embeddings import OpenAIEmbeddings
vectorstore = Chroma.from_documents(chunks, OpenAIEmbeddings())

# 4. 检索链
from langchain.chains import RetrievalQA
qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(),
    retriever=vectorstore.as_retriever()
)
```

**RAG 优化清单：**
- [ ] 文档切分策略（按语义 vs 按长度）
- [ ] 检索策略（相似度 vs MMR vs 混合检索）
- [ ] Reranking（用 Cross-encoder 提升精度）
- [ ] 引用溯源（返回答案时标注来源）
- [ ] Query Rewriting（用户问题扩展改写）

### 1.3 Prompt Engineering 模式

| 模式 | 用途 | 示例 |
|------|------|------|
| Few-shot | 引导输出格式 | "以下是 3 个示例，请按同样格式输出..." |
| Chain-of-Thought | 复杂推理 | "请逐步思考..." |
| Role Playing | 设定专业角色 | "你是一位有 10 年经验的 XX 专家..." |
| Structured Output | 控制输出格式 | "请以 JSON 格式输出，字段包括..." |
| Self-Refine | 提升质量 | "请检查你的回答是否准确，如有问题请修正" |

### 1.4 模型选型决策树

```
需要本地部署？
├── 是 → 数据敏感/离线场景？
│   ├── 是 → Qwen2.5 / DeepSeek 本地部署
│   └── 否 → 考虑边缘推理模型
└── 否 → 调用云端 API
    ├── 通用任务 → GPT-4o / Claude
    ├── 中文场景 → Qwen / DeepSeek / 百川
    └── 成本敏感 → GPT-4o-mini / Qwen-Turbo
```

---

## 二、快速原型工具

| 工具 | 用途 | 上手时间 |
|------|------|---------|
| Streamlit | 数据应用/仪表盘 | 30 分钟 |
| Gradio | ML 模型演示 | 15 分钟 |
| FastAPI | API 服务 | 1 小时 |
| Next.js + shadcn/ui | 前端原型 | 2 小时 |
| Retool / Dify | 低代码内部工具 | 1 小时 |

---

## 三、系统集成模式

### 3.1 常见集成场景

| 模式 | 方案 | 适用场景 |
|------|------|---------|
| API 网关 | Nginx/Kong + FastAPI | 对外的 REST API |
| 数据库直连 | SQLAlchemy + 只读副本 | 数据分析场景 |
| 消息队列 | Kafka/RabbitMQ | 实时数据流 |
| 文件交换 | SFTP/S3 批量导入 | 批量数据场景 |
| Webhook | FastAPI + 签名验证 | 事件驱动 |
| 嵌入式 SDK | Python/JS SDK | 深度集成 |

### 3.2 Docker 部署模板

```dockerfile
# FDE 快速部署 Dockerfile 模板
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml 模板
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - db
      - redis
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
  redis:
    image: redis:7-alpine
```

---

## 四、数据工程速查

### 4.1 数据质量检查 SQL

```sql
-- 通用数据质量检查模板
-- 1. 总行数
SELECT COUNT(*) as total_rows FROM {table};

-- 2. 各列缺失率
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN col1 IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as col1_null_pct,
  SUM(CASE WHEN col2 IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as col2_null_pct
FROM {table};

-- 3. 各列唯一值数量
SELECT
  COUNT(DISTINCT col1) as col1_distinct,
  COUNT(DISTINCT col2) as col2_distinct
FROM {table};

-- 4. 数值列统计
SELECT
  MIN(col) as min_val,
  MAX(col) as max_val,
  AVG(col) as avg_val,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY col) as median_val
FROM {table};
```

### 4.2 数据清洗 Python 模板

```python
import pandas as pd

def quick_data_audit(df: pd.DataFrame) -> dict:
    """60秒快速数据审计"""
    return {
        "shape": df.shape,
        "dtypes": df.dtypes.to_dict(),
        "null_pct": (df.isnull().sum() / len(df) * 100).to_dict(),
        "duplicates": df.duplicated().sum(),
        "memory_mb": df.memory_usage(deep=True).sum() / 1024 / 1024
    }

def auto_clean(df: pd.DataFrame) -> pd.DataFrame:
    """基础自动清洗"""
    # 去除全空列
    df = df.dropna(axis=1, how='all')
    # 去除全空行
    df = df.dropna(axis=0, how='all')
    # 去除完全重复行
    df = df.drop_duplicates()
    # 去除列名前后的空格
    df.columns = df.columns.str.strip()
    return df
```

---

## 五、安全合规速查

### 5.1 数据安全法则

```markdown
FDE 必须遵守的安全红线：

1. 生产数据绝不下载到个人设备
2. 测试环境必须使用脱敏数据
3. API Key / 密码绝不硬编码
4. 日志中绝不打印敏感信息（手机号、身份证等）
5. 数据传输必须加密（HTTPS/TLS）
6. 第三方依赖必须经过安全审查
```

### 5.2 合规关切点（按行业）

| 行业 | 关键合规要求 |
|------|------------|
| 金融 | PCI-DSS, 数据不出境, 等保三级 |
| 医疗 | HIPAA, 个人信息保护法, 医疗器械注册 |
| 政府 | 等保, 信创, 国产化要求 |
| 跨境 | GDPR, 数据出境安全评估 |
```

---

## 六、FDE 效率武器

### 6.1 AI Coding 工作流

```markdown
FDE 的 AI 辅助编码最佳实践：

1. 先用 AI 生成脚手架，再手动精修
2. 明确告诉 AI 当前技术栈和约束
3. 让 AI 写测试（比自己写快 10x）
4. 让 AI 写文档注释（写完代码立即生成）
5. 用 AI 做代码审查（发现逻辑漏洞）
6. 让 AI 生成错误处理代码
```

### 6.2 常用命令速查

```bash
# Docker 常用
docker-compose up -d          # 启动服务
docker-compose logs -f app    # 查看日志
docker exec -it container bash # 进入容器

# 日志排查
tail -f /var/log/app.log | grep ERROR
journalctl -u myapp -f

# 网络排查
curl -v http://localhost:8000/health
netstat -tlnp | grep 8000

# 性能
htop                           # 系统资源
docker stats                   # 容器资源
```
