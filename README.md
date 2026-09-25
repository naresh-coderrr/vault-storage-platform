# Vault — operator console

Fault-tolerant distributed object storage UI: put/get objects, cluster health, replication/durability, repair, and integrity.

## Run locally

```bash
npm install
npm start
# http://localhost:8080
```

Demo operator: `operator@vault.local` / `vault-operator`

Optional: point object/cluster APIs at a live `vault-backend` gateway:

```bash
VAULT_GATEWAY=http://localhost:3000 npm start
```

Auth always runs in this process (`POST /api/v1/auth/login`). vault-backend does not ship an auth API.

## Console pages

| Page | Purpose |
|------|---------|
| Homepage | Product story for the storage fabric |
| Sign in | Operator session |
| Overview | Health score, node mesh, events |
| Objects | Upload, download, delete, chunk map |
| Cluster | Nodes, register, decommission |
| Repair | Under-replicated chunks, healer, scrub |
| Durability | Replication factor, ack quorum, scrub interval |

Removed from navigation: Shared, Analytics, Chaos Studio, API keys, lifecycle tiers.

## Gateway contracts used

- `GET /api/health`
- `GET/POST /api/v1/objects`, `POST /api/v1/objects/upload`, `GET /api/v1/objects/:id`, `GET /api/v1/objects/:id/download`, `DELETE /api/v1/objects/:id`
- `GET/POST /api/v1/cluster/nodes`, `GET /api/v1/cluster/nodes/:id`, `DELETE /api/v1/cluster/nodes/:id`, `GET /api/v1/cluster/health`

Local extras (not on vault-backend): auth, `GET/POST /api/v1/cluster/repair`, `POST /api/v1/cluster/scrub`, `GET/PUT /api/v1/cluster/settings`, `GET /api/v1/cluster/events`.
