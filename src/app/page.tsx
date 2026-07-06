import { QuietLuxeHome } from "@/components/quiet-luxe-home";
import { LanguageHome } from "@/components/language-home";
import { ClassicLanguageHome } from "@/components/language-home-classic";
import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{
    code?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  if (params.code) {
    redirect(`/auth/callback?code=${encodeURIComponent(params.code)}&next=/dashboard`);
  }

  // Quiet-luxe editorial homepage is the default. Prior designs remain available
  // as an instant, code-free rollback via HOMEPAGE_VARIANT (commerce | classic).
  const variant = process.env.HOMEPAGE_VARIANT;
  if (variant === "classic") return <ClassicLanguageHome />;
  if (variant === "commerce") return <LanguageHome />;
  return <QuietLuxeHome />;
}
