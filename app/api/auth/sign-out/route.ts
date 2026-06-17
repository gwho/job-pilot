import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions, createServerClient } from "@insforge/sdk/ssr";
import { captureServerEvent } from "@/lib/posthog-server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let userId: string | undefined;
    try {
      const serverClient = createServerClient({ cookies: request.cookies });
      const { data } = await serverClient.auth.getCurrentUser();
      userId = data.user?.id ?? undefined;
    } catch {
      // Best effort — don't block sign-out
    }

    const response = NextResponse.json({ success: true });
    const auth = createAuthActions({
      requestCookies: request.cookies,
      responseCookies: response.cookies,
    });

    const { error } = await auth.signOut();
    if (error) {
      console.error("[api/auth/sign-out]", error);
      const errorResponse = NextResponse.json(
        { success: false, error: "Failed to sign out" },
        { status: error.statusCode },
      );
      response.cookies.getAll().forEach((cookie) => {
        errorResponse.cookies.set(cookie);
      });
      return errorResponse;
    }

    if (userId) {
      try {
        await captureServerEvent({
          distinctId: userId,
          event: "user_signed_out",
          properties: { userId },
        });
      } catch {
        // Best effort
      }
    }

    return response;
  } catch (error) {
    console.error("[api/auth/sign-out]", error);
    return NextResponse.json(
      { success: false, error: "Failed to sign out" },
      { status: 500 },
    );
  }
}
