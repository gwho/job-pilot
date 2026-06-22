import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { error } = await auth.signOut();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
  }

  return response;
}
