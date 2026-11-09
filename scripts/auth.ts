/**
 * Helpers for the login env vars.
 *
 *   npm run auth -- secret        # print a new AUTH_SECRET
 *   npm run auth -- user anna     # prompt for a password, print an AUTH_USERS entry
 *
 * Paste the output into Vercel → Project → Settings → Environment Variables,
 * then redeploy (env changes only apply to new deployments).
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/auth/password";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let asked = false;
    out._writeToOutput = (s: string) => {
      if (!asked) {
        out.output.write(s);
        asked = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const [cmd, name] = process.argv.slice(2);
  if (cmd === "secret") {
    console.log(`AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
    return;
  }
  if (cmd === "user" && name && /^[a-z0-9._-]{2,32}$/i.test(name)) {
    const pw = await askHidden(`Password for ${name}: `);
    if (pw.length < 10) throw new Error("Use at least 10 characters.");
    const again = await askHidden("Repeat: ");
    if (pw !== again) throw new Error("Passwords don't match.");
    console.log(`\nAdd to AUTH_USERS (comma-separate multiple users):\n${name.toLowerCase()}:${await hashPassword(pw)}`);
    return;
  }
  console.log("Usage:\n  npm run auth -- secret\n  npm run auth -- user <name>");
  process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
