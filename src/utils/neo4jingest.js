import neo4j from "neo4j-driver";
import { connectDB } from "../db/connection.js";
import { Job } from "../db/jobmodel.js";
import { BATCH_SIZE, JOB_EXPIRY_DAYS, NEO4J_PASSWORD, NEO4J_URI, NEO4J_USER } from "./constants.js";



// ----------------------------
// Neo4j connection
// ----------------------------
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  { maxConnectionPoolSize: 5 }
);

// ----------------------------
// Helper: flatten technical skills
// ----------------------------
function getCanonicalSkills(job) {
  return Array.from(
    new Set(
      (job.skills?.technical || [])
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

// ----------------------------
// Batch ingest function
// ----------------------------
async function ingestBatch(jobs) {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });

  try {
    const tx = session.beginTransaction();

    for (const job of jobs) {
      const skills = getCanonicalSkills(job);

      await tx.run(
        `
        // ---------------- JOB ----------------
        MERGE (j:Job {job_id: $job_id})
        SET j.title = $title,
            j.source = $source,
            j.source_url = $source_url,
            j.created_at = datetime(),
            j.expires_at = datetime() + duration({days: $expiry_days})

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

        // ---------------- SALARY (JOB LEVEL) ----------------
        FOREACH (_ IN CASE WHEN $salary_min IS NOT NULL THEN [1] ELSE [] END |
          MERGE (sal:Salary {
            min: $salary_min,
            max: $salary_max,
            currency: $salary_currency,
            period: $salary_period
          })
          MERGE (j)-[:OFFERS_SALARY]->(sal)
        )
        `,
        {
          job_id: job.job_id,
          title: job.job_title,
          source: job.source,
          source_url: job.source_url,
          role_title: job.role_title,
          difficulty_level: job.difficulty_level || null,
          company: job.company_name || null,
          skills,
          salary_min: job.salary_min ?? null,
          salary_max: job.salary_max ?? null,
          salary_currency: job.salary_currency || "INR",
          salary_period: job.salary_period || "year",
          expiry_days: JOB_EXPIRY_DAYS
        }
      );
    }

    await tx.commit();
  } catch (err) {
    console.error("❌ Batch failed:", err.message);
    throw err;
  } finally {
    await session.close();
  }
}

// ----------------------------
// MAIN INGESTION LOOP
// ----------------------------
async function runIngestion() {
  console.log("🚀 Starting Neo4j ingestion...");

  await connectDB();

  let skip = 0;

  while (true) {
    const jobs = await Job.find({ is_ingested: false })
      .limit(BATCH_SIZE)
      .lean();
      console.log("📊 Fetched batch of jobs:", jobs.length);

    if (jobs.length === 0) break;

    console.log(`➡️ Ingesting batch of ${jobs.length} jobs...`);

    await ingestBatch(jobs);

    const jobIds = jobs.map(j => j._id);
    await Job.updateMany(
      { _id: { $in: jobIds } },
      { $set: { is_ingested: true } }
    );

    skip += jobs.length;
  }

  console.log("✅ Ingestion completed.");
  await driver.close();
  process.exit(0);
}

runIngestion().catch(err => {
  console.error(err);
  process.exit(1);
});
