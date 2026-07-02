import { Hyperbrowser, type HyperbrowserClient } from "@hyperbrowser/sdk";
import type { SessionDetail } from "@hyperbrowser/sdk/types";

export type HyperbrowserSession = SessionDetail;

export async function createHyperbrowserSession(): Promise<{
  client: HyperbrowserClient;
  session: HyperbrowserSession;
}> {
  const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! });
  const session = await client.sessions.create({
    useStealth: true,
    adblock: true,
    acceptCookies: true,
    timeoutMinutes: 2,
  });
  return { client, session };
}
