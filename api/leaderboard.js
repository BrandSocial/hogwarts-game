// Vercel Serverless Function — Global Leaderboard API
// Uses Upstash Redis (via Vercel Storage) for persistent cross-device storage
// Supports both KV_REST_API_URL/TOKEN and REDIS_URL env var formats
 
// Resolve Upstash REST API credentials from available env vars
function getCredentials() {
  // Option 1: Vercel KV style (KV_REST_API_URL + KV_REST_API_TOKEN)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  }
  // Option 2: Parse REDIS_URL (redis://default:{password}@{host}:{port})
  // Upstash REST API lives at https://{host} with the password as Bearer token
  if (process.env.REDIS_URL) {
    try {
      const parsed = new URL(process.env.REDIS_URL);
      const host = parsed.hostname;
      const token = parsed.password;
      return { url: `https://${host}`, token };
    } catch { return null; }
  }
  return null;
}
 
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
 
const LB_KEY = 'hogwarts_leaderboard';
const MAX_ENTRIES = 100;
 
async function kvCommand(creds, ...args) {
  const res = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
 
async function getLeaderboard(creds) {
  const raw = await kvCommand(creds, 'GET', LB_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
 
async function saveLeaderboard(creds, lb) {
  await kvCommand(creds, 'SET', LB_KEY, JSON.stringify(lb));
}
 
function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}
 
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(200).end();
  }
 
  // Resolve credentials
  const creds = getCredentials();
  if (!creds) {
    setCors(res);
    return res.status(503).json({ error: 'Leaderboard storage not configured', entries: [] });
  }
 
  try {
    if (req.method === 'GET') {
      const lb = await getLeaderboard(creds);
      setCors(res);
      return res.status(200).json({ entries: lb });
    }
 
    if (req.method === 'POST') {
      const { name, score, house } = req.body || {};
 
      if (!name || typeof score !== 'number') {
        setCors(res);
        return res.status(400).json({ error: 'name (string) and score (number) required' });
      }
 
      // Sanitize inputs
      const cleanName = String(name).slice(0, 30).replace(/[<>"'&]/g, '');
      const cleanHouse = String(house || '').slice(0, 5);
      const cleanScore = Math.max(0, Math.min(999999, Math.round(score)));
 
      let lb = await getLeaderboard(creds);
 
      // Find existing entry for this player
      const existing = lb.findIndex(e => e.name === cleanName);
      if (existing >= 0) {
        // Only update if new score is higher
        if (cleanScore > lb[existing].score) {
          lb[existing].score = cleanScore;
        }
        lb[existing].house = cleanHouse;
        lb[existing].lastPlayed = Date.now();
      } else {
        lb.push({
          name: cleanName,
          score: cleanScore,
          house: cleanHouse,
          lastPlayed: Date.now(),
        });
      }
 
      // Sort and trim
      lb.sort((a, b) => b.score - a.score);
      lb = lb.slice(0, MAX_ENTRIES);
 
      await saveLeaderboard(creds, lb);
 
      setCors(res);
      return res.status(200).json({ success: true, entries: lb });
    }
 
    setCors(res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    setCors(res);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
