import axios from "axios";
import { Job } from "../db/jobmodel.js";
import { connectDB } from "../db/connection.js";

export async function syncMongoJobsToPostgres() {
  await connectDB();
  const BACKEND_URL = process.env.BACKEND_URL;

  let hasMore = true;

  while (hasMore) {
    try {
      const jobs = await Job.find({ is_published: false }).limit(2);

      if (!jobs.length) {
        console.log("✅ All jobs synced");
        hasMore = false;
        break;
      }

      // 🔥 prepare batch payload
      const payload = jobs.map((j) => ({
        job_id: j.job_id,
        source: j.source,
        source_url: j.source_url,

        job_title: j.job_title,
        role_title: j.role_title,
        company_name: j.company_name,

        skills: {
          technical: j.skills?.technical || [],
          tools: j.skills?.tools || [],
          soft: j.skills?.soft || [],
        },

        min_experience: j.min_experience,
        max_experience: j.max_experience,
        difficulty_level: j.difficulty_level,

        salary_min: j.salary_min,
        salary_max: j.salary_max,
        salary_currency: j.salary_currency,
        salary_period: j.salary_period,

        location: j.location,
        location_state: j.location_state,
        location_country: j.location_country,

        job_type: j.job_type,
        work_mode: j.work_mode,

        industry: j.industry || [],
        description: j.description,

        posted_at: j.posted_at,
        expiry_at: j.expiry_at,
      }));

      // 🔥 send batch
      const response = await axios.post(
        `${BACKEND_URL}/api/jobs/ingest`,
        { jobs: payload }
      );

      const successIds = response.data.successIds || [];

      // ✅ mark only successful ones
      await Job.updateMany(
        { job_id: { $in: successIds } },
        { $set: { is_published: true } }
      );

      console.log(`✅ Synced batch: ${successIds.length}`);
    } catch (err) {
      console.error("❌ Batch failed:", err.message);

      // optional: small delay before retry
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}


//syncMongoJobsToPostgres()
