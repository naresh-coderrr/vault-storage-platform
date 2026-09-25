'use strict';

/**
 * Vault operator console gateway.
 *
 * Serves the UI and a contract-compatible API:
 *   - /api/v1/objects   (same shape as vault-backend)
 *   - /api/v1/cluster   (nodes, health, repair, scrub)
 *   - /api/v1/auth      (operator login — not present on vault-backend)
 *
 * If VAULT_GATEWAY is set (e.g. http://localhost:3000), object/cluster
 * requests are proxied to that process. Auth always stays local.
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const GATEWAY = (process.env.VAULT_GATEWAY || '').replace(/\/$/, '');
const DEMO_EMAIL = process.env.VAULT_DEMO_EMAIL || 'operator@vault.local';
const DEMO_PASSWORD = process.env.VAULT_DEMO_PASSWORD || 'vault-operator';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
});

const sessions = new Map();
const events = [];

function nowIso() {
  return new Date().toISOString();
}

function logEvent(type, message, meta) {
  events.unshift({ id: uuidv4(), type, message, meta: meta || {}, at: nowIso() });
  if (events.length > 80) events.pop();
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function chunkBuffer(buf, size) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += size) {
    chunks.push(buf.subarray(i, i + size));
  }
  if (chunks.length === 0) chunks.push(Buffer.alloc(0));
  return chunks;
}

const store = {
  settings: {
    replicationFactor: 3,
    minDurableWrites: 2,
    scrubIntervalMinutes: 60,
  },
  nodes: [
    node('node-alpha', 'Node-Alpha', 'http://127.0.0.1:9001', 'HEALTHY', 0.31),
    node('node-beta', 'Node-Beta', 'http://127.0.0.1:9002', 'HEALTHY', 0.28),
    node('node-gamma', 'Node-Gamma', 'http://127.0.0.1:9003', 'DEGRADED', 0.72),
    node('node-delta', 'Node-Delta', 'http://127.0.0.1:9004', 'HEALTHY', 0.19),
  ],
  files: [],
};

function node(id, node_name, endpoint_url, status, usedFrac) {
  const total = 10 * 1024 * 1024 * 1024;
  return {
    id,
    node_name,
    endpoint_url,
    status,
    total_capacity: total,
    used_capacity: Math.floor(total * usedFrac),
    last_heartbeat: nowIso(),
    missed_heartbeats: status === 'OFFLINE' ? 8 : status === 'DEGRADED' ? 1 : 0,
  };
}

function seedObject(filename, text, replicationFactor) {
  const buf = Buffer.from(text, 'utf8');
  ingestObject(filename, 'text/plain', buf, replicationFactor);
}

function ingestObject(filename, mimeType, fileBuffer, replicationFactor) {
  const factor = Math.max(1, parseInt(replicationFactor, 10) || store.settings.replicationFactor);
  const healthy = store.nodes.filter((n) => n.status !== 'OFFLINE');
  const targets = healthy.length ? healthy : store.nodes;
  const effective = Math.min(factor, targets.length);
  const pieces = chunkBuffer(fileBuffer, 64 * 1024);
  const fileId = uuidv4();
  const chunks = pieces.map((piece, index) => {
    const chunkId = uuidv4();
    const checksum = sha256(piece);
    const replicas = [];
    for (let r = 0; r < effective; r++) {
      const n = targets[(index + r) % targets.length];
      const corrupted = n.status === 'DEGRADED' && index === 0 && r === effective - 1;
      replicas.push({
        id: uuidv4(),
        node_id: n.id,
        node_name: n.node_name,
        node_status: n.status,
        is_corrupted: corrupted,
        last_verified: nowIso(),
        bytes: Buffer.from(piece),
      });
    }
    return {
      id: chunkId,
      chunk_index: index,
      size: piece.length,
      checksum,
      replicas,
    };
  });

  const file = {
    id: fileId,
    filename,
    mime_type: mimeType || 'application/octet-stream',
    total_size: fileBuffer.length,
    chunk_size: 64 * 1024,
    total_chunks: chunks.length,
    replication_factor: factor,
    file_hash: sha256(fileBuffer),
    status: chunks.some((c) => c.replicas.filter((r) => !r.is_corrupted).length < factor)
      ? 'DEGRADED'
      : 'ACTIVE',
    prefix: '',
    created_at: nowIso(),
    chunks,
  };
  store.files.unshift(file);
  logEvent('upload', `Stored ${filename} with ${effective}× replication`, { fileId });
  return file;
}

seedObject(
  'cluster-manifest.json',
  JSON.stringify({ cluster: 'vault-prod', durability: '3x', healer: true }, null, 2),
  3
);
seedObject(
  'integrity-baseline.txt',
  'SHA-256 checksum ledger for replica scrubber baseline.\n',
  3
);

function summarizeFile(file) {
  let healthyReplicas = 0;
  let totalReplicas = 0;
  for (const chunk of file.chunks) {
    totalReplicas += chunk.replicas.length;
    healthyReplicas += chunk.replicas.filter(
      (r) => !r.is_corrupted && r.node_status === 'HEALTHY'
    ).length;
  }
  return {
    id: file.id,
    filename: file.filename,
    mime_type: file.mime_type,
    total_size: file.total_size,
    chunk_size: file.chunk_size,
    total_chunks: file.total_chunks,
    replication_factor: file.replication_factor,
    file_hash: file.file_hash,
    status: file.status,
    prefix: file.prefix,
    created_at: file.created_at,
    replica_health: {
      total_replicas: totalReplicas,
      healthy_replicas: healthyReplicas,
      total_chunks: file.chunks.length,
    },
  };
}

function enrichNode(n) {
  let total = 0;
  let healthy = 0;
  for (const file of store.files) {
    for (const chunk of file.chunks) {
      for (const r of chunk.replicas) {
        if (r.node_id === n.id) {
          total += 1;
          if (!r.is_corrupted) healthy += 1;
        }
      }
    }
  }
  const usedPercent = n.total_capacity
    ? Number(((n.used_capacity / n.total_capacity) * 100).toFixed(2))
    : 0;
  return {
    ...n,
    stored_replicas_count: total,
    healthy_replica_count: healthy,
    capacity: { total: n.total_capacity, used: n.used_capacity, usedPercent },
    time_since_heartbeat_ms: Date.now() - new Date(n.last_heartbeat).getTime(),
  };
}

function clusterHealth() {
  const totalNodes = store.nodes.length;
  const healthyNodes = store.nodes.filter((n) => n.status === 'HEALTHY').length;
  const degradedNodes = store.nodes.filter((n) => n.status === 'DEGRADED').length;
  const offlineNodes = store.nodes.filter((n) => n.status === 'OFFLINE').length;
  const under = underReplicated().length;
  const totalChunks = store.files.reduce((s, f) => s + f.chunks.length, 0);
  const totalReplicas = store.files.reduce(
    (s, f) => s + f.chunks.reduce((c, ch) => c + ch.replicas.length, 0),
    0
  );
  const nodeScore = totalNodes ? (healthyNodes / totalNodes) * 100 : 100;
  const chunkPenalty = totalChunks ? (under / totalChunks) * 20 : 0;
  return {
    totalNodes,
    healthyNodes,
    degradedNodes,
    offlineNodes,
    healthScore: Number(Math.max(0, Math.min(100, nodeScore - chunkPenalty)).toFixed(1)),
    totalFiles: store.files.length,
    totalChunks,
    totalReplicas,
    underReplicatedChunks: under,
  };
}

function underReplicated() {
  const rows = [];
  for (const file of store.files) {
    for (const chunk of file.chunks) {
      const healthy = chunk.replicas.filter((r) => !r.is_corrupted && r.node_status !== 'OFFLINE').length;
      if (healthy < file.replication_factor) {
        rows.push({
          chunk_id: chunk.id,
          file_id: file.id,
          filename: file.filename,
          chunk_index: chunk.chunk_index,
          replication_factor: file.replication_factor,
          healthy_replica_count: healthy,
        });
      }
    }
  }
  return rows;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  req.operator = sessions.get(token);
  next();
}

async function proxyIfGateway(req, res, next) {
  if (!GATEWAY) return next();
  if (req.path.startsWith('/api/v1/auth') || req.path === '/api/health') return next();
  try {
    const url = GATEWAY + req.originalUrl;
    const headers = { ...req.headers, host: undefined };
    delete headers.host;
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['content-type'] && req.headers['content-type'].includes('multipart')) {
        return next();
      }
      init.body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }
    const upstream = await fetch(url, init);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const ctype = upstream.headers.get('content-type');
    if (ctype) res.set('content-type', ctype);
    const disp = upstream.headers.get('content-disposition');
    if (disp) res.set('content-disposition', disp);
    return res.send(buf);
  } catch (err) {
    console.warn('[proxy] gateway unreachable, using local store:', err.message);
    return next();
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: GATEWAY ? 'proxy+local-auth' : 'local-simulator',
    timestamp: nowIso(),
  });
});

app.post('/api/v1/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
    return res.status(401).json({ error: 'Unknown operator or bad password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const operator = { email, name: 'Cluster Operator', role: 'operator' };
  sessions.set(token, operator);
  logEvent('auth', `${email} signed in`);
  res.json({ token, operator });
});

app.post('/api/v1/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/v1/auth/session', requireAuth, (req, res) => {
  res.json({ operator: req.operator });
});

app.use('/api', proxyIfGateway);

app.get('/api/v1/objects', requireAuth, (_req, res) => {
  res.json(store.files.map(summarizeFile));
});

app.post('/api/v1/objects/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided (field name: "file")' });
  const file = ingestObject(
    req.file.originalname,
    req.file.mimetype,
    req.file.buffer,
    req.body.replicationFactor
  );
  res.status(201).json(summarizeFile(file));
});

app.get('/api/v1/objects/:id/download', requireAuth, (req, res) => {
  const file = store.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const parts = [];
  for (const chunk of file.chunks.sort((a, b) => a.chunk_index - b.chunk_index)) {
    const replica = chunk.replicas.find((r) => !r.is_corrupted && r.node_status !== 'OFFLINE');
    if (!replica) {
      return res.status(503).json({ error: `No healthy replica for chunk ${chunk.chunk_index}` });
    }
    const actual = sha256(replica.bytes);
    if (actual !== chunk.checksum) {
      replica.is_corrupted = true;
      return res.status(500).json({ error: `Integrity check failed for chunk ${chunk.chunk_index}` });
    }
    parts.push(replica.bytes);
  }
  const body = Buffer.concat(parts);
  res.set('Content-Type', file.mime_type);
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.send(body);
});

app.get('/api/v1/objects/:id', requireAuth, (req, res) => {
  const file = store.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({
    ...summarizeFile(file),
    chunks: file.chunks.map((chunk) => ({
      id: chunk.id,
      chunk_index: chunk.chunk_index,
      size: chunk.size,
      checksum: chunk.checksum,
      replicas: chunk.replicas.map((r) => ({
        id: r.id,
        node_id: r.node_id,
        node_name: r.node_name,
        node_status: r.node_status,
        is_corrupted: !!r.is_corrupted,
        last_verified: r.last_verified,
      })),
    })),
  });
});

app.delete('/api/v1/objects/:id', requireAuth, (req, res) => {
  const idx = store.files.findIndex((f) => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'File not found' });
  const [removed] = store.files.splice(idx, 1);
  logEvent('delete', `Purged ${removed.filename}`);
  res.status(204).end();
});

app.get('/api/v1/cluster/nodes', requireAuth, (_req, res) => {
  store.nodes.forEach((n) => {
    if (n.status !== 'OFFLINE') n.last_heartbeat = nowIso();
  });
  res.json(store.nodes.map(enrichNode));
});

app.post('/api/v1/cluster/nodes', requireAuth, (req, res) => {
  const { nodeUrl, nodeName, totalCapacity } = req.body || {};
  if (!nodeUrl || !nodeName) {
    return res.status(400).json({ error: 'nodeUrl and nodeName are required' });
  }
  const created = node(uuidv4(), nodeName, String(nodeUrl).replace(/\/$/, ''), 'HEALTHY', 0.05);
  if (totalCapacity) created.total_capacity = totalCapacity;
  store.nodes.push(created);
  logEvent('node', `Registered ${nodeName}`);
  res.status(201).json(created);
});

app.get('/api/v1/cluster/nodes/:id', requireAuth, (req, res) => {
  const n = store.nodes.find((x) => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Node not found' });
  const chunks = [];
  for (const file of store.files) {
    for (const chunk of file.chunks) {
      for (const r of chunk.replicas) {
        if (r.node_id === n.id) {
          chunks.push({
            chunk_id: chunk.id,
            chunk_index: chunk.chunk_index,
            size: chunk.size,
            checksum: chunk.checksum,
            replica_id: r.id,
            is_corrupted: r.is_corrupted ? 1 : 0,
            last_verified: r.last_verified,
            file_id: file.id,
            filename: file.filename,
          });
        }
      }
    }
  }
  res.json({
    ...enrichNode(n),
    time_since_heartbeat_ms: Date.now() - new Date(n.last_heartbeat).getTime(),
    stored_chunks: chunks,
  });
});

app.get('/api/v1/cluster/health', requireAuth, (_req, res) => {
  res.json(clusterHealth());
});

app.delete('/api/v1/cluster/nodes/:id', requireAuth, (req, res) => {
  const n = store.nodes.find((x) => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Node not found' });
  n.status = 'OFFLINE';
  n.missed_heartbeats = 12;
  for (const file of store.files) {
    for (const chunk of file.chunks) {
      for (const r of chunk.replicas) {
        if (r.node_id === n.id) r.node_status = 'OFFLINE';
      }
    }
    file.status = 'DEGRADED';
  }
  logEvent('node', `${n.node_name} decommissioned — healer will re-replicate`);
  res.json({ message: `Node ${n.node_name} marked OFFLINE`, node: n });
});

app.get('/api/v1/cluster/repair', requireAuth, (_req, res) => {
  res.json({ underReplicated: underReplicated(), events: events.slice(0, 20) });
});

app.post('/api/v1/cluster/repair', requireAuth, (_req, res) => {
  const pending = underReplicated();
  let healed = 0;
  for (const row of pending) {
    const file = store.files.find((f) => f.id === row.file_id);
    const chunk = file && file.chunks.find((c) => c.id === row.chunk_id);
    if (!chunk) continue;
    const source = chunk.replicas.find((r) => !r.is_corrupted && r.node_status === 'HEALTHY');
    const holders = new Set(chunk.replicas.map((r) => r.node_id));
    const target = store.nodes.find((n) => n.status === 'HEALTHY' && !holders.has(n.id));
    if (source && target) {
      chunk.replicas.push({
        id: uuidv4(),
        node_id: target.id,
        node_name: target.node_name,
        node_status: target.status,
        is_corrupted: false,
        last_verified: nowIso(),
        bytes: Buffer.from(source.bytes),
      });
      healed += 1;
    } else if (source) {
      chunk.replicas.forEach((r) => {
        if (r.is_corrupted || r.node_status === 'OFFLINE') {
          r.is_corrupted = false;
          r.node_status = source.node_status;
          r.bytes = Buffer.from(source.bytes);
          r.last_verified = nowIso();
          healed += 1;
        }
      });
    }
  }
  store.files.forEach((f) => {
    const still = f.chunks.some(
      (c) => c.replicas.filter((r) => !r.is_corrupted && r.node_status !== 'OFFLINE').length < f.replication_factor
    );
    f.status = still ? 'DEGRADED' : 'ACTIVE';
  });
  logEvent('repair', `Healer pass complete — ${healed} replica(s) restored`);
  res.json({ healed, remaining: underReplicated().length });
});

app.post('/api/v1/cluster/scrub', requireAuth, (_req, res) => {
  let verified = 0;
  let corrupted = 0;
  for (const file of store.files) {
    for (const chunk of file.chunks) {
      for (const r of chunk.replicas) {
        if (r.node_status === 'OFFLINE') continue;
        const ok = sha256(r.bytes) === chunk.checksum && !r.is_corrupted;
        r.last_verified = nowIso();
        if (ok) verified += 1;
        else {
          r.is_corrupted = true;
          corrupted += 1;
        }
      }
    }
  }
  logEvent('scrub', `Integrity scrub: ${verified} ok, ${corrupted} corrupted`);
  res.json({ verified, corrupted, at: nowIso() });
});

app.get('/api/v1/cluster/events', requireAuth, (_req, res) => {
  res.json(events);
});

app.get('/api/v1/cluster/settings', requireAuth, (_req, res) => {
  res.json(store.settings);
});

app.put('/api/v1/cluster/settings', requireAuth, (req, res) => {
  const next = { ...store.settings };
  if (req.body.replicationFactor != null) {
    next.replicationFactor = Math.max(1, Math.min(9, parseInt(req.body.replicationFactor, 10)));
  }
  if (req.body.minDurableWrites != null) {
    next.minDurableWrites = Math.max(1, parseInt(req.body.minDurableWrites, 10));
  }
  if (req.body.scrubIntervalMinutes != null) {
    next.scrubIntervalMinutes = Math.max(1, parseInt(req.body.scrubIntervalMinutes, 10));
  }
  store.settings = next;
  logEvent('settings', `Durability policy updated to ${next.replicationFactor}× / ${next.minDurableWrites} durable writes`);
  res.json(next);
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  next();
});

app.listen(PORT, () => {
  console.log(`Vault console at http://localhost:${PORT}`);
  console.log(`Demo operator: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  if (GATEWAY) console.log(`Proxying cluster/object APIs to ${GATEWAY}`);
});
