# Brandthread assistant — screenshots

All shots are the real app at a 390x844 viewport (2x device pixel ratio):
a production (`--no-dev`) Expo web build against a local api-server and
Postgres, signed in as freshly seeded local buyer/seller accounts. Every
inbox row, message and card comes from the real API; nothing is preview/demo
data.

**About the Q&A shots (05-08):** this environment has no LLM key, so the
server's existing OpenAI integration (`AI_INTEGRATIONS_OPENAI_BASE_URL`)
pointed at a local stand-in that returns fixed answers. Everything else on
that path is real: auth, the welcome thread, the system prompt the server
builds, moderation, `[[open:…]]` link parsing into deep-link cards,
persistence in `messages`, and the typing indicator. With a real key the
answers come from the model.

**09** is the real offline path: the `brandthreadAssistantChat` flag was off,
so the server stored its "offline right now" reply instead of calling the
LLM.

`polish/` holds before (origin/dev) and after shots for Messages items #44–#51.
