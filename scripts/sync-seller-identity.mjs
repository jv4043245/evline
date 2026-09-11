import { fileURLToPath } from "node:url";
import { syncSellerIdentity } from "./lib/seller-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const changed = await syncSellerIdentity(root, { check });
console.log(JSON.stringify({ check, changedCount: changed.length, files: changed }, null, 2));
if (check && changed.length) process.exitCode = 1;
