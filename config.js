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
  model: 'google/gemini-2.5-flash',
  models: [
    'google/gemini-2.5-flash',
    'qwen/qwen3-vl-32b-instruct',
    'qwen/qwen-vl-plus'
  ],
  timeout: 30000, // 图片识别在移动网络下可能超过 10 秒
};
