import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpCall, startApp, type RunningApp } from './helpers.js';

/**
 * End-to-end over real HTTP, with only the identity provider and the Unimicro
 * API stubbed. These tests are the executable version of docs/CONNECTING.md.
 */

let app: RunningApp;
const realFetch = globalThis.fetch;

/** Intercept outbound calls to the Unimicro API; let everything else through. */
function stubUnimicro(routes: Record<string, unknown>): void {
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
        const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
        for (const [fragment, body] of Object.entries(routes)) {
            if (url.includes(fragment)) {
                return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
            }
        }
        return realFetch(input, init);
    });
}

beforeAll(async () => {
    app = await startApp();
});
afterEach(() => {
    vi.unstubAllGlobals();
});
afterAll(async () => {
    await app.close();
});

describe('authentication', () => {
    it('challenges an unauthenticated request with a discoverable resource', async () => {
        const response = await realFetch(`${app.baseUrl}/mcp`, { method: 'POST', body: '{}' });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    });

    it('rejects a token the verifier does not accept', async () => {
        const { status } = await mcpCall(app.baseUrl, 'tools/list', {}, { token: 'nope' });
        expect(status).toBe(401);
    });
});

describe('tools/list', () => {
    it('advertises the tool with an input schema, output schema and annotations', async () => {
        const { body } = await mcpCall(app.baseUrl, 'tools/list');
        const tools: any[] = body.result.tools;

        expect(tools.map(t => t.name)).toContain('check_api_access');
        expect(tools.map(t => t.name)).toContain('get_company_activations');

        const [tool] = tools;
        expect(tool.title).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
        expect(tool.outputSchema).toBeTruthy();
        expect(tool.annotations.readOnlyHint).toBe(true);
    });
});

describe('get_company_activations', () => {
    const call = (arguments_: Record<string, unknown> = {}, headers?: Record<string, string>) =>
        mcpCall(app.baseUrl, 'tools/call', { name: 'get_company_activations', arguments: arguments_ }, { name: 'get_company_activations', headers });

    it('requires a companyKey', async () => {
        const { body } = await call();

        expect(body.result.isError).toBe(true);
        expect(body.result.content[0].text).toContain('companyKey');
    });

    it('requests active purchases for the resolved company and returns stable product fields', async () => {
        const requests: Array<{ url: string; headers: Headers }> = [];
        vi.stubGlobal('fetch', async (input: any, init?: any) => {
            const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
            if (url.includes('/api/elsa/purchases')) {
                requests.push({ url, headers: new Headers(init?.headers) });
                return new Response(JSON.stringify([
                    {
                        ID: 10,
                        ProductID: 20,
                        ProductName: 'Payroll',
                        ProductKey: 'payroll',
                        PurchaseStatus: 1,
                        CompanyKey: 'ignored-by-request',
                        StartDate: '2026-01-01',
                        EndDate: '2026-12-31',
                        CreatorName: 'Not exposed',
                    },
                    { ID: 11, ProductID: 21, ProductName: 'Inactive', PurchaseStatus: 2 },
                ]), { headers: { 'content-type': 'application/json' } });
            }
            return realFetch(input, init);
        });

        const { body } = await call({
            companyKey: '123e4567-e89b-12d3-a456-426614174000',
            productName: 'Payroll',
        });

        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toContain('/api/elsa/purchases?PurchaseStatus=1&productName=Payroll');
        expect(requests[0]?.headers.get('CompanyKey')).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect(body.result.structuredContent).toEqual({
            products: [{
                purchaseId: 10,
                productId: 20,
                productKey: 'payroll',
                productName: 'Payroll',
                purchaseStatus: 1,
                startDate: '2026-01-01',
                endDate: '2026-12-31',
                productTypeName: null,
            }],
        });
        expect(body.result.content[0].text).toBe('1 activated item.');
    });

    it('passes a requested purchase status and product name to the server', async () => {
        const requests: string[] = [];
        vi.stubGlobal('fetch', async (input: any, init?: any) => {
            const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
            if (url.includes('/api/elsa/purchases')) {
                requests.push(url);
                return new Response(JSON.stringify([
                    { ID: 12, ProductName: 'Accounting', ProductKey: 'accounting', PurchaseStatus: 2 },
                    { ID: 13, ProductName: 'Payroll', ProductKey: 'payroll', PurchaseStatus: 2 },
                    { ID: 14, ProductName: 'Accounting', ProductKey: 'accounting', PurchaseStatus: 1 },
                ]), { headers: { 'content-type': 'application/json' } });
            }
            return realFetch(input, init);
        });

        const { body } = await call({
            companyKey: '123e4567-e89b-12d3-a456-426614174000',
            purchaseStatus: 2,
            productName: 'Accounting',
        });

        expect(requests[0]).toContain('/api/elsa/purchases?PurchaseStatus=2&productName=Accounting');
        expect(body.result.structuredContent.products).toEqual([{
            purchaseId: 12,
            productId: null,
            productKey: 'accounting',
            productName: 'Accounting',
            purchaseStatus: 2,
            startDate: null,
            endDate: null,
            productTypeName: null,
        }]);
    });

    it('returns an empty list when the company has no active purchases', async () => {
        stubUnimicro({ '/api/elsa/purchases': [] });

        const { body } = await call({ companyKey: '123e4567-e89b-12d3-a456-426614174000' });

        expect(body.result.structuredContent).toEqual({ products: [] });
        expect(body.result.content[0].text).toBe('0 activated items.');
    });
});

describe('check_api_access', () => {
    const call = (headers?: Record<string, string>) =>
        mcpCall(app.baseUrl, 'tools/call', { name: 'check_api_access', arguments: {} }, { name: 'check_api_access', headers });

    it('reports the API it reached and the companies it found', async () => {
        stubUnimicro({
            '/api/init/companies': [{ Key: 'c-1', Name: 'Test AS', OrganizationNumber: '123456789' }],
        });

        const { body } = await call();

        expect(body.result.structuredContent).toEqual({
            ok: true,
            apiBaseUrl: 'https://test.unimicro.no',
            companyCount: 1,
            companies: [{ companyKey: 'c-1', name: 'Test AS', organizationNumber: '123456789' }],
            defaultCompanyKey: 'c-1',
            notes: [],
        });
        expect(body.result.content[0].text).toContain('Test AS');
    });

    it('reports no default company, with a reason, when the choice is ambiguous', async () => {
        stubUnimicro({
            '/api/init/companies': [{ Key: 'c-1', Name: 'One AS' }, { Key: 'c-2', Name: 'Two AS' }],
        });

        const { body } = await call();
        const result = body.result.structuredContent;

        expect(result.companyCount).toBe(2);
        expect(result.defaultCompanyKey).toBeNull();
        expect(result.notes.join(' ')).toContain('companyKey');

        // The companies are already in `companies`; repeating them in the note
        // doubles the tokens this tool costs on every call.
        expect(result.notes.join(' ')).not.toContain('c-1');
        expect(result.notes.join(' ')).not.toContain('One AS');
    });

    it('honours a CompanyKey header from the host', async () => {
        stubUnimicro({
            '/api/init/companies': [{ Key: 'c-1', Name: 'One AS' }, { Key: 'c-2', Name: 'Two AS' }],
        });

        const { body } = await call({ CompanyKey: 'c-2' });
        const result = body.result.structuredContent;

        expect(result.defaultCompanyKey).toBe('c-2');
        expect(result.notes.join(' ')).toContain('CompanyKey header');
    });

    it('reports an empty company list rather than failing', async () => {
        stubUnimicro({ '/api/init/companies': [] });

        const { body } = await call();
        const result = body.result.structuredContent;

        expect(result.companyCount).toBe(0);
        expect(result.defaultCompanyKey).toBeNull();
        expect(result.notes.join(' ')).toContain('no companies');
    });

    it('surfaces an API failure as a tool error the model can act on', async () => {
        vi.stubGlobal('fetch', async (input: any, init?: any) => {
            const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
            if (url.includes('/api/init/companies')) return new Response('nope', { status: 403 });
            return realFetch(input, init);
        });

        const { body } = await call();

        expect(body.result.isError).toBe(true);
        expect(body.result.content[0].text).toContain('403');
    });
});
