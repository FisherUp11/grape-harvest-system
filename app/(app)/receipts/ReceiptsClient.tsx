"use client";
import LedgerClient from "@/app/components/LedgerClient";
import type { GrapeReceipt, Profile, Supporter } from "@/lib/types";
export default function ReceiptsClient({
  profile,
  profiles,
  supporters,
  receipts,
}: {
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  receipts: GrapeReceipt[];
}) {
  return (
    <LedgerClient
      kind="receipt"
      profile={profile}
      profiles={profiles}
      supporters={supporters}
      rows={receipts}
    />
  );
}
