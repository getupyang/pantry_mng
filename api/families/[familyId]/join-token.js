import { ensureEnv, sbGet, sbPost, isValidClientId, generateJoinToken } from "../../_supabase.js";

function parseFamilyId(req) {
  const raw = req.query.familyId;
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;

  const familyId = parseFamilyId(req);
  const clientId = req.headers["x-client-id"];
  if (!familyId) {
    res.status(400).json({ error: "familyId is required" });
    return;
  }
  if (!isValidClientId(clientId)) {
    res.status(401).json({ error: "Invalid client identity" });
    return;
  }

  try {
    const { resp: boundResp, data: boundRows } = await sbGet(
      `pantry_clients?select=client_id&client_id=eq.${encodeURIComponent(clientId)}&family_id=eq.${familyId}&limit=1`
    );
    if (!boundResp.ok || !Array.isArray(boundRows) || boundRows.length === 0) {
      res.status(403).json({ error: "Client is not a member of this family" });
      return;
    }

    const token = generateJoinToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { resp: createResp, data: createData } = await sbPost("pantry_join_tokens", {
      token,
      family_id: familyId,
      created_by_client_id: clientId,
      expires_at: expiresAt,
    });
    if (!createResp.ok) {
      res.status(500).json({ error: "Failed to create join token", detail: createData });
      return;
    }

    const origin = req.headers.origin || req.headers.referer || "";
    const baseUrl = origin ? origin.replace(/\/$/, "") : "";
    const joinUrl = baseUrl ? `${baseUrl}/?join=${encodeURIComponent(token)}` : `/?join=${encodeURIComponent(token)}`;

    res.status(200).json({ token, expiresAt, joinUrl });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

