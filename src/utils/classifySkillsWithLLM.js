import fs from 'fs';

import { client } from './ScraperUtilityfunctions.js';

import { generateObject } from 'ai';
import { SkillSchema } from './schema.js';

// ---- CONFIG ----
const CHUNK_SIZE = 300;

// ---- READ SKILLS ----
const skills = fs
  .readFileSync('./unique_skills.txt', 'utf-8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

// ---- PROMPT ----
function buildPrompt(skillChunk) {
  return `
You are helping build a job market skill taxonomy.

Classify EACH skill into EXACTLY ONE of these categories:

1) technical → programming languages, frameworks, databases, networking, security, engineering concepts
2) tools → software tools, platforms, cloud services, devops tools, utilities
3) soft → communication, leadership, teamwork, behavioral skills

STRICT RULES:
- Do NOT rename skills
- Do NOT remove skills
- Do NOT add new skills
- Each skill must appear exactly once
- Return ONLY valid JSON

Skills:
${skillChunk.join("\n")}
`;
}

function splitArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

// ---- MAIN ----
async function run() {
  const progressFile = 'progress.json';

  let lastBatch = -1;
  if (fs.existsSync(progressFile)) {
    lastBatch = JSON.parse(fs.readFileSync(progressFile)).lastBatch;
  }

  console.log(`🔁 Resuming from batch ${lastBatch + 1}`);

  // load existing sets
  function loadSet(file) {
    return fs.existsSync(file) ? new Set(JSON.parse(fs.readFileSync(file))) : new Set();
  }

  const technicalSet = loadSet('technical_skills.json');
  const toolsSet = loadSet('tools_skills.json');
  const softSet = loadSet('soft_skills.json');

  const totalBatches = Math.ceil(skills.length / CHUNK_SIZE);

  for (let batch = lastBatch + 1; batch < totalBatches; batch++) {
    const start = batch * CHUNK_SIZE;
    const chunk = skills.slice(start, start + CHUNK_SIZE);

    console.log(`🔹 Processing batch ${batch} (${start} → ${start + chunk.length})`);

    const microChunks = splitArray(chunk, 25);

    for (const micro of microChunks) {
      const { object: parsed } = await generateObject({
        model: client("gpt-4o-mini"),

        schema: SkillSchema,
        prompt: buildPrompt(micro),
        maxOutputTokens: 500,
      });

      for (const item of parsed.items) {
        if (item.category === 'technical') technicalSet.add(item.skill);
        if (item.category === 'tools') toolsSet.add(item.skill);
        if (item.category === 'soft') softSet.add(item.skill);
      }
    }

    // save skill files
    fs.writeFileSync('technical_skills.json', JSON.stringify([...technicalSet], null, 2));
    fs.writeFileSync('tools_skills.json', JSON.stringify([...toolsSet], null, 2));
    fs.writeFileSync('soft_skills.json', JSON.stringify([...softSet], null, 2));

    // save progress
    fs.writeFileSync(progressFile, JSON.stringify({ lastBatch: batch }));

    console.log(`✅ Batch ${batch} saved`);
  }

  console.log('🎉 Skill classification completed!');
}

run();
