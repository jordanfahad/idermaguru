import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";
import { publicSnapshotsEnabled } from "@/lib/flags";

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  imageUrl: z.string().optional(),
  url: z.string(),
  routineSlot: z.string(),
  why: z.string(),
  safety: z.string().optional(),
  beforePrice: z.string().optional(),
  afterPrice: z.string().optional(),
  price: z.string().optional(),
  variantId: z.string().optional(),
  inventorySize: z.number().optional(),
  discoveryOnly: z.boolean().optional(),
});

const RecentSchema = z.object({
  concern: z.string().min(2),
  skinType: z.string().optional().default("combination"),
  summary: z.string().min(2),
  products: z.array(ProductSchema).min(1).max(10),
});

export async function GET(request: Request) {
  if (!publicSnapshotsEnabled()) {
    return NextResponse.json({ consultations: [], page: 1, limit: 10, hasMore: false, total: 0 });
  }
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = 10;
  const from = (page - 1) * limit;
  if (from >= 100) {
    return NextResponse.json({ consultations: [], page, limit, hasMore: false, total: 100 });
  }
  const to = from + limit - 1;
  const cappedTo = Math.min(to, 99);
  const supabase = getSupabaseAdmin();

  if (!supabase) return NextResponse.json({ consultations: [], page, limit, hasMore: false });

  const { data, count, error } = await supabase
    .from("recommendations")
    .select("slug,title,concern,skin_type,summary,created_at", { count: "exact" })
    .like("slug", "live-consultation-result-%")
    .order("created_at", { ascending: false })
    .range(from, cappedTo);

  if (error) return jsonError(error.message, 500);
  const cappedTotal = Math.min(count ?? 0, 100);

  return NextResponse.json({
    consultations: data ?? [],
    page,
    limit,
    hasMore: cappedTo + 1 < cappedTotal,
    total: cappedTotal,
  });
}

export async function POST(request: Request) {
  if (!publicSnapshotsEnabled()) {
    return jsonError("Public consultation snapshots are disabled.", 404);
  }
  try {
    const input = await parseJson(request, RecentSchema);
    const supabase = getSupabaseAdmin();
    if (!supabase) return jsonError("Recent consultation storage is not configured.", 503);

    const now = new Date().toISOString();
    const slug = `live-consultation-result-${slugify(input.concern)}-${Date.now().toString(36)}`;
    const title = `Routine for ${input.concern.slice(0, 84)}`;
    const routine = input.products.map((product, index) => ({
      step: product.routineSlot || `${index + 1}. Recommended product`,
      timing: timingFor(product.category),
      productId: product.id,
      note: product.why,
      product,
    }));

    const { error } = await supabase.from("recommendations").insert({
      slug,
      title,
      concern: input.concern,
      skin_type: input.skinType,
      summary: input.summary,
      routine: routine as never,
      avoid: [
        "Patch test new products.",
        "Use sunscreen every morning.",
        "Seek clinician care for severe, painful, infected, rapidly worsening, bleeding, or eye-involving symptoms.",
      ],
      seo_title: `${title} | AI Derma Guru live consultation`,
      seo_description: `Public AI Derma Guru OTC skincare routine snapshot for ${input.concern}.`,
      created_at: now,
    });

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ slug, url: `/recommendations/${slug}` });
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58) || "skin-routine";
}

function timingFor(category: string) {
  if (/sunscreen|spf/i.test(category)) return "Every morning";
  if (/cleanser/i.test(category)) return "AM and PM";
  if (/exfoliant|bha|acid/i.test(category)) return "Evening, slowly";
  if (/moistur/i.test(category)) return "AM and PM";
  return "Use as directed";
}
