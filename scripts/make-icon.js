const fs = require("node:fs/promises");
const path = require("node:path");
const pngToIco = require("png-to-ico").default;

async function main() {
  const root = path.resolve(__dirname, "..");
  const source = path.join(
    root,
    "Groove",
    "Assets",
    "AppList.targetsize-256_altform-lightunplated.png"
  );
  const outputDirectory = path.join(root, "build");
  const output = path.join(outputDirectory, "icon.ico");

  await fs.mkdir(outputDirectory, { recursive: true });
  const ico = await pngToIco(source);
  await fs.writeFile(output, ico);
  console.log(`Created ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
