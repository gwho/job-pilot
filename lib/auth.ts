import { createInsforgeServer } from "@/lib/insforge-server";

export async function getCtaHref() {
  const insforge = await createInsforgeServer();
  const { data } = await insforge.auth.getCurrentUser();
  return data.user ? "/dashboard" : "/login";
}
