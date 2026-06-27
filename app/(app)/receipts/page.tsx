import ReceiptsClient from "./ReceiptsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchProfiles, fetchReceipts, fetchSupporters } from "@/lib/data";

export default async function ReceiptsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, supporters, receipts] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchSupporters(supabase, profile),
    fetchReceipts(supabase, profile),
  ]);
  return <ReceiptsClient profile={profile} profiles={profiles} supporters={supporters} receipts={receipts} />;
}
