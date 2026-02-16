
import fs from "fs";
import { RawJob } from "../db/rawJobModel.js";
import { connectDB } from "../db/connection.js";




const skillSet = new Set();

function normalizeSkill(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+.# ]/g, "") // remove junk chars
    .trim();
}

async function run() {
await connectDB()
  const cursor = RawJob.find({
    "rawData.tagsAndSkills": { $exists: true, $ne: null }
  }).cursor();

  for await (const doc of cursor) {
    const raw = doc.rawData?.tagsAndSkills;
    if (!raw) continue;

    const parts = raw.split(",");

    parts.forEach(skill => {
      const clean = normalizeSkill(skill);
      if (clean.length > 1) {
        skillSet.add(clean);
      }
    });
  }

  const skills = [...skillSet].sort();

  fs.writeFileSync("unique_skills.txt", skills.join("\n"));

  console.log(`✅ Extracted ${skills.length} unique skills`);
  process.exit(0);
}

run();
