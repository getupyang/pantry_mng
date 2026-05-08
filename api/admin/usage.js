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

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(rows, keyFn) {
  const map = {};
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function uniqueCount(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

function channelName(event) {
  const props = event.properties || {};
  const from = props.from || props.firstFrom || props.utm_source || props.source;
  const campaign = props.campaign || props.firstCampaign || props.utm_campaign;
  if (from && campaign) return `${from}/${campaign}`;
  return from || campaign || "direct";
}

function summarizeFamily(family, clients) {
  const data = family.data_json || {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    id: family.id,
    version: family.version,
    createdAt: family.created_at,
    updatedAt: family.updated_at,
    clientCount: clients.filter((client) => client.family_id === family.id).length,
    itemCount: items.length,
    openCount: items.reduce((sum, item) => sum + Number(item.openCount || 0), 0),
    stockCount: items.reduce((sum, item) => sum + Number(item.stockCount || 0), 0),
    locationCount: Array.isArray(data.locations) ? data.locations.length : 0,
  };
}

function summarizeDaily(events, clients, sinceDate) {
  const days = [];
  const start = new Date(sinceDate);
  const today = new Date();
  for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    const dayEvents = events.filter((event) => dayKey(event.created_at) === key);
    const dayClients = clients.filter((client) => dayKey(client.last_seen_at) === key);
    days.push({
      date: key,
      events: dayEvents.length,
      activeClients: uniqueCount(dayEvents, "client_id") || uniqueCount(dayClients, "client_id"),
      activeFamilies: uniqueCount(dayEvents, "family_id"),
    });
  }
  return days;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!ensureEnv(res)) return;
  if (!requireAdmin(req, res)) return;

  const days = Math.max(1, Math.min(90, parseInt(req.query.days || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const activeSince = new Date(Date.now() - 7 * 86400000).toISOString();

  try {
    const [eventsResult, familiesResult, clientsResult, recognitionResult] = await Promise.all([
      sbGet(
        `pantry_usage_events?select=event_name,family_id,client_id,properties,country,created_at&created_at=gte.${encodeURIComponent(
          since
        )}&order=created_at.desc&limit=5000`
      ),
      sbGet("pantry_families?select=id,version,data_json,created_at,updated_at&order=updated_at.desc&limit=500"),
      sbGet("pantry_clients?select=client_id,family_id,created_at,last_seen_at&order=last_seen_at.desc&limit=1000"),
      sbGet(
        `pantry_recognition_usage?select=req_type,status,error_code,created_at&created_at=gte.${encodeURIComponent(
          since
        )}&order=created_at.desc&limit=2000`
      ),
    ]);

    for (const result of [eventsResult, familiesResult, clientsResult, recognitionResult]) {
      if (!result.resp.ok) {
        res.status(500).json({ error: "Failed to query usage data", detail: result.data });
        return;
      }
    }

    const events = safeArray(eventsResult.data);
    const families = safeArray(familiesResult.data);
    const clients = safeArray(clientsResult.data);
    const recognition = safeArray(recognitionResult.data);
    const activeClients = clients.filter((client) => new Date(client.last_seen_at) >= new Date(activeSince));

    const eventCounts = countBy(events, (event) => event.event_name);
    const channelCounts = countBy(events, channelName);
    const countryCounts = countBy(events, (event) => event.country || "unknown");
    const recognitionCounts = countBy(recognition, (row) => `${row.req_type}_${row.status}`);
    const recentEvents = events.slice(0, 50).map((event) => ({
      eventName: event.event_name,
      familyId: event.family_id,
      clientId: event.client_id,
      country: event.country,
      createdAt: event.created_at,
      properties: event.properties || {},
    }));

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      since,
      days,
      summary: {
        totalFamilies: families.length,
        totalClients: clients.length,
        activeClients7d: activeClients.length,
        activeFamiliesInRange: uniqueCount(events, "family_id"),
        activeClientsInRange: uniqueCount(events, "client_id"),
        eventCount: events.length,
        recognitionCount: recognition.length,
        scanErrors: recognition.filter((row) => row.status === "error").length,
      },
      daily: summarizeDaily(events, clients, since),
      eventCounts,
      channelCounts,
      countryCounts,
      recognitionCounts,
      families: families.slice(0, 100).map((family) => summarizeFamily(family, clients)),
      recentEvents,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
