import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";
import { captureServerEvent, identifyServerUser } from "@/lib/posthog-server";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
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

    const { data, error } = await auth.exchangeOAuthCode(code, verifier);
    if (error) {
      console.error("[api/auth/callback]", error);
      return NextResponse.redirect(new URL("/login?error=oauth", request.url));
    }

    if (data?.user) {
      await identifyServerUser({
        distinctId: data.user.id,
        properties: { email: data.user.email },
      });
      await captureServerEvent({
        distinctId: data.user.id,
        event: "user_signed_in",
        properties: { userId: data.user.id, email: data.user.email },
      });
    }

    response.cookies.delete(CODE_VERIFIER_COOKIE);
    return response;
  } catch (error) {
    console.error("[api/auth/callback]", error);
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
