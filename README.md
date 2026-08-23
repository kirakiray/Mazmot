# Mazmot

> English | [中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.16-blue.svg)](package.json)
[![Browser Tests](https://github.com/kirakiray/Mazmot/actions/workflows/test.yml/badge.svg)](https://github.com/kirakiray/Mazmot/actions/workflows/test.yml)
[![Website](https://img.shields.io/badge/website-mazmot.noneos.com-blue.svg)](https://mazmot.noneos.com)
[![Repository](https://img.shields.io/badge/repo-github.com/kirakiray/Mazmot-blue.svg)](https://github.com/kirakiray/Mazmot)

**Mazmot** is a browser-based application launcher. Users can manage, run, and share multiple independent web apps — all running directly on the main domain, with no extra container service or packaging step. It is built on top of the micro-frontend containerization provided by [NoneOS Core](https://github.com/kirakiray/noneos-core), with the user-facing layer constructed using the [ofa.js](https://github.com/ofajs/ofa.js) framework and the [Senti-UI](https://github.com/ofajs/senti-ui) component library.

> **In essence**, Mazmot is a **userland implementation** of NoneOS Core's micro-frontend containerization technology. It assembles NoneOS Core's virtual filesystem, decentralized user identity, and P2P publishing capabilities into an end-user-facing "app market + launcher + sharing pipeline", enabling ordinary users to manage web apps as if they were using an operating system.

```js
// App run URL (virtual directory)
/$mazmot-apps/{appName}/client/index.html

// App share short link (P2P, fetchable while publisher is online)
/apps/run-app/?u={publisherUserId}&h={payloadHash}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser (User)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Mazmot App Layer                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │   │
│  │  │ apps/    │  │ apps/    │  │ apps/    │  │official-│  │   │
│  │  │ main     │  │ run-app  │  │ network  │  │apps/    │  │   │
│  │  │ (launcher│  │ (share   │  │ (network │  │ (app    │  │   │
│  │  │  )       │  │ receiver)│  │  monitor)│  │  market)│  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────┴─────────────────────────────────┐   │
│  │              ofa.js Framework + Senti-UI                   │   │
│  │       (Web Components / data binding / routing / UI kit)    │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                     │
│  ┌──────────┐  ┌──────────┴─┐  ┌────────────┐  ┌────────────┐  │
│  │ /nos/fs  │  │ /nos/user  │  │/nos/publish│  │/nos/storage│  │
│  │ (virtual │  │ (decent-   │  │ (DataPub-  │  │ (IndexedDB │  │
│  │  filesys)│  │  identity │  │  lisher)   │  │   store)  │  │
│  │           │  │  /messaging)│  │            │  │            │  │
│  └──────────┘  └────────────┘  └────────────┘  └────────────┘  │
│                           │                                     │
├───────────────────────────┼─────────────────────────────────────┤
│              NoneOS Core Service Worker (sw.js)                  │
│        (fetch interception / virtual URL prefixes / offline      │
│         caching / OPFS mounting)                                 │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────────┐
              │   NoneOS Core Relay Servers  │
              │ (ECDSA handshake / message   │
              │  relay / RTC signaling tunnel │
              │  / traffic stats)            │
              └──────────────────────────────┘
```

Apps run directly on the main domain through the Service Worker's virtual URL prefixes (`/$mazmot-apps/`, `/$mount-.../`, `/nos/`, `/gh/`, `/npm/`). The browser sees a single origin, while each app perceives an isolated runtime container.

---

## Features

### App Management (`apps/main/`)
- **Three app sources**: local directory (Chrome File System Access mount), virtual directory (OPFS-persisted), and official app market
- **App templates**: built-in templates (base / share-link / ping-pong / tic-tac-toe) so new apps work out of the box
- **App market**: browse and install official apps, with version detection and one-click updates
- **Status tracking**: tracks app window liveness via BroadcastChannel + localStorage

### P2P Sharing (`apps/run-app/` + `lib/share-mgr.js`)
- Peer-to-peer distribution via NoneOS Core `DataPublisher` — **no backend, no zip, no upload**
- Short links carry only `u` (publisher userId) + `h` (payload hash) parameters
- Three-layer security anchors: E2E key handshake + ECDSA signature verification + SHA-256 chunk tamper protection
- Receiver-side "fast jump": skips download and enters the app directly when already installed with matching content hash
- Fetchable while the publisher tab is online; closing it cuts off supply

### Network Monitoring (`apps/network/`)
- Server connection status, version, latency, connect/disconnect/test
- Connected RemoteUser online status, SessionIds, RTT, Ping
- Real-time bandwidth and traffic stats (per server / per user)

### Offline & Caching
- Service Worker intercepts `/gh/`, `/npm/`, `/nos/*` prefixed requests for offline use
- Host project file cache manifest (`host-cache.json`), auto-downloaded to OPFS after Core install/upgrade

---

## Project Structure

```
Mazmot/
├── index.html                # Root entry: initializes/upgrades NoneOS Core
├── sw.js                     # NoneOS Core Service Worker
├── host-cache.json           # Host project offline cache manifest
├── AGENTS.md                 # AI agent dev conventions (required reading)
├── CONTEXT.md                # Project architecture context
├── apps/                     # Apps (URL = /apps/<name>/)
│   ├── main/                 #   Main app: app list / add / market / share
│   ├── run-app/              #   Share receiver app (?u=...&h=...)
│   └── network/              #   Network monitoring app
├── lib/                      # Cross-app shared utils (app-runner / share-mgr)
├── comps/                    # System-level shared components (ercode / rdn-network / rnd-box)
├── official-apps/            # Official app resources (app market)
│   ├── ai-manager/           #   AI API Key manager
│   └── smart-assistant/      #   Smart contact assistant
├── ai/                       # Standalone subproject: AI Provider abstraction layer
└── .github/workflows/        # CI: multi-browser test matrix
```

---

## Quick Start

### Prerequisites

- Node.js (to run the static dev server)
- **Chrome** recommended (local directory mounting is Chrome-only; other browsers can use virtual directories and official apps)

### 1. Online access (fastest)

Visit **[mazmot.noneos.com](https://mazmot.noneos.com)** directly — no installation or setup required. The first visit auto-installs NoneOS Core, then enters the main app at `/apps/main/`.

### 2. Local development

Alternatively, run locally for development:

```bash
git clone https://github.com/kirakiray/Mazmot.git
cd Mazmot
npm install
npm run static
# → http://localhost:30031/
```

> **Note**: For full-featured local debugging (P2P handshakes, decentralized user connections, app sharing), you also need to run the local handshake server provided by [NoneOS Core](https://github.com/kirakiray/noneos-core):

```bash
git clone https://github.com/kirakiray/noneos-core.git
cd noneos-core
npm install
npm run ws
```

Keep the handshake server running in a separate terminal while developing Mazmot, otherwise P2P-dependent features (app sharing, user-to-user messaging, etc.) will not work end-to-end.

### 3. Add and run your first app

1. Click "Add App" on the main screen
2. Choose a source: local directory (Chrome) or virtual directory
3. Enter an app name (letters, digits, underscores, hyphens only — no spaces)
4. A new entry appears in the app list; click the row or the `tab-plus` / `open-in-new` button to launch

### 4. Share an app

Toggle "Auto Share" in the app list's collapsible sub-item to generate a short link:

```
https://your-host/apps/run-app/?u={publisherUserId}&h={payloadHash}
```

Anyone opening the link can install and run the app in one click. **The publisher tab must stay online** so peers can fetch data via P2P.

---

## Scripts

| Script | Description |
|---|---|
| `npm run static` | Start the static server (port 30031, no cache) |
| `npm test` | Run the sibyl-test multi-browser test suite |
| `npm run update` | Regenerate the host project offline cache manifest (`host-cache.json`) |

---

## Documentation

- [AGENTS.md](AGENTS.md) — AI agent dev conventions (tech stack, dependency URL rules, directory rules, testing, P2P sharing constraints)
- [CONTEXT.md](CONTEXT.md) — Project architecture context (directory tree, data models, app lifecycle, sharing flow)
- [comps/CONTEXT.md](comps/CONTEXT.md) — System-level shared component docs
- [mz/ai/README.md](mz/ai/README.md) — AI Provider abstraction layer full API docs

### Related Skill Knowledge Bases

Read the corresponding Skill docs before development (see [AGENTS.md](AGENTS.md) for details):

- **ofajs-docs** — page/component module development
- **noneos-core-docs** — `/nos/storage` (IndexedDB), filesystem, user management, service communication
- **senti-ui** — component library and visual conventions (Material Design 3)
- **sibyl-test** — testing framework

---

## Testing

Browser-side unit tests are written with [sibyl-test](https://github.com/ofajs/sibyl-test) as `.sb.html` files.

```bash
# Full test (multi-browser matrix)
npm test

# Quick single-file debug (Chrome)
npx sb-test -f <target-test-file>.sb.html --browsers chrome
```

CI runs a **Chrome (Ubuntu) / Firefox (Ubuntu) / WebKit (macOS)** three-browser matrix via the `ofajs/sibyl-test@v1` action (see [test.yml](.github/workflows/test.yml)).

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit changes: `git commit -am 'Add my feature'`
4. Push: `git push origin feat/my-feature`
5. Open a [Pull Request](https://github.com/kirakiray/Mazmot/pulls)

For bugs and feature requests, please [open an issue](https://github.com/kirakiray/Mazmot/issues).

> ⚠️ Before contributing, please read the dev conventions in [AGENTS.md](AGENTS.md) — especially the ofa.js dependency URL prefix rules and the NoneOS Core module loading timing constraints.

---

## License

[Apache-2.0](LICENSE) © Yao
