import {
  classifySkills,
  filterValidSkills,
  findRole,
} from '../../utils/ScraperUtilityfunctions.js';
import logger from '../../logger/logger.js';


function parseLocations(locationsRaw) {
  if (!locationsRaw || typeof locationsRaw !== "string") return [];

  return locationsRaw
    .replace(/\band\b/gi, ",")
    .replace(/[|/]/g, ",")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}


export default async function instahyreParser(rawJobDoc) {
  try {
    const rawJob = rawJobDoc

    // ---- Locations ----
    const locations = rawJob?.locations
  ? parseLocations(rawJob.locations)
  : [];

    // ---- Skills (MERGED) ----
    const baseSkills = Array.isArray(rawJob.keywords)
      ? rawJob.keywords
      : [];

  

    const allSkills = Array.from(new Set([
      ...baseSkills,
    ]));

    const validSkills = filterValidSkills(allSkills);
    const skills = classifySkills(validSkills);

    // ---- Role detection ----
    const role_title = await findRole(
      rawJob.title || rawJob.candidate_title,
      [...validSkills]
    );

    // ---- Experience (NOW AVAILABLE ✅) ----
    const minExp = rawJob.experience?.min ?? undefined;
    const maxExp = rawJob.experience?.max ?? undefined;

    // ---- Salary (NOT AVAILABLE) ----
    const salaryMin = undefined;
    const salaryMax = undefined;

    // ---- Dates (SYSTEM GENERATED) ----
    const postedAt = rawJobDoc.createdAt
      ? new Date(rawJobDoc.createdAt)
      : new Date();

    const expiryAt = new Date(postedAt.getTime() + 90 * 86400000);

    // ---- Return normalized object ----
    return {
      job_id: rawJob.id?.toString(),
      source: 'instahyre',

      source_url: rawJob.public_url,

      role_title: role_title.role || 'Others',
      extracted_by: role_title.extracted_by || 'unknown',

      job_title: rawJob.title || rawJob.candidate_title,
      company_name: rawJob.employer?.company_name,

      // 🔥 FINAL SKILLS
      skills: skills,

      // 🔥 EXPERIENCE (NOW WORKING)
      min_experience: minExp,
      max_experience: maxExp,

      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: 'INR',
      salary_period: null,

      description: undefined,

      job_type: undefined,

      location: locations.length ? locations[0] : undefined,
      location_country: 'India',

      industry: undefined,

      posted_at: postedAt,
      expiry_at: expiryAt,
    };

  } catch (error) {
    logger.error(`❌ Instahyre parser failed: ${error.message}`);
    return undefined;
  }
}