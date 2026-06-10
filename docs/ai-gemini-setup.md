# NOXUS AI Gemini Auto-Reply

The backend includes a Gemini-powered WhatsApp auto-reply hook. It only replies from the company knowledge file.

## Setup

You can manage AI from the dashboard under **AI Manager**. Use it to enter the Gemini key, enable or disable auto replies, edit the knowledge base, and review recent questions and replies.

The same settings can also be provided through environment variables:

1. Edit `data/knowledge/noxus.md` with your real company data.
2. Add a Gemini API key to your environment:

```env
AI_REPLY_ENABLED=true
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=gemini-2.5-flash
AI_KNOWLEDGE_PATH=./data/knowledge/noxus.md
```

3. Restart the backend.

Runtime dashboard changes are stored in `data/ai/settings.json`. Interaction history is stored in `data/ai/interactions.jsonl`.

## Safety Rules

- If the answer is not in `data/knowledge/noxus.md`, the assistant says the team will follow up.
- Group replies are off by default. Enable them with `AI_REPLY_INCLUDE_GROUPS=true`.
- The default cooldown is 30 seconds per chat: `AI_REPLY_COOLDOWN_MS=30000`.
