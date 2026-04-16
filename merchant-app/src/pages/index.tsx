import { useEffect } from "react";
import { useRouter } from "next/router";

// This page is normally pre-empted by middleware which serves
// public/hashpoint-landing.html at `/`. This redirect is a fallback.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
