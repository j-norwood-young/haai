# Ollama

[Ollama](https://ollama.com/) provides an OpenAI-compatible API (default port **11434**).

## Setup

1. Install Ollama on the target machine.
2. Pull a model: `ollama pull llama3.2`
3. Confirm the API responds: `curl http://localhost:11434/v1/models`

## Add backend

```bash
aivm backend add \
  --name ollama-gpu1 \
  --base-url http://192.168.1.50:11434 \
  --provider ollama \
  --hostname gpu1
```

Use **passthrough** key mode.

## Model IDs

```
llama3.2:gpu1:ollama
```

Ollama model tags (e.g. `llama3.2:latest`) appear as returned by `/v1/models`.

## Tips

- Set `OLLAMA_HOST=0.0.0.0` to listen on all interfaces for remote access.
- For multiple GPUs, add one backend per Ollama instance with distinct `hostName` values.
