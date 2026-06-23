import { Router } from 'express';
import { getDb } from '../db.js';
import { encrypt, decrypt, maskValue } from '../crypto.js';

const router = Router();

router.get('/llm', (req, res) => {
  const db = getDb();
  const config = db.prepare('SELECT * FROM user_llm_config WHERE user_id = ?')
    .get(req.user.userId);
  if (!config) {
    return res.json({
      hasKey: false,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
  }
  // Decrypt at the edge so callers never see the raw ciphertext
  const decryptedKey = config.api_key ? decrypt(config.api_key) : '';
  res.json({
    hasKey: !!decryptedKey,
    provider: config.provider,
    baseUrl: config.base_url,
    model: config.model,
    apiKeyHint: decryptedKey ? maskValue(decryptedKey) : '',
  });
});

router.put('/llm', (req, res) => {
  const { provider, baseUrl, apiKey, model } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT * FROM user_llm_config WHERE user_id = ?').get(req.user.userId);

  // API key is only required if there is no existing one
  if (!existing && !apiKey) {
    return res.status(400).json({ error: 'API key is required for first-time setup' });
  }

  // If a new key is provided, encrypt it. Otherwise keep the existing one (already encrypted).
  let finalKey = existing?.api_key;
  if (apiKey && apiKey.trim()) {
    finalKey = encrypt(apiKey.trim());
  }

  db.prepare(`
    INSERT INTO user_llm_config (user_id, provider, base_url, api_key, model, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      model = excluded.model,
      updated_at = datetime('now')
  `).run(
    req.user.userId,
    provider || existing?.provider || 'openai',
    baseUrl || existing?.base_url || 'https://api.openai.com/v1',
    finalKey,
    model || existing?.model || 'gpt-4o-mini'
  );
  res.json({ message: 'LLM config saved' });
});

// Check whether the configured model is a reasoning model
// Sends two test prompts: a simple "ok" and a categorization-style one
// Some models only "reason" on complex tasks, so we test both
router.post('/llm/check', async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM user_llm_config WHERE user_id = ?').get(req.user.userId);
  if (!existing) {
    return res.status(400).json({ error: 'No LLM config saved yet. Save your settings first.' });
  }

  const { provider, base_url, model } = existing;
  const api_key = existing.api_key ? decrypt(existing.api_key) : '';

  const buildBody = (messages, maxTokens) => provider === 'anthropic'
    ? {
        url: `${base_url}/messages`,
        headers: {
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, messages, max_tokens: maxTokens },
      }
    : {
        url: `${base_url}/chat/completions`,
        headers: {
          'Authorization': `Bearer ${api_key}`,
          'Content-Type': 'application/json',
        },
        body: { model, messages, max_tokens: maxTokens, temperature: 0 },
      };

  const callLLM = async (messages, maxTokens) => {
    const { url, headers, body } = buildBody(messages, maxTokens);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const text = await response.text();
      return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message || data.content?.[0] || {};
    // Different providers name the reasoning field differently:
    //   - DeepSeek R1, GLM: `reasoning_content` (with underscore)
    //   - Nvidia Nemotron, others: `reasoning` (no underscore)
    //   - Some: `reasoning_details[].text`
    const reasoning = (
      message.reasoning_content ||
      message.reasoning ||
      (Array.isArray(message.reasoning_details) ? message.reasoning_details.map(d => d.text || '').join('\n') : '') ||
      ''
    ).trim();
    return {
      content: (message.content || '').trim(),
      reasoning,
      finish_reason: data.choices?.[0]?.finish_reason || data.stop_reason,
      model: data.model || model,
      usage: data.usage,
    };
  };

  try {
    // Test 1: simple "ok" prompt
    const simple = await callLLM(
      [{ role: 'user', content: 'Respond with only the word: ok' }],
      50
    );
    if (simple.error) {
      return res.status(500).json({ error: 'Test 1 failed: ' + simple.error });
    }

    // Test 2: categorization-style request that mirrors the real call's shape.
    // The trigger for reasoning models is the long system prompt with
    // CRITICAL RULES -- not the transaction count. Use 50 transactions for
    // speed; the system prompt is what surfaces the model's reasoning behavior.
    // 200 transactions, the same txn_idx/category/confidence field format, and
    // 8000 max_tokens -- the same shape the production /api/transactions/categorize-llm
    // route uses. A model that "thinks out loud" on complex tasks (like
    // deepseek-v4-flash does on real 200-transaction calls) will reveal itself
    // here: either by truncating mid-JSON or by wrapping in prose.
    const REALISTIC_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Shopping', 'Other'];
    const REALISTIC_DESCRIPTIONS = [
      'WHOLE FOODS MARKET', 'STARBUCKS COFFEE', 'UBER TRIP', 'AMAZON.COM',
      'SHELL GAS STATION', 'NETFLIX SUBSCRIPTION', 'APPLE.COM/BILL', 'TRADER JOES',
      'DOORDASH DELIVERY', 'TARGET STORE', 'WALGREENS PHARMACY', 'LYFT RIDE',
      'CHIPOTLE MEXICAN', 'COSTCO WHOLESALE', 'CVS PHARMACY', 'MCDONALDS',
      'DOMINOS PIZZA', 'BEST BUY', 'KROGER GROCERY', 'PIZZA HUT',
      'STARBUCKS RESERVE', 'UBER EATS', 'VENMO PAYMENT', 'PAYPAL TRANSFER',
      'AIRBNB STAY', 'DELTA AIRLINES', 'HILTON HOTEL', 'SHELL OIL',
      'COMCAST CABLE', 'VERIZON WIRELESS', 'AT&T INTERNET', 'T-MOBILE',
      'SPOTIFY PREMIUM', 'ADOBE CREATIVE', 'DROPBOX STORAGE', 'ICLOUD STORAGE',
      'GOOGLE STORAGE', 'OFFICE 365', 'GITHUB SUBSCRIPTION', 'AWS BILLING',
      'OPENAI API', 'ANTHROPIC API', 'GODADDY DOMAIN', 'CLOUDFLARE',
      'DIGITALOCEAN', 'HEROKU DYNOS', 'RENT PAYMENT', 'MORTGAGE PAYMENT',
      'ELECTRIC BILL', 'WATER BILL', 'NATURAL GAS', 'INTERNET PROVIDER',
    ];
    const realisticTxnList = REALISTIC_DESCRIPTIONS
      .map((d, i) => `[${i}] "${d}" (-${(5 + (i * 3) % 80).toFixed(2)})`)
      .join('\n');
    const categoryPrompt = `Categorize these ${REALISTIC_DESCRIPTIONS.length} transactions. Return ONLY a JSON array, no explanation, no thinking. Use exact category names.

Categories: ${REALISTIC_CATEGORIES.join(', ')}

Transactions:
${realisticTxnList}

Return: [{"txn_idx":0,"category":"Groceries","confidence":0.95}, ...]`;
    const systemPrompt = `You are a transaction categorizer. For each transaction, choose the single best matching category from this list:

${REALISTIC_CATEGORIES.map(c => `- ${c}`).join('\n')}

CRITICAL RULES:
- Return ONLY a JSON array, no explanation, no thinking, no preamble
- Do NOT output any reasoning, analysis, or commentary before the JSON
- Output must START with [ and END with ]
- Use EXACT category names from the list above
- Match the description text to the category meaning
- Negative amounts (withdrawals) match spending categories`;

    const complex = await callLLM(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: categoryPrompt },
      ],
      8192
    );
    if (complex.error) {
      return res.status(500).json({ error: 'Test 2 failed: ' + complex.error });
    }

    // Heuristics
    const reasoningPhrases = [
      'i need to', 'i should', 'let me', "i'll", 'i will',
      'first,', 'to begin', 'the user wants', 'the user is asking',
      'i need to categorize', 'let me categorize', 'i will categorize',
      'i must follow', 'i should output', 'i need to output',
      'step by step', "let's ", 'going through',
      'looking at', 'based on the', 'the description suggests',
      'we need to', 'we are to', 'we should', 'to categorize',
    ];

    // Try to extract a JSON array from arbitrary content. Handles:
    //  - clean JSON:    '[{"a":1}]'
    //  - prose prefix:  'Let me think...\n[{"a":1}]'
    //  - prose suffix:  '[{"a":1}]\nDone.'
    //  - code fences:   '```json\n[{"a":1}]\n```'
    //  - markdown:      'Here you go: [{"a":1}]'
    // Returns { hasJson, proseBefore, proseAfter }.
    const inspectJson = (content) => {
      if (!content || typeof content !== 'string') {
        return { hasJson: false, proseBefore: false, proseAfter: false };
      }
      // Strip code fences if present
      let stripped = content.trim();
      const fenceMatch = stripped.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
      if (fenceMatch) stripped = fenceMatch[1].trim();
      // Look for the first '[' and last ']'
      const firstBracket = stripped.indexOf('[');
      const lastBracket = stripped.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
        return { hasJson: false, proseBefore: false, proseAfter: false };
      }
      const candidate = stripped.slice(firstBracket, lastBracket + 1);
      let parsed;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        return { hasJson: false, proseBefore: false, proseAfter: false };
      }
      if (!Array.isArray(parsed)) {
        return { hasJson: false, proseBefore: false, proseAfter: false };
      }
      const proseBefore = stripped.slice(0, firstBracket).trim().length > 0;
      const proseAfter = stripped.slice(lastBracket + 1).trim().length > 0;
      return { hasJson: true, proseBefore, proseAfter };
    };

    const analyzeResponse = (resp, testName, expectedLength) => {
      const fullText = (resp.content + ' ' + resp.reasoning).toLowerCase();
      const hasReasoning = reasoningPhrases.some(p => fullText.includes(p));
      const echoes = resp.content.toLowerCase().includes('respond with only') ||
                     resp.content.toLowerCase().includes('return only');
      const json = inspectJson(resp.content);
      const cutOff = resp.finish_reason === 'length';
      return { resp, hasReasoning, echoes, json, cutOff, fullText };
    };

    const simpleAnalysis = analyzeResponse(simple, 'simple', 10);
    const complexAnalysis = analyzeResponse(complex, 'complex', 200);

    const result = {
      simple: {
        content: simple.content.slice(0, 200),
        reasoning: simple.reasoning.slice(0, 200),
        finish_reason: simple.finish_reason,
      },
      complex: {
        content: complex.content.slice(0, 500),
        reasoning: complex.reasoning.slice(0, 500),
        finish_reason: complex.finish_reason,
      },
      model: complex.model || simple.model,
      isReasoning: false,
      isBroken: false,
      verdict: '',
      recommendation: '',
    };

    // Determine verdict
    // The complex test is the real signal — if it doesn't return parseable JSON, the model is unsuitable.
    // Three states: clean JSON, JSON with prose around it (often a reasoning model paraphrasing the prompt),
    // or no JSON at all.
    const j = complexAnalysis.json;
    if (complex.content.length === 0) {
      result.isReasoning = true;
      result.verdict = 'Model returned empty content on the complex test. Likely a reasoning model that needs more tokens to think AND answer.';
    } else if (complexAnalysis.cutOff && !j.proseBefore && !j.proseAfter) {
      // Response was cut off mid-generation (finish_reason === 'length'), meaning
      // the model used all available tokens. A non-reasoning model that was given
      // 6000 tokens for 50 transactions would only need ~3000; if it hit the cap,
      // it was spending tokens on thinking. Flag as reasoning.
      result.isReasoning = true;
      result.verdict = 'Model ran out of tokens on the 50-transaction test (response was cut off). A non-reasoning model handles this well under the cap; hitting it means the model is spending tokens on reasoning/thinking. This will fail on real categorization calls with more transactions. Use a non-reasoning model.';
    } else if (!j.hasJson && (complexAnalysis.hasReasoning || complexAnalysis.cutOff)) {
      result.isReasoning = true;
      result.verdict = 'Model thinks out loud on complex tasks. It returned reasoning instead of the expected JSON array. This is a reasoning model that will not produce structured output for categorization.';
    } else if (!j.hasJson && complexAnalysis.echoes) {
      result.isBroken = true;
      result.verdict = 'Model is echoing the prompt instead of following instructions. Not suitable for structured output.';
    } else if (!j.hasJson) {
      result.isReasoning = true;
      result.verdict = 'Model did not return valid JSON. It produced freeform text instead. This will not work for transaction categorization.';
    } else if (j.proseBefore || j.proseAfter) {
      result.isReasoning = true;
      result.verdict = 'Model returned a JSON array but wrapped it in reasoning prose (e.g., paraphrasing the prompt before answering). The JSON is hidden in the text, so strict parsers will fail. This is a reasoning model that will not produce clean structured output for categorization.';
    } else {
      result.verdict = 'Non-reasoning model — it produced a clean JSON array for the categorization test. Should work for transaction categorization.';
    }

    if (result.isReasoning) {
      result.recommendation = 'Try a non-reasoning model like claude-haiku-4-5, glm-5, or gpt-5-nano.';
    } else if (result.isBroken) {
      result.recommendation = 'This model is not suitable for structured output. Switch to a different model.';
    } else {
      result.recommendation = 'This model should work for transaction categorization.';
    }

    res.json(result);
  } catch (err) {
    // Sanitize: don't leak the full provider error to the client.
    // Log the full error server-side for debugging.
    console.error('[LLM-CHECK] Error:', err);
    const isNetwork = err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
    const safeMsg = isNetwork
      ? `Network error: cannot reach the model server (${err.code || 'unknown'}).`
      : 'Test failed. Check your model name, base URL, and API key.';
    res.status(500).json({ error: safeMsg });
  }
});

router.get('/sync', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);
  res.json({
    sync_interval_hours: row?.sync_interval_hours || 2,
    ui_theme: row?.ui_theme || 'minimal',
  });
});

router.put('/sync', (req, res) => {
  const { sync_interval_hours, ui_theme } = req.body;

  const db = getDb();
  const current = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.userId);

  const hours = sync_interval_hours !== undefined ? Number(sync_interval_hours) : (current?.sync_interval_hours || 2);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
    return res.status(400).json({ error: 'sync_interval_hours must be an integer between 1 and 24' });
  }

  const validThemes = ['minimal', 'colorful'];
  const theme = ui_theme !== undefined ? ui_theme : (current?.ui_theme || 'minimal');
  if (!validThemes.includes(theme)) {
    return res.status(400).json({ error: `ui_theme must be one of: ${validThemes.join(', ')}` });
  }

  db.prepare(`
    INSERT INTO user_settings (user_id, sync_interval_hours, ui_theme, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      sync_interval_hours = excluded.sync_interval_hours,
      ui_theme = excluded.ui_theme,
      updated_at = datetime('now')
  `).run(req.user.userId, hours, theme);
  res.json({ sync_interval_hours: hours, ui_theme: theme });
});

const EMAIL_BOOL_FIELDS = [
  'enabled',
  'include_total_balance',
  'include_per_account_balance',
  'include_per_category_spending',
  'include_todays_transactions',
  'include_weeks_transactions',
];

router.get('/email-summary', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_summary_settings WHERE user_id = ?')
    .get(req.user.userId);
  if (!row) {
    return res.json({
      enabled: false,
      frequency_hours: 6,
      include_total_balance: true,
      include_per_account_balance: true,
      include_per_category_spending: true,
      include_todays_transactions: true,
      include_weeks_transactions: true,
      last_sent_at: null,
      next_send_at: null,
    });
  }
  res.json({
    enabled: !!row.enabled,
    frequency_hours: row.frequency_hours,
    include_total_balance: !!row.include_total_balance,
    include_per_account_balance: !!row.include_per_account_balance,
    include_per_category_spending: !!row.include_per_category_spending,
    include_todays_transactions: !!row.include_todays_transactions,
    include_weeks_transactions: !!row.include_weeks_transactions,
    last_sent_at: row.last_sent_at,
    next_send_at: row.next_send_at,
  });
});

router.put('/email-summary', (req, res) => {
  const body = req.body || {};
  const db = getDb();

  const current = db.prepare('SELECT * FROM email_summary_settings WHERE user_id = ?')
    .get(req.user.userId);

  const hours = body.frequency_hours !== undefined
    ? Number(body.frequency_hours)
    : (current?.frequency_hours || 6);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
    return res.status(400).json({ error: 'frequency_hours must be an integer between 1 and 24' });
  }

  for (const key of EMAIL_BOOL_FIELDS) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return res.status(400).json({ error: `${key} must be a boolean` });
    }
  }

  const pick = (key, fallback) => {
    if (body[key] !== undefined) return body[key] ? 1 : 0;
    return current?.[key] ?? fallback;
  };

  const enabled = pick('enabled', 0);
  const incTotal = pick('include_total_balance', 1);
  const incAccounts = pick('include_per_account_balance', 1);
  const incCategories = pick('include_per_category_spending', 1);
  const incToday = pick('include_todays_transactions', 1);
  const incWeek = pick('include_weeks_transactions', 1);

  db.prepare(`
    INSERT INTO email_summary_settings
      (user_id, enabled, frequency_hours,
       include_total_balance, include_per_account_balance,
       include_per_category_spending, include_todays_transactions, include_weeks_transactions,
       updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      frequency_hours = excluded.frequency_hours,
      include_total_balance = excluded.include_total_balance,
      include_per_account_balance = excluded.include_per_account_balance,
      include_per_category_spending = excluded.include_per_category_spending,
      include_todays_transactions = excluded.include_todays_transactions,
      include_weeks_transactions = excluded.include_weeks_transactions,
      updated_at = datetime('now')
  `).run(req.user.userId, enabled, hours, incTotal, incAccounts, incCategories, incToday, incWeek);

  res.json({
    enabled: !!enabled,
    frequency_hours: hours,
    include_total_balance: !!incTotal,
    include_per_account_balance: !!incAccounts,
    include_per_category_spending: !!incCategories,
    include_todays_transactions: !!incToday,
    include_weeks_transactions: !!incWeek,
  });
});

export default router;
