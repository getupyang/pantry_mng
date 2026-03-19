const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }
  if (!OPENROUTER_API_KEY) {
    res.status(500).json({ error: { message: "OPENROUTER_API_KEY is not configured" } });
    return;
  }

  try {
    const rawBody = req.body;
    const body =
      typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody || {};
    const referer =
      req.headers.origin || req.headers.referer || "https://pantry-mng.vercel.app";

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
    if (!upstream.ok) {
      res
        .status(upstream.status)
        .json(
          data?.error?.message
            ? data
            : { error: { message: `Upstream ${upstream.status}` } }
        );
      return;
    }
    res.status(200).json(data);
  } catch (e) {
    res
      .status(500)
      .json({ error: { message: e?.message || "Unknown server error" } });
  }
}

