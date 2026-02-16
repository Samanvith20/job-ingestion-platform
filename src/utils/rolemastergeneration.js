import fs from "fs";

import { client } from "./ScraperUtilityfunctions.js";
import redis from "../config/redis.js";
import { RoleMappingSchema } from "./schema.js";
import { generateObject } from "ai";


const CHUNK_SIZE = 400;

const technical = JSON.parse(fs.readFileSync("./technical_skills.json"));
const tools = JSON.parse(fs.readFileSync("./tools_skills.json"));
const soft = JSON.parse(fs.readFileSync("./soft_skills.json"));

const skills = [...new Set([...technical, ...tools, ...soft])];


function buildPrompt(skillChunk) {
return  `
  You are building a JOB MARKET ROLE TAXONOMY for real hiring data across industries.

Your task is to map the following skills into ONLY these predefined role categories.

You MUST NOT create new roles.

You MUST use ONLY the roles listed below.

A skill MAY belong to multiple roles if it is commonly used there.

ROLES (do not change names):
1. Frontend Developer
2. Backend Developer
3. Fullstack Developer
4. Mobile Developer

5. DevOps Engineer
6. Cloud Engineer
7. Site Reliability Engineer (SRE)

8. Data Engineer
9. Data Analyst
10. Data Scientist / ML Engineer
11. MLOps Engineer

12. QA / Test Engineer

13. Cybersecurity Engineer
14. Network Engineer
15. Database Engineer / DBA

16. Blockchain / Web3 Engineer

17. ERP Consultant (SAP/Oracle/Dynamics)
18. CRM Consultant (Salesforce/ServiceNow)

19. IT Support / System Admin

20. Business Analyst
21. Product Manager
22. Project Manager

23. UI/UX Designer

24. Sales Executive / Business Development
25. Marketing Executive / Digital Marketing

26. HR / Talent Acquisition
27. Finance / Accounts

28. Operations / Supply Chain

29. Customer Support / BPO

30. Mechanical / Electrical / Civil Engineer
31. Manufacturing / Production Engineer

32. Healthcare Professional
33. Teacher / Trainer

34. Solutions Architect

35. Platform Engineer

36.Data Architect

37. Analytics Engineer / BI

38.Embedded / Firmware Engineer

39.Robotics / Automation Engineer

40. Game Developer

41.Security Analyst / SOC

42.UX Researcher

43.Quantitative Analyst / Research Scientist


Return ONLY valid JSON in this format:
{
  "Frontend Developer": ["react", "html"],
  "Backend Developer": ["node", "sql"],
  
}


n\nSkills:\n${skillChunk.join("\n")}

  `
}



function mergeUnique(existing, incoming) {
  const set = new Set(existing || []);
  incoming.forEach(s => set.add(s));
  return [...set];
}

async function run() {
  const lastBatch = parseInt(await redis.get("role_taxonomy_batch")) || 0;

  const roleMaster = fs.existsSync("role_master.json")
    ? JSON.parse(fs.readFileSync("role_master.json"))
    : {};

  const totalBatches = Math.ceil(skills.length / CHUNK_SIZE);

  for (let batch = lastBatch; batch < totalBatches; batch++) {
    const start = batch * CHUNK_SIZE;
    const chunk = skills.slice(start, start + CHUNK_SIZE);

    console.log(`🔹 Processing batch ${batch}`);

    

    const { object } = await generateObject({
  model: client("gpt-4o-mini"),
  schema: RoleMappingSchema,
  prompt: buildPrompt(chunk),
});


    

    for (const item of object.items) {
  for (const role of item.roles) {
    roleMaster[role] = mergeUnique(
      roleMaster[role],
      [item.skill]
    );
  }
}


    fs.writeFileSync("role_master.json", JSON.stringify(roleMaster, null, 2));

    await redis.set("role_taxonomy_batch", batch + 1);

    console.log(`✅ Batch ${batch} saved`);
  }

  console.log("🎉 role_master.json ready");
}

run();
