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

  return process.env.HOMEPAGE_VARIANT === "classic" ? <ClassicLanguageHome /> : <LanguageHome />;
}
