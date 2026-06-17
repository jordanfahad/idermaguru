import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { createProductForTenant } from "@/services/catalog";
import { csvSplit, jsonError } from "../../../_shared";

const csvHeaders = [
  "sku",
  "name",
  "brand",
  "category",
  "description",
  "url",
  "imageUrl",
  "price",
  "currency",
  "inStock",
  "ingredients",
  "activeIngredients",
  "skinTypes",
  "concerns",
  "avoidIf",
  "pregnancySafety",
  "fragranceFree",
  "nonComedogenic",
  "sensitiveSkinSuitable",
  "merchantPriority",
  "sponsoredBidCpc",
];

export async function POST(request: Request) {
  const form = await request.formData();
  const tenantSlug = String(form.get("tenantSlug") ?? seedTenant.slug);
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("CSV file is required.");

  const text = await file.text();
  const rows = text.split(/\r?\n/).filter(Boolean);
  const [headerLine, ...dataLines] = rows;
  const header = headerLine.split(",").map((item) => item.trim());
  const missing = csvHeaders.filter((name) => !header.includes(name));
  if (missing.length > 0) return jsonError(`Missing columns: ${missing.join(", ")}`);

  const created = [];
  for (const line of dataLines) {
    const cells = line.split(",").map((item) => item.trim());
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    created.push(
      await createProductForTenant(tenantSlug, {
        sku: sanitize(row.sku),
        name: sanitize(row.name),
        brand: sanitize(row.brand),
        category: sanitize(row.category),
        description: sanitize(row.description),
        url: sanitize(row.url),
        imageUrl: sanitize(row.imageUrl),
        price: Number(row.price || 0),
        currency: sanitize(row.currency || "AED"),
        inStock: row.inStock !== "false",
        ingredientsJson: csvSplit(row.ingredients),
        activeIngredientsJson: csvSplit(row.activeIngredients),
        skinTypesJson: csvSplit(row.skinTypes),
        concernsJson: csvSplit(row.concerns),
        avoidIfJson: csvSplit(row.avoidIf),
        pregnancySafety: normalizePregnancySafety(row.pregnancySafety),
        fragranceFree: row.fragranceFree === "true",
        nonComedogenic: row.nonComedogenic === "true",
        sensitiveSkinSuitable: row.sensitiveSkinSuitable === "true",
        claimsJson: [],
        approvedClaimsJson: [],
        merchantPriority: Number(row.merchantPriority || 0),
        sponsoredBidCpc: Number(row.sponsoredBidCpc || 0),
      }),
    );
  }

  return NextResponse.json({ created });
}

function sanitize(value: string) {
  return value.replace(/[<>]/g, "").trim();
}

function normalizePregnancySafety(value: string) {
  if (["UNKNOWN", "AVOID", "CAUTION", "GENERALLY_ACCEPTED"].includes(value)) {
    return value as "UNKNOWN" | "AVOID" | "CAUTION" | "GENERALLY_ACCEPTED";
  }
  return "UNKNOWN";
}
