import { ensureEnv, sbGet, sbPatch, isValidClientId } from "../_supabase.js";

function parseFamilyId(req) {
  const raw = req.query.familyId;
  return Array.isArray(raw) ? raw[0] : raw;
}

async function verifyClientFamily(clientId, familyId) {
  const { resp, data } = await sbGet(
    `pantry_clients?select=client_id,family_id&client_id=eq.${encodeURIComponent(clientId)}&family_id=eq.${familyId}&limit=1`
  );
  return resp.ok && Array.isArray(data) && data.length > 0;
}

export default async function handler(req, res) {
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
    const bound = await verifyClientFamily(clientId, familyId);
    if (!bound) {
      res.status(403).json({ error: "Client is not a member of this family" });
      return;
    }

    if (req.method === "GET") {
      const { resp, data } = await sbGet(
        `pantry_families?select=id,data_json,version,updated_at&id=eq.${familyId}&limit=1`
      );
      if (!resp.ok || !Array.isArray(data) || data.length === 0) {
        res.status(404).json({ error: "Family not found" });
        return;
      }
      const fam = data[0];
      res.status(200).json({
        familyId: fam.id,
        version: fam.version,
        updatedAt: fam.updated_at,
        data: fam.data_json || { items: [], locations: [] },
      });
      return;
    }

    if (req.method === "PUT") {
      const { baseVersion, data } = req.body || {};
      if (typeof baseVersion !== "number" || !data || typeof data !== "object") {
        res.status(400).json({ error: "Invalid payload: baseVersion + data required" });
        return;
      }

      const { resp: currentResp, data: currentRows } = await sbGet(
        `pantry_families?select=id,version,data_json,updated_at&id=eq.${familyId}&limit=1`
      );
      if (!currentResp.ok || !Array.isArray(currentRows) || currentRows.length === 0) {
        res.status(404).json({ error: "Family not found" });
        return;
      }
      const current = currentRows[0];
      if (current.version !== baseVersion) {
        res.status(409).json({
          error: "Version conflict",
          serverVersion: current.version,
          serverData: current.data_json || { items: [], locations: [] },
          updatedAt: current.updated_at,
        });
        return;
      }

      const nextVersion = baseVersion + 1;
      const { resp: updateResp, data: updateRows } = await sbPatch(
        `pantry_families?id=eq.${familyId}&version=eq.${baseVersion}&select=id,version,updated_at`,
        { data_json: data, version: nextVersion },
        { Prefer: "return=representation" }
      );
      if (!updateResp.ok || !Array.isArray(updateRows) || updateRows.length === 0) {
        res.status(409).json({ error: "Concurrent update detected" });
        return;
      }
      const updated = updateRows[0];
      res.status(200).json({
        familyId,
        version: updated.version,
        updatedAt: updated.updated_at,
      });
      return;
    }

    res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

