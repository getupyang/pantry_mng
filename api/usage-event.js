import { ensureEnv, sbPost, isValidClientId } from "./_supabase.js";

function isValidEventName(name) {
  return typeof name === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(name);
}

function cleanProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > 4000) return { truncated: true };
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;

  const { eventName, clientId, familyId, pagePath, properties } = req.body || {};
  if (!isValidEventName(eventName)) {
    res.status(400).json({ error: "Invalid eventName" });
    return;
  }
  if (!isValidClientId(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  try {
    const { resp, data } = await sbPost("pantry_usage_events", {
      family_id: typeof familyId === "string" && familyId ? familyId : null,
      client_id: clientId,
      event_name: eventName,
      page_path: typeof pagePath === "string" ? pagePath.slice(0, 200) : null,
      properties: cleanProperties(properties),
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
      country: String(req.headers["x-vercel-ip-country"] || "").slice(0, 8) || null,
    });
    if (!resp.ok) {
      res.status(500).json({ error: "Failed to write event", detail: data });
      return;
    }
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
