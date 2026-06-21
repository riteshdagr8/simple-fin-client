import { getDb } from './db.js';
import { decrypt } from './crypto.js';

const DEFAULT_PROVIDERS = {
  openai:    { baseUrl: 'https://api.openai.com/v1',  model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022' },
};

export async function getUserConfig(userId) {
  const db = getDb();
  const config = db.prepare('SELECT * FROM user_llm_config WHERE user_id = ?').get(userId);
  if (!config) return null;
  return {
    provider: config.provider,
    baseUrl: config.base_url,
    apiKey: config.api_key ? decrypt(config.api_key) : null,
    model: config.model,
  };
}

export async function chat(userId, messages, options = {}) {
  const config = await getUserConfig(userId);
  if (!config) throw new Error('LLM not configured. Add your API key in Settings.');

  const { provider, baseUrl, apiKey, model } = config;
  const resolvedModel = options.model || model;
  const resolvedUrl = options.baseUrl || baseUrl;

  if (provider === 'anthropic') {
    return chatAnthropic(resolvedUrl, apiKey, resolvedModel, messages);
  }
  return chatOpenAICompatible(resolvedUrl, apiKey, resolvedModel, messages, options);
}

async function chatOpenAICompatible(baseUrl, apiKey, model, messages, options = {}) {
  const maxTokens = options.maxTokens || 8192;
  const temperature = options.temperature ?? 0.1;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...options.body,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  // Reasoning models (DeepSeek R1, etc.) put the actual answer in reasoning_content
  // and leave content empty until the reasoning is done. Fall back to it.
  const content = (message?.content || message?.reasoning_content || '').trim();
  return content;
}

async function chatAnthropic(baseUrl, apiKey, model, messages) {
  // Anthropic uses a different format: system message separate, no "system" role in messages array
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs = messages.filter(m => m.role !== 'system');

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      system: systemMsg?.content ?? '',
      messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

export async function categorizeTransactions(userId, transactions, categories) {
  const categoryDefs = categories
    .map(c => `- ${c.name}: ${c.description || ''}`)
    .join('\n');

  const txnList = transactions.map((t, i) =>
    `[${i}] "${t.description}" (${t.amount > 0 ? '+' : ''}${t.amount.toFixed(2)})`
  ).join('\n');

  const systemPrompt = `You are a transaction categorizer. For each transaction, choose the single best matching category from this list:

${categoryDefs}

CRITICAL RULES:
- Return ONLY a JSON array, no explanation, no thinking, no preamble
- Do NOT output any reasoning, analysis, or commentary before the JSON
- Output must START with [ and END with ]
- Use EXACT category names from the list above
- Match the description text to the category meaning
- Positive amounts (deposits) likely are "Income" or "Transfer"
- Negative amounts (withdrawals) match spending categories`;

  const userPrompt = `Categorize these ${transactions.length} transactions:\n${txnList}\n\nReturn: [{"txn_idx": 0, "category": "CategoryName", "confidence": 0.95}, ...]`;

  const content = await chat(userId, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  // Log the raw response for debugging
  console.log(`[LLM] Response length: ${content.length} chars`);
  console.log(`[LLM] First 500 chars: ${content.slice(0, 500)}`);

  if (!content || content.trim() === '') {
    const config = await getUserConfig(userId);
    throw new Error(
      `LLM returned an empty response. Check your Settings: provider=${config?.provider}, ` +
      `model=${config?.model}, baseUrl=${config?.baseUrl}. ` +
      `Reasoning models (e.g. deepseek-v4-flash) often return empty content because they spend all tokens on thinking. ` +
      `Try a non-reasoning model like "minimax-m2.5" or "grok-build-0.1".`
    );
  }

  // Parse JSON response — be lenient: extract the first JSON array found
  let parsed;
  try {
    // Find all candidate JSON arrays (greedy) and try each
    const candidates = [...content.matchAll(/\[[\s\S]*?\]/g)].map(m => m[0]);
    if (candidates.length === 0) {
      throw new Error(`No JSON array found. Response was: ${content.slice(0, 300)}`);
    }
    // Try parsing each candidate, take the first that succeeds and looks like our schema
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const obj = JSON.parse(candidate);
        if (Array.isArray(obj) && obj.length > 0 && (obj[0].category || obj[0].txn_idx !== undefined)) {
          parsed = obj;
          break;
        }
      } catch (e) {
        lastError = e;
        continue;
      }
    }
    if (!parsed) {
      // Fallback: try the first candidate anyway
      parsed = JSON.parse(candidates[0]);
    }
  } catch (err) {
    throw new Error(`Failed to parse LLM response: ${err.message}\nRaw: ${content.slice(0, 200)}`);
  }

  // Map back to transactions
  const results = [];
  for (const item of parsed) {
    const txn = transactions[item.txn_idx];
    const cat = categories.find(c => c.name.toLowerCase() === String(item.category).toLowerCase());
    if (txn && cat) {
      results.push({ txnId: txn.id, categoryId: cat.id, confidence: item.confidence || 0.9 });
    }
  }
  return results;
}
