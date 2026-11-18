# Edu-Agent (LangGraph + LangChain + GitHub MCP Server)

这是一个教育智能体 MVP：
1) 学生提交代码到 GitHub
2) 系统通过 GitHub MCP Server 拉取代码
3) 系统按 GitHub 代码字节占比确定主要编程语言，从最多六个重要源文件提取连续 2–3 行的原始代码，建立带难度和评分要点的候选池
4) 学生在 Solve 页逐题解释代码；系统根据已评估回答调整下一段代码的难度，通常收集 6–12 题的证据。每题读完反馈后点击 Continue，已评分答案不可修改
5) Review 页展示本次练习的能力层级、技能覆盖和回答证据；不同难度的分数不再直接平均作为能力等级。历史三题会话继续使用旧流程

## 项目结构与首屏整合

`EduAgent-main` 与 `-EduAgent-Final-main` 使用同一套 FastAPI + 原生 JavaScript
ES modules + LangGraph + SQLModel/SQLite 架构。首次对比时，业务文件差异集中在
`main.py`、`core/mcp.py`、`static/index.html` 和 `static/js/pages/create.js`；
出题图、评估图、三题工作流、数据库模型和 Solve/Review 页面一致。

| 层次 | 入口及职责 |
| --- | --- |
| 页面与 HTTP 接口 | `backend/app/main.py`：`/`、`/create`、`/solve`、`/review` 与挑战 API |
| 创建题组 | `graphs/challenge_graph.py`：解析仓库 → 判定主要编程语言 → 选择源文件 → 读取源码 → 构建候选片段池 |
| GitHub 与模型适配 | `core/mcp.py` 提供认证 MCP 工具及 REST tree 回退；`core/llm.py` 提供本地模型 HTTP 调用和结构化输出校验 |
| 作答与评估 | `services/workflow.py` 控制逐题提交、评分重试、反馈确认与综合报告；`graphs/evaluation_graph.py` 执行单题评价 |
| 自适应测评 | `adaptive_challenge.py` 生成并校验候选片段；`adaptive_policy.py` 决定难度、停止条件和能力证据；`adaptive_workflow.py` 提供当前题与确定性报告 |
| 持久化 | `services/repository.py`、`workflow_repository.py` 保存题组快照、不可变答案、评分、继续确认与综合报告 |
| 前端状态 | `static/js/state/workflow-store.js` 缓存当前题目和草稿；URL 中的 `session_id` 恢复服务端进度 |

本次将来源项目的首屏逻辑接入目标项目现有 Create 页面，保留背景、创建表单、
转场及三题流程。新增功能包括：

- GitHub 仓库识别、默认分支自动填写；支持 URL、SSH clone URL 和
  `owner/repo`。分支可手动修改，出题语言由后端按代码字节占比自动判定。
  TypeScript 与 JavaScript 分开选题，C++ 使用 `cpp` 标识。
- 文件树预览、贡献者排行及占比、贡献者分支提交历史、提交详情、30 天趋势、
  星期分布、作者占比与仓库活动概述。
- 更换仓库立即清理旧数据并取消请求；更换分支刷新相关数据；生成前等待仓库
  元数据以取得正确默认分支，重复提交被锁定。浏览器预览超时、私有仓库不可见
  或预览限流时仍可提交创建请求，由服务端认证读取语言统计和源码。

新增代码按职责拆分为 `js/api/repositories.js`（公开只读请求）、
`js/domain/repository.js`（解析和统计）、`js/ui/repository-explorer.js`（请求状态）、
`js/ui/repository-view.js`（展示），样式仅作用于 Create 页的
`repository-explorer.css`。`js/pages/create.js` 继续负责原有创建与跳转流程。

预览与来源项目一致，由浏览器访问 GitHub 公开 REST API，不使用或暴露服务端
PAT。私有仓库的出题仍通过原有服务端认证链路。文件树最多显示 150 条，贡献者
与近期提交各读取最多 100 条；截断和样本范围会在界面标明。贡献者统计为仓库
维度，提交统计与贡献者历史使用所选分支；日统计统一使用 UTC。

后续整体合并时需单独决策的差异：来源项目将 `GitHubMCP` 整体替换为 REST
适配器，并允许 GitHub 初始化失败时继续启动。本次首屏不依赖这两项改动，
因此继续使用目标项目的 MCP 初始化与认证行为；未导入来源的 `main.py.bak`、
编码异常注释或运行数据。

首屏浏览器回归：`backend/tests/frontend/` 下运行 `npm run check:repository`。
环境、隔离测试与截图说明见该目录的 `README.md`。

## 自适应 2–3 行代码解释（workflow_version=3）

新建解释题默认进入此流程；界面只提供代码解释。每题选择连续 2 或 3 行原始源码，
不改写片段、不要求补全/修改代码，也不扩大作答目标。周围文件内容用于理解上下文。

- 先选最多六个主要语言的合格文件，每个文件由模型提出最多六个候选；不强制文件或
  难度凑数。候选必须有实际逻辑、足够上下文、明确评分要点和分级依据。过滤越界、
  重叠、重复片段和整文件副本；只有一行的文件不会产生自适应题。
- L1 为直接语义，L2 为局部变量/条件/调用关系，L3 为隐含状态、执行时机或副作用，
  L4 为上下文足以支持的复杂执行机制。文件路径和关键词不直接决定难度。
- 默认从最接近 L2 的候选开始。同级最近两个有效回答来自不同文件、核心正确性均
  至少 48/60 且通过原有评分约束时，探测高一级；两个回答核心正确性均低于 36/60
  时降低一级。其他情况同级验证。优先不同文件及证据较少的技能，保持原有空答案
  拦截、真实引用校验、分数上限和失败后修改答案机制。表达分数不能触发升级。
- 至少六个有效回答、三个技能各有两个不同文件的观察，并有重复的层级/边界证据
  且无相关冲突时可结束；最多展示十二题。素材耗尽或用户在反馈后主动结束时，
  生成有明确停止原因的报告；未达到证据要求则标为暂定，不补造问题。
- Skip 是明确的“暂时不会”，不计为错误、不降低等级，但占用十二题的展示预算。
  已保存待评估的答案必须先评估，可以修改重试；不能用跳过覆盖该答案。
- 候选池、参考要点、分级理由和源码快照只存服务端。浏览器只能取得当前题、等级、
  技能和不泄露解答的选题说明。难度缺档时选最近的可用等级并明确说明，不重新贴标签。
- Continue 的反馈确认、下一题快照和策略决策在同一 SQLite 写事务中落盘，重复请求
  或多个 worker 竞争只推进一次。评分与继续分开，断网或刷新恢复原题和已保存反馈。
- 报告由保存的单题证据确定性生成，无需再次调用模型。展示各级证据、技能覆盖、
  首次观察/看过相关反馈后的回答及停止原因，不把等权均分当作能力等级。
- 分级和阈值是可解释启发式，尚未用真实答题数据校准。报告只描述本仓库、本语言
  的短代码解释练习，不输出统计置信度或工程师资历。后续校准需要人工复核题目与
  回答并检验模型评分、难度排序、等级一致性及不同语言的适用性。

这是基于证据的自适应练习，采用逐题更新、有限题量和内容覆盖的思想；不声称已实现
经过校准的 IRT 测验。方法背景：[NCLEX 自适应测评说明](https://www.nclex.com/computerized-adaptive-testing.page)、
[BanditCAT 与题目校准研究](https://arxiv.org/abs/2410.21033)。

新增 `POST /api/challenges/{session_id}/skip`、`.../finish`，请求包含当前 `question_id`。
v3 的 `question_count` 表示已发出的题数，最终题数尚未确定；界面读取 `adaptive`
中的最低有效作答数、最高展示题数、已评分/跳过数及 `next_action`。
策略版本随会话保存，无新增数据库列；重启后端并新建会话即可使用。现有 v1/v2
快照不会自动改成自适应模式。API 显式传 `assessment_mode: "fixed"`，或旧补全请求，
仍使用原三题逻辑，供历史兼容与回归验证。

测试：`tests/test_adaptive_workflow.py` 使用合成模型适配器验证路由、短片段、隐私、
题量、事务幂等、失败恢复、跳过与证据报告；这些测试不代表真实模型的测量准确率。

### 第三页可视化

Review 使用本地 SVG 和保存的评分数据展示：逐题分数柱状图、对齐题号的 L1–L4
难度轨迹、回答状态环图以及按回答数量绘制的技能覆盖条形图。分数和难度使用独立
坐标，图表不把不同难度的分数转换为能力百分比。跳过或未验证的评分显示 `—`，
与真实零分区分；未测到的技能标为未评估。

点击柱形或题号可查看该题的文件位置、分数、难度和原有回答证据，并定位到证据详情。
题号支持方向键、Home/End；另提供等价的数据表格。手机上图表可横向滚动，点击题号
会自动定位对应数据。图表无外部 CDN 依赖，不调用模型、不改写已保存评分。

旧三题会话的 Review API 增加只读 `observations` 投影，从已有单题评分读取图表数据，
不暴露参考源码或完整提交，也不补造旧会话没有记录的难度/技能。已有自适应报告
直接复用 `evaluation.observations`，刷新即可显示图表；旧单题报告保持原样。

实现：`static/js/ui/review-charts.js`、`static/review-charts.css`。
浏览器图表检查：`npm run check:review-charts`，运行方式见 `backend/tests/frontend/README.md`。

## 兼容的三题工作流（workflow_version=2）

- Create 仅需仓库、分支和题型，不指定语言或文件路径。
- 文件选择优先入口、核心逻辑、请求处理及数据模块，并兼顾不同目录；排除依赖、构建产物、测试及生成目录。
- 必须有三个符合主要编程语言的独立源文件；不足时明确报错，不重复文件或混入其他语言凑题。
- Solve 每次只获取当前题目，刷新或换浏览器可通过 URL 中的 session_id 恢复服务端进度；未提交草稿仍仅保存在当前浏览器会话中。
- 已完成评分的答案不可修改，同一答案的重试不会重复推进或重新评估已成功的题目；参考源码快照仅保存在服务端，不向作答页面暴露。
- Solve 评估失败时停留当前题，答案已保存且允许编辑；刷新或换浏览器可恢复已提交答案，原样点击 Retry assessment 或修改后点击 Submit revised answer。`completed_count` 仅计入评估完成的题目。已有失败会话同样适用，无需重新创建题组。
- 未评分答案的修改会重新校验；无效修改不覆盖已保存答案。相同题目和服务端答案下的本地修改草稿（包括清空输入）可在刷新后恢复；服务端答案已变化或已评分时，以服务端版本为准。
- 评估成功后状态为 `feedback_ready`，不会自动切题；反馈和继续确认均保存在服务端。刷新仍显示当前反馈，最后一题点击 Continue 后才进入总评估。
- Review 汇总已保存的三份评估，并通过只读 `observations` 返回逐题图表所需的分数、位置和证据。汇总失败可单独重试，刷新最终报告不会重新评分。
- 旧版本已保存但未评估的答案可回到对应 `/solve?session_id=...` 逐题重试评估，不需要重新填写；已完成的报告继续可用。
- 同一 Web worker 内的重复评估请求按会话串行，SQLite 事务保护答案顺序与结果写入；保存评分时核对实际评估的答案快照，拒绝将旧评分写到新答案上。多 worker 部署如需跨进程防重复模型调用，应另加分布式锁。
- 评估为 AI + 静态规则检查，不执行学生代码，不代表已通过运行测试。
- 启动时自动创建 `questionanswer`、`workflowreview` 与 `questionfeedbackreceipt` 表，不修改原有表；旧单题会话仍可读取、提交和查看评价。

主要接口：`POST /api/challenges/create`、`GET /api/challenges/{session_id}`、
`POST /api/challenges/{session_id}/submit`（新会话必须带 `question_id`）、
`POST /api/challenges/{session_id}/continue`（阅读本题反馈后确认，必须带 `question_id`）、
`GET /api/challenges/{session_id}/review`、`POST /api/challenges/{session_id}/review/evaluate`。

验证：从 `backend/` 运行 `.venv-local/bin/python -m pytest tests -q`。
真实前后端集成测试（GitHub/模型使用固定适配器、数据库隔离）见 `backend/tests/frontend/README.md`。

### 第二页评分规则

新评分链路只评估学生实际作答：解释题只看解释文本，补全题只看替换 BLANK 的
代码片段。题目自带源码、未修改的上下文及整文件相似度均不计分。

- 空白、零宽字符、纯数字/符号解释和明显占位回答在前后端拦截；后端返回 422，
  不保存答案、不调用模型，用户可直接修改。没有最低字数要求，简短中文解释可正常评分。
- 补全题校验区域边界、残留标记、空白/注释占位以及可确定的无效字面量替换；
  不能改动题目周围的源码。Python 通过 AST 区分无效果语句与表达式中的合法字面量，
  其他语言仅对明确的 return/赋值/声明被裸字面量替换做静态拦截；不执行学生代码。
- 模型按语义正确性 60、推理与上下文 25、表达/代码质量 15 分输出分项理由及
  学生回答中的原文证据；后端校验证据确实来自实际回答，再汇总总分。
- 零分项的评语为空、缺失或 null 时，补充“不授予该项分数”的中性说明，保留
  原始零分；正分项仍必须有理由和学生原文证据。如果所有必需字段完整有效，
  仅可选 `suggestions` 的 JSON 内容损坏，则省略建议；评分字段损坏仍必须修复或重试。
- 核心回答错误或不相关最高 20 分；缺失关键行为或存在关键错误最高 59 分；
  80 分以上必须至少取得 48/60 的语义正确性得分。分项合计、总分及通过状态保持一致。
- 模型引用了不存在的回答、引用系统源码冒充学生证据或返回非法分项分数时，
  评估失败并允许修改答案或 Retry assessment；保留已提交答案，不猜测分数或惩罚学生。
  模型修复请求附带具体校验错误；页面仅展示可操作的错误提示，原始诊断留在后端日志。
- 新评估保存 `grading_version=evidence_rubric_v2`、`score_breakdown`（含证据）与
  `score_caps`，第二页反馈显示分项、依据和适用的扣分限制。

更新后重启后端，新提交使用新规则。历史已评分记录保持原样；旧版已保存但尚未
评分的无效答案会被确定性评为 0 分，允许继续流程，避免被锁死。
语义判分仍依赖模型，静态规则不保证任意错误答案都能被识别；模型升级时应使用
人工标注的正确、部分正确、错误和无关答案重新校准。回归用例见
`backend/tests/test_assessment.py` 及三题接口/浏览器测试。

### 按主要编程语言自动出题

1. 后端通过 GitHub `GET /repos/{owner}/{repo}/languages` 读取各语言的**代码字节数**。
   依据为字节占比，不是文件个数、文件行数或浏览器中的 `language` 字段。
2. 使用随项目固定的 GitHub Linguist 语言分类排除 markup、data、prose；
   HTML、CSS、文档以及 Jupyter Notebook 容器不会参与编程语言排名。
3. 在编程语言中选择字节数最多的一种；并列时按语言名称字母顺序确定，保证
   API 字段顺序变化不影响选题。先确定最大语言，再检查支持情况，不跳过它
   去选占比第二的受支持语言。
4. 按选中的语言筛选所选分支的源文件，再沿用入口、核心逻辑、数据模块和
   目录多样性排序规则选出最多六个候选文件；兼容的固定流程仍选择三个文件。

当前支持 Python、JavaScript、TypeScript、Java、Go、C、C++。JavaScript 支持
`.js/.jsx/.mjs/.cjs`，TypeScript 支持 `.ts/.tsx/.mts/.cts`，两者不混选；
`.d.ts/.d.mts/.d.cts` 声明文件不出题。C 和 C++ 分开筛选，并排除语言归属
不明确的 `.h` 头文件；`.C` 按 C++ 处理。

**统计范围**：GitHub 的语言接口不接受分支参数，统计来自仓库默认分支，可能
随 GitHub 的异步分析更新。用户选择的分支控制实际取文件的版本。如果该分支
没有主要语言的合格文件，创建会报错，不改选其他语言；固定流程要求三个文件。
展示的百分比以
GitHub 返回的全部语言字节数为分母，而非只对编程语言重新归一化。

空统计、只有非编程语言、最大语言不受支持或源码不足返回 HTTP 400；语言
接口超时、权限/限流、格式异常或分类未知返回 HTTP 502。失败时不调用出题模型，
不保存不完整题组，也不默认退回 Python。浏览器预览是否成功不影响后端的独立
语言判定；服务端可复用 `GITHUB_MCP_PAT` 访问已授权私有仓库。

新请求不发送 `language`；API 暂时接受旧客户端传来的该字段，但忽略它。
检测结果写入会话的 `language` 字段和题组的 `language_selection` 快照，包含
字节分布、占比、来源及统计范围。题目生成、评分和恢复进度都沿用该快照，
不会因仓库之后改变语言比例而改写已有题目。v3 的 `selection_reason` 说明动态
选题依据，`language_selection` 保存语言统计；旧流程的选题说明包含语言及文件职责。

实现入口：`services/repository_language.py`；离线分类数据：
`services/language_catalog.py`，文件头记录固定上游 revision，许可证随附。
口径参考：[GitHub Languages API](https://docs.github.com/en/rest/repos/repos#list-repository-languages)、
[GitHub Linguist 语言分类](https://github.com/github-linguist/linguist/blob/73ee9a3b277f398c37ca4ab0dea0193849de6460/lib/linguist/languages.yml)。

### 创建性能

筛选优先读取完整递归目录树；当 MCP 没有目录树工具时，通过 GitHub 只读
Trees API 一次读取目录结构，复用现有 `GITHUB_MCP_PAT`。接口不可用、权限受限
或返回截断目录树时，仍回退到目录扫描与代码搜索。目录扫描提前跳过不会参与
排名的依赖、测试和文档目录，保留原有重要性和多模块覆盖规则。

可在 `backend/.env` 调整以下参数：

- `GITHUB_READ_CONCURRENCY=4`：目录请求及文件读取的并发上限（1–8）。
- `GITHUB_READ_TIMEOUT_SECONDS=15`：单次 GitHub 请求超时。
- `CHALLENGE_GENERATION_CONCURRENCY=2`：按文件生成候选或旧题目的并发上限（1–3）；若本地模型
  不支持高效并发，可设为 1，文件筛选的加速不受影响。

不会缓存分支名对应的旧选题。候选生成完成且至少有一个合格片段后才创建新会话；
旧固定流程仍要求三题全部成功。候选排序不受请求完成顺序影响。后续自适应选题
在已保存候选池中完成，不在 Continue 请求中追加模型调用。
创建响应的 `Server-Timing` 头及后端阶段日志分别记录
`detect_language`、`select_files`、`fetch_files`、`generate_questions` 的耗时，方便定位实际瓶颈。

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
