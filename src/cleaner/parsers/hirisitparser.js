import {
  classifySkills,
  filterValidSkills,
  findRole,
} from '../../utils/ScraperUtilityfunctions.js';
import logger from '../../logger/logger.js';

export default async function hiristParser(rawJobDoc) {
  try {
    const rawJob = rawJobDoc

    // --------------------------------------------------
    // 📍 LOCATION
    // --------------------------------------------------
    const locations = Array.isArray(rawJob.location)
      ? rawJob.location.map(l => l?.name).filter(Boolean)
      : [];

    // --------------------------------------------------
    // 🧠 SKILLS (VERY CLEAN DATA)
    // --------------------------------------------------
    const technicalSkills = Array.isArray(rawJob.tags)
      ? rawJob.tags.map(tag => tag?.name).filter(Boolean)
      : [];

    const validSkills = filterValidSkills(technicalSkills);
    const skills = classifySkills(validSkills);

    // --------------------------------------------------
    // 🎯 ROLE DETECTION
    // --------------------------------------------------
    const role_title = await findRole(
      rawJob.title || rawJob.jobdesignation,
      [...validSkills]
    );

    // --------------------------------------------------
    // 💼 EXPERIENCE (DIRECT FROM DATA ✅)
    // --------------------------------------------------
    const minExp = rawJob.min ?? undefined;
    const maxExp = rawJob.max ?? undefined;

    // --------------------------------------------------
    // 💰 SALARY
    // --------------------------------------------------
    const salaryMin = rawJob.minSal || undefined;
    const salaryMax = rawJob.maxSal || undefined;

    // --------------------------------------------------
    // 📅 DATE (VERY IMPORTANT)
    // --------------------------------------------------
    const postedAt = rawJob.createdTime
      ? new Date(rawJob.createdTime)
      : new Date(rawJobDoc.createdAt);

    const expiryAt = new Date(postedAt.getTime() + 90 * 86400000);

    // --------------------------------------------------
    // 🧾 FINAL OBJECT
    // --------------------------------------------------
    return {
      job_id: rawJob.id?.toString(),
      source: 'hirist',

      source_url: rawJob.jobDetailUrl,

      role_title: role_title.role || 'Others',
      extracted_by: role_title.extracted_by || 'unknown',

      job_title: rawJob.title,
      company_name: rawJob.companyData?.companyName,

      // 🔥 VERY STRONG SKILL DATA
      skills: skills,

      // 🔥 EXPERIENCE (HIGH QUALITY)
      min_experience: minExp,
      max_experience: maxExp,

      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: 'INR',
      salary_period: salaryMin || salaryMax ? 'yearly' : null,

      description: undefined, // ❌ not needed

      job_type: rawJob.workFromHome ? 'remote' : 'fulltime',

      location: locations.length ? locations[0] : undefined,
      location_country: 'India',

      industry: rawJob.companyData?.ambitionBoxInfo?.primaryIndustry
        ? [rawJob.companyData.ambitionBoxInfo.primaryIndustry]
        : undefined,

      posted_at: postedAt,
      expiry_at: expiryAt,
    };

  } catch (error) {
    logger.error(`❌ Hirist parser failed: ${error.message}`);
    return undefined;
  }
}