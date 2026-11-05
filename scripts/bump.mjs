// npm run bump -- 0.13.3
// Sets the version in package.json, package-lock.json and server.json, the
// three places release.yml checks agree before it publishes.
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("usage: npm run bump -- X.Y.Z");
  process.exit(1);
}
const edit = (file, fn) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  fn(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};
edit("package.json", (d) => { d.version = v; });
edit("package-lock.json", (d) => {
  d.version = v;
  if (d.packages?.[""]) d.packages[""].version = v;
});
edit("server.json", (d) => {
  d.version = v;
  for (const p of d.packages ?? []) p.version = v;
});
console.log(`version ${v} in package.json, package-lock.json and server.json`);
