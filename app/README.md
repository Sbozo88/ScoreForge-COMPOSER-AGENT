# Score Forge Composer Agent

A personal studio website (`https://scoreforge-8b660.web.app`) with ten static pages, animated specialist previews, responsive navigation, learning cards, local conversations and browser music tools.

Run `npm install`, `npm test` and `npm run build` here. Craft Anything serves the resulting static preview.

The five reference pages are Home, Agents, Tools, Academy and Plans. Workspace, Account, FAQ, Contact and Score Converter provide working destinations. Plans are design previews and collect no payments. AI conversations are labelled demonstrations; no live AI, transcription or email service is connected. Academy readings are sample previews.

Local MusicXML inspection and basic MIDI export, WAV processing, signal analysis, instrument ranges, browser conversation history and saved reading previews work without external accounts. The voice filter is a frequency preview. The converter service has separate setup requirements.

For PDF conversion on macOS without Docker, run `npm run converter:local` from `app/` (or `npm run converter:start` with Docker Desktop) and open `http://localhost:4173/score-converter/`. This builds/uses Audiveris, Tesseract and the MusicXML schema, starts the persistent conversion queue, and serves the studio with `/api/converter` connected to that worker. The first build downloads the recognition engine and can take several minutes. A private worker token is generated in the ignored `converter/.env`; it never enters browser assets. Scores remain in the Docker `scores` volume across restarts. Run `npm run converter:stop` to stop both services without deleting scores.

The local converter is bound to this computer and has no owner login. Craft Anything's static-only preview cannot run the PDF worker; use the local address above for PDF uploads. `npm start` serves an already built site against an existing worker using server-side `CONVERTER_URL` and `CONVERTER_SECRET` environment variables. For public Firebase hosting, retain the owner gate, configure `CONVERTER_URL` to the worker's HTTPS address in the Functions environment, and store the same `CONVERTER_SECRET` in Firebase Secret Manager.

Private Firebase hosting code is retained. Owner authentication requires a configured Firebase project and exact owner UID, and remains unverified. Static previews are not access-controlled. Nothing was deployed.

See TESTING.md and VALIDATION.md for coverage and visual comparison limits.
