import { Suspense } from "react";
import AuthCompleteClient from "./AuthCompleteClient";
export const metadata = { referrer: "no-referrer" };
export default function AuthCompletePage() {
  return (
    <Suspense fallback={<p>正在验证邮件链接…</p>}>
      <AuthCompleteClient />
    </Suspense>
  );
}
