import { mkdir, writeFile } from "node:fs/promises";
import { passwordRecoveryEmail } from "../lib/server/emailTemplates";

async function main() {
  const directory = new URL("../supabase/templates/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("recovery.html", directory), passwordRecoveryEmail());
  console.log(
    "已生成 supabase/templates/recovery.html；请粘贴到 Supabase Reset password 模板。",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
