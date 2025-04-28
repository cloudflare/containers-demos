import { DurableObject } from 'cloudflare:workers';

export class Container extends DurableObject<Env> {
	container: globalThis.Container;

	async blockConcurrencyRetry(cb: () => Promise<unknown>) {
		await this.ctx.blockConcurrencyWhile(async () => {
			let lastErr;
			for (let i = 0; i < 10; i++) {
				try {
					return await cb();
				} catch (err) {
					lastErr = err;
					continue;
				}
			}

			throw lastErr;
		});
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.container = ctx.container!;
		this.blockConcurrencyRetry(async () => {
			await this.initWebsocket();
		});
	}

	conn?: WebSocket;
	async initWebsocket() {
		if (!this.container.running) this.container.start();

		const res = await this.container.getTcpPort(8080).fetch(new Request('http://container/ws', { headers: { Upgrade: 'websocket' } }));
		if (res.webSocket === null) throw new Error('websocket server is faulty');

		// Accept the websocket and listen to messages
		res.webSocket.accept();
		res.webSocket.addEventListener('message', (msg) => {
			if (this.resolveResolve !== undefined)
				this.resolveResolve(typeof msg.data === 'string' ? msg.data : new TextDecoder().decode(msg.data));
		});

		res.webSocket.addEventListener('close', () => {
			this.ctx.abort();
		});

		this.conn = res.webSocket;
	}

	promise?: Promise<string>;
	resolveResolve?: (s: string) => void;
	async send(message: string) {
		// add a promise to the class and send a message
		this.promise = new Promise((res) => {
			this.resolveResolve = res;
		});

		this.conn?.send(message);
	}

	async receive(): Promise<string> {
		if (this.promise !== undefined) return await this.promise;
		return '<no message>';
	}

	async fetch(req: Request) {
		const url = req.url.replace('https:', 'http:');
		return this.container.getTcpPort(8080).fetch(url, req);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const id: DurableObjectId = env.CONTAINER.idFromName('foo');
		const stub = env.CONTAINER.get(id);
		if (request.method !== 'POST') {
			return await stub.fetch(request);
		}

		await stub.send('we sent: ' + (await request.text()));
		const message = await stub.receive();
		return new Response(message);
	},
} satisfies ExportedHandler<Env>;
