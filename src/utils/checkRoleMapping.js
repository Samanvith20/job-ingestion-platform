import { Job } from "../db/jobmodel.js";
import { connectDB } from "../db/connection.js";
import fs from "fs";

const roleMaster = JSON.parse(
  fs.readFileSync(new URL("../utils/role_master.json", import.meta.url))
);

function normalize(s) {
  return s?.toLowerCase()?.trim();
}

await connectDB();
const jobs = await Job.find(
  { role_title: { $exists: true, $ne: null } },
  { job_title: 1, role_title: 1, skills: 1, extracted_by: 1 }
)
  .sort({ createdAt: -1 })
  .limit(150);


const report = [];

for (const j of jobs) {
  const allSkills = [
    ...(j.skills?.technical || []),
    ...(j.skills?.tools || []),
    ...(j.skills?.soft || []),
  ]
    .map(normalize)
    .filter(Boolean);

  const roleSkills = new Set(
    (roleMaster[j.role_title] || []).map(normalize)
  );

  // ✅ EXACT MATCH ONLY (no includes)
  const matched = allSkills.filter(s => roleSkills.has(s));

  report.push({
    title: j.job_title,
    role: j.role_title,
    matched_count: matched.length,
    matched_skills: matched,
    all_skills: allSkills,
    extracted_by: j.extracted_by || "unknown",
    role_sample_skills: Array.from(roleSkills).slice(0, 15),
  });
}

fs.writeFileSync(
  "role_audit_report.json",
  JSON.stringify(report, null, 2)
);

console.log("✅ role_audit_report.json created");
process.exit(0);
