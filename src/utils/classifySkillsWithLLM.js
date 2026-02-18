import fs from "fs";
import { client, processMicroChunkWithFallback, splitArray } from "./ScraperUtilityfunctions.js";
import { generateObject } from "ai";
import { SkillSchema } from "./schema.js";
import redis from "../config/redis.js";

// ---- CONFIG ----
const CHUNK_SIZE = 300;
const REDIS_KEY = "skill_classification:last_batch";
const LOCK_KEY = "skill_classification:lock";
const SKILL_FILE = "./unique_skills.txt";

// ---- READ SKILLS SNAPSHOT ----
function readSkillsSnapshot() {
  if (!fs.existsSync(SKILL_FILE)) return [];
  return fs
    .readFileSync(SKILL_FILE, "utf-8")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}




// ---- MAIN ----
async function run() {
  /* ---------- LOCK ---------- */
  const locked = await redis.set(LOCK_KEY, "1", { NX: true, EX: 600 });
  if (!locked) {
    console.log("⚠️ Another run is in progress. Exiting.");
    return;
  }

  let processedAll = true;

  try {
    const skills = readSkillsSnapshot();

    if (!skills.length) {
      console.log("ℹ️ No skills to process");
      return;
    }

    const redisValue = await redis.get(REDIS_KEY);
    const lastBatch = redisValue ? Number(redisValue) : -1;

    console.log(`🔁 Resuming from batch ${lastBatch + 1}`);

    // ---- LOAD EXISTING OUTPUT ----
    function loadSet(file) {
      return fs.existsSync(file)
        ? new Set(JSON.parse(fs.readFileSync(file)))
        : new Set();
    }

    const technicalSet = loadSet("technical_skills.json");
    const toolsSet = loadSet("tools_skills.json");
    const softSet = loadSet("soft_skills.json");

    const totalBatches = Math.ceil(skills.length / CHUNK_SIZE);

    for (let batch = lastBatch + 1; batch < totalBatches; batch++) {
      const start = batch * CHUNK_SIZE;
      const chunk = skills.slice(start, start + CHUNK_SIZE);

      console.log(`🔹 Batch ${batch}: ${chunk.length} skills`);

      const microChunks = splitArray(chunk, 25) || [];
   
      console.log(`   - Split into ${microChunks.length} micro-chunks of 25 skills each`);
        for (const micro of microChunks) {
          console.log("   - Processing micro-chunk of size", micro.length);
  if (!Array.isArray(micro) || micro.length === 0) continue;

  await processMicroChunkWithFallback(
    micro,
    technicalSet,
    toolsSet,
    softSet
  );
}


} 
    }
   catch (err) {
    processedAll = false;
    console.error("❌ Error during processing:", err);
  } finally {
    /* ---------- FINAL CLEANUP ---------- */
    if (processedAll) {
      console.log("🧹 All batches completed. Clearing state...");

      // Clear the skill file (drain queue)
      fs.writeFileSync(SKILL_FILE, "", "utf-8");

      // Reset progress
      await redis.del(REDIS_KEY);

      console.log("♻️ File + Redis state reset");
    }

    // Release lock
    await redis.del(LOCK_KEY);
  }

  console.log("🎉 Run finished");
}

run();
