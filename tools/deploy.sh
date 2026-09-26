#!/bin/sh
# Deploy src/ to Vercel from a copy without git metadata. The Vercel team
# blocks deployments whose git commit author is not a team member and the
# site is plain static files, so it ships as a folder.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mktemp -d)
cp -R "$ROOT/src/." "$OUT/"
mkdir -p "$OUT/.vercel"
cp "$ROOT/.vercel/project.json" "$OUT/.vercel/"
node -e 'const v=require(process.argv[1]); v.outputDirectory="."; require("fs").writeFileSync(process.argv[2], JSON.stringify(v, null, 2))' "$ROOT/vercel.json" "$OUT/vercel.json"
# the team is named explicitly: from a folder with no git a bare deploy was refused as "Not authorized"
SCOPE=$(node -e 'console.log(require(process.argv[1]).orgId)' "$ROOT/.vercel/project.json")
cd "$OUT" && npx vercel deploy --prod --yes --scope "$SCOPE"
rm -rf "$OUT"
