# LM Studio

[LM Studio](https://lmstudio.ai/) exposes an OpenAI-compatible API on the local network.

## Setup

1. Install LM Studio and load a model.
2. Enable the local server (default port **1234**).
3. Note the machine hostname — used as the `hostName` label in model IDs.

## Add backend

```bash
aivm backend add \
  --name lmstudio-bob \
  --base-url http://192.168.1.100:1234 \
  --provider lmstudio \
  --hostname bob
```

Use **passthrough** key mode — LM Studio typically does not require a real API key.

## Model IDs

Models appear as:

```
<model-name>:bob:lmstudio
```

Example: `qwen3.5-35b:bob:lmstudio`

List them with:

```bash
curl http://localhost:4000/v1/models -H "Authorization: Bearer $API_KEY"
```

## Tips

- Ensure the LM Studio server is reachable from the ai-v-models host (firewall, bind address).
- Use a virtual model alias if you want a stable name like `smart-chat` instead of the namespaced ID.
