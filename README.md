# Soxial

An AI-powered desktop social media manager for X/Twitter and Reddit. A Gemini AI agent researches your accounts, learns your writing voice, builds a growth strategy, and executes — with your approval at every step.

## Download

| Platform | Download | Size | Instructions |
|----------|----------|------|--------------|
| **Linux** (AppImage) | [Soxial-0.1.8.AppImage](https://github.com/rabden/Soxial/releases/download/v0.1.8/Soxial-0.1.8.AppImage) | ~187 MB | `chmod +x Soxial-0.1.8.AppImage && ./Soxial-0.1.8.AppImage` |
| **Linux** (deb) | [soxial_0.1.8_amd64.deb](https://github.com/rabden/Soxial/releases/download/v0.1.8/soxial_0.1.8_amd64.deb) | ~143 MB | `sudo dpkg -i soxial_0.1.8_amd64.deb` |
| **macOS** (Apple Silicon) | [Soxial-0.1.8-arm64.dmg](https://github.com/rabden/Soxial/releases/download/v0.1.8/Soxial-0.1.8-arm64.dmg) | ~180 MB | Open dmg, drag to Applications. First launch: right-click, Open (unsigned) |
| **macOS** (Intel) | [Soxial-0.1.8.dmg](https://github.com/rabden/Soxial/releases/download/v0.1.8/Soxial-0.1.8.dmg) | ~182 MB | Open dmg, drag to Applications. First launch: right-click, Open (unsigned) |
| **Windows** | [Soxial.Setup.0.1.8.exe](https://github.com/rabden/Soxial/releases/download/v0.1.8/Soxial.Setup.0.1.8.exe) | ~147 MB | Run installer. SmartScreen warning, "More info", "Run anyway" |

> **Walkthrough video**: [https://youtu.be/vRNKqhSeWgY](https://youtu.be/vRNKqhSeWgY)

The app is unsigned (no Apple Developer cert or Windows code signing cert). Binaries are built via GitHub Actions CI from this repo's source. macOS: right-click, Open to bypass Gatekeeper. Windows: "More info", "Run anyway" to bypass SmartScreen.

## Features

- **5-minute onboarding** — connect X and Reddit, pull your posts and engagement, analyze your writing voice, ask targeted questions, then build a complete growth strategy (positioning, content pillars, hook library, targets, voice rules, baseline metrics)
- **Autonomous research** — scan feeds, find conversation gaps, draft posts and replies in your voice
- **Growth tracking** — follower metrics, content performance, strategy adaptation
- **Image generation** — Gemini-powered image creation for posts
- **Approval-first** — every public action (post, reply, comment, like, follow) requires your approval
- **Rich content rendering** — tweet cards, Reddit posts rendered inline, not text dumps
- **Local-first** — SQLite database, no cloud account, no tracking

## Quick Start

```bash
git clone https://github.com/rabden/soxial.git
cd soxial
npm install
npm run dev
```

Requires:
- Node.js 20+
- A free [Google AI Studio API key](https://aistudio.google.com/apikey)
- (Optional) Logged-in X and Reddit sessions for platform features

To build a distributable:

```bash
npm run dist          # all platforms
npm run dist:linux    # Linux only (AppImage, deb)
npm run dist:mac      # macOS only (DMG)
npm run dist:win      # Windows only (NSIS)
```

## Architecture

```
soxial/
├── electron/main/
│   ├── index.ts                    # App entry, IPC handlers, onboarding
│   ├── agent.ts                    # Gemini agent loop: streaming, tools, thinking
│   ├── agent-system-prompt.ts      # Chat agent system prompt
│   ├── onboarding-system-prompt.ts # Onboarding agent prompt
│   ├── tools.ts                    # 60+ tool definitions (X, Reddit, strategy, memory, image gen)
│   ├── cli.ts                      # Platform connector wrapper (cookie auth)
│   ├── db.ts                       # SQLite schema + queries (WAL mode)
│   ├── puter.ts                    # Image gen: Gemini primary, Puter.js fallback
│   └── social-content.ts           # Auto-archive of fetched posts/replies/comments
├── electron/preload/
│   └── index.ts                    # contextBridge IPC surface
├── src/
│   ├── App.tsx                     # Routes between Onboarding and Chat
│   ├── components/
│   │   ├── Onboarding.tsx          # Multi-step wizard
│   │   ├── Chat.tsx                # Streaming chat interface
│   │   ├── rich-content.tsx        # Parser/renderer for tweet-card, reddit-post, etc.
│   │   └── ui/                     # shadcn-style components
│   └── lib/
└── package.json
```

**Key design decisions:**

- **Tool-per-action** — each platform capability is its own tool with a Zod schema. Adding a new platform means adding tools; the agent loop doesn't change.
- **Approval as first-class** — the agent can research and draft freely. Public-facing actions are gated at the tool level.
- **Structured memory** — strategy data lives in typed SQLite tables (hooks, pillars, voice rules, targets). The agent queries what it needs instead of loading everything into context.
- **Two agent modes** — onboarding (60-step strategy builder) and chat (day-to-day ops). Same loop, different prompts and tool emphasis.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 42 |
| Build | electron-vite 5, Vite 6 |
| Frontend | React 19, TypeScript 5.8 |
| Styling | Tailwind CSS 3.4, shadcn/ui pattern |
| AI | Google Gemini via `@ai-sdk/google` + `@google/genai` |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Validation | Zod + zod-to-json-schema |
| Packaging | electron-builder |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start in development mode |
| `npm run build` | Build all targets (main, preload, renderer) |
| `npm run dist` | Build + package for all platforms |
| `npm run dist:linux` | Build + package for Linux |
| `npm run dist:mac` | Build + package for macOS |
| `npm run dist:win` | Build + package for Windows |
| `npm run typecheck` | Type-check both Node and web targets |
| `npm run reset` | Delete DB, uninstall CLIs, start fresh |

## Contributing

Contributions are welcome. Since `main` is protected, all changes go through pull requests:

1. Fork the repo and create a feature branch
2. Run `npm run typecheck` and `npm run build` locally before pushing
3. Open a pull request — CI runs typecheck + build, and an AI review runs on every PR
4. The maintainer reviews and merges once all checks pass

## Author

**Hossain Jahed** — [github.com/rabden](https://github.com/rabden)

Other projects: [X-twitter-social-manager-skill](https://github.com/rabden/X-twitter-social-manager-skill) (the open-source skill Soxial grew from) | [Hone Compose](https://github.com/rabden/hone-compose) (Chrome extension) | [Webhook SMS Forwarder](https://github.com/rabden/webhook-smsforwarder) (Android app)

---

Built with TypeScript, Electron, React, SQLite, and Google Gemini AI.
