# sandbox

Cloudflare Worker that exposes a minimal sandbox HTTP API. It creates and manages sandboxed execution environments backed directly by [Cloudflare Containers](https://developers.cloudflare.com/containers/) attached to Durable Objects.

It uses the container `start()` API to specify the container image and configuration programmatically in the Worker code.

## Prerequisites

- Node.js and pnpm
- A Cloudflare account with Durable Objects and Containers enabled

## Getting Started

Install dependencies and generate the Worker types:

```sh
pnpm install
pnpm wrangler types
```

Configure a local bearer token and start the Worker:

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set SANDBOX_API_KEY
# (generate one with: openssl rand -hex 32)
pnpm wrangler dev
```

The Worker starts at `http://localhost:8787`.

Run the type checks and unit tests:

```sh
pnpm typecheck
pnpm test
```

## Authentication

Create a bearer token and add it to the Worker:

```sh
SANDBOX_API_KEY="$(openssl rand -hex 32)"
printf '%s' "$SANDBOX_API_KEY" | pnpm wrangler secret put SANDBOX_API_KEY
```

Save `$SANDBOX_API_KEY`. You will need it to access the API when the Worker is deployed.

## Deployment

Deploy the Worker with:

```sh
pnpm wrangler deploy
```

## Sandbox Interface

The bridge exposes three routes:

| Operation       | Route                       | Description                                                       |
| --------------- | --------------------------- | ----------------------------------------------------------------- |
| Create sandbox  | `POST /v1/sandbox`          | Generate a unique sandbox ID and initiate container startup       |
| Execute command | `POST /v1/sandbox/:id/exec` | Run an argument vector and return stdout, stderr, and exit status |
| Destroy sandbox | `DELETE /v1/sandbox/:id`    | Destroy the container and return HTTP 204                         |

Sandbox IDs are returned by `POST /v1/sandbox`.

## API Reference

In the examples below, `$CLOUDFLARE_SANDBOX_URL` is the URL of the deployed worker.

### `POST /v1/sandbox`

Create a sandbox and initiate its container startup:

```sh
curl --fail --silent --show-error \
  -X POST "$CLOUDFLARE_SANDBOX_URL/v1/sandbox" \
  -H "Authorization: Bearer $SANDBOX_API_KEY"
```

Response:

```json
{ "id": "2l2igitsdnm4wpssr5vcbsju4l3nfcrlulti5u3gqta7m34yy6ya" }
```

### `POST /v1/sandbox/:id/exec`

Execute a command:

```sh
curl --fail --no-buffer --silent --show-error \
  -X POST "$CLOUDFLARE_SANDBOX_URL/v1/sandbox/$SANDBOX_ID/exec" \
  -H "Authorization: Bearer $SANDBOX_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"argv":["node","-v"],"timeout_ms":30000}'
```

Request body:

| Field        | Type       | Required | Description                                                                    |
| ------------ | ---------- | -------- | ------------------------------------------------------------------------------ |
| `argv`       | `string[]` | yes      | Non-empty executable and argument vector                                       |
| `cwd`        | `string`   | no       | Working directory passed to `container.exec()`                                 |
| `timeout_ms` | `number`   | no       | Positive timeout in milliseconds; defaults to 30,000 and cannot exceed 900,000 |

The response uses server-sent event framing. `stdout` and `stderr` contain base64-encoded bytes:

```text
event: stdout
data: <base64>

event: stderr
data: <base64>

event: exit
data: {"exit_code":0}
```

### `DELETE /v1/sandbox/:id`

Destroy a sandbox:

```sh
curl --fail --silent --show-error \
  -X DELETE "$CLOUDFLARE_SANDBOX_URL/v1/sandbox/$SANDBOX_ID" \
  -H "Authorization: Bearer $SANDBOX_API_KEY"
```

The route returns HTTP 204 on success.
