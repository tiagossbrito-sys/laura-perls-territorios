// api/ranking.js — Vercel Serverless Function (ranking compartilhado)
// Guarda as pontuações num hash Redis (Upstash). Sem dependências: usa o fetch nativo do Node 18+.
//
// Variáveis de ambiente esperadas (a integração "Upstash for Redis" do Vercel as cria automaticamente):
//   KV_REST_API_URL   / KV_REST_API_TOKEN            (nomes do Vercel KV)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (nomes do Upstash)

const KEY       = 'quiz-territorios:ranking';
const MAX_SCORE = 750;
const MAX_NAME  = 30;

const REDIS_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Banco de dados não configurado (variáveis de ambiente ausentes)');
  }
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function normalise(name) { return String(name).trim().toLowerCase(); }
function todayISO()      { return new Date().toISOString().split('T')[0]; }

function parseHashAll(result) {
  // Upstash REST devolve HGETALL como array plano [campo, valor, campo, valor, ...]
  const entries = [];
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i += 2) {
      try { entries.push(JSON.parse(result[i + 1])); } catch (_) {}
    }
  } else if (result && typeof result === 'object') {
    for (const v of Object.values(result)) {
      try { entries.push(JSON.parse(v)); } catch (_) {}
    }
  }
  return entries;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const raw     = await redis(['HGETALL', KEY]);
      const entries = parseHashAll(raw);
      entries.sort((a, b) => b.score - a.score || String(a.date).localeCompare(String(b.date)));
      res.status(200).json({ ranking: entries.slice(0, 100) });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      let name  = String(body.name || '').trim().slice(0, MAX_NAME);
      let score = Number(body.score);

      if (!name) { res.status(400).json({ error: 'Nome inválido' }); return; }
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
        res.status(400).json({ error: 'Pontuação inválida' }); return;
      }
      score = Math.round(score);

      const key         = normalise(name);
      const existingRaw = await redis(['HGET', KEY, key]);
      let entry = null;
      if (existingRaw) { try { entry = JSON.parse(existingRaw); } catch (_) {} }

      let isRecord = false;
      if (!entry) {
        entry = { name, score, rounds: 1, date: todayISO() };
        isRecord = true;
      } else {
        entry.name   = name;                       // mantém a grafia mais recente
        entry.rounds = (entry.rounds || 0) + 1;
        entry.date   = todayISO();
        if (score > (entry.score || 0)) { entry.score = score; isRecord = true; }
      }

      await redis(['HSET', KEY, key, JSON.stringify(entry)]);
      res.status(200).json({ isRecord, entry });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
