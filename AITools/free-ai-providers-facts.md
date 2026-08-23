# Free AI API providers - verified facts (2026-08-23)

All numbers from official docs unless marked "third-party".

## Groq (free plan) - https://console.groq.com/docs/rate-limits

- openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b: 30 RPM, 1K RPD, 8K TPM, 200K TPD
- groq/compound, groq/compound-mini: 30 RPM, 250 RPD, 70K TPM
- whisper-large-v3 (speech to text): 20 RPM, 2K RPD
- No credit card required.

## OpenRouter ":free" models - https://openrouter.ai/docs/api-reference/limits

- Under $10 credits purchased all time: 20 RPM, 50 RPD
- At least $10 credits purchased all time (one-time, lifetime total, not balance): 20 RPM, 1000 RPD
- 18 free models listed on 2026-08-23, including z-ai/glm-5.2:free, nvidia/nemotron-3-ultra-550b-a55b:free, google/gemma-4-31b-it:free

## Google Gemini API (free tier) - https://ai.google.dev/gemini-api/docs/rate-limits

- Official page no longer publishes free-tier numbers; says to check AI Studio.
- Third-party reports (aipromptshub.co, tokenmix.ai): Gemini 2.5 Flash about 10 RPM, 250K TPM, 250-500 RPD.
- Google cut free quotas by 50-80% on 2025-12-07 (third-party).

## Cerebras (free trial) - https://inference-docs.cerebras.ai/support/rate-limits

- gpt-oss-120b, gemma-4-31b: 5 RPM, 30K TPM, 1M TPH, 1M TPD

## Cloudflare Workers AI - https://developers.cloudflare.com/workers-ai/platform/pricing/

- 10,000 neurons per day free. No RPM cap published.
- About 4.07M input tokens/day on Llama 3.2-1b; about 375K input tokens/day on Llama 3.1-70b.

## Mistral La Plateforme (Experiment tier) - third-party (pricepertoken.com)

- All API models free, about 1B tokens per month. Exact RPM not published; visible in Admin Console.

## GitHub Models - https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models

- Fully retired on 2026-07-30. Inference API no longer available.
