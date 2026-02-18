import { classifySkills, filterValidSkills, findRole, parsePostedDate } from "../../utils/ScraperUtilityfunctions.js";

export default async function naukriParser(raw) {
  const skillsRaw = raw.tagsAndSkills
    ? raw.tagsAndSkills.split(",").map(s => s.trim())
    : [];
const validSkills = filterValidSkills(skillsRaw);

  const skills = classifySkills(validSkills);

  // 🔴 IMPORTANT — pass ALL skills as flat array
  const role_title = await findRole(raw.title, [
    ...validSkills,
  ]);

  const minExp = Number(raw?.minimumExperience) || null;

  let difficulty = "entry";
  if (minExp > 2 && minExp <= 6) difficulty = "mid";
  if (minExp > 6) difficulty = "senior";

  // ✅ SALARY MAPPING
  const salary = raw.salaryDetail || {};
   const postedAt = parsePostedDate(raw.createdDate);
    const expiryAt = new Date(postedAt.getTime() + 90 * 86400000)

  return {
    job_id: raw.jobId,
    source: "naukri",
    source_url: `https://www.naukri.com${raw.jdURL}`,

    job_title: raw.title,
    role_title: role_title.role || "Others",
    extracted_by: role_title.extracted_by || "unknown",

    company_name: raw.companyName,

    skills,

    min_experience: Number(raw?.minimumExperience) || null,
    max_experience: Number(raw?.maximumExperience) || null,
    difficulty_level: difficulty,

    // ✅ salary
    salary_min: salary.minimumSalary || null,
    salary_max: salary.maximumSalary || null,
    salary_currency: salary.currency || "INR",
    salary_period: "year", // naukri salaries are yearly

    location: raw.placeholders?.find(p => p.type === "location")?.label,

    description: raw.jobDescription?.replace(/<[^>]*>/g, " "),
     posted_at: postedAt,
      expiry_at: expiryAt,
  };
}
