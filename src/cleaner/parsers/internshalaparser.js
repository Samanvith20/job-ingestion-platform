import {
  classifySkills,
  filterValidSkills,
  findRole,
  parsePostedDate,
} from "../../utils/ScraperUtilityfunctions.js";

export default async function internshalaParser(raw) {
  /* ---------------- SKILLS ---------------- */
   const skillsRaw = Array.isArray(raw.skills_required)
      ? raw.skills_required.map((s) => s.skill?.trim()).filter(Boolean)
      : [];

  const validSkills = filterValidSkills(skillsRaw);
  const skills = classifySkills(validSkills);

  /* ---------------- ROLE ---------------- */
  const role_title = await findRole(raw.title, validSkills);

  


  /* ---------------- LOCATION ---------------- */
  const locations = Array.isArray(raw.city) ? raw.city : [];

  /* ---------------- DESCRIPTION ---------------- */
  const description =
    raw.description?.replace(/<[^>]*>/g, " ") ||
    raw.content ||
    raw.company_description ||
    "";

    // ---- Salary parsing ----
    let salaryMin = null;
    let salaryMax = null;
    let salaryCurrency = null;
    let salaryPeriod = null;

    if (raw.salary) {
      const yearly = /year/i.test(raw.salary);
      const monthly = /month/i.test(raw.salary);

      const match = raw.salary.match(/([A-Za-z]+)?\s?([\d,]+)-([\d,]+)/);
      if (match) {
        salaryCurrency = match[1] || 'INR';
        salaryMin = parseInt(match[2].replace(/,/g, ''), 10);
        salaryMax = parseInt(match[3].replace(/,/g, ''), 10);
        salaryPeriod = yearly ? 'yearly' : monthly ? 'monthly' : null;
      }
    }
 // ---- Industry ----
    const industryList = raw.category
      ? raw.category.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  
 // ---- Job Type ----
    let jobType = null;
    const lower = raw.working_hours?.toLowerCase() || '';
    if (lower.includes('full')) jobType = 'fulltime';
    else if (lower.includes('part')) jobType = 'parttime';
    else if (lower.includes('intern')) jobType = 'internship';
    else if (lower.includes('contract')) jobType = 'contract';
    // ---- Experience ----
    const expMatch = raw.experience?.match(/(\d+)/);
    const experience = expMatch ? Number(expMatch[1]) : null;
    let difficulty = "entry";
  if (experience > 2 && experience <= 6) difficulty = "mid";
  if (experience > 6) difficulty = "senior";

  // ---- Dates ----
    const postedAt = parsePostedDate(raw.date);
    const expiryAt = postedAt ? new Date(postedAt.getTime() + 90 * 86400000) : null;
  return {
    // identity
    job_id: String(raw.id),
    source: "internshala-jobs",
    source_url: raw.url,

    // titles
    job_title: raw.title,
    role_title: role_title.role || "Others",
    extracted_by: role_title.extracted_by || "unknown",

    // company
    company_name: raw.company,

    // skills
    skills,

    // experience
    min_experience: experience,
      max_experience: experience,
    difficulty_level: difficulty,

   salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: salaryCurrency,
      salary_period: salaryPeriod,

      location: locations.length ? locations[0] : null,
      location_country: raw.country || 'India',
      industry: industryList.length ? industryList : null,
      posted_at: postedAt,
      expiry_at: expiryAt,

    

    // job type
    job_type: jobType || "fulltime",
    work_mode: "onsite", // Internshala jobs are mostly onsite unless specified

    

    // description
    description,
  };
}
