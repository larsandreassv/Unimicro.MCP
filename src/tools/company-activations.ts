import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from './context.js';

const activeProductSchema = z.object({
    purchaseId: z.union([z.number(), z.string()]).nullable().describe('The purchase record ID, when provided.'),
    productId: z.union([z.number(), z.string()]).nullable().describe('The product ID, when provided.'),
    productKey: z.string().nullable().describe('The stable product key, when provided.'),
    productName: z.string().nullable().describe('The product name, when provided.'),
    purchaseStatus: z.union([z.number(), z.string()]).nullable().describe('The purchase status returned by Unimicro.'),
    startDate: z.string().nullable().describe('The activation start date, when provided.'),
    endDate: z.string().nullable().describe('The activation end date, when provided.'),
    productTypeName: z.string().nullable().describe('The product type name, when provided.'),
});

interface RawLicensePurchase {
    ID?: number | string;
    ProductID?: number | string;
    ProductName?: string;
    ProductKey?: string;
    PurchaseStatus?: number | string;
    StartDate?: string;
    EndDate?: string;
    ProductTypeName?: string;
}

export function registerCompanyActivationsTool(server: McpServer, ctx: ToolContext): void {
    server.registerTool(
        'get_company_activations',
        {
            title: 'Get company activations',
            description:
                'List the modules, integrations, and products activated for a Unimicro company. ' +
                'Pass the companyKey for the company to inspect. Defaults to accepted/active purchases; ' +
                'use purchaseStatus to inspect another purchase status and search to match product name or key.',
            inputSchema: z.object({
                companyKey: z.string().uuid().describe('The company to inspect.'),
                purchaseStatus: z.number().int().min(0).default(1).describe('Purchase status to request. Defaults to 1 (accepted/active).'),
                search: z.string().trim().min(1).optional().describe('Case-insensitive text to match against product name or key.'),
            }),
            outputSchema: z.object({
                products: z.array(activeProductSchema),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async ({ companyKey, purchaseStatus, search }) => {
            const resolvedCompanyKey = await ctx.resolveCompanyKey(companyKey);
            const rows = await ctx.api.get<RawLicensePurchase[]>('api/elsa/purchases', {
                companyKey: resolvedCompanyKey,
                query: { PurchaseStatus: purchaseStatus },
            });

            const searchTerm = search?.toLocaleLowerCase();
            const products = (rows ?? [])
                .filter(row => row.PurchaseStatus === purchaseStatus || row.PurchaseStatus === String(purchaseStatus))
                .filter(row => {
                    if (!searchTerm) return true;
                    return [row.ProductName, row.ProductKey]
                        .some(value => value?.toLocaleLowerCase().includes(searchTerm));
                })
                .map(row => ({
                    purchaseId: row.ID ?? null,
                    productId: row.ProductID ?? null,
                    productKey: row.ProductKey ?? null,
                    productName: row.ProductName ?? null,
                    purchaseStatus: row.PurchaseStatus ?? null,
                    startDate: row.StartDate ?? null,
                    endDate: row.EndDate ?? null,
                    productTypeName: row.ProductTypeName ?? null,
                }));

            return {
                content: [{ type: 'text', text: `${products.length} activated ${products.length === 1 ? 'item' : 'items'}.` }],
                structuredContent: { products },
            };
        },
    );
}
