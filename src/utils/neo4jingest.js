import neo4j from 'neo4j-driver';
import { connectDB } from '../db/connection.js';
import { Job } from '../db/jobmodel.js';
import { BATCH_SIZE, JOB_EXPIRY_DAYS, NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER } from './constants.js';
import logger from '../logger/logger.js';

// ----------------------------
// Neo4j connection
// ----------------------------
const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), {
  maxConnectionPoolSize: 5,
});


function normalizePrimitive(v) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && '$numberLong' in v) return Number(v.$numberLong);
  if (typeof v === 'object' && '$date' in v) return new Date(v.$date);

  return null; // last-resort safety
}

// ----------------------------
// Helper: flatten technical skills
// ----------------------------
function getCanonicalSkills(job) {
  return Array.from(
    new Set((job.skills?.technical || []).map((s) => s.trim().toLowerCase()).filter(Boolean))
  );
}
function getCanonicalTools(job) {
  return Array.from(
    new Set((job.skills?.tools || []).map((t) => t.trim().toLowerCase()).filter(Boolean))
  );
}
function assertNeo4jSafe(name, value) {
  const isPrimitive =
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date;

  const isPrimitiveArray =
    Array.isArray(value) &&
    value.every(
      (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    );

  if (!isPrimitive && !isPrimitiveArray) {
    console.error('❌ INVALID NEO4J VALUE');
    console.error('Field:', name);
    console.error('Type:', typeof value);
    console.error('Value:', value);
    throw new Error(`Neo4j invalid value for field: ${name}`);
  }
}

function toNeo4jSafeDate(value) {
  if (!value) return null;

  // JS Date → ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Mongo {$date}
  if (typeof value === 'object' && value.$date) {
    return new Date(value.$date).toISOString();
  }

  // Neo4j DateTime → ISO string
  if (value?.year && value?.month && value?.day) {
    const ms = Math.floor((value.nanosecond || 0) / 1e6);
    return new Date(
      Date.UTC(
        value.year,
        value.month - 1,
        value.day,
        value.hour || 0,
        value.minute || 0,
        value.second || 0,
        ms
      )
    ).toISOString();
  }

  return null;
}


const CYPER_QUERY = `
        // ---------------- JOB ----------------
        MERGE (j:Job {job_id: $job_id})
        SET j.title = $title,
            j.source = $source,
            j.source_url = $source_url,
            j.created_at = datetime(),
            j.posted_at = datetime($posted_at),
            j.expires_at = datetime() + duration({days: $expiry_days}),
            j.min_experience = $min_experience,
            j.max_experience = $max_experience,
            j.location = $location,
            j.location_state = $location_state,
            j.location_country = $location_country,
            j.job_type = $job_type,
            j.work_mode = $work_mode,
            j.industry = $industry

        // ---------------- ROLE ----------------
        MERGE (r:Role {role_title: $role_title})
        SET r.difficulty_level = $difficulty_level
        MERGE (j)-[:MAPS_TO]->(r)

        // ---------------- COMPANY ----------------
        FOREACH (_ IN CASE WHEN $company IS NOT NULL THEN [1] ELSE [] END |
          MERGE (c:Company {name: $company})
          MERGE (j)-[:POSTED_BY]->(c)
        )

        // ---------------- SKILLS ----------------
        FOREACH (skill IN $skills |
          MERGE (s:Skill {canonical: skill})
          MERGE (j)-[:REQUIRES]->(s)
        )

          FOREACH (tool IN $tools |
  MERGE (t:Tool {name: tool})
  MERGE (j)-[:USES_TOOL]->(t)
)

        // ---------------- SALARY (JOB LEVEL) ----------------
        FOREACH (_ IN CASE WHEN $salary_min IS NOT NULL THEN [1] ELSE [] END |
         MERGE (sal:Salary {min: $salary_min, max: $salary_max})
SET sal.currency = $salary_currency,
    sal.period = $salary_period

          MERGE (j)-[:OFFERS_SALARY]->(sal)
        )
`;

// ----------------------------
// Batch ingest function
// ----------------------------t
 async function ingestBatch(jobs) {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });

  try {
    const tx = session.beginTransaction();

    for (const job of jobs) {
      const skills = getCanonicalSkills(job).filter(s => typeof s === 'string');

const tools = getCanonicalTools(job).filter(t => typeof t === 'string');
      const params = {
        job_id: normalizePrimitive(job.job_id),
        title: normalizePrimitive(job.job_title),
        source: normalizePrimitive(job.source),
        source_url: normalizePrimitive(job.source_url),
        role_title: normalizePrimitive(job.role_title),
        difficulty_level: normalizePrimitive(job.difficulty_level),
        company: normalizePrimitive(job.company_name),
        posted_at: toNeo4jSafeDate(job.posted_at),

        min_experience: normalizePrimitive(job.min_experience),
        max_experience: normalizePrimitive(job.max_experience),
        location: normalizePrimitive(job.location),
        location_state: normalizePrimitive(job.location_state),
        location_country: normalizePrimitive(job.location_country),
        job_type: normalizePrimitive(job.job_type),
        work_mode: normalizePrimitive(job.work_mode),
        industry:  Array.isArray(job.industry)
  ? job.industry.map(normalizePrimitive).filter(v => v !== null)
  : [],

        description: normalizePrimitive(job.description),
        extracted_by: normalizePrimitive(job.extracted_by),
        is_published: normalizePrimitive(job.is_published),
        skills,
        tools,
        salary_min: normalizePrimitive(job.salary_min),
        salary_max: normalizePrimitive(job.salary_max),
        salary_currency: normalizePrimitive(job.salary_currency || 'INR'),
        salary_period: normalizePrimitive(job.salary_period || 'year'),
        expiry_days: normalizePrimitive(JOB_EXPIRY_DAYS),
      };
     

     for (const [k, v] of Object.entries(params)) {
  try {
    assertNeo4jSafe(k, v);
  } catch (e) {
    console.error('🧨 Neo4j param validation failed');
    console.error('Job _id:', job._id);
    console.error('Job job_id:', job.job_id);
    console.error('Field:', k);
    console.error('Raw value from Mongo:', job[k]);
    console.error('Normalized value:', v);
    throw e;
  }
}


      await tx.run(CYPER_QUERY, params);
    }

    await tx.commit();
  } catch (err) {
    console.error('❌ Batch failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

// ----------------------------
// MAIN INGESTION LOOP
// ----------------------------
export async function runIngestion() {
  logger.info('🚀 Starting Neo4j ingestion...');

  await connectDB();

  let skip = 0;

  while (true) {
    const jobs = await Job.find({ is_ingested: false }).limit(BATCH_SIZE).lean();
    logger.info('📊 Fetched batch of jobs:', jobs.length);

    if (jobs.length === 0) break;

    logger.info(`➡️ Ingesting batch of ${jobs.length} jobs...`);

    await ingestBatch(jobs);

    const jobIds = jobs.map((j) => j._id);
    await Job.updateMany({ _id: { $in: jobIds } }, { $set: { is_ingested: true } });

    skip += jobs.length;
  }

  logger.info('✅ Ingestion completed.');
  await driver.close();

  return true;
}

// runIngestion().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
