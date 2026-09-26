// Vercel serverless function. Reads GROQ_API_KEY from the environment
// (set in Project Settings -> Environment Variables) so it's never sent to the browser.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not set on this deployment' });
    return;
  }
  try {
    const { model, messages, temperature } = req.body || {};
    if (!model || !messages) {
      res.status(400).json({ error: 'Missing model or messages in request body' });
      return;
    }
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.4 })
    });
    const data = await groqResp.json();
    res.status(groqResp.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Server error calling Groq' });
  }
};
