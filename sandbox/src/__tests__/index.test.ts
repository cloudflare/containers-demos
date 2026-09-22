import { describe, expect, it, vi } from 'vitest';
import worker, { Sandbox } from '../index';

interface ExecOutputLike {
    stdout: ArrayBuffer;
    stderr: ArrayBuffer;
    exitCode: number;
}

interface SandboxStub {
    start(): Promise<void>;
    exec(
        argv: string[],
        cwd: string | undefined,
        timeoutMs: number
    ): Promise<ExecOutputLike>;
    destroy(): Promise<void>;
}

interface TestDurableObjectID {
    toString(): string;
}

const DURABLE_OBJECT_ID = '0123456789abcdef'.repeat(4);

function sandboxStub(overrides: Partial<SandboxStub> = {}): SandboxStub {
    return {
        start: async () => { },
        exec: async () => ({
            stdout: new ArrayBuffer(0),
            stderr: new ArrayBuffer(0),
            exitCode: 0
        }),
        destroy: async () => { },
        ...overrides
    };
}

function envFor(
    stub: SandboxStub,
    APIKey: string | undefined = 'test-secret'
): Parameters<typeof worker.fetch>[1] {
    const env = {
        SANDBOX_API_KEY: APIKey,
        SANDBOX: {
            newUniqueId: (): TestDurableObjectID => ({
                toString: () => DURABLE_OBJECT_ID
            }),
            idFromString: (id: string): TestDurableObjectID => {
                if (id !== DURABLE_OBJECT_ID) throw new TypeError('Invalid ID');
                return { toString: () => id };
            },
            get: (): SandboxStub => stub
        }
    };
    return env as unknown as Parameters<typeof worker.fetch>[1];
}

function request(path: string, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer test-secret');
    return new Request(`https://example.com${path}`, { ...init, headers });
}

function processWith(output: ExecOutputLike) {
    return { output: async () => output };
}

function sandboxWith(container: object): Sandbox {
    return new Sandbox(
        { container } as unknown as DurableObjectState,
        {} as Parameters<typeof worker.fetch>[1]
    );
}

describe('sandbox routes', () => {
    it('requires the configured bearer token', async () => {
        const stub = sandboxStub();
        const unauthorized = await worker.fetch(
            new Request('https://example.com/v1/sandbox', { method: 'POST' }),
            envFor(stub)
        );
        expect(unauthorized.status).toBe(401);

        const undefinedToken = await worker.fetch(
            new Request('https://example.com/v1/sandbox', {
                method: 'POST',
                headers: { Authorization: 'Bearer undefined' }
            }),
            envFor(stub, undefined)
        );
        expect(undefinedToken.status).toBe(401);
    });

    it('creates a unique sandbox after starting its container', async () => {
        let releaseStart: (() => void) | undefined;
        const stub = sandboxStub({
            start: () =>
                new Promise<void>((resolve) => {
                    releaseStart = resolve;
                })
        });

        let settled = false;
        const create = worker
            .fetch(request('/v1/sandbox', { method: 'POST' }), envFor(stub))
            .then((response) => {
                settled = true;
                return response;
            });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);

        releaseStart?.();
        const response = await create;
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: DURABLE_OBJECT_ID });
    });

    it('returns command output as SSE events', async () => {
        const stub = sandboxStub({
            exec: async () => ({
                stdout: Uint8Array.from([0, 255]).buffer,
                stderr: Uint8Array.from([10]).buffer,
                exitCode: 7
            })
        });

        const response = await worker.fetch(
            request(`/v1/sandbox/${DURABLE_OBJECT_ID}/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    argv: ['sh', '-lc', 'node -v'],
                    cwd: '/tmp',
                    timeout_ms: 1_000
                })
            }),
            envFor(stub)
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
            'event: stdout\ndata: AP8=\n\nevent: stderr\ndata: Cg==\n\nevent: exit\ndata: {"exit_code":7}\n\n'
        );
    });

    it.each([
        'not json',
        '{}',
        '{"argv":[]}',
        '{"argv":[1]}',
        '{"argv":["true"],"timeout_ms":900001}'
    ])('rejects invalid exec input: %s', async (body) => {
        const response = await worker.fetch(
            request(`/v1/sandbox/${DURABLE_OBJECT_ID}/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            }),
            envFor(sandboxStub())
        );
        expect(response.status).toBe(400);
    });

    it('destroys a sandbox', async () => {
        const destroy = vi.fn(async () => { });
        const response = await worker.fetch(
            request(`/v1/sandbox/${DURABLE_OBJECT_ID}`, { method: 'DELETE' }),
            envFor(sandboxStub({ destroy }))
        );
        expect(response.status).toBe(204);
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('rejects unsupported routes, methods, and invalid sandbox IDs', async () => {
        const env = envFor(sandboxStub());

        expect((await worker.fetch(request('/v1/sandbox'), env)).status).toBe(405);
        expect(
            (await worker.fetch(request('/missing', { method: 'POST' }), env)).status
        ).toBe(404);
        expect(
            (
                await worker.fetch(
                    request('/v1/sandbox/invalid', { method: 'DELETE' }),
                    env
                )
            ).status
        ).toBe(404);
        expect(
            (await worker.fetch(request(`/v1/sandbox/${DURABLE_OBJECT_ID}`), env)).status
        ).toBe(405);
    });
});

describe('Sandbox container lifecycle', () => {
    it('starts the managed image without a readiness command', async () => {
        let startOptions: unknown;
        const exec = vi.fn(async () =>
            processWith({
                stdout: new ArrayBuffer(0),
                stderr: new ArrayBuffer(0),
                exitCode: 0
            })
        );
        const container = {
            running: false,
            start(options: unknown) {
                startOptions = options;
                this.running = true;
            },
            exec,
            destroy: vi.fn(async () => { })
        };

        const sandbox = sandboxWith(container);
        await sandbox.start();

        expect(startOptions).toEqual({
            image: 'cloudflare/debian-trixie',
            instance: 'standard-1',
            entrypoint: ['sh', '-c', 'sleep infinity'],
            enableInternet: false
        });
        expect(exec).not.toHaveBeenCalled();

        await expect(
            sandbox.exec(['true'], undefined, 1_000)
        ).resolves.toMatchObject({ exitCode: 0 });
        expect(exec).toHaveBeenCalledWith(['true'], {
            cwd: undefined,
            stdout: 'pipe',
            stderr: 'pipe',
            signal: expect.any(AbortSignal)
        });
    });

    it('is idempotent when destroying a stopped container', async () => {
        const destroy = vi.fn(async function(this: { running: boolean }) {
            this.running = false;
        });
        const container = {
            running: true,
            start: vi.fn(),
            exec: vi.fn(),
            destroy
        };
        const sandbox = sandboxWith(container);

        await sandbox.destroy();
        await sandbox.destroy();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('aborts a process after timeout', async () => {
        const sandbox = sandboxWith({
            running: true,
            start: vi.fn(),
            exec: async (
                _argv: string[],
                options: { signal?: AbortSignal }
            ) => {
                const signal = options.signal;
                if (!signal) throw new Error('expected an abort signal');
                return {
                    output: () =>
                        new Promise<ExecOutputLike>((resolve) => {
                            const finish = () =>
                                resolve({
                                    stdout: new ArrayBuffer(0),
                                    stderr: new ArrayBuffer(0),
                                    exitCode: 137
                                });
                            if (signal.aborted) finish();
                            else signal.addEventListener('abort', finish, { once: true });
                        })
                };
            },
            destroy: vi.fn(async () => { })
        });

        await expect(sandbox.exec(['sleep', '1'], undefined, 1)).rejects.toThrow();
    });
});
