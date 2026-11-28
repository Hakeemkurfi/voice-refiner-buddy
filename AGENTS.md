# Architecture rules
- Keep advanced math dictation constraints and repetition normalization in one browser-safe module used by both answer surfaces, so Pi and web rules stay aligned.
- Keep curated reference documents as markdown under public/study-packs and index them into the resource library one item per chunk with embeddings, retaining page references; independently verify worked answers before treating them as guidance.
- Voice audio is generated in short pieces, with "Label:" colons spoken as full stops (the voice model drops colon labels), and joined with silent frames cloned from the voice's own frame header, so the file is one uniform stream.
- Phone Audio Mode relay (/api/public/pi-answer) is separate from pi-say; the server numbers captures per device and rejects stale publishes, and the shared rules live in src/lib/pi-answer.ts so tests and both sides agree.
- Multi-photo batches inventory all pages before solving one question per request; append answers to the live voice queue without interrupting earlier answers, retaining failed work for explicit retry.
