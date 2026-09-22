import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from './context.js';

enum PurchaseStatus {
    Unknown = 0,
    Accepted = 1,
    Rejected = 5,
    Pending = 10,
    RequestSent = 20,
    RequestApproved = 25,
    RequestRejected = 30,
    ConsentRequired = 35,
}

const purchaseStatusDescription =
    'Purchase status: 0 Unknown, 1 Accepted, 5 Rejected, 10 Pending, 20 RequestSent, ' +
    '25 RequestApproved, 30 RequestRejected, 35 ConsentRequired.';

const activeProductSchema = z.object({
    purchaseId: z.union([z.number(), z.string()]).nullable().describe('The purchase record ID, when provided.'),
    productId: z.union([z.number(), z.string()]).nullable().describe('The product ID, when provided.'),
    productKey: z.string().nullable().describe('The stable product key, when provided.'),
    productName: z.string().nullable().describe('The product name, when provided.'),
    purchaseStatus: z.union([z.number(), z.string()]).nullable().describe(purchaseStatusDescription),
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
                'use purchaseStatus to inspect another purchase status or productName to find one product.',
            inputSchema: z.object({
                companyKey: z.string().uuid().describe('The company to inspect.'),
                purchaseStatus: z.nativeEnum(PurchaseStatus).default(PurchaseStatus.Accepted).describe(purchaseStatusDescription),
                productName: z.string().trim().min(1).optional().describe('Exact product name to filter on server side.'),
            }),
            outputSchema: z.object({
                products: z.array(activeProductSchema),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        },
        async ({ companyKey, purchaseStatus, productName }) => {
            const resolvedCompanyKey = await ctx.resolveCompanyKey(companyKey);
            const rows = await ctx.api.get<RawLicensePurchase[]>('api/elsa/purchases', {
                companyKey: resolvedCompanyKey,
                query: { PurchaseStatus: purchaseStatus, productName },
            });

            const products = (rows ?? [])
                .filter(row => row.PurchaseStatus === purchaseStatus || row.PurchaseStatus === String(purchaseStatus))
                .filter(row => !productName || row.ProductName?.toLocaleLowerCase() === productName.toLocaleLowerCase())
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
