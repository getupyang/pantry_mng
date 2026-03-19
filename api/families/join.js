import { ensureEnv, sbGet, sbPost, sbPatch, isValidClientId } from "../_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;

  const { clientId, joinToken } = req.body || {};
  if (!isValidClientId(clientId) || typeof joinToken !== "string" || joinToken.length < 16) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  try {
    const now = encodeURIComponent(new Date().toISOString());
    const { resp: tokenResp, data: tokenRows } = await sbGet(
      `pantry_join_tokens?select=token,family_id,expires_at,revoked_at&token=eq.${encodeURIComponent(
        joinToken
      )}&revoked_at=is.null&or=(expires_at.is.null,expires_at.gt.${now})&limit=1`
    );
    if (!tokenResp.ok || !Array.isArray(tokenRows) || tokenRows.length === 0) {
      res.status(404).json({ error: "Invalid or expired join token" });
      return;
    }
    const familyId = tokenRows[0].family_id;

    const { resp: existingResp, data: existingRows } = await sbGet(
      `pantry_clients?select=client_id&client_id=eq.${encodeURIComponent(clientId)}&limit=1`
    );
    if (!existingResp.ok) {
      res.status(500).json({ error: "Failed to query client" });
      return;
    }

    if (Array.isArray(existingRows) && existingRows.length > 0) {
      const { resp: upResp, data: upData } = await sbPatch(
        `pantry_clients?client_id=eq.${encodeURIComponent(clientId)}`,
        { family_id: familyId, last_seen_at: new Date().toISOString() }
      );
      if (!upResp.ok) {
        res.status(500).json({ error: "Failed to update client family", detail: upData });
        return;
      }
    } else {
      const { resp: insResp, data: insData } = await sbPost("pantry_clients", {
        client_id: clientId,
        family_id: familyId,
      });
      if (!insResp.ok) {
        res.status(500).json({ error: "Failed to bind client", detail: insData });
        return;
      }
    }

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
      data: fam.data_json || { items: [], locations: [] },
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

