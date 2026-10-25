# Embedding comparison

Run from the project root with `node --import tsx benchmarks/embedding-models.ts`. It reads `OPENROUTER_API_KEY` from `.env` and makes small, billable requests through OpenRouter. It does not alter `.env`, the running app's model, or its vector index.

The runner embeds the 42 chunks in the eight bundled example guides independently with each requested model, then ranks them by cosine similarity for 20 manually labeled questions. Top-1 and top-3 count whether the expected **step** appears at that rank, rather than merely finding the right document. These small fixture results do not establish general retrieval quality or generated-answer correctness.

Latency is measured separately using five distinct single-query requests per model. Model order rotates each round. The reported median/range includes routing, network and response parsing, with no retry, keyword shortcut, application cache or Mercury generation. Corpus indexing and the batched accuracy queries are excluded from these latency samples. Model-recommended query/document prefixes are included. All outputs are 1,024 dimensions; OpenAI is shortened from its default, while BGE and Liquid use native output dimensions with the `dimensions` parameter omitted.

Liquid's free endpoint may retain inputs for training. Only this benchmark's Liquid requests allow data collection; the paid-model requests retain `data_collection: deny`. A hash check rejects modified fixtures so the runner cannot silently send a replacement knowledge library to the free endpoint. Review and replace the fixture hash only for an explicitly public test corpus. No embeddings or API keys are written to the report.

- `embedding-results.json`: complete measurements and per-question ranks.
- `embedding-comparison.html`: standalone summary prepared from that report.
- `embedding-models.ts`: reproducible API benchmark and labeled cases.

Pricing and model documentation:

- [BGE Large EN v1.5](https://openrouter.ai/baai/bge-large-en-v1.5), [query instructions](https://huggingface.co/BAAI/bge-large-en-v1.5)
- [Perplexity Embed V1 0.6B](https://openrouter.ai/perplexity/pplx-embed-v1-0.6b), [model card](https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b)
- [Liquid LFM2.5 Embedding 350M](https://openrouter.ai/liquid/lfm-2.5-embedding-350m:free), [required query/document prefixes](https://huggingface.co/LiquidAI/LFM2.5-Embedding-350M)
- [OpenAI Text Embedding 3 Small](https://openrouter.ai/openai/text-embedding-3-small), [official dimension-shortening documentation](https://developers.openai.com/api/docs/guides/embeddings)
