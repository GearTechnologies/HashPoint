import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Serve the static landing page at `/` by rewriting to the public HTML file.
 * This bypasses React/Next.js rendering entirely, avoiding hydration mismatches
 * caused by the landing page's inline JavaScript (IntersectionObserver animations).
 */
export function middleware(request: NextRequest) {
  return NextResponse.rewrite(new URL("/hashpoint-landing.html", request.url));
}

export const config = {
  matcher: ["/"],
};
