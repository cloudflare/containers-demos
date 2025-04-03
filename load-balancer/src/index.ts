import { DurableObject } from 'cloudflare:workers';

// starting => we called start() and init the monitor promise
// running => container returned healthy on the endpoint
// unhealthy => container is unhealthy (returning not OK status codes)
// stopped => container is stopped (finished running)
// failed => container failed to run and it won't try to run again, unless called 'start' again
type ContainerState = 'starting' | 'running' | 'unhealthy' | 'stopped' | 'failed';

async function wrap<T, E = Error>(fn: Promise<T>): Promise<[T, null] | [null, E]> {
	return fn.then((data) => [data, null] as [T, null]).catch((err) => [null, err as unknown as E] as [null, E]);
}

function isNotListeningError(err: Error): boolean {
	return err.message.includes('the container is not listening');
}

function noContainerYetError(err: Error): boolean {
	return err.message.includes('there is no container instance');
}

function wait(ms: number): Promise<unknown> {
	return new Promise((res) => setTimeout(res, ms));
}

export class Container extends DurableObject<Env> {
	container: globalThis.Container;
	monitor?: Promise<unknown>;

	async state(): Promise<ContainerState> {
		return (await this.ctx.storage.get('state')) ?? 'starting';
	}

	async stateTx(cb: (state: ContainerState) => Promise<unknown>) {
		return await this.ctx.blockConcurrencyWhile(async () => {
			const s = await this.state();
			await cb(s);
		});
	}

	private async setState(state: ContainerState) {
		console.log('Setting container state', state);
		await this.ctx.storage.put('state', state);
		await this.ctx.storage.sync();
	}

	constructor(ctx: DurableObjectState, env: Env) {
		if (ctx.container === undefined) {
			throw new Error('container is not defined');
		}

		super(ctx, env);
		this.container = ctx.container;
		this.ctx.blockConcurrencyWhile(async () => {
			if (this.container.running) {
				if (this.monitor === undefined) {
					this.monitor = this.container.monitor();
					this.handleMonitorPromise(this.monitor);
				}
			}

			// if no alarm, trigger ASAP
			await this.setAlarm(Date.now());
		});
	}

	async setAlarm(value = Date.now() + 500) {
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm === null) {
			await this.ctx.storage.setAlarm(value);
			await this.ctx.storage.sync();
		}
	}

	async alarm() {
		try {
			await this.stateTx(async (state) => {
				console.log('Current container state:', state);
				const [result, err] = await wrap(this.healthCheck());
				if (err !== null) {
					console.error('Received an internal error from healthCheck:', err.message);
					if (state !== 'starting') {
						await this.setState('failed');
					}

					return;
				}

				if (typeof result !== 'string') {
					console.warn('Container is unhealthy because it returned a ', result.status);

					// consume text stream
					await wrap(result.text());

					await this.setState('unhealthy');
					return;
				}

				if (result === 'ok') {
					await this.setState('running');
					return;
				}

				if (result == 'not_listening' || result == 'no_container_yet') {
					await this.setState('starting');
					return;
				}

				console.error('unknown result:', result);
			});
		} finally {
			await this.setAlarm();
		}
	}

	handleMonitorPromise(monitor: Promise<unknown>) {
		monitor
			.then(async () => {
				await this.stateTx(async (state) => {
					if (state === 'running' || state == 'unhealthy') {
						await this.setState('stopped');
						console.log(`Container stopped from state ${state}`);
						return;
					}

					if (state === 'starting') {
						console.log('Container was starting, and monitor resolved, we might have had an exception, retrying later');
						return;
					}

					if (state === 'failed') {
						console.log('Container was marked as failed, but we resolved monitor successfully');
					}
				});
			})
			.catch(async (err) => {
				console.error(`Monitor exited with an error: ${err.message}`);
				await this.setState('failed');
			});
	}

	// 'start' will start the container, and it will make sure it runs until the end
	async start(containerStart?: ContainerStartupOptions) {
		if (this.container.running) {
			if (this.monitor === undefined) {
				this.monitor = this.container.monitor();
				this.handleMonitorPromise(this.monitor);
			}

			return;
		}

		await this.setState('starting');
		this.container.start(containerStart);
		this.monitor = this.container.monitor();
		this.handleMonitorPromise(this.monitor);
	}

	// This ALWAYS throws an exception because it resets the DO
	async destroy() {
		try {
			await this.ctx.storage.deleteAll();
			await this.ctx.storage.deleteAlarm();
			await this.container.destroy();
		} finally {
			this.ctx.abort();
		}
	}

	// healthCheck returns 'ok' when the container returned
	// in the port returned a successful status code.
	// It will return a Response object when the status code is not ok.
	// It will return a known error enum if the container is not ready yet.
	async healthCheck(portNumber = 8000): Promise<'ok' | 'not_listening' | 'no_container_yet' | Response> {
		const port = this.container.getTcpPort(portNumber);
		const [res, err] = await wrap(port.fetch(new Request('http://container/_health')));
		if (err !== null) {
			if (isNotListeningError(err)) {
				return 'not_listening';
			}

			if (noContainerYetError(err)) {
				return 'no_container_yet';
			}

			// :(
			throw err;
		}

		if (res.ok) {
			await res.text();
			return 'ok';
		}

		// let the end user handle the not ok status code
		return res;
	}
}

export class ContainerManager extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async setNumberOfInstances(instances: number) {
		await this.ctx.storage.put('instances', instances);
	}

	async getContainerStates(): Promise<ContainerState[]> {
		const instances = (await this.ctx.storage.get<number>('instances')) ?? 0;
		const statuses: ContainerState[] = [];

		// TODO: do this in parallel basis with concurrency limits
		for (let i = 0; i < instances; i++) {}

		return statuses;
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		return new Response('hello');
	},
} satisfies ExportedHandler<Env>;
