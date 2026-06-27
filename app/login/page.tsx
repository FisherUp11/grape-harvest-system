import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-page"><section className="card">加载中…</section></main>}>
      <LoginClient />
    </Suspense>
  );
}
