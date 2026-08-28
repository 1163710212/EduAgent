# Edu-Agent (LangGraph + LangChain + GitHub MCP Server)

这是一个教育智能体 MVP：
1) 学生提交代码到 GitHub
2) 系统通过 GitHub MCP Server 拉取代码
3) LLM 生成“挑战版代码”（同义/重命名/留空 TODO 等），返回到网页客户端
4) 学生在网页里补全/解释
5) LLM + 规则评估学生提交，输出评分与反馈

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
uvicorn app.main:app --host 127.0.0.1 --port 8012 --reload
#安装llm
运行 /home/choxia/Data/EduAgent-main/ollama_install.ipynb
ollama run llama3.1
ollama run llama3.1:8b

#绑定远程端口 （mimas2替换为实际节点）
ssh -J choxia@access.ihpc.uts.edu.au -L 8000:127.0.0.1:8012 choxia@mimas2
#运行llm接口
nohup python /home/choxia/Data/EduAgent-main/run_llama.py &

#本地访问
http://127.0.0.1:8000/
