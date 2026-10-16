# Edu-Agent (LangGraph + LangChain + GitHub MCP Server)

这是一个教育智能体 MVP：
1) 学生提交代码到 GitHub
2) 系统通过 GitHub MCP Server 拉取代码
3) 系统按仓库结构自动选择三个重要源文件，分别生成解释题或补全题
4) 学生在 Solve 页按顺序提交第 1、2、3 题；每题提交后保存并评估，展示本题分数、反馈和建议，点击 Continue 后才进入下一题，不可回退修改
5) Review 页只生成并展示跨题综合反馈，不展示逐题评估；综合分为三题等权平均（保留一位小数）

## 三题工作流

- Create 仅需仓库、分支、语言和题型，不再指定文件路径。
- 文件选择优先入口、核心逻辑、请求处理及数据模块，并兼顾不同目录；排除依赖、构建产物、测试及生成目录。
- 必须有三个符合所选语言的独立源文件；不足时明确报错，不重复同一文件凑题。
- Solve 每次只获取当前题目，刷新或换浏览器可通过 URL 中的 session_id 恢复服务端进度；未提交草稿仍仅保存在当前浏览器会话中。
- 已提交答案不可修改，同一答案的重试不会重复推进或重新评估已成功的题目；参考源码快照仅保存在服务端，不向作答页面暴露。
- Solve 评估失败时停留当前题，答案已保存并锁定；刷新或换浏览器可恢复已提交答案，点击 Retry assessment 重试。`completed_count` 仅计入评估完成的题目。
- 评估成功后状态为 `feedback_ready`，不会自动切题；反馈和继续确认均保存在服务端。刷新仍显示当前反馈，最后一题点击 Continue 后才进入总评估。
- Review 只汇总已保存的三份评估，响应不包含逐题分数或反馈。汇总失败可单独重试，刷新最终报告不会重新评分。
- 旧版本已保存但未评估的答案可回到对应 `/solve?session_id=...` 逐题重试评估，不需要重新填写；已完成的报告继续可用。
- 同一 Web worker 内的重复评估请求按会话串行，SQLite 事务保护答案顺序与结果写入；多 worker 部署如需跨进程防重复模型调用，应另加分布式锁。
- 评估为 AI + 静态规则检查，不执行学生代码，不代表已通过运行测试。
- 启动时自动创建 `questionanswer`、`workflowreview` 与 `questionfeedbackreceipt` 表，不修改原有表；旧单题会话仍可读取、提交和查看评价。

主要接口：`POST /api/challenges/create`、`GET /api/challenges/{session_id}`、
`POST /api/challenges/{session_id}/submit`（新会话必须带 `question_id`）、
`POST /api/challenges/{session_id}/continue`（阅读本题反馈后确认，必须带 `question_id`）、
`GET /api/challenges/{session_id}/review`、`POST /api/challenges/{session_id}/review/evaluate`。

验证：从 `backend/` 运行 `.venv-local/bin/python -m pytest tests -q`。
真实前后端集成测试（GitHub/模型使用固定适配器、数据库隔离）见 `backend/tests/frontend/README.md`。

### 创建性能

筛选优先读取完整递归目录树；当 MCP 没有目录树工具时，通过 GitHub 只读
Trees API 一次读取目录结构，复用现有 `GITHUB_MCP_PAT`。接口不可用、权限受限
或返回截断目录树时，仍回退到目录扫描与代码搜索。目录扫描提前跳过不会参与
排名的依赖、测试和文档目录，保留原有重要性和多模块覆盖规则。

可在 `backend/.env` 调整以下参数：

- `GITHUB_READ_CONCURRENCY=4`：目录请求及文件读取的并发上限（1–8）。
- `GITHUB_READ_TIMEOUT_SECONDS=15`：单次 GitHub 请求超时。
- `CHALLENGE_GENERATION_CONCURRENCY=2`：三题生成的并发上限（1–3）；若本地模型
  不支持高效并发，可设为 1，文件筛选的加速不受影响。

不会缓存分支名对应的旧选题。三题全部生成成功后才创建会话，并且题目顺序不受
请求完成顺序影响。创建响应的 `Server-Timing` 头及后端阶段日志分别记录
`select_files`、`fetch_files`、`generate_questions` 的耗时，方便定位实际瓶颈。

### 源码读取保护

新题目的解释目标和填空范围默认均为连续 2–3 行源码，周围源码保持显示。
后端会约束模型给出的行号；解释片段长度或范围不符时使用选中原文，避免截断
模型改写导致代码损坏。只有一行的文件按实际长度处理，已有题目快照不改写。

文件解析兼容 MCP 原始资源和 LangChain 适配器转换后的文本块，过滤下载成功
提示，保留真实源码。只有提示、资源链接、无效编码或无法明确识别源码的响应
会导致创建失败（HTTP 502），不会调用模型或保存不完整题组。

如果旧题目中已经出现 `successfully downloaded text file (SHA: ...)`，更新并
重启后端后，请回到 `/create` 重新生成题组。旧会话保存的是当时的题目快照，
刷新不会重新拉取源码；修复不会删除或改写已有会话和答案。
读取、提交或评价含下载提示的旧题组时，API 返回 HTTP 409 并提示重新创建，
不会继续展示伪代码或为其生成评分；新题组入库前也会检查这类污染。

## 依赖
- Python 3.11+
- 一个 LLM Key（默认示例使用 OpenAI 兼容的 `OPENAI_API_KEY`）
- GitHub MCP：
  - 推荐使用 GitHub 远程 MCP: https://api.githubcopilot.com/mcp/
  - 用 PAT 认证：Authorization: Bearer <PAT>
  - 只读模式与 toolsets 通过 header 控制（本项目默认只读 + repos toolset）

## 快速开始（本地）
1) 复制环境变量
```bash
cp .env.example backend/.env

cd /data/choxia/EduAgent-main/backend
source .venv-local/bin/activate
# /data 为跨服务器共享目录时，使用轮询，避免远端编辑没有触发热重载。
WATCHFILES_FORCE_POLLING=true uvicorn app.main:app --host 127.0.0.1 --port 8012 --reload --reload-dir app
#安装llm
运行 /home/choxia/Data/EduAgent-main/ollama_install.ipynb
ollama run llama3.1
ollama run llama3.1:8b

#绑定远程端口 （mimas2替换为实际节点）
ssh -J choxia@access.ihpc.uts.edu.au -L 8000:127.0.0.1:8012 choxia@mimas1
#运行llm接口
nohup python /home/choxia/Data/EduAgent-main/run_llama.py &

#本地访问
http://127.0.0.1:8000/
