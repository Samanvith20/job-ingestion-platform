import {
  classifySkills,
  filterValidSkills,
  findRole,
  parsePostedDate,
} from '../../utils/ScraperUtilityfunctions.js';

/**
 * Convert a raw Foundit job payload into a normalized job object.
 *
 * @param {Object} rawJob - Raw job data from Foundit.
 * @returns {Object|null} A normalized job object with the following fields: `jobtitle`, `employer`, `industry`, `jobid`, `location` (array of city names), `skills` (array of strings), `job_type`, `joburl`, `work_mode`, `salary_median`, `salary_currency`, `experience`, ` description`, `posted_at` (Date), `expires_at` (Date), `ispublished` (boolean), and `platform`. Returns `null` if parsing fails.
 */

function mapFounditJobType(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  const text = arr.join(' ').toLowerCase();

  if (text.includes('full')) return 'fulltime';
  if (text.includes('part')) return 'parttime';
  if (text.includes('contract')) return 'contract';
  if (text.includes('intern')) return 'internship';
  if (text.includes('permanent')) return 'fulltime'; // Foundit shorthand

  return undefined;
}

export default async function founditParser(rawJob) {
  console.log('foundit parser has been called');

  try {
    // ---- Locations ----
    const locations = Array.isArray(rawJob.locations)
      ? rawJob.locations.map((l) => l?.city).filter(Boolean)
      : [];
    const location_country = Array.isArray(rawJob.locations)
      ? Array.from(new Set(rawJob.locations.map((l) => l?.country).filter(Boolean)))
      : [];
    // ---- Industries ----
    const industries = Array.isArray(rawJob.industries)
      ? Array.from(new Set(rawJob.industries.filter(Boolean)))
      : [];

    // ---- Skills (raw only, no grouping) ----
    const technicalSkills = Array.from(
      new Set([
        ...(Array.isArray(rawJob.itSkills)
          ? rawJob.itSkills.map((s) => s?.text).filter(Boolean)
          : []),
        ...(Array.isArray(rawJob.skills) ? rawJob.skills.map((s) => s?.text).filter(Boolean) : []),
      ])
    );
    const validSkills = filterValidSkills(technicalSkills);

    const skills = classifySkills(validSkills);
    const role_title = await findRole(rawJob.cleanedJobTitle || rawJob.title, [...validSkills]);
    // ---- Experience ----
    const minExp = rawJob.minimumExperience?.years;
    const maxExp = rawJob.maximumExperience?.years;

    // ---- Salary ----
    const minYear = rawJob.minimumSalary?.absoluteValue || 0;
    const maxYear = rawJob.maximumSalary?.absoluteValue || 0;

    const minMonth = rawJob.minimumSalary?.absoluteMonthlyValue || 0;
    const maxMonth = rawJob.maximumSalary?.absoluteMonthlyValue || 0;

    // Decide salary period
    let salaryPeriod;
    if (minYear > 0 || maxYear > 0) {
      salaryPeriod = 'yearly';
    } else if (minMonth > 0 || maxMonth > 0) {
      salaryPeriod = 'monthly';
    } else {
      salaryPeriod = null;
    }

    // Decide what to store based on period
    const salaryMin = salaryPeriod === 'yearly' ? minYear : minMonth;
    const salaryMax = salaryPeriod === 'yearly' ? maxYear : maxMonth;
    const salaryCurrency = rawJob.minimumSalary?.currency || null;

    // ---- Dates ----
    const postedAt = parsePostedDate(rawJob.postedAt);
    const expiryAt = postedAt ? new Date(postedAt.getTime() + 90 * 86400000) : null;

    // ---- Description (markdown-friendly clean) ----
    const description = rawJob.description || '';
    // ---- Convert job type ----
    const canonicalJobType = mapFounditJobType(rawJob.employmentTypes);

    // ---- Return guaranteed raw extraction ----
    return {
      job_id: rawJob.jobId?.toString(),
      source: 'foundit',
      source_url: rawJob.jdUrl ? `https://www.foundit.in${rawJob.jdUrl}` : undefined,
      role_title: role_title.role || 'Others',
      extracted_by: role_title.extracted_by || 'unknown',
      job_title: rawJob.cleanedJobTitle || rawJob.title,
      company_name: rawJob.company?.name || rawJob.companyName,

      // raw skill list ALWAYS present  in foundit
      skills: skills,

      min_experience: minExp,
      max_experience: maxExp,

      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: salaryCurrency || 'INR',
      description: description,
      salary_period: salaryPeriod,
      job_type: canonicalJobType,
      location: locations.length ? locations[0] : undefined,
      location_country: location_country?.length ? location_country[0] : 'India',
      industry: industries.length ? industries : undefined,

      posted_at: postedAt,
      expiry_at: expiryAt,
    };
  } catch (error) {
    console.error(`❌ foundit parser failed: ${error.message}`);
    return undefined;
  }
}
