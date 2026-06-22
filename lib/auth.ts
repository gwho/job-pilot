import { cache } from "react";
import { createInsforgeServer } from "@/lib/insforge-server";

const getCachedCtaHref = cache(async (): Promise<string> => {
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();
    return data.user ? "/dashboard" : "/login";
  } catch {
    return "/login";
  }
});

export async function getCtaHref(): Promise<string> {
  return getCachedCtaHref();
}
