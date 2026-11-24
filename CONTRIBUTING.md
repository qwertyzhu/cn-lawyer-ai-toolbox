# 贡献指南（CONTRIBUTING）

非常欢迎全国执业律师、法务、法学研究者以及法律科技开发者参与完善「中国律师 AI 工具箱」！无论你是提交最新年度的 LPR / 节假日 / 省市社平工资参数，补充最高法新发布的要素式起诉状案由模板，还是修复一个前端体验细节，每一次贡献都能帮无数同行省下宝贵的办案时间。

## 最受欢迎的贡献方向

1. **年度与地方实务基准维护**：
   - 央行最新 1 年/5 年期 LPR 调息表更新（`src/tools/website/LprInterestCalculator.tsx`）
   - 国务院办公厅年度法定节假日与调休安排（`src/tools/website/DateCalculator.tsx`）
   - 各省市最新在岗职工平均工资、工伤赔偿标准与律师费行业指导标准（`src/tools/website/`、`vendor/lawyer-fee-workbench.source.html`）
2. **最高法要素式示范文本扩充**：
   - 补充更多细分案由的表格化起诉状/答辩状/申请书模板（`src/data/elementsComplaintTemplates.ts`）
3. **离线法典与实务提示完善**：
   - 补充或校对最新修正的法律、司法解释条文及 `litTips` / `nonLitTips` 实务提示
4. **工程体验与无障碍优化**：
   - 移动端 / 微信内置浏览器兼容性修复、PWA 离线体验优化、无障碍支持等

## 本地开发流程

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/qwertyzhu/cn-lawyer-ai-toolbox.git
cd cn-lawyer-ai-toolbox

# 2. 安装依赖（推荐 Node.js >= 20 / 22）
npm ci

# 3. 启动热更新开发服务器（默认 AUTH_MODE=open 免激活开箱即用）
npm run dev

# 4. 提交前务必跑通完整构建、单元测试与开源防泄密守卫
npm run build
npm test
npm run test:guard
```

## 提交 PR 的隐私与合规红线

为保护委托人隐私与律所信息安全，所有 Pull Request **必须严格遵守以下红线**（GitHub Actions CI 中的 `tests/oss_guard.py` 也会自动拦截）：

- ❌ 严禁提交任何真实当事人的姓名、身份证号、手机号、银行账号、企业真实纠纷文书或未脱敏案号；
- ❌ 严禁提交真实的大模型 API Key、IMA OpenAPI 凭据、SSH 私钥、服务器真实 IP、律所内部 OA 地址或 `TR-MASTER-...` / `TR1-...` 真实签发凭证；
- ❌ 严禁直接复制受版权保护的第三方付费法律数据库内容、收费课程讲义或未经授权的第三方模板；
- ✅ 测试用例与示例文本统一使用虚构主体（如“杭州示例商贸有限公司”“张示范”“李示例”）。

## 协议约定

根据 [Apache License 2.0](./LICENSE) 第 5 条，您向本仓库提交的所有贡献默认采用 Apache-2.0 许可协议开放。
