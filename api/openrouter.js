import { createHash } from "crypto";
import { ensureEnv, sbGet, sbPost, isValidClientId } from "./_supabase.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ALLOWED_MODELS = new Set([
  "google/gemini-2.5-flash",
  "qwen/qwen3-vl-32b-instruct",
  "qwen/qwen-vl-plus",
]);
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_BODY_BYTES = 7 * 1024 * 1024;
const MAX_TOKENS = 2200;
const LIMITS = {
  clientHour: 12,
  clientDay: 40,
  familyDay: 100,
  ipHour: 30,
  ipDay: 80,
};

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getIpHash(req) {
  const forwarded = String(getHeader(req, "x-forwarded-for") || "");
  const ip = forwarded.split(",")[0].trim() || String(req.socket?.remoteAddress || "unknown");
  return createHash("sha256").update(`pantry:${ip}`).digest("hex").slice(0, 32);
}

function hasImage(value) {
  if (!value) return false;
  if (typeof value === "string") return value.startsWith("data:image/");
  if (Array.isArray(value)) return value.some(hasImage);
  if (typeof value === "object") {
    if (value.type === "image_url" && typeof value.image_url?.url === "string") {
      return value.image_url.url.startsWith("data:image/");
    }
    return Object.values(value).some(hasImage);
  }
  return false;
}

function sanitizeVisionRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    return { error: "messages is required" };
  }
  if (!hasImage(messages)) {
    return { error: "Only image recognition requests are allowed" };
  }

  const requestedModels = Array.isArray(body.models)
    ? body.models
    : body.model
      ? [body.model]
      : [DEFAULT_MODEL];
  if (!requestedModels.length || requestedModels.length > 3) {
    return { error: "Invalid model list" };
  }
  const unknown = requestedModels.find((model) => !ALLOWED_MODELS.has(model));
  if (unknown) {
    return { error: `Model is not allowed: ${unknown}` };
  }

  const maxTokens = Math.max(1, Math.min(MAX_TOKENS, Number(body.max_tokens || 700)));
  const clean = {
    messages,
    max_tokens: maxTokens,
    temperature: Number.isFinite(Number(body.temperature)) ? Math.min(1, Math.max(0, Number(body.temperature))) : 0.1,
  };
  if (requestedModels.length > 1) clean.models = requestedModels;
  else clean.model = requestedModels[0];
  return { body: clean, models: requestedModels };
}

async function verifyClientFamily(clientId, familyId) {
  const { resp, data } = await sbGet(
    `pantry_clients?select=client_id,family_id&client_id=eq.${encodeURIComponent(clientId)}&family_id=eq.${familyId}&limit=1`
  );
  return resp.ok && Array.isArray(data) && data.length > 0;
}

async function countEvents(filter, max) {
  const { resp, data } = await sbGet(
    `pantry_usage_events?select=id&event_name=eq.openrouter_request&${filter}&limit=${max + 1}`
  );
  if (!resp.ok || !Array.isArray(data)) return 0;
  return data.length;
}

async function checkRateLimit({ clientId, familyId, ipHash }) {
  const hour = encodeURIComponent(new Date(Date.now() - 3600000).toISOString());
  const day = encodeURIComponent(new Date(Date.now() - 86400000).toISOString());
  const checks = [
    ["clientHour", `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${hour}`],
    ["clientDay", `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${day}`],
    ["familyDay", `family_id=eq.${familyId}&created_at=gte.${day}`],
    ["ipHour", `ip_hash=eq.${ipHash}&created_at=gte.${hour}`],
    ["ipDay", `ip_hash=eq.${ipHash}&created_at=gte.${day}`],
  ];
  for (const [name, filter] of checks) {
    const count = await countEvents(filter, LIMITS[name]);
    if (count >= LIMITS[name]) {
      return { ok: false, name, limit: LIMITS[name] };
    }
  }
  return { ok: true };
}

async function recordUsage({ familyId, clientId, ipHash, reqType, models, status, errorCode, upstreamStatus, cost }) {
  await sbPost("pantry_usage_events", {
    family_id: familyId,
    client_id: clientId,
    event_name: "openrouter_request",
    ip_hash: ipHash,
    page_path: "/api/openrouter",
    properties: { reqType, models, status, errorCode, upstreamStatus, cost },
  });
  if (reqType === "photo" || reqType === "order") {
    await sbPost("pantry_recognition_usage", {
      family_id: familyId,
      client_id: clientId,
      req_type: reqType,
      status: status === "ok" ? "ok" : "error",
      error_code: errorCode || null,
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }
  if (!OPENROUTER_API_KEY) {
    res.status(500).json({ error: { message: "OPENROUTER_API_KEY is not configured" } });
    return;
  }
  if (!ensureEnv(res)) return;

  const clientId = getHeader(req, "x-client-id");
  const familyId = getHeader(req, "x-family-id");
  const reqType = getHeader(req, "x-recognition-type") === "order" ? "order" : "photo";
  const ipHash = getIpHash(req);
  if (!isValidClientId(clientId) || !isUuid(familyId)) {
    res.status(401).json({ error: { message: "Invalid client identity" } });
    return;
  }

  try {
    const bound = await verifyClientFamily(clientId, familyId);
    if (!bound) {
      res.status(403).json({ error: { message: "Client is not a member of this family" } });
      return;
    }

    const rawBody = req.body;
    const body =
      typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : rawBody || {};
    const rawSize = Buffer.byteLength(JSON.stringify(body), "utf8");
    if (rawSize > MAX_BODY_BYTES) {
      res.status(413).json({ error: { message: "Image request is too large" } });
      return;
    }
    const sanitized = sanitizeVisionRequest(body);
    if (sanitized.error) {
      res.status(400).json({ error: { message: sanitized.error } });
      return;
    }

    const rate = await checkRateLimit({ clientId, familyId, ipHash });
    if (!rate.ok) {
      res.status(429).json({ error: { message: `识别次数过多，请稍后再试（${rate.name}:${rate.limit}）` } });
      return;
    }

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
      body: JSON.stringify(sanitized.body),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      await recordUsage({
        familyId,
        clientId,
        ipHash,
        reqType,
        models: sanitized.models,
        status: "error",
        errorCode: data?.error?.code || data?.error?.message || `upstream_${upstream.status}`,
        upstreamStatus: upstream.status,
      });
      res
        .status(upstream.status)
        .json(
          data?.error?.message
            ? data
            : { error: { message: `Upstream ${upstream.status}` } }
        );
      return;
    }
    await recordUsage({
      familyId,
      clientId,
      ipHash,
      reqType,
      models: sanitized.models,
      status: "ok",
      upstreamStatus: upstream.status,
      cost: data?.usage?.cost || null,
    });
    res.status(200).json(data);
  } catch (e) {
    res
      .status(500)
      .json({ error: { message: e?.message || "Unknown server error" } });
  }
}
