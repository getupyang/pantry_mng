import { ensureEnv, sbGet, sbPatch, isValidClientId } from "./_supabase.js";

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanJson(value, max = 12000) {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value ?? null);
  if (json.length > max) return { truncated: true };
  return value;
}

async function verifyClientFamily(clientId, familyId) {
  const { resp, data } = await sbGet(
    `pantry_clients?select=client_id,family_id&client_id=eq.${encodeURIComponent(clientId)}&family_id=eq.${familyId}&limit=1`
  );
  return resp.ok && Array.isArray(data) && data.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;

  const { reviewId, familyId, clientId, parsedResult, acceptedData, outcome } = req.body || {};
  if (!isUuid(reviewId) || !isUuid(familyId) || !isValidClientId(clientId)) {
    res.status(400).json({ error: "Invalid review identity" });
    return;
  }
  if (outcome && !["recognized", "accepted", "discarded", "error"].includes(outcome)) {
    res.status(400).json({ error: "Invalid outcome" });
    return;
  }

  try {
    const bound = await verifyClientFamily(clientId, familyId);
    if (!bound) {
      res.status(403).json({ error: "Client is not a member of this family" });
      return;
    }

    const { resp: reviewResp, data: reviews } = await sbGet(
      `pantry_recognition_reviews?select=id,family_id,client_id&id=eq.${reviewId}&family_id=eq.${familyId}&client_id=eq.${encodeURIComponent(
        clientId
      )}&limit=1`
    );
    if (!reviewResp.ok || !Array.isArray(reviews) || reviews.length === 0) {
      res.status(404).json({ error: "Recognition review not found" });
      return;
    }

    const patch = { updated_at: new Date().toISOString() };
    const cleanParsed = cleanJson(parsedResult);
    const cleanAccepted = cleanJson(acceptedData);
    if (cleanParsed !== undefined) patch.parsed_result = cleanParsed;
    if (cleanAccepted !== undefined) patch.accepted_data = cleanAccepted;
    if (outcome) patch.outcome = outcome;

    const { resp, data } = await sbPatch(
      `pantry_recognition_reviews?id=eq.${reviewId}&select=id,outcome,updated_at`,
      patch,
      { Prefer: "return=representation" }
    );
    if (!resp.ok || !Array.isArray(data) || data.length === 0) {
      res.status(500).json({ error: "Failed to update recognition review", detail: data });
      return;
    }
    res.status(200).json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
