// Pantry 配置文件
// API Key存储在localStorage中，首次使用时输入
// 默认使用提供的API Key（如果localStorage中没有）

const DEFAULT_API_KEY = '';

function getApiKey() {
  const stored = localStorage.getItem('pantry_openrouter_key');
  return stored || DEFAULT_API_KEY;
}

function setApiKey(key) {
  localStorage.setItem('pantry_openrouter_key', key);
}

// OpenRouter配置
const OPENROUTER_CONFIG = {
  apiUrl: '/api/openrouter',
  model: 'anthropic/claude-3.5-sonnet', // 多模态模型
  timeout: 10000, // 10秒超时（图片识别需要更长时间）
};
