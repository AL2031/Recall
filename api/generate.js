// Vercel serverless function. Reads one or more Groq API keys from the
// environment (set in Project Settings -> Environment Variables) so no key
// is ever sent to the browser.
//
// Supports multiple keys so you can spread requests across several Groq
// accounts (handy since Groq's free tier rate-limits are per-key). Set any
// of the following - all are optional to add, but at least one is required:
//   GROQ_API_KEY        (first / only key)
//   GROQ_API_KEY_2       ...
//   GROQ_API_KEY_3       ... up to GROQ_API_KEY_10
//   GROQ_API_KEYS        a single comma-separated list, e.g. "key1,key2,key3"
//                         (use this if you have more than 10 keys)
// On each request a key is picked at random. If that key comes back
// rate-limited or unauthorized, the function automatically retries with the
// next key before giving up.

function collectApiKeys() {
  const keys = new Set();
  if (process.env.GROQ_API_KEYS) {
    process.env.GROQ_API_KEYS.split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.add(k));
  }
  if (process.env.GROQ_API_KEY) keys.add(process.env.GROQ_API_KEY.trim());
  for (let i = 2; i <= 10; i++) {
    const v = process.env['GROQ_API_KEY_' + i];
    if (v && v.trim()) keys.add(v.trim());
  }
  return Array.from(keys);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keys = collectApiKeys();
  if (!keys.length) {
    res.status(500).json({
      error:
        'No Groq API key is set on this deployment. Set GROQ_API_KEY in Project Settings -> Environment Variables (add GROQ_API_KEY_2, GROQ_API_KEY_3, ... for additional keys, or GROQ_API_KEYS as a comma-separated list).'
    });
    return;
  }

  const { model, messages, temperature, response_format } = req.body || {};
  if (!model || !messages) {
    res.status(400).json({ error: 'Missing model or messages in request body' });
    return;
  }

  const order = shuffle(keys.slice());
  let lastStatus = 500;
  let lastError = { error: 'All configured Groq API keys failed.' };

  for (const apiKey of order) {
    try {
      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: temperature ?? 0.4,
          ...(response_format ? { response_format } : {})
        })
      });

      // Rate-limited or unauthorized on this key -> try the next one instead
      // of failing the whole request.
      if (groqResp.status === 429 || groqResp.status === 401 || groqResp.status === 403) {
        lastStatus = groqResp.status;
        lastError = (await safeJson(groqResp)) || lastError;
        continue;
      }

      const data = await groqResp.json();
      res.status(groqResp.status).json(data);
      return;
    } catch (e) {
      lastStatus = 500;
      lastError = { error: e.message || 'Server error calling Groq' };
    }
  }

  // Every key was rate-limited / invalid / errored.
  res.status(lastStatus).json({
    error: `All ${order.length} configured Groq API key(s) failed (last status ${lastStatus}).`,
    details: lastError
  });
};
