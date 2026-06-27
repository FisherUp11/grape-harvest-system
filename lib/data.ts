import type { SupabaseClient } from "@supabase/supabase-js";
import type { Commitment, CommitmentPeriod, GrapeConsumption, GrapeReceipt, Profile, Supporter } from "./types";

export async function fetchProfiles(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("profiles")
    .select("id, org_id, role, display_name, email, monthly_fixed_consumption, grape_alert_threshold, created_at")
    .eq("org_id", profile.org_id)
    .order("display_name", { ascending: true });

  if (profile.role !== "grape_keeper") query.eq("id", profile.id);
  const { data } = await query;
  return (data ?? []) as Profile[];
}

export async function fetchSupporters(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("supporters")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("updated_at", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as Supporter[];
}

export async function fetchCommitments(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("commitments")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as Commitment[];
}

export async function fetchCommitmentPeriods(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("commitment_periods")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("expected_date", { ascending: true });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as CommitmentPeriod[];
}

export async function fetchReceipts(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("grape_receipts")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("received_date", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as GrapeReceipt[];
}

export async function fetchConsumptions(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("grape_consumptions")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("consumption_date", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as GrapeConsumption[];
}
