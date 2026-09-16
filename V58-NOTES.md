# V58 — OpenAI Realtime/WebRTC Voice Executive

- Direct low-latency speech-to-speech connection using OpenAI Realtime over WebRTC.
- Browser microphone audio is sent over the peer connection; OpenAI audio is played as a remote track.
- Server creates the Realtime call, so the standard OPENAI_API_KEY never reaches browser JavaScript.
- Semantic VAD automatically detects turns and supports interruption/barge-in.
- Realtime voice is deliberately read-only for sensitive executive actions. Spoken approval is not accepted as authorization; protected actions still use the written approval flow.
- Environment: OPENAI_REALTIME_MODEL (default gpt-realtime), OPENAI_REALTIME_VOICE (default marin).
- Production requires HTTPS for microphone access.
