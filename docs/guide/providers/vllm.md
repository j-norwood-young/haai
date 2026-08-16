# vLLM

[vLLM](https://docs.vllm.ai/) serves OpenAI-compatible endpoints, commonly on port **8000**.

## Setup

Start vLLM with the OpenAI API server:

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 --port 8000
```

## Add backend

```bash
haai backend add \
  --name vllm-a100 \
  --base-url http://10.0.0.5:8000 \
  --provider vllm \
  --hostname a100
```

## Model IDs

```
Qwen/Qwen2.5-7B-Instruct:a100:vllm
```

## Known quirks

Some vLLM builds reject multiple system messages. The repo includes an example plugin (`examples/plugins/vllm-system-prompt-fix`) that merges system messages before forwarding.

Consider **plugins** (not hooks) for request mutation in production today — see [Plugin Authoring](./plugin-authoring).

## Tips

- Use [virtual models](./vmodels) to hide long HuggingFace model names from clients.
- Monitor GPU memory; add backends to a v-model for failover across nodes.
