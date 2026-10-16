#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Auto-load .env if available
try {
  if (process.loadEnvFile) process.loadEnvFile(path.join(rootDir, ".env"));
} catch {
  // ignore
}

const accountId =
  process.env.R2_ACCOUNT_ID || "09e44e6a7eadceba9da84d9a5efb7681";
const accessKeyId =
  process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const bucketName =
  process.env.R2_BUCKET_NAME || "nimbus-releases";
const publicUrl = (
  process.env.R2_PUBLIC_URL ||
  process.env.VITE_RELEASES_URL ||
  "https://pub-ce50cd78e02245c4afb325681955755a.r2.dev"
).replace(/\/$/, "");

const endpoint =
  process.env.R2_ENDPOINT ||
  `https://${accountId}.r2.cloudflarestorage.com`;

const releaseDir = path.resolve(
  rootDir,
  process.env.RELEASE_DIR || "apps/desktop/release"
);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".dmg":
      return "application/x-apple-diskimage";
    case ".exe":
      return "application/vnd.microsoft.portable-executable";
    case ".zip":
      return "application/zip";
    case ".yml":
    case ".yaml":
      return "text/yaml";
    case ".blockmap":
      return "application/octet-stream";
    case ".apk":
      return "application/vnd.android.package-archive";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

async function main() {
  console.log("☁️  Nimbus Release Uploader → Cloudflare R2");
  console.log(`• Bucket:     ${bucketName}`);
  console.log(`• Endpoint:   ${endpoint}`);
  console.log(`• Public URL: ${publicUrl}`);
  console.log(`• Local Dir:  ${releaseDir}\n`);

  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "❌ Error: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required.\n" +
        "   Set them in your .env or environment:\n" +
        "     R2_ACCESS_KEY_ID=...\n" +
        "     R2_SECRET_ACCESS_KEY=...\n"
    );
    process.exit(1);
  }

  if (!existsSync(releaseDir)) {
    console.error(`❌ Error: Release directory does not exist: ${releaseDir}`);
    console.error("   Run `pnpm desktop:dist` or `pnpm desktop:dist:win` first.");
    process.exit(1);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const allowedExtensions = new Set([
    ".dmg",
    ".exe",
    ".zip",
    ".yml",
    ".yaml",
    ".blockmap",
    ".apk",
  ]);

  const pattern = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
  const allEntries = readdirSync(releaseDir);
  const filesToUpload = allEntries.filter((file) => {
    if (file.startsWith("builder-") || file.startsWith(".")) return false;
    if (pattern && !pattern.test(file)) return false;
    const fullPath = path.join(releaseDir, file);
    if (!statSync(fullPath).isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    return allowedExtensions.has(ext);
  });

  if (filesToUpload.length === 0) {
    console.warn("⚠️  No installer artifacts found in release directory.");
    return;
  }

  // Upload small files (yml, blockmap) first, then installers
  filesToUpload.sort(
    (a, b) =>
      statSync(path.join(releaseDir, a)).size -
      statSync(path.join(releaseDir, b)).size
  );

  console.log(`Found ${filesToUpload.length} artifacts to upload:\n`);

  const uploadedUrls = [];

  for (const fileName of filesToUpload) {
    const filePath = path.join(releaseDir, fileName);
    const stats = statSync(filePath);
    const contentType = getContentType(fileName);
    const fileBuffer = readFileSync(filePath);

    process.stdout.write(`• Uploading ${fileName} (${formatSize(stats.size)})... `);

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: fileName,
          Body: fileBuffer,
          ContentType: contentType,
        })
      );
      console.log("DONE ✅");
      uploadedUrls.push({ name: fileName, url: `${publicUrl}/${fileName}` });
    } catch (err) {
      console.log("FAILED ❌");
      console.error(`  ${err.message}`);
      process.exit(1);
    }

    // Server-side alias copy for permanent latest links
    const aliases = [];
    if (fileName.endsWith(".dmg") && !fileName.endsWith("Nimbus-universal.dmg")) {
      aliases.push("Nimbus-universal.dmg");
    } else if (
      fileName.endsWith(".exe") &&
      (fileName.includes("Setup") || fileName.includes("setup"))
    ) {
      if (!fileName.endsWith("Nimbus-Setup.exe")) {
        aliases.push("Nimbus-Setup.exe");
      }
      if (!fileName.endsWith("Nimbus.Setup.0.1.1.exe")) {
        aliases.push("Nimbus.Setup.0.1.1.exe");
      }
    }

    for (const aliasName of aliases) {
      process.stdout.write(`  ↳ Alias ${aliasName} (copy)... `);
      try {
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: encodeURI(`${bucketName}/${fileName}`),
            Key: aliasName,
            ContentType: contentType,
          })
        );
        console.log("DONE ✅");
        uploadedUrls.push({ name: aliasName, url: `${publicUrl}/${aliasName}` });
      } catch (err) {
        // Fallback to upload directly if CopyObject is restricted
        try {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: aliasName,
              Body: fileBuffer,
              ContentType: contentType,
            })
          );
          console.log("DONE (direct) ✅");
          uploadedUrls.push({ name: aliasName, url: `${publicUrl}/${aliasName}` });
        } catch (copyErr) {
          console.log(`(alias notice: ${copyErr.message})`);
        }
      }
    }
  }

  console.log("\n🎉 All release assets successfully uploaded to Cloudflare R2!");
  console.log("==================================================================");
  for (const item of uploadedUrls) {
    console.log(`${item.name.padEnd(32)} → ${item.url}`);
  }
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Fatal error during upload:", err);
  process.exit(1);
});
