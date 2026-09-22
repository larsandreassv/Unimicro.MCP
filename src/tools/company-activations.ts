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
                'Omit companyKey unless company selection is ambiguous.',
            inputSchema: z.object({
                companyKey: z.string().uuid().optional().describe('Which company. Omit unless company selection is ambiguous.'),
            }),
            outputSchema: z.object({
                products: z.array(activeProductSchema),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async ({ companyKey }) => {
            const resolvedCompanyKey = await ctx.resolveCompanyKey(companyKey);
            const rows = await ctx.api.get<RawLicensePurchase[]>('api/elsa/purchases', {
                companyKey: resolvedCompanyKey,
                query: { PurchaseStatus: 1 },
            });

            const products = (rows ?? [])
                .filter(row => row.PurchaseStatus === 1 || row.PurchaseStatus === '1')
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
