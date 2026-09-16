# 智能邮箱 (AI Mail)

个人 Web 智能邮箱客户端:接入你现有的邮箱账号(IMAP/SMTP),提供 AI 摘要、智能分类、
AI 代笔、定时发送等能力。设计文档见 [docs/](./docs)。

## 架构

```
apps/
  web/            React SPA (Vite)
  server/         NestJS API + 同步/AI Worker
packages/
  shared/         前后端共享类型
  mail-core/      IMAP 同步 / MIME 解析 / SMTP 发送(纯库)
```

## 快速开始

要求:Node >= 20、pnpm >= 9、Docker。

```bash
# 1. 启动基础设施(PostgreSQL+pgvector / Redis / Meilisearch)
pnpm infra

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp apps/server/.env.example apps/server/.env
#    编辑 .env,至少设置 DATABASE_URL 的密码与 MASTER_KEY(32字节hex)

# 4. 初始化数据库
pnpm db:generate && pnpm db:migrate

# 5. 启动开发服务(server:3000 / web:5173)
pnpm dev
```

默认账号体系:第一个注册的用户即管理员,注册后到「设置 → 账号管理」接入邮箱。

## LLM 配置

AI 能力通过 OpenAI 兼容协议调用,`.env` 中配置:

```
AI_PROVIDER_BASE_URL=https://api.deepseek.com/v1   # 可换 GLM/Ollama 等
AI_PROVIDER_API_KEY=sk-xxx
AI_MODEL_CHAT=deepseek-chat
AI_MODEL_LIGHT=deepseek-chat                        # 分类等轻任务
```

不配置时产品仍可作为纯邮箱客户端使用(AI 功能自动降级)。

## 开发里程碑

- [x] M1-S1 项目骨架 + 基础设施
- [ ] M1-S2 IMAP 同步引擎 + 邮件解析入库
- [ ] M1-S3 收件箱/阅读 UI + 实时推送
- [ ] M1-S4 写信 + 发送 + 定时发送
- [ ] M1-S5 AI 网关 + 摘要/分类/今日重点
- [ ] M1-S6 AI 代笔/回复建议/语气调整 + 全文搜索
