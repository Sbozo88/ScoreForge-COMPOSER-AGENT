# Personal edition testing

Run `npm test` and `npm run build` from `app/`. The build produces nine static preview routes plus the protected Firebase function's site directory. Craft Anything serves the local preview; do not start a development server.

- Open each route and switch specialist tabs with the mouse and arrow keys.
- Open Plans, switch monthly/annual pricing and open the offer dialog. These are design previews; selecting a plan explains that no payment is collected. No checkout or card collection should appear.
- Open Workspace, choose a specialist, send a prompt and reload. Conversations persist in this browser; responses are labelled demonstrations.
- Open Account, clear local data and verify conversations and saved readings are removed. Lock studio works on Firebase, and explains its limitation in the local preview.
- In Tools, download and select the provided MusicXML/WAV samples. Score inspection and basic pitched-note MIDI export work on uncompressed MusicXML. Audio export creates PCM WAV, not MP3. The filter is a frequency preview, not AI voice isolation.
- Search the academy and save a reading preview. Full source articles are not included.
- Follow README.md's signed-out, wrong-account, owner and logout checks on Firebase. The local preview is not access-controlled.

AI, remote transcription and email delivery are not connected. Personal browser data is not cloud-synced. Use your own Firebase project and exact owner UID before deployment.
