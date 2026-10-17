export function sessionFor(role = "user") {
  const user = {
    id:
      role === "super_admin"
        ? "10000000-0000-0000-0000-000000000004"
        : role === "grape_keeper"
          ? "10000000-0000-0000-0000-000000000003"
          : "10000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email:
      role === "super_admin"
        ? "owner@example.invalid"
        : role === "grape_keeper"
          ? "keeper@example.invalid"
          : "lin@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        exp,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
  return {
    access_token: token,
    refresh_token: "test-refresh-token",
    expires_at: exp,
    expires_in: 86400,
    token_type: "bearer",
    user,
  };
}
