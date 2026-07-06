import type { Metadata } from "next";
import { QuietLuxeLogin } from "@/components/quiet-luxe-login";

export const metadata: Metadata = {
  title: "Sign in — AI Derma Guru",
  description: "Sign in to your AI Derma Guru store advisor with a secure magic link.",
};

export default function LoginPage() {
  return <QuietLuxeLogin />;
}
