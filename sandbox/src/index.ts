import { DurableObject } from 'cloudflare:workers';

interface ExecRequest {
    argv: string[];
    cwd?: string;
    timeout_ms?: number;
}

interface ExecResult {
    stdout: ArrayBuffer;
    stderr: ArrayBuffer;
    exitCode: number;
}

interface SandboxOptions {
    vcpu?: number;
    memoryMib?: number;
    diskMb?: number;
    image?: string;
}

const MAX_EXEC_TIMEOUT_MS = 15 * 60_000;

function errorResponse(error: unknown, status = 500): Response {
    return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status }
    );
}

function execResponse(result: ExecOutput): Response {
    const body = [
        `event: stdout\ndata: ${new Uint8Array(result.stdout).toBase64()}\n\n`,
        `event: stderr\ndata: ${new Uint8Array(result.stderr).toBase64()}\n\n`,
        `event: exit\ndata: ${JSON.stringify({ exit_code: result.exitCode })}\n\n`
    ].join('');

    return new Response(body, {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/event-stream; charset=utf-8'
        }
    });
}

async function createRequest(request: Request): Promise<SandboxOptions> {
    const text = await request.text();
    if (text === '') return {};

    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new TypeError('request body must be valid JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new TypeError('request body must be a JSON object');
    }

    const { vcpu, memoryMib, diskMb, image } = body as Record<string, unknown>;
    for (const [name, value] of Object.entries({ vcpu, memoryMib, diskMb })) {
        if (
            value !== undefined &&
            (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        ) {
            throw new TypeError(`${name} must be a positive number`);
        }
    }
    const sizes = [vcpu, memoryMib, diskMb].filter((value) => value !== undefined);
    if (sizes.length !== 0 && sizes.length !== 3) {
        throw new TypeError('vcpu, memoryMib, and diskMb must be set together');
    }
    if (image !== undefined && typeof image !== 'string') {
        throw new TypeError('image must be a string');
    }

    return { vcpu, memoryMib, diskMb, image } as SandboxOptions;
}

async function execRequest(request: Request): Promise<ExecRequest> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new TypeError('request body must be valid JSON');
    }

    if (typeof body !== 'object' || body === null) {
        throw new TypeError('argv must be a non-empty array of strings');
    }

    const { argv, cwd, timeout_ms: timeoutMs } = body as Record<string, unknown>;
    if (
        !Array.isArray(argv) ||
        argv.length === 0 ||
        !argv.every((value: unknown) => typeof value === 'string')
    ) {
        throw new TypeError('argv must be a non-empty array of strings');
    }
    if (cwd !== undefined && typeof cwd !== 'string') {
        throw new TypeError('cwd must be a string');
    }
    if (
        timeoutMs !== undefined &&
        (typeof timeoutMs !== 'number' ||
            !Number.isFinite(timeoutMs) ||
            timeoutMs <= 0 ||
            timeoutMs > MAX_EXEC_TIMEOUT_MS)
    ) {
        throw new TypeError(
            `timeout_ms must be a positive number no greater than ${MAX_EXEC_TIMEOUT_MS}`
        );
    }

    return {
        argv: argv as string[],
        cwd,
        timeout_ms: timeoutMs
    };
}

export class Sandbox extends DurableObject<Env> {
    #exitError: unknown;

    get container(): Container {
        if (this.ctx.container === undefined) {
            throw new Error('Container attachment is unavailable');
        }
        return this.ctx.container;
    }

    start({ vcpu, memoryMib, diskMb, image }: SandboxOptions = {}): void {
        const container = this.container;
        if (container.running) return;

        let imageReference = 'cloudflare/debian-trixie';
        if (image !== undefined) {
            imageReference = container.images[image];
            if (imageReference === undefined) {
                throw new TypeError(`unknown image: ${image}`);
            }
        }

        container.start({
            image: imageReference,
            instance:
                vcpu === undefined || memoryMib === undefined || diskMb === undefined
                    ? 'standard-1'
                    : { vcpu, memoryMib, diskMb },
            entrypoint: ['sh', '-c', 'sleep infinity'],
            enableInternet: true
        });

        // start() reports failures, such as exceeded account limits, only
        // through monitor(). exec() reports them in place of a generic error.
        this.#exitError = undefined;
        container.monitor().catch((error: unknown) => {
            this.#exitError = error;
        });
    }

    async exec(
        argv: string[],
        cwd: string | undefined,
        timeoutMs: number
    ): Promise<ExecResult> {
        if (!this.container.running && this.#exitError !== undefined) {
            throw this.#exitError;
        }

        // A timeout signal that fires after the process exits logs an internal
        // error, so the timer is cleared when the command ends.
        const controller = new AbortController();
        const timer = setTimeout(
            () =>
                controller.abort(
                    new DOMException(`Command timed out after ${timeoutMs} ms`, 'TimeoutError')
                ),
            timeoutMs
        );
        try {
            const process = await this.container.exec(argv, {
                cwd,
                stdout: 'pipe',
                stderr: 'pipe',
                signal: controller.signal
            });
            const output = await process.output();
            controller.signal.throwIfAborted();
            return {
                stdout: output.stdout,
                stderr: output.stderr,
                exitCode: output.exitCode
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async destroy(): Promise<void> {
        if (this.container.running) {
            await this.container.destroy();
        }
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (
            !env.SANDBOX_API_KEY ||
            request.headers.get('Authorization') !== `Bearer ${env.SANDBOX_API_KEY}`
        ) {
            return new Response('Unauthorized', { status: 401 });
        }

        const url = new URL(request.url);

        if (url.pathname === '/v1/sandbox') {
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: 'POST' }
                });
            }

            const objectID = env.SANDBOX.newUniqueId();
            const stub = env.SANDBOX.get(objectID);
            try {
                await stub.start(await createRequest(request));
                return Response.json({ id: objectID.toString() });
            } catch (error) {
                return errorResponse(error, error instanceof TypeError ? 400 : 503);
            }
        }

        const match = /^\/v1\/sandbox\/([^/]+)(?:\/(exec))?$/.exec(url.pathname);
        if (!match) return new Response('Not Found', { status: 404 });
        const [, id, operation] = match;

        let objectID: DurableObjectId;
        try {
            objectID = env.SANDBOX.idFromString(id);
        } catch {
            return new Response('Not Found', { status: 404 });
        }
        const stub = env.SANDBOX.get(objectID);

        if (operation === 'exec') {
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: { Allow: 'POST' }
                });
            }

            try {
                const {
                    argv,
                    cwd,
                    timeout_ms: timeoutMs = 30_000
                } = await execRequest(request);
                return execResponse(await stub.exec(argv, cwd, timeoutMs));
            } catch (error) {
                return errorResponse(error, error instanceof TypeError ? 400 : 500);
            }
        }

        if (request.method !== 'DELETE') {
            return new Response('Method Not Allowed', {
                status: 405,
                headers: { Allow: 'DELETE' }
            });
        }

        try {
            await stub.destroy();
            return new Response(null, { status: 204 });
        } catch (error) {
            return errorResponse(error);
        }
    }
} satisfies ExportedHandler<Env>;
