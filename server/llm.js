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

  // Line-by-line output format. Reasoning models can't easily wrap one
  // category per line in prose, and the parser is robust to truncation
  // (we just process the lines we got). If the model returns JSON anyway,
  // we fall back to a bracket-counted JSON extractor.
  const systemPrompt = `You are a transaction categorizer. For each transaction, choose the single best matching category from this list:

${categoryDefs}

CRITICAL RULES:
- Output EXACTLY one category name per line, in the same order as the transactions
- No numbering, no bullets, no JSON, no explanation, no preamble
- Use EXACT category names from the list above (case-sensitive)
- Each line should contain ONLY the category name (e.g. "Groceries")
- Match the description text to the category meaning
- Positive amounts (deposits) likely are "Income" or "Transfer"
- Negative amounts (withdrawals) match spending categories`;

  const userPrompt = `Categorize these ${transactions.length} transactions. Output exactly one category name per line, in order:

${txnList}

Categories: ${categories.map(c => c.name).join(', ')}`;

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
      `model=${config?.model}, baseUrl=${config?.baseUrl}.`
    );
  }

  // Build a normalized lookup of category names (lowercased) for fuzzy matching.
  const catByLower = new Map(categories.map(c => [c.name.toLowerCase(), c]));

  // Try the line-by-line path first. For each non-empty line, look for an
  // exact category name match (case-insensitive). Skip lines that don't
  // match any category (treated as prose). If we got at least one match,
  // map matches in order to transactions.
  const lineMatches = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Strip common prefixes like "1:", "1.", "- ", "[1]" that the model might add
    const stripped = line
      .replace(/^\[?\d+\]?[\s.:)\-]*/, '')
      .replace(/^[-*]\s+/, '')
      .trim();
    if (!stripped) continue;
    const cat = catByLower.get(stripped.toLowerCase());
    if (cat) lineMatches.push(cat);
  }

  let parsed = null;
  let parseMode = 'line-by-line';

  if (lineMatches.length > 0) {
    // Map each match to its corresponding transaction (by order)
    parsed = lineMatches.slice(0, transactions.length).map((cat, idx) => ({
      txn_idx: idx,
      category: cat.name,
      confidence: 0.9,
    }));
  } else {
    // Fall back to JSON: use a bracket-counting extractor to find the first
    // balanced JSON array. This handles prose-wrapped and nested objects
    // correctly, unlike the previous non-greedy regex.
    const arrayText = extractBalancedJsonArray(content);
    if (arrayText) {
      try {
        const obj = JSON.parse(arrayText);
        if (Array.isArray(obj)) {
          parsed = obj;
          parseMode = 'json';
        }
      } catch (err) {
        // fall through
      }
    }
  }

  if (!parsed) {
    throw new Error(
      `Failed to parse LLM response. The model did not return category names per line ` +
      `and no JSON array was found. Raw (first 300 chars): ${content.slice(0, 300)}`
    );
  }

  // Map back to transactions
  const results = [];
  for (const item of parsed) {
    const idx = Number(item.txn_idx ?? item.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= transactions.length) continue;
    const txn = transactions[idx];
    const catName = String(item.category || '').trim();
    const cat = catByLower.get(catName.toLowerCase());
    if (txn && cat) {
      results.push({ txnId: txn.id, categoryId: cat.id, confidence: item.confidence || 0.9 });
    }
  }
  console.log(`[LLM] Parsed ${results.length}/${transactions.length} transactions via ${parseMode}`);
  return results;
}

// Find the first balanced JSON array in a string. Handles nested objects and
// arrays correctly, unlike a non-greedy regex. Returns the array text
// (including brackets), or null if no balanced array is found.
function extractBalancedJsonArray(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
