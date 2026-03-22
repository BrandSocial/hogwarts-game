// Vercel Serverless Function — Global Leaderboard API
// Uses Vercel KV (Upstash Redis) for persistent cross-device storage

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const LB_KEY = 'hogwarts_leaderboard';
const MAX_ENTRIES = 100;

async function kvCommand(...args) {
  const res = await fetch(`${KV_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

async function getLeaderboard() {
  const raw = await kvCommand('GET', LB_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveLeaderboard(lb) {
  await kvCommand('SET', LB_KEY, JSON.stringify(lb));
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  }

  // Check KV is configured
  if (!KV_URL || !KV_TOKEN) {
    return res.status(503).json({ error: 'Leaderboard storage not configured', entries: [] });
  }

  try {
    if (req.method === 'GET') {
      const lb = await getLeaderboard();
      Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).json({ entries: lb });
    }

    if (req.method === 'POST') {
      const { name, score, house } = req.body || {};

      if (!name || typeof score !== 'number') {
        Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
        return res.status(400).json({ error: 'name (string) and score (number) required' });
      }

      // Sanitize inputs
      const cleanName = String(name).slice(0, 30).replace(/[<>"'&]/g, '');
      const cleanHouse = String(house || '').slice(0, 5);
      const cleanScore = Math.max(0, Math.min(999999, Math.round(score)));

      let lb = await getLeaderboard();

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

      await saveLeaderboard(lb);

      Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).json({ success: true, entries: lb });
    }

    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
