# Score Forge Composer Agent

Specialist AI assistants and browser-based music tools built for professional composers, orchestrators, and arrangers.

Live deployment: [https://scoreforge-8b660.web.app](https://scoreforge-8b660.web.app)

---

## Overview

Score Forge Composer Agent is designed around the real moments in a composer's working day:
- **AIUTO**: Direct DAW procedures and setup documentation.
- **PRESTO**: Context-aware client communication and brief replies.
- **TEMPO**: Temp track and placeholder audio generation.
- **VOCE**: Meeting, call, and voice-note transcription reports.
- **CECILIA**: Score recognition and unlabelled notation identification.
- **GUIDA**: Intelligent ecosystem router and workflow guidance.
- **ANALISI**: Audio metadata, channel analysis, and signal levels.
- **SAPIENZA**: Professional orchestration reference and instrument ranges.

Alongside the specialists, Score Forge provides client-side, privacy-respecting audio and score tools (MusicXML to MIDI converters, audio normalizers, and interactive score viewers) where files never leave your browser.

---

## Development

### Prerequisites

- Node.js 20+ (Node 22 or 26 recommended)
- Firebase CLI (for deployment)

### Commands

```bash
# Run automated tests
npm test

# Build all static pages and application assets
npm run build
```

---

## Project Structure

```
├── app/                  # Application source code
│   ├── public/           # Frontend assets (CSS, JS, fonts, sample media)
│   ├── functions/        # Firebase Cloud Functions (private studio gate)
│   ├── converter/        # Score converter utilities
│   ├── tests/            # Automated test suite
│   ├── pages.mjs         # Multi-route static page definitions
│   └── build.mjs         # Asset compiler and route builder
├── .github/workflows/    # CI/CD check workflows
├── firebase.json         # Firebase Hosting & Functions config
├── package.json          # Root scripts and dependencies
└── LICENSE               # License terms
```

---

## Deployment

To deploy latest updates to Firebase Hosting:

```bash
npm run build && npx firebase deploy --only hosting
```

---

## License

Licensed under the terms specified in the [LICENSE](LICENSE) file.
