const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!OPENROUTER_API_KEY) {
    res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
    return;
  }

  try {
    const body = req.body || {};
    const referer = req.headers.origin || req.headers.referer || "https://pantry-mng.vercel.app";

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": "Pantry",
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY is not set on server' });
    return;
  }

  try {
    const body = req.body;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pantry.vercel.app',
        'X-Title': 'Pantry'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(response.status).json(data || { error: 'Upstream error' });
      return;
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Unknown server error' });
  }
}

