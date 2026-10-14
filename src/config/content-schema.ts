import { z } from "zod";
import { looksSecret } from "./site-schema";

/**
 * Editable public content of ONE installation: `site/content.json`.
 *
 * Hero slides, trust cards, social links and footer help links. Public by construction (rendered to
 * customers); the schema refuses secrets, non-https links and unknown keys. Text is bilingual; a
 * missing Bangla string falls back to English. Nothing here may override ERP facts (prices, stock,
 * COD eligibility) — the trust cards are claims the business itself confirms.
 */
export const CONTENT_SCHEMA_VERSION = 1;

const text = z.object({ en: z.string().trim().min(1).max(160), bn: z.string().trim().max(160).optional() }).strict();
const longText = z.object({ en: z.string().trim().min(1).max(400), bn: z.string().trim().max(400).optional() }).strict();
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "links must be https");
/** An internal path inside the storefront ("/products", "/categories/grocery"), locale added at render. */
const internalPath = z.string().regex(/^\/(?!\/)[A-Za-z0-9\-._~/?=&%]{0,200}$/, "must be an internal path like /products");

export const contentSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    hero: z
      .object({
        slides: z
          .array(
            z
              .object({
                /** https URL, or a file in the installation's own public/ folder ("/hero/eid.webp"). */
                image: z.union([httpsUrl, z.string().regex(/^\/[A-Za-z0-9\-._/]{1,200}$/)]),
                alt: text,
                headline: text.optional(),
                subline: longText.optional(),
                cta: z.object({ label: text, href: internalPath }).strict().optional(),
              })
              .strict(),
          )
          .max(6)
          .default([]),
      })
      .strict()
      .default({ slides: [] }),
    trust: z
      .array(
        z
          .object({
            icon: z.enum(["cash", "truck", "return", "shield", "phone", "clock"]),
            title: text,
            text: text.optional(),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    social: z
      .array(
        z
          .object({
            network: z.enum(["facebook", "instagram", "youtube", "tiktok", "whatsapp", "linkedin", "x"]),
            url: httpsUrl,
          })
          .strict(),
      )
      .max(8)
      .default([]),
    helpLinks: z
      .array(z.object({ label: text, href: z.union([internalPath, httpsUrl]) }).strict())
      .max(8)
      .default([]),
  })
  .strict()
  .superRefine((content, context) => {
    if (looksSecret(JSON.stringify(content))) {
      context.addIssue({ code: "custom", path: [], message: "site content must not contain secret values" });
    }
  });

export type SiteContent = z.infer<typeof contentSchema>;
export type LocalizedText = z.infer<typeof text>;

export function parseSiteContent(input: unknown): SiteContent {
  return contentSchema.parse(input);
}

/** The text in the requested language, falling back to English. */
export function localized(value: { en: string; bn?: string } | undefined, lang: string): string {
  if (!value) {
    return "";
  }
  return lang === "bn" && value.bn ? value.bn : value.en;
}
