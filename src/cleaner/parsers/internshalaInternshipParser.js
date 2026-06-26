
import {  parsePostedDate } from '../../utils/ScraperUtilitiyfuctions.js';
import logger from '../../logger/logger.js';

export default function internshalaInternshipParser(rawJob) {
  try {
    // ---- Salary ----
    let salaryMin = null;
    let salaryMax = null;
    let salaryCurrency = null;
    let salaryPeriod = null;

    if (rawJob.stipend) {
      const yearly = /year/i.test(rawJob.stipend);
      const monthly = /month/i.test(rawJob.stipend);

      const match = rawJob.stipend.match(/([A-Za-z]+)?\s?([\d,]+)\s*-\s*([\d,]+)/);

      if (match) {
        salaryCurrency = match[1] || 'INR';
        salaryMin = parseInt(match[2].replace(/,/g, ''), 10);
        salaryMax = parseInt(match[3].replace(/,/g, ''), 10);
        salaryPeriod = yearly ? 'yearly' : monthly ? 'monthly' : null;
      }
    }

    // ---- Experience ----
    const rawExp = rawJob.experience || '';
    const expMatch = rawExp.match(/(\d+)/);
    const experience = expMatch ? Number(expMatch[1]) : null;

    // ---- Dates ----
    const postedAt = parsePostedDate(rawJob.date);
    const expiryAt = postedAt ? new Date(postedAt.getTime() + 30 * 86400000) : null;

 

    // ---- Location ----
    let location = null;
    if (Array.isArray(rawJob.locations) && rawJob.locations.length > 0) {
      location = rawJob.locations[0];
    }

    // ---- Skills RAW ----
    // Internshala internships usually hide skills; AI will infer from desc
    const skillsRaw = [];

    // ---- Industries ----
    const industryList = rawJob.category
      ? rawJob.category.split(',').map((c) => c.trim()).filter(Boolean)
      : [];

    // ---- Job Type ----
    let jobType = null;
    const type = rawJob.working_hours?.toLowerCase() || '';
    if (type.includes('full')) jobType = 'fulltime';
    else if (type.includes('intern')) jobType = 'internship';
    else if (type.includes('part')) jobType = 'parttime';
    else if (rawJob.contract?.toLowerCase().includes('intern')) jobType = 'internship';

    // ---- Work Mode ----
    let workMode = null;
    if (rawJob.work_from_home === 1) workMode = 'remote';

    return {
      job_id: rawJob.id.toString(),
      source: 'internshala-internships',
      source_url: rawJob.url || '',

      job_title: rawJob.title || null,
      company_name: rawJob.company || null,

      skills_raw: skillsRaw,

      min_experience: experience,
      max_experience: experience,

      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: salaryCurrency,
      salary_period: salaryPeriod,

      location: location,
      location_country: 'India',
      industry: industryList,

      job_type: jobType,
      work_mode: workMode,

      description: rawJob.description || null,

      posted_at: postedAt,
      expiry_at: expiryAt,
    };
  } catch (err) {
    logger.error(`❌ Internshala internship parser failed: ${err.message}`);
    return null;
  }
}
