import { NextResponse, type NextRequest } from "next/server";
import { updateSession, getAccessTokenCookieName } from "@insforge/sdk/ssr/middleware";

const PROTECTED_PATHS = ["/dashboard", "/profile", "/find-jobs"];

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  await updateSession({
    requestCookies: { get: (name: string) => request.cookies.get(name) },
    responseCookies: response.cookies,
  });

  const isProtected = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (isProtected && !request.cookies.get(getAccessTokenCookieName())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/find-jobs/:path*"],
};
