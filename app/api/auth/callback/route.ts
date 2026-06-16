import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("insforge_code");
  const verifier = (await cookies()).get(CODE_VERIFIER_COOKIE)?.value;

  if (!code || !verifier) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { error } = await auth.exchangeOAuthCode(code, verifier);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  response.cookies.delete(CODE_VERIFIER_COOKIE);
  return response;
}
