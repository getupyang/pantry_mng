import { ensureEnv, sbGet } from "../_supabase.js";

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

function extractModelText(modelResponse) {
  const text = modelResponse?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;
  return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
}

function summarize(row) {
  return {
    id: row.id,
    familyId: row.family_id,
    clientId: row.client_id,
    reqType: row.req_type,
    imageDataUrl: row.image_data_url,
    models: row.models || [],
    modelText: extractModelText(row.model_response),
    usage: row.model_response?.usage || null,
    parsedResult: row.parsed_result,
    acceptedData: row.accepted_data,
    outcome: row.outcome,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;
  if (!requireAdmin(req, res)) return;

  const limit = Math.max(1, Math.min(80, parseInt(req.query.limit || "30", 10) || 30));
  const familyId = Array.isArray(req.query.familyId) ? req.query.familyId[0] : req.query.familyId;
  const familyFilter = isUuid(familyId) ? `&family_id=eq.${familyId}` : "";

  const { resp, data } = await sbGet(
    `pantry_recognition_reviews?select=id,family_id,client_id,req_type,image_data_url,models,model_response,parsed_result,accepted_data,outcome,error_code,created_at,updated_at${familyFilter}&order=created_at.desc&limit=${limit}`
  );
  if (!resp.ok) {
    res.status(500).json({ error: "Failed to query recognition reviews", detail: data });
    return;
  }
  res.status(200).json({ reviews: Array.isArray(data) ? data.map(summarize) : [] });
}
