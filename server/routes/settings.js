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

    // Test 2: modified wolf-goat-cabbage logic puzzle with a twist.
    // The classic puzzle requires 7 trips. The twist (cabbage in a locked crate
    // the goat can't open) reduces the answer to 3. Reasoning models figure
    // out the trick; non-reasoning models pattern-match the classic puzzle
    // and answer 7. This is a deterministic test of whether the model can
    // reason about a problem, which correlates with the model spending
    // tokens 'thinking' on complex categorization prompts.
    //
    // The strict-JSON constraint is part of the test -- a non-reasoning model
    // that can't follow instructions will fail the JSON parse, which we
    // also catch.
    const logicPuzzlePrompt = `Solve this modified logic puzzle.

Puzzle: A farmer needs to cross a river with a wolf, a goat, and a cabbage. His boat can only carry himself and one item. If left alone, the wolf eats the goat, and the goat eats the cabbage. However, the cabbage is currently locked in a secure, heavy-duty crate that the goat cannot open or chew through under any circumstances.

Provide your response strictly in the following JSON format, with no extra text, markdown formatting, or explanations outside the JSON:
{
  "minimum_trips": <integer_value>
}`;
    const complex = await callLLM(
      [
        { role: 'user', content: logicPuzzlePrompt },
      ],
      200
    );
    if (complex.error) {
      return res.status(500).json({ error: 'Test 2 failed: ' + complex.error });
    }

    // Parse the logic puzzle response. Try to find JSON in the content (with
    // possible code fences) and extract minimum_trips.
    const parsePuzzleResponse = (content) => {
      if (!content || typeof content !== 'string') {
        return { ok: false, trips: null, raw: content };
      }
      let stripped = content.trim();
      const fenceMatch = stripped.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
      if (fenceMatch) stripped = fenceMatch[1].trim();
      const firstBrace = stripped.indexOf('{');
      const lastBrace = stripped.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        return { ok: false, trips: null, raw: content };
      }
      const candidate = stripped.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(candidate);
        const trips = Number(parsed.minimum_trips);
        if (!Number.isFinite(trips)) return { ok: false, trips: null, raw: content };
        return { ok: true, trips, raw: content };
      } catch {
        return { ok: false, trips: null, raw: content };
      }
    };

    const puzzle = parsePuzzleResponse(complex.content);

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

    // Determine verdict from puzzle answer
    //   3 trips: model reasoned correctly = reasoning model = bad for us
    //   7 trips: model pattern-matched classic puzzle = non-reasoning = good
    //   any other number: ambiguous
    //   failed JSON: non-reasoning but broken (can't follow instructions)
    if (puzzle.ok && puzzle.trips === 3) {
      result.isReasoning = true;
      result.verdict = 'Reasoning model detected: solved the modified puzzle in 3 trips (correctly identified that the locked crate removes the goat-vs-cabbage constraint). Reasoning models spend hidden tokens on complex tasks like transaction categorization, which causes the production categorizer to fail. Use a non-reasoning model.';
    } else if (puzzle.ok && puzzle.trips === 7) {
      result.verdict = 'Non-reasoning model: pattern-matched the classic 7-trip wolf-goat-cabbage puzzle without noticing the locked-crate twist. Should work for transaction categorization.';
    } else if (puzzle.ok) {
      result.verdict = `Model returned minimum_trips=${puzzle.trips} -- unexpected answer. The puzzle has a unique correct answer (3). If the model couldn't reason about the twist, it likely can't be trusted on real categorization either. Try a different model.`;
    } else {
      result.isBroken = true;
      result.verdict = 'Model failed to return valid JSON for the puzzle prompt. It cannot reliably follow strict output constraints, which means it will not work for transaction categorization either.';
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
