// Vercel Serverless Function — Global Leaderboard API
// Uses Redis (via Vercel Storage / Redis Cloud) for persistent cross-device storage
import Redis from 'ioredis';
 
let redis = null;
function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });
  }
  return redis;
}
 
const LB_KEY = 'hogwarts_leaderboard';
const MAX_ENTRIES = 100;
 
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}
 
async function getLeaderboard(r) {
  const raw = await r.get(LB_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
 
async function saveLeaderboard(r, lb) {
  await r.set(LB_KEY, JSON.stringify(lb));
}
 
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { setCors(res); return res.status(200).end(); }
 
  const r = getRedis();
  if (!r) { setCors(res); return res.status(503).json({ error: 'Leaderboard storage not configured', entries: [] }); }
 
  try {
    await r.connect().catch(() => {});
 
    if (req.method === 'GET') {
      const lb = await getLeaderboard(r);
      setCors(res);
      return res.status(200).json({ entries: lb });
    }
 
    if (req.method === 'POST') {
      const { name, score, house } = req.body || {};
      if (!name || typeof score !== 'number') { setCors(res); return res.status(400).json({ error: 'name and score required' }); }
 
      const cleanName = String(name).slice(0, 30).replace(/[<>"'&]/g, '');
      const cleanHouse = String(house || '').slice(0, 5);
      const cleanScore = Math.max(0, Math.min(999999, Math.round(score)));
 
      let lb = await getLeaderboard(r);
      const ex = lb.findIndex(e => e.name === cleanName);
      if (ex >= 0) {
        if (cleanScore > lb[ex].score) lb[ex].score = cleanScore;
        lb[ex].house = cleanHouse;
        lb[ex].lastPlayed = Date.now();
      } else {
        lb.push({ name: cleanName, score: cleanScore, house: cleanHouse, lastPlayed: Date.now() });
      }
      lb.sort((a, b) => b.score - a.score);
      lb = lb.slice(0, MAX_ENTRIES);
      await saveLeaderboard(r, lb);
 
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
