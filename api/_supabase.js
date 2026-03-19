const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ensureEnv(res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Supabase env is not configured" });
    return false;
  }
  return true;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "GET",
    headers: supabaseHeaders(),
  });
  const data = await resp.json().catch(() => null);
  return { resp, data };
}

async function sbPost(path, body, extraHeaders = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: supabaseHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  return { resp, data };
}

async function sbPatch(path, body, extraHeaders = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: supabaseHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  return { resp, data };
}

function isValidClientId(clientId) {
  return typeof clientId === "string" && clientId.length >= 8 && clientId.length <= 128;
}

function generateJoinToken() {
  return `join_${crypto.randomUUID().replace(/-/g, "")}${crypto
    .randomUUID()
    .replace(/-/g, "")}`;
}

export {
  SUPABASE_URL,
  ensureEnv,
  sbGet,
  sbPost,
  sbPatch,
  isValidClientId,
  generateJoinToken,
};

