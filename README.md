# 🔐 Vault — Distributed Object Storage Platform

> **Google Drive simplicity. AWS-grade resilience underneath.**

Vault is a polished, production-quality web dashboard for a resilient distributed object storage system — featuring real-time cluster telemetry, self-healing visualization, chaos engineering tools, and zero-knowledge browser-side encryption.

![Vault Dashboard](https://img.shields.io/badge/Status-Live-22C55E?style=for-the-badge)
![Pages](https://img.shields.io/badge/Pages-5-6366F1?style=for-the-badge)
![Theme](https://img.shields.io/badge/Theme-Dark%20%2F%20Light-0A0A0F?style=for-the-badge)

---

## 🖥️ Pages

| Page | File | Description |
|------|------|-------------|
| 🏠 Dashboard | `index.html` | Hero stats, live cluster topology canvas, activity feed |
| 📁 File Manager | `files.html` | Google Drive-style grid/list, drag-and-drop upload with chunk animation |
| 🖥️ Cluster Health | `cluster.html` | Node cards, replication matrix, engineer view, self-healing log |
| ⚡ Chaos Studio | `chaos.html` | Kill nodes, inject corruption/latency, preset disaster scenarios |
| ⚙️ Settings | `settings.html` | Lifecycle policies, zero-knowledge encryption, API keys, advanced tuning |

---

## ✨ Features

- **Dark / Light theme** — glassmorphic design system with CSS custom properties
- **Live cluster topology** — Canvas-animated node graph with data-flow particles
- **Real-time activity feed** — Simulated WebSocket event stream
- **Drag-and-drop upload** — Animated chunk routing visualization
- **File detail drawer** — Slide-over with chunk breakdown, version history, sharing
- **Chaos Engineering Studio** — Kill nodes, inject bit corruption, latency injection
- **Replication Health Matrix** — Files × Nodes replica map with repair triggers
- **Engineer View toggle** — Raw JSON, SHA-256 hash table, latency heatmap
- **Zero-Knowledge Encryption** — AES-256-GCM browser-side toggle in Settings
- **Smart Lifecycle Rules** — Hot/Cold tier automator configuration
- **Fully responsive** — Mobile-first, keyboard accessible (WCAG AA)
- **Undo toasts** — 5-second undo for destructive actions
- **Universal search** — Ctrl+K command palette

---

## 🚀 Running Locally

### Option 1: Python (built-in, no install)
```bash
cd vault-website
python -m http.server 8080
# Open: http://localhost:8080
```

### Option 2: Node.js `serve`
```bash
npx serve . -p 8080
# Open: http://localhost:8080
```

### Option 3: VS Code Live Server
Install the **Live Server** extension → right-click `index.html` → Open with Live Server

---

## 🗄️ Backend & Database Setup

See the [Database Setup Guide](../database-setup.md) for:
- SQLite quickstart (zero config)
- PostgreSQL production setup
- Full schema with 7 tables
- Connection pool configuration
- Health check queries

### Proposed Stack
- **Frontend**: Pure HTML/CSS/JS (this repo) → migrate to Next.js + TailwindCSS
- **Backend**: Node.js (Express) or Python (FastAPI)
- **Database**: SQLite (dev) / PostgreSQL (production)
- **Real-time**: WebSockets (socket.io)
- **Storage Nodes**: Lightweight Express/FastAPI daemons on configurable ports

---

## 🏗️ Architecture

```
[Web Dashboard UI] ←──REST + WebSockets──→ [Gateway API]
                                                  │
                          ┌───────────────────────┼────────────────────────┐
                          ▼                       ▼                        ▼
                   [Metadata DB]         [Heartbeat Daemon]       [Self-Healing Worker]
                          │                       │                        │
                    ┌─────┴─────────────────────┬─┘                       │
                    ▼           ▼               ▼                          ▼
               [Node :9001] [Node :9002]  [Node :9003]  ←── P2P Repair Streaming
```

---

## 🎨 Design System

| Token | Dark | Light |
|-------|------|-------|
| Background | `#0A0A0F` | `#F8F9FF` |
| Surface | `#12121A` | `#FFFFFF` |
| Primary | `#6366F1` | `#6366F1` |
| Success | `#22C55E` | `#16A34A` |
| Warning | `#F59E0B` | `#D97706` |
| Danger | `#EF4444` | `#DC2626` |

Font: **Inter** · Icons: **Lucide** · Motion: 150–250ms purposeful transitions

---

## 📄 License

MIT © 2026 naresh-coderrr
