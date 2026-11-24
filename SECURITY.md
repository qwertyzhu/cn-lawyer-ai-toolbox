# 安全架构与漏洞披露指南（SECURITY）

## 1. 隐私与本地安全设计原则

「中国律师 AI 工具箱」采用**本地优先（Local-First） + BYOK（自带密钥）**架构：

- **零遥测 / 零追踪**：不包含第三方统计代码、广告 SDK 或行为埋点。
- **API Key 仅存本机**：用户在“我的配置”中填入的 DeepSeek / 阿里云百炼 / Kimi / OpenAI / Claude 等 API Key 仅存储在当前设备的浏览器 `localStorage` 中；开启本机 4–8 位 PIN 码保险箱后，将以 Web Crypto `PBKDF2 + AES-256-GCM` 密文落盘。
- **100% 本地离线工具**：案件隐私脱敏与还原、证据 PDF 合并/分卷/页码水印、要素式起诉状 OOXML `.docx` 生成、4,111 条法典检索与所有费用/期限计算均在浏览器端离线完成，文件永不离开本机。

## 2. 自建服务端安全基线（Node.js / Docker 部署必读）

若您使用内置的 `server/index.mjs`（而非纯静态托管）向公网开放部署，请注意以下安全红线：

1. **防开放代理滥用（`/api/ai-relay`）**：
   - 服务端仅当显式配置 `ENABLE_AI_RELAY=true` 且目标 URL 属于允许的 HTTPS 模型商白名单（且拒绝一切内网/回环/元数据 IP，防 SSRF）时才转发请求。
   - 已内置单 IP 滑动窗口限流（默认每分钟 30 次，可通过 `AI_RELAY_RATE_LIMIT_PER_MIN` 调整）。**如面向公网开放 `AUTH_MODE=open` 站点，建议将 `ENABLE_AI_RELAY=false`（让浏览器直接直连支持 CORS 的模型商，如 DeepSeek / 阿里云百炼 / 智谱），或在 Nginx/Caddy 层叠加访问鉴权与限流，避免成为免费中转出口。**
2. **律所团队模式（`AUTH_MODE=license`）私钥保管**：
   - 运行 `npm run init-keys` 生成的 `ops/.keys/firm-master-signing-key.json` 与 `TR-MASTER-...` 签发主密钥属于本所最高权限凭据（ECDSA P-256 私钥），已默认写入 `.gitignore` 并设置 `chmod 600`。
   - **严禁将 `ops/.keys/`、`.env`、`.ima-credentials.json`、`.account-registry.json` 或本地双击发码器 HTML 上传至任何公开或多人共享代码仓库！**
   - 服务端与前端只持有配对的 **P-256 公钥**，即使服务器被完整打包泄露也无法伪造新激活码或接管主任管理台。
3. **IMA 知识库 OpenAPI 凭据**：
   - 若您为团队配置了自有的腾讯 IMA 知识库 OpenAPI 凭据（`IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`），该凭据仅在服务端 `.env` 中读取，前端永不可见，且建议仅配合 `AUTH_MODE=license` 使用。

## 3. 报告安全漏洞

如果您在本项目中发现安全漏洞（例如 XSS、SSRF、激活码验签绕过、本地脱敏绕过或潜在敏感信息泄露）：

- 请勿直接在公开 Issue 中披露可被直接利用的 PoC 细节；
- 请通过本仓库 GitHub **Security Advisories（私密漏洞报告）** 提交详细信息及复现步骤，我们会在收到后尽快核验并发布修复版本。
