import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAdminSessionCookieName, verifyAdminSession } from "@/lib/admin-auth";
import { getLiveConsultationConfig, saveLiveConsultationConfig } from "@/services/live-consultations";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

const VendorSchema = z.object({
  name: z.string(),
  domain: z.string(),
  share: z.number().min(0).max(100),
  accent: z.string(),
});

const ProductSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  name: z.string(),
  category: z.string(),
  imageUrl: z.string(),
  price: z.string(),
  url: z.string(),
  routineSlot: z.string(),
  why: z.string(),
  safety: z.string(),
  trust: z.string(),
  bundleTag: z.string().optional(),
  priority: z.number().optional(),
  keywords: z.array(z.string()).optional(),
  beforePrice: z.string().optional(),
  afterPrice: z.string().optional(),
  variantId: z.string().optional(),
  inventorySize: z.number().optional(),
  discoveryOnly: z.boolean().optional(),
});

const ConfigSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  subtitle: z.string(),
  primaryVendor: z.string(),
  vendors: z.array(VendorSchema),
  products: z.array(ProductSchema),
});

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const config = await getLiveConsultationConfig(slug);
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  if (session?.role === "super_admin") return NextResponse.json({ config });

  return NextResponse.json({
    config: {
      ...config,
      vendors: config.vendors.map((vendor) => ({
        name: vendor.name,
        domain: vendor.domain,
        accent: vendor.accent,
        share: 0,
      })),
    },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }) {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(cookieStore.get(getAdminSessionCookieName())?.value);
  if (!session || session.role !== "super_admin") return jsonError("Super-admin login required.", 401);

  try {
    const { slug } = await context.params;
    const config = await parseJson(request, ConfigSchema);
    if (config.slug !== slug) return jsonError("Config slug does not match route.", 400);
    return NextResponse.json({ config: await saveLiveConsultationConfig(config) });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}
