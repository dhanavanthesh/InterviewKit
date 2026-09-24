import { NextResponse, type NextRequest } from "next/server";

// Behind a reverse proxy the server's own URL is internal, so redirects use the forwarded public origin.
export function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host.split(",")[0]!.trim()}`;
}

export function middleware(request: NextRequest) {
  if (!request.cookies.has("sid")) {
    const login = new URL("/login", publicOrigin(request));
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/kits/:path*"] };
