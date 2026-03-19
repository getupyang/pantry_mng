import { ensureEnv, sbGet, sbPost, sbPatch, isValidClientId } from "../_supabase.js";

function emptyPayload() {
  return { items: [], locations: [] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;

  const { clientId } = req.body || {};
  if (!isValidClientId(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  try {
    const { resp: clientResp, data: clientRows } = await sbGet(
      `pantry_clients?select=client_id,family_id&client_id=eq.${encodeURIComponent(clientId)}&limit=1`
    );
    if (!clientResp.ok) {
      res.status(500).json({ error: "Failed to query client binding", detail: clientRows });
      return;
    }

    if (Array.isArray(clientRows) && clientRows.length > 0) {
      const familyId = clientRows[0].family_id;
      await sbPatch(`pantry_clients?client_id=eq.${encodeURIComponent(clientId)}`, { last_seen_at: new Date().toISOString() });
      const { resp: famResp, data: famRows } = await sbGet(
        `pantry_families?select=id,data_json,version,updated_at&id=eq.${familyId}&limit=1`
      );
      if (!famResp.ok || !Array.isArray(famRows) || famRows.length === 0) {
        res.status(404).json({ error: "Family not found" });
        return;
      }
      const fam = famRows[0];
      res.status(200).json({
        familyId: fam.id,
        version: fam.version,
        updatedAt: fam.updated_at,
        data: fam.data_json || emptyPayload(),
      });
      return;
    }

    const { resp: createResp, data: createRows } = await sbPost(
      "pantry_families?select=id,data_json,version,updated_at",
      { data_json: emptyPayload() },
      { Prefer: "return=representation" }
    );
    if (!createResp.ok || !Array.isArray(createRows) || createRows.length === 0) {
      res.status(500).json({ error: "Failed to create family", detail: createRows });
      return;
    }
    const family = createRows[0];

    const { resp: bindResp, data: bindData } = await sbPost("pantry_clients", {
      client_id: clientId,
      family_id: family.id,
    });
    if (!bindResp.ok) {
      res.status(500).json({ error: "Failed to bind client", detail: bindData });
      return;
    }

    res.status(200).json({
      familyId: family.id,
      version: family.version,
      updatedAt: family.updated_at,
      data: family.data_json || emptyPayload(),
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

