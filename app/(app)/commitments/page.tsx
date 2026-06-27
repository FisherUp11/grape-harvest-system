import CommitmentsClient from "./CommitmentsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchCommitmentPeriods, fetchCommitments, fetchProfiles, fetchSupporters } from "@/lib/data";

export default async function CommitmentsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, supporters, commitments, periods] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchSupporters(supabase, profile),
    fetchCommitments(supabase, profile),
    fetchCommitmentPeriods(supabase, profile),
  ]);
  return <CommitmentsClient profile={profile} profiles={profiles} supporters={supporters} commitments={commitments} periods={periods} />;
}
