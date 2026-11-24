import type { AiImageAttachment, AiProtocol, AiProviderConfig } from '../types/toolbox';
import { getSavedLicense } from './licenseEngine.ts';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  fastModel: string;
  reasoningModel: string;
  visionModel: string;
  applyUrl: string;
  badge: string;
  guide: string;
}

export const AI_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方（国内直连 · 强烈推荐）',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    fastModel: 'deepseek-chat',
    reasoningModel: 'deepseek-reasoner',
    visionModel: '',
    applyUrl: 'https://platform.deepseek.com/api_keys',
    badge: '性价比之王 · 纯文本接口',
    guide: '访问 platform.deepseek.com 微信扫码登录 → API Keys → 创建密钥，充值 10 元即可用数月（注：DeepSeek 官方暂仅支持文本，如需上传截图识图可新增阿里云百炼/硅基流动/智谱等）。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow（聚合多模型 · 支持截图）',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    fastModel: 'deepseek-ai/DeepSeek-V3',
    reasoningModel: 'deepseek-ai/DeepSeek-R1',
    visionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    applyUrl: 'https://cloud.siliconflow.cn/account/ak',
    badge: '国内直连 · 文本+识图全能',
    guide: '访问 cloud.siliconflow.cn 手机号注册 → API 密钥 → 新建密钥，一个 Key 同时支持 DeepSeek 文本推理与 Qwen2.5-VL 截图识别。',
  },
  {
    id: 'aliyun-bailian',
    name: '阿里云百炼 · 通义千问（支持截图）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fastModel: 'qwen-plus',
    reasoningModel: 'qwq-plus',
    visionModel: 'qwen-vl-max-latest',
    applyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    badge: '杭州同城极速 · 识图强项',
    guide: '使用支付宝/阿里云账号登录百炼控制台 → 右上角 API-KEY 管理 → 创建 API-KEY，原生支持合同/聊天记录高清截图识别。',
  },
  {
    id: 'moonshot-kimi',
    name: 'Moonshot Kimi（超长卷宗 · 支持截图）',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    fastModel: 'kimi-k2-0711-preview',
    reasoningModel: 'kimi-thinking-preview',
    visionModel: 'moonshot-v1-32k-vision-preview',
    applyUrl: 'https://platform.moonshot.cn/console/api-keys',
    badge: '长合同/长笔录强项',
    guide: '登录 platform.moonshot.cn 开放平台 → API Key 管理 → 新建密钥（支持长文档及视觉识图模型）。',
  },
  {
    id: 'zhipu-glm',
    name: '智谱清言 BigModel（GLM · 支持截图）',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    fastModel: 'glm-4-plus',
    reasoningModel: 'glm-z1-air',
    visionModel: 'glm-4v-plus-0111',
    applyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    badge: '国产中文语义与识图扎实',
    guide: '登录 open.bigmodel.cn → 个人中心 → API Keys → 添加新的 API Key。',
  },
  {
    id: 'volcengine-ark',
    name: '字节火山方舟（豆包大模型 · 支持截图）',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    fastModel: 'doubao-1-5-pro-32k-250115',
    reasoningModel: 'doubao-1-5-thinking-pro-250415',
    visionModel: 'doubao-1-5-vision-pro-32k-250115',
    applyUrl: 'https://console.volcengine.com/ark',
    badge: '字节生态高速稳定',
    guide: '登录火山方舟控制台 → API Key 管理创建密钥，并在模型栏填入开通的模型 ID 或接入点 ep-xxxx。',
  },
  {
    id: 'custom-openai',
    name: '自定义 OpenAI 兼容接口 / 个人中转站',
    protocol: 'openai',
    baseUrl: 'https://',
    fastModel: '',
    reasoningModel: '',
    visionModel: '',
    applyUrl: '',
    badge: 'OpenAI /v1/chat/completions',
    guide: '支持任意兼容 OpenAI 协议的网关（如 OpenRouter、OneAPI 等），如该模型原生支持视觉识图（如 gpt-4o / gemini-2.5-pro），直接填入视觉模型名即可。',
  },
  {
    id: 'custom-anthropic',
    name: '自定义 Anthropic Claude 兼容接口',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    fastModel: 'claude-sonnet-4-20250514',
    reasoningModel: 'claude-sonnet-4-20250514',
    visionModel: 'claude-sonnet-4-20250514',
    applyUrl: '',
    badge: 'Anthropic /v1/messages · 原生识图',
    guide: '支持官方 Anthropic 或兼容 Messages 协议的中转端点，原生支持多图截图识别。',
  },
];

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: AiImageAttachment[];
}

export interface StreamOptions {
  provider: AiProviderConfig;
  modelSlot: 'fast' | 'reasoning';
  messages: ChatTurn[];
  temperature?: number;
  signal?: AbortSignal;
  onChunk: (deltaContent: string, deltaReasoning?: string) => void;
}

export function resolveVisionModel(provider: AiProviderConfig | undefined): string {
  if (!provider) return '';
  if (provider.visionModel?.trim()) return provider.visionModel.trim();
  const preset = AI_PROVIDER_PRESETS.find((p) => p.id === provider.presetId);
  if (preset?.visionModel) return preset.visionModel;
  // Detect inherently multimodal custom models (e.g. gpt-4o, gemini, claude, qwen-vl)
  const fallbackModel = (provider.fastModel || provider.reasoningModel || '').trim();
  if (/gpt-4o|gpt-4\.1|gemini|claude|vl|vision|omni|4v/i.test(fallbackModel)) {
    return fallbackModel;
  }
  return '';
}

function normalizeEndpoint(provider: AiProviderConfig): string {
  const clean = provider.baseUrl.trim().replace(/\/+$/, '');
  if (provider.protocol === 'anthropic') {
    if (clean.endsWith('/messages')) return clean;
    if (clean.endsWith('/v1')) return `${clean}/messages`;
    return `${clean}/v1/messages`;
  }
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

export function normalizeModelsEndpoints(provider: AiProviderConfig): string[] {
  const raw = provider.baseUrl.trim().replace(/\/+$/, '');
  if (!raw) return [];
  const base = raw
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/models$/i, '')
    .replace(/\/+$/, '');

  if (provider.protocol === 'anthropic') {
    if (base.endsWith('/v1')) return [`${base}/models`];
    return [`${base}/v1/models`, `${base}/models`];
  }
  if (/\/v\d+(?:alpha|beta)?$/i.test(base)) {
    return [`${base}/models`];
  }
  return [`${base}/models`, `${base}/v1/models`];
}

export function parseModelsResponsePayload(json: unknown): string[] {
  const rawList: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown[] })?.data)
    ? (json as { data: unknown[] }).data
    : Array.isArray((json as { models?: unknown[] })?.models)
    ? (json as { models: unknown[] }).models
    : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawList) {
    let id = '';
    if (typeof item === 'string') {
      id = item.trim();
    } else if (item && typeof item === 'object') {
      const rec = item as { id?: unknown; name?: unknown; model?: unknown };
      id = String(rec.id || rec.model || rec.name || '').trim();
    }
    if (!id) continue;
    if (id.startsWith('models/')) id = id.slice('models/'.length);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }

  const nonChatRe = /(?:^|[/:_-])(embed|embedding|rerank|whisper|tts|speech|audio|dall-e|flux|sdxl|stable-diffusion|moderation|bge-|text-embedding|jina-embeddings|omni-moderation)/i;
  return out.sort((a, b) => {
    const aUtil = nonChatRe.test(a) ? 1 : 0;
    const bUtil = nonChatRe.test(b) ? 1 : 0;
    if (aUtil !== bUtil) return aUtil - bUtil;
    return a.localeCompare(b);
  });
}

export function suggestModelSlots(models: string[]): {
  fastModel: string;
  reasoningModel: string;
  visionModel: string;
} {
  if (models.length === 0) return { fastModel: '', reasoningModel: '', visionModel: '' };
  const nonChatRe = /(?:^|[/:_-])(embed|embedding|rerank|whisper|tts|speech|audio|dall-e|flux|sdxl|moderation|bge-|text-embedding)/i;
  const chatModels = models.filter((m) => !nonChatRe.test(m));
  const pool = chatModels.length > 0 ? chatModels : models;

  const strongReasoningRe = /(reasoner|r1|qwq|thinking|o1|o3|o4-mini|opus)/i;
  const fallbackReasoningRe = /(pro|max)/i;
  const visionRe = /(vl|vision|4o|4\.1|4\.5|gpt-5|gpt-6|gemini|claude|omni|4v|qvq|pixtral)/i;
  const fastRe = /(chat|flash|mini|turbo|plus|sonnet|haiku|v3|v4|glm-4|moonshot|kimi)/i;

  const fastModel =
    pool.find((m) => fastRe.test(m) && !/(reasoner|r1|qwq|thinking|vl|vision)/i.test(m)) ||
    pool.find((m) => !strongReasoningRe.test(m) && !/(vl|vision)/i.test(m)) ||
    pool[0] ||
    '';
  const reasoningModel =
    pool.find((m) => strongReasoningRe.test(m)) ||
    pool.find((m) => fallbackReasoningRe.test(m) && !/(vl|vision)/i.test(m)) ||
    fastModel ||
    pool[0] ||
    '';
  const visionModel = pool.find((m) => visionRe.test(m)) || '';

  return { fastModel, reasoningModel, visionModel };
}

export function buildProviderRequestPayload(
  provider: AiProviderConfig,
  modelSlot: 'fast' | 'reasoning',
  messages: ChatTurn[],
  temperature = 0.25
): { usedModel: string; payload: Record<string, unknown> } {
  const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
  let usedModel = '';

  if (hasImages) {
    usedModel = resolveVisionModel(provider);
    if (!usedModel) {
      throw new Error(
        `当前服务商「${provider.name.split('（')[0]}」未配置视觉识图模型（例如 DeepSeek 官方接口暂仅支持纯文本）。请前往「我的配置」切换或新增支持截图识图的服务商（如阿里云百炼、硅基流动、智谱或 Kimi），或在自定义模型中填写视觉模型标识。`
      );
    }
  } else {
    usedModel = (
      modelSlot === 'reasoning' ? provider.reasoningModel || provider.fastModel : provider.fastModel
    ).trim();
    if (!usedModel) {
      throw new Error('尚未填写模型名称（请在「我的配置」中检查模型标识）');
    }
  }

  if (provider.protocol === 'anthropic') {
    const sysMsg = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const chatMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'user' && m.images && m.images.length > 0) {
          const blocks: Record<string, unknown>[] = m.images.map((img) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType || 'image/jpeg',
              data: img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl,
            },
          }));
          if (m.content.trim()) {
            blocks.push({ type: 'text', text: m.content });
          }
          return { role: m.role, content: blocks };
        }
        return { role: m.role, content: m.content };
      });

    return {
      usedModel,
      payload: {
        model: usedModel,
        max_tokens: 4096,
        stream: true,
        ...(sysMsg ? { system: sysMsg } : {}),
        messages: chatMsgs,
      },
    };
  }

  const openAiMsgs = messages.map((m) => {
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: Record<string, unknown>[] = [];
      if (m.content.trim()) {
        parts.push({ type: 'text', text: m.content });
      }
      for (const img of m.images) {
        parts.push({
          type: 'image_url',
          image_url: { url: img.dataUrl },
        });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });

  const isReasoner = /reasoner|r1|qwq|thinking/i.test(usedModel);
  return {
    usedModel,
    payload: {
      model: usedModel,
      stream: true,
      messages: openAiMsgs,
      ...(isReasoner ? {} : { temperature }),
    },
  };
}

async function performRequest(
  url: string,
  headers: Record<string, string>,
  bodyStr: string,
  useRelay: boolean,
  signal?: AbortSignal,
  method: 'POST' | 'GET' = 'POST'
): Promise<Response> {
  if (!useRelay) {
    return fetch(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: bodyStr }),
      signal,
    });
  }
  return fetch('/api/ai-relay', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Toolbox-License': getSavedLicense()?.rawCode || '',
    },
    body: JSON.stringify({
      method,
      targetUrl: url,
      headers,
      ...(method === 'GET' ? {} : { body: bodyStr }),
    }),
    signal,
  });
}

export class AiDirectConnectError extends Error {
  readonly code = 'AI_DIRECT_CORS_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'AiDirectConnectError';
  }
}

export async function streamAiCompletion(opts: StreamOptions): Promise<{
  content: string;
  reasoning: string;
  usedModel: string;
  usedRelay: boolean;
}> {
  const { provider, modelSlot, messages, temperature = 0.25, signal, onChunk } = opts;
  const apiKey = provider.apiKey?.trim();
  if (!apiKey) {
    throw new Error('尚未填写 API Key（请前往底部「我的配置」填入您个人的大模型密钥）');
  }

  const { usedModel, payload } = buildProviderRequestPayload(
    provider,
    modelSlot,
    messages,
    temperature
  );

  const endpoint = normalizeEndpoint(provider);
  const headers: Record<string, string> =
    provider.protocol === 'anthropic'
      ? {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };

  const bodyStr = JSON.stringify(payload);
  const allowRelay = Boolean(provider.useCorsRelayFallback);
  let res: Response;

  try {
    res = await performRequest(endpoint, headers, bodyStr, allowRelay, signal);
  } catch (err) {
    if (signal?.aborted) throw new Error('已手动停止生成');
    // S-2: Strictly forbid silent fallback to /api/ai-relay unless explicitly enabled by user
    if (!allowRelay) {
      throw new AiDirectConnectError(
        `浏览器直连该大模型接口失败（${err instanceof Error ? err.message : '网络或跨域受限'}）。因您未开启「跨域转发兜底」，系统严禁静默改走服务器转发；如该自定义中转站不支持浏览器直连，请前往「我的配置」手动勾选启用中转兜底后再试。`
      );
    }
    throw new Error(
      `经服务器无状态中转连接大模型接口失败（${err instanceof Error ? err.message : '网络异常'}）。请检查网络、Base URL 或 API Key。`
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `模型服务返回 HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      const detail = parsed?.error?.message || parsed?.message || errText.slice(0, 180);
      if (detail) msg += `：${detail}`;
    } catch {
      if (errText) msg += `：${errText.slice(0, 180)}`;
    }
    throw new Error(msg);
  }

  if (!res.body) {
    const json = await res.json();
    const content =
      json?.choices?.[0]?.message?.content ||
      json?.content?.[0]?.text ||
      '';
    onChunk(content);
    return { content, reasoning: '', usedModel, usedRelay: allowRelay };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';
  let fullReasoning = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const evt = JSON.parse(dataStr);
        if (provider.protocol === 'anthropic') {
          if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta' && evt.delta.text) {
              fullContent += evt.delta.text;
              onChunk(evt.delta.text, undefined);
            } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
              fullReasoning += evt.delta.thinking;
              onChunk('', evt.delta.thinking);
            }
          }
        } else {
          const delta = evt?.choices?.[0]?.delta;
          if (delta) {
            const c = delta.content || '';
            const r = delta.reasoning_content || '';
            if (c || r) {
              fullContent += c;
              fullReasoning += r;
              onChunk(c, r || undefined);
            }
          }
        }
      } catch {
        // Ignore partial non-JSON keepalive comments
      }
    }
  }

  return { content: fullContent, reasoning: fullReasoning, usedModel, usedRelay: allowRelay };
}

export async function fetchAvailableModels(provider: AiProviderConfig): Promise<string[]> {
  const apiKey = provider.apiKey?.trim();
  if (!apiKey) {
    throw new Error('请先填写 API Key，再拉取可用模型列表');
  }
  const candidates = normalizeModelsEndpoints(provider);
  if (candidates.length === 0) {
    throw new Error('请先填写有效的接口地址 Base URL');
  }

  const headers: Record<string, string> =
    provider.protocol === 'anthropic'
      ? {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : {
          Authorization: `Bearer ${apiKey}`,
        };

  const allowRelay = Boolean(provider.useCorsRelayFallback);
  let lastErr = '该接口未返回模型列表';
  let sawDirectConnectErr = false;
  for (const endpoint of candidates) {
    let res: Response | null = null;
    try {
      res = await performRequest(endpoint, headers, '', allowRelay, undefined, 'GET');
    } catch (err) {
      if (!allowRelay) {
        sawDirectConnectErr = true;
      }
      lastErr = err instanceof Error ? err.message : '网络或跨域受限';
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      lastErr = `HTTP ${res.status}${txt ? `：${txt.slice(0, 120)}` : ''}`;
      if (res.status === 404 && candidates.length > 1) continue;
      throw new Error(`拉取模型列表失败（${lastErr}）`);
    }

    const json = await res.json().catch(() => null);
    const models = parseModelsResponsePayload(json);
    if (models.length > 0) {
      return models;
    }
    lastErr = '接口响应成功但返回模型列表为空（部分中转站不支持 /models，可直接手动填写模型名）';
  }

  if (sawDirectConnectErr && !allowRelay) {
    throw new AiDirectConnectError(
      `浏览器直连拉取模型列表失败（${lastErr}）。因未开启「跨域转发兜底」，系统严禁静默走服务器中转；如需中转拉取，请先手动勾选「启用跨域转发兜底」后再试。`
    );
  }
  throw new Error(lastErr);
}

export async function testProviderConnectivity(provider: AiProviderConfig): Promise<string> {
  let reply = '';
  const { usedModel } = await streamAiCompletion({
    provider,
    modelSlot: 'fast',
    messages: [{ role: 'user', content: '请仅回复“AI接口连通正常”七个字，不要标点。' }],
    temperature: 0,
    onChunk: (c) => {
      reply += c;
    },
  });
  return `${usedModel} 响应成功：「${reply.trim().slice(0, 30) || '连通正常'}」`;
}
