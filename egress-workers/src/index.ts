import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { TERMINAL_HOST, terminalServerCode, terminalHTML } from "./terminal";
import { newWorkersRpcResponse, RpcTarget } from "capnweb";

const R2_PROXY_HOST = "r2-bucket";
const KV_PROXY_HOST = "kv";
const CONTAINER_PROXY_HOST = "container";

class MyCapnweb extends RpcTarget {
  foo() {
    return "hello from capnweb";
  }
}

export class TestService extends WorkerEntrypoint<Env, { id: string }> {
  async fetch(req: Request) {
    if (req.url.includes("capnweb")) {
      return newWorkersRpcResponse(req, new MyCapnweb());
    }

    let urlString = req.url;
    if (req.url.startsWith("/")) {
      urlString = "http://" + req.headers.get("host");
    }

    if (req.url.includes("exception")) {
      throw new Error("we want exception here");
    }

    const url = new URL(req.url);
    // Serve terminal server JS code to the container
    if (url.hostname === TERMINAL_HOST) {
      return new Response(terminalServerCode, {
        headers: { "content-type": "application/javascript" },
      });
    }

    if (url.hostname === R2_PROXY_HOST) {
      const key = url.pathname.slice(1);
      if (!key) {
        return new Response(
          "Give me an object path and I will pull it from R2 at lightspeed.",
          { status: 400 },
        );
      }

      const object = await this.env.ONE_GB.get(key);
      if (!object || !object.body) {
        return new Response(`No luck finding "${key}" in the 1gb bucket.`, {
          status: 404,
        });
      }

      const headers = new Headers();
      if (object.httpMetadata?.contentType) {
        headers.set("content-type", object.httpMetadata.contentType);
      }

      if (object.size !== undefined) {
        headers.set("content-length", String(object.size));
      }

      return new Response(object.body, { headers });
    }

    if (url.hostname === KV_PROXY_HOST) {
      if (!this.env.KV) {
        return new Response("KV binding is missing on this worker.", {
          status: 500,
        });
      }

      const key = url.pathname.slice(1);
      if (!key) {
        const prefix = url.searchParams.get("prefix") ?? undefined;
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const limit = url.searchParams.has("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined;
        const result = await this.env.KV.list({ prefix, cursor, limit });
        return Response.json(result);
      }

      if (req.method === "DELETE") {
        await this.env.KV.delete(key);
        return new Response(`Deleted "${key}" from KV.`, { status: 200 });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        const payload = req.body ? await req.arrayBuffer() : "";
        await this.env.KV.put(key, payload);
        return new Response(`Stored "${key}" in KV.`, { status: 200 });
      }

      const value = await this.env.KV.get(key, "arrayBuffer");
      if (value === null) {
        return new Response(`No KV value for "${key}".`, { status: 404 });
      }

      return new Response(value, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(value.byteLength),
        },
      });
    }

    if (url.hostname === CONTAINER_PROXY_HOST) {
      const containerName = req.headers.get("x-container-name");
      if (!containerName) {
        return new Response(
          "Missing x-container-name header for container network routing.",
          { status: 400 },
        );
      }

      const containerId = this.env.CONTAINER.idFromName(containerName);
      return this.env.CONTAINER.get(containerId).fetch(req);
    }

    return new Response(
      "Worker intercept online. Instance " +
        this.ctx.props.id +
        " handled " +
        req.url +
        " with headers " +
        JSON.stringify(Object.fromEntries(req.headers)) +
        "\n\nDemo hints:\n" +
        "- Use ?domain=<host> to choose the outbound destination.\n" +
        "- R2 mode: set ?domain=r2-bucket and put the object key in the path.\n" +
        "- KV mode: set ?domain=kv and use path as key (GET/HEAD read, PUT/POST write, DELETE remove).\n" +
        "- Container mode: set ?domain=container and send x-container-name to pick target container DO.\n" +
        "- Example: /1gb?domain=r2-bucket\n" +
        "- In R2 mode, the container measures download only and returns x-downloaded-bytes.",
      {
        headers: {
          Connection: "close",
        },
      },
    );
  }
}

let script = `
const http = require("node:http");
const https = require("node:https");

const server = http.createServer((req, res) => {
  const host = req.headers.host;
  if (!host) {
    res.writeHead(400);
    res.end("No host, no flight plan. Add a Host header and we are ready.");
    return;
  }

	if (host === "container") {
		res.end("hello, this is from container!")
		return;
  }

  const target = new URL(req.url || "/", "http://" + host);

  if (target.searchParams.has("capnweb")) {
    const capnweb = require("capnweb");
    const stub = capnweb.newWebSocketRpcSession("ws://15.0.0.1/capnweb");
    stub.foo()
      .then(function(result) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("capnweb result: " + JSON.stringify(result));
      })
      .catch(function(err) {
        res.writeHead(500);
        res.end("capnweb error: " + err.message);
      });
    return;
  }

  const isR2 = host === "${R2_PROXY_HOST}";
  const useHttps = target.searchParams.has("originHttps");
  if (useHttps) {
    target.protocol = "https:";
    target.searchParams.delete("originHttps");
  }
  const client = useHttps ? https : http;
  const MAX_BUFFER = 1 * 1024 * 1024;
  const startedAt = Date.now();
  const proxyReq = client.get(target, (proxyRes) => {
	const chunks = [];
	let downloadedBytes = 0;
	let bufferedBytes = 0;

	proxyRes.on("data", (chunk) => {
	  downloadedBytes += chunk.length;
	  if (bufferedBytes < MAX_BUFFER) {
		chunks.push(chunk);
		bufferedBytes += chunk.length;
	  }
	});

	proxyRes.on("end", () => {
	  const ok = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;

	  if (isR2) {
		const responseBody = ok
		  ? "R2 check complete: pulled " + downloadedBytes + " bytes from " + target.pathname + "."
		  : Buffer.concat(chunks).toString();
		const headers = {
		  ...proxyRes.headers,
		  "content-type": "text/plain; charset=utf-8",
		};
		headers["x-response-time-ms"] = String(Date.now() - startedAt);
		headers["x-downloaded-bytes"] = String(downloadedBytes);
		headers["content-length"] = String(Buffer.byteLength(responseBody));

		res.writeHead(proxyRes.statusCode || 200, headers);
		res.end(responseBody);
		return;
	  }

	  const body = Buffer.concat(chunks);
	  const headers = { ...proxyRes.headers };
	  headers["x-response-time-ms"] = String(Date.now() - startedAt);
	  headers["content-length"] = String(body.length);

	  res.writeHead(proxyRes.statusCode || 200, headers);
	  res.end(body);
	});
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502);
    res.end("Network turbulence hit the proxy: " + err.message);
  });
});

server.listen(3000, "0.0.0.0");
`;

export class Container extends DurableObject<Env> {
  container: globalThis.Container;
  wasRunningAfterReset = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.container = ctx.container!;
    void this.ctx.blockConcurrencyWhile(async () => {
      if (this.ctx.container?.running) {
        this.ctx.container.monitor();
        await this.container.interceptAllOutboundHttp(
          this.ctx.exports.TestService({
            props: { id: this.ctx.id.toString() },
          }),
        );
      }
    });
  }

  async start() {
    this.container.start({
      enableInternet: true,
      entrypoint: [
        `sh`,

        `-c`,
        `
				  mkdir -p /etc &&
					mount -o remount,rw /etc/hosts 2>/dev/null || true;
					echo '15.0.0.1 r2-bucket' >> /etc/hosts;
					echo '15.0.0.1 kv' >> /etc/hosts;
					echo '15.0.0.1 container' >> /etc/hosts; echo '15.0.0.1 ${TERMINAL_HOST}' >> /etc/hosts;
					echo '${script}' > ./index.js;
					node ./index.js &
					sleep 1
					wget -q -O /terminal-server.js http://${TERMINAL_HOST}/terminal-server.js; node /terminal-server.js`,
      ],
    });

    this.container
      .monitor()
      .catch((err) => {
        console.error(err.message);
      })
      .finally(() => {
        console.log("--> Container exited");
        this.start();
      });
  }

  private async ensureRunning() {
    if (!this.container.running) {
      // This will be in the future!! v
      //   await this.container.interceptOutboundHttps('google.com', this.ctx.exports.TestService({ props: { id: this.ctx.id.toString() } }));

      await this.container.interceptAllOutboundHttp(
        this.ctx.exports.TestService({ props: { id: this.ctx.id.toString() } }),
      );
      await this.start();
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  async fetch(req: Request) {
    await this.ensureRunning();

    const url = new URL(req.url);

    // WebSocket terminal: pass through to container
    if (url.pathname === "/terminal/ws") {
      return this.container
        .getTcpPort(3001)
        .fetch(req.url.replace("https://", "http://"), req);
    }

    // Everything else goes to the proxy on port 3000
    return this.container
      .getTcpPort(3000)
      .fetch(req.url.replace("https://", "http://"), req);
  }
}

export default {
  async fetch(request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = env.CONTAINER.idFromName("my-container-3");

    // Serve terminal HTML page
    if (url.pathname === "/terminal") {
      return new Response(terminalHTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Forward WebSocket upgrade to the DO -> container terminal server
    if (url.pathname === "/terminal/ws") {
      const res = await env.CONTAINER.get(stub).fetch(request.url, request);
      if (res.status >= 400) {
        console.error("Error upgrading", res.status, await res.text());
        return new Response("error", { status: 500 });
      }

      return res;
    }

    // Proxy demo
    const now = Date.now();
    const domain = url.searchParams.get("domain") ?? "google.com";
    const useHttps = url.searchParams.has("originHttps");
    const scheme = useHttps ? "https" : "http";
    const targetUrl = new URL(`${scheme}://${domain}`);
    targetUrl.pathname = url.pathname;
    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "domain") {
        targetUrl.searchParams.append(key, value);
      }
    }

    try {
      const res = await env.CONTAINER.get(stub).fetch(targetUrl.toString(), {
        ...request,
        signal: AbortSignal.timeout(30000),
      });
      const t = await res.text();
      const downloadedBytes = res.headers.get("x-downloaded-bytes");

      return new Response(
        t +
          (downloadedBytes
            ? ` Downloaded bytes: ${downloadedBytes}.`
            : "(does not apply)") +
          ` Demo timing: end-to-end ${Date.now() - now}ms, container to worker network hop ${res.headers.get("x-response-time-ms")}ms.`,
        res,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Error fetch:", message);
      return new Response(
        `Demo request failed on ${stub.toString()}: ${message}`,
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
