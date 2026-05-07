import { ensureEnv, sbGet, sbPost, sbPatch } from "../_supabase.js";

const ADMIN_TOKEN = process.env.PANTRY_ADMIN_TOKEN;

function getAdminToken(req) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return String(req.headers["x-admin-token"] || bearer?.[1] || "");
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(500).json({ error: "PANTRY_ADMIN_TOKEN is not configured" });
    return false;
  }
  if (getAdminToken(req) !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function summarizePayload(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    itemCount: items.length,
    openCount: items.reduce((sum, item) => sum + Number(item.openCount || 0), 0),
    stockCount: items.reduce((sum, item) => sum + Number(item.stockCount || 0), 0),
    locationCount: Array.isArray(data?.locations) ? data.locations.length : 0,
  };
}

function summarizeBackup(row) {
  return {
    id: row.id,
    familyId: row.family_id,
    version: row.version,
    reason: row.reason,
    createdByClientId: row.created_by_client_id,
    createdAt: row.created_at,
    ...summarizePayload(row.data_json),
  };
}

async function getFamily(familyId) {
  const { resp, data } = await sbGet(
    `pantry_families?select=id,version,data_json,updated_at&id=eq.${familyId}&limit=1`
  );
  if (!resp.ok || !Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

export default async function handler(req, res) {
  if (!ensureEnv(res)) return;
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const familyId = Array.isArray(req.query.familyId) ? req.query.familyId[0] : req.query.familyId;
    if (!isUuid(familyId)) {
      res.status(400).json({ error: "familyId is required" });
      return;
    }
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "30", 10) || 30));
    const { resp, data } = await sbGet(
      `pantry_family_backups?select=id,family_id,version,data_json,reason,created_by_client_id,created_at&family_id=eq.${familyId}&order=created_at.desc&limit=${limit}`
    );
    if (!resp.ok) {
      res.status(500).json({ error: "Failed to query backups", detail: data });
      return;
    }
    const family = await getFamily(familyId);
    res.status(200).json({
      family: family
        ? { id: family.id, version: family.version, updatedAt: family.updated_at, ...summarizePayload(family.data_json) }
        : null,
      backups: Array.isArray(data) ? data.map(summarizeBackup) : [],
    });
    return;
  }

  if (req.method === "POST") {
    const { familyId, backupId } = req.body || {};
    if (!isUuid(familyId) || !Number.isInteger(Number(backupId))) {
      res.status(400).json({ error: "familyId and backupId are required" });
      return;
    }

    const { resp: backupResp, data: backupRows } = await sbGet(
      `pantry_family_backups?select=id,family_id,version,data_json,created_at&family_id=eq.${familyId}&id=eq.${Number(
        backupId
      )}&limit=1`
    );
    if (!backupResp.ok || !Array.isArray(backupRows) || backupRows.length === 0) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }
    const backup = backupRows[0];
    const family = await getFamily(familyId);
    if (!family) {
      res.status(404).json({ error: "Family not found" });
      return;
    }

    const { resp: safetyResp, data: safetyData } = await sbPost("pantry_family_backups", {
      family_id: familyId,
      version: family.version,
      data_json: family.data_json || { items: [], locations: [] },
      reason: "before_admin_restore",
      created_by_client_id: "admin",
    });
    if (!safetyResp.ok) {
      res.status(500).json({ error: "Failed to create safety backup", detail: safetyData });
      return;
    }

    const nextVersion = Number(family.version || 0) + 1;
    const { resp: restoreResp, data: restoreRows } = await sbPatch(
      `pantry_families?id=eq.${familyId}&version=eq.${family.version}&select=id,version,updated_at`,
      { data_json: backup.data_json, version: nextVersion },
      { Prefer: "return=representation" }
    );
    if (!restoreResp.ok || !Array.isArray(restoreRows) || restoreRows.length === 0) {
      res.status(409).json({ error: "Restore conflict", detail: restoreRows });
      return;
    }

    res.status(200).json({
      familyId,
      restoredFromBackupId: backup.id,
      restoredFromVersion: backup.version,
      version: restoreRows[0].version,
      updatedAt: restoreRows[0].updated_at,
    });
    return;
  }

  res.status(405).json({ error: "Method Not Allowed" });
}
