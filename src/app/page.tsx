import { LanguageHome } from "@/components/language-home";
import { ClassicLanguageHome } from "@/components/language-home-classic";
import { ConciergeHome } from "@/components/concierge-home";
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

  // Default: the voice-first concierge homepage. Roll back instantly with an env var:
  //   HOMEPAGE_VARIANT=retail   -> the previous retail homepage
  //   HOMEPAGE_VARIANT=classic  -> the classic homepage
  const variant = process.env.HOMEPAGE_VARIANT;
  if (variant === "classic") return <ClassicLanguageHome />;
  if (variant === "retail") return <LanguageHome />;
  return <ConciergeHome />;
}
