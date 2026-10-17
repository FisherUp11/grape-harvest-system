import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Profile } from "@/lib/types";

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Components cannot always set cookies; middleware refreshes them.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options, maxAge: 0 });
          } catch {
            // Server Components cannot always set cookies; middleware refreshes them.
          }
        },
      },
    },
  );
}

export const getSessionContext = cache(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*, organizations(name,fixed_requires_approval)")
    .eq("id", user.id)
    .single<Profile>();

  if (error && error.code !== "PGRST116")
    throw new Error(`账号资料读取失败：${error.message}`);

  return {
    supabase,
    user,
    profile: profile ?? null,
    isKeeper: profile?.role === "grape_keeper",
    isSuperAdmin: profile?.role === "super_admin",
  };
});

export const getAppContext = cache(async () => {
  const context = await getSessionContext();
  if (context.profile?.must_change_password)
    redirect("/reset-password?required=1");
  return context;
});
