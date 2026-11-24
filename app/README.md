# Score Forge Composer Agent · Personal edition

Your personal music workspace, focused tools, and specialist companions for the work around your score. The multi-page local and hosted experience includes specialist demonstrations, score/audio tools, sample reading previews and browser-local conversations.

Live production deployment: [https://scoreforge-8b660.web.app](https://scoreforge-8b660.web.app)

## Quick Start

From this directory or the project root:

```bash
# Run unit tests
npm test

# Build static routes and protected functions site
npm run build
```

## Features

- **8 Composer Specialists**: AIUTO (DAW manuals), PRESTO (client replies), TEMPO (temp audio), VOCE (call transcription), CECILIA (score recognition), GUIDA (platform guide), ANALISI (audio metadata), SAPIENZA (orchestration companion).
- **Free In-Browser Music Tools**:
  - Score Converter (MusicXML to MIDI)
  - Score Viewer (read scores without desktop notation software)
  - Media Converter (batch WAV/audio channel and level processing)
  - Audio Metadata & Signal Analyzer (ANALISI)
  - Orchestration & Range Companion (SAPIENZA)
  - Voice Frequency Isolator preview
  - Curiosities card deck
- **Composer Academy**: Curated guides on orchestration, notation, contracts, and music production.
- **Privacy First**: Files and conversations remain local to your browser session.

## Verification & Deployment

- Automated unit tests cover audio/MIDI output, signal levels, session validation, path traversal prevention, and security gating.
- Continuous integration runs automated builds and syntax checks on push.

## License

See [LICENSE](../LICENSE) for details.
