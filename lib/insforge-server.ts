import { cookies } from "next/headers";
import { createServerClient, updateSession } from "@insforge/sdk/ssr";

type CreateInsforgeServerOptions = {
  refreshSession?: boolean;
  refreshLeewaySeconds?: number;
};

export class InsforgeSessionRefreshError extends Error {
  constructor(message = "InsForge session refresh failed") {
    super(message);
    this.name = "InsforgeSessionRefreshError";
  }
}

export async function createInsforgeServer(
  options: CreateInsforgeServerOptions = {},
) {
  const cookieStore = await cookies();

  if (options.refreshSession) {
    const session = await updateSession({
      requestCookies: cookieStore,
      responseCookies: cookieStore,
      refreshLeewaySeconds: options.refreshLeewaySeconds,
    });

    if (session.error || !session.accessToken) {
      throw new InsforgeSessionRefreshError(session.error?.message);
    }
  }

  return createServerClient({ cookies: cookieStore });
}
