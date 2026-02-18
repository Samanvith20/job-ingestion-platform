// postProcessing.js

import neo4j from "neo4j-driver";
import { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } from "./constants.js";

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

// ═══════════════════════════════════════════════════════════════
// QUERY 1: Create Role-Skill relationships (ESSENTIAL)
// ═══════════════════════════════════════════════════════════════
export  async function createRoleSkillLinks() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    console.log('   1️⃣ Creating Role-Skill links...');
    
    const result = await session.run(`
      // Get top 20 skills per role based on job frequency
      MATCH (j:Job)-[:MAPS_TO]->(r:Role)
      MATCH (j)-[:REQUIRES]->(s:Skill)
      
      WITH r, s, count(j) AS frequency
      ORDER BY r.role_title, r.difficulty_level, frequency DESC
      
      // Take top 20 skills per role
      WITH r, collect({skill: s, freq: frequency})[0..20] AS topSkills
      
      UNWIND topSkills AS skillData
      
      // Create Role -> Skill relationship
      MERGE (r)-[rel:REQUIRES]->(skillData.skill)
      SET rel.frequency = skillData.freq,
          rel.last_updated = datetime()
      
      RETURN count(DISTINCT rel) AS linksCreated
    `);
    
    const count = result.records[0].get('linksCreated').toNumber();
    console.log(`      ✅ Created ${count} Role-Skill links`);
    
    return count;
    
  } catch (err) {
    console.error('      ❌ Failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}


// ═══════════════════════════════════════════════════════════════
// QUERY 2: Calculate Skill Demand (ESSENTIAL)
// ═══════════════════════════════════════════════════════════════
export  async function calculateSkillDemand() {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  
  try {
    console.log('   2️⃣ Calculating skill demand rankings...');
    
    const result = await session.run(`
      // Count jobs per skill (only active jobs)
      MATCH (s:Skill)<-[:REQUIRES]-(j:Job)
      WHERE j.expires_at > datetime()
      
      WITH s, count(j) AS jobCount
      ORDER BY jobCount DESC
      
      // Rank all skills
      WITH collect({skill: s, count: jobCount}) AS allSkills
      
      UNWIND range(0, size(allSkills) - 1) AS idx
      WITH allSkills[idx] AS item, idx
      
      // Set demand metrics on each skill
      SET item.skill.demand_rank = idx + 1,
          item.skill.demand_count = item.count,
          item.skill.demand_tier = 
            CASE 
              WHEN idx < 20 THEN "critical"    // Top 20 skills
              WHEN idx < 50 THEN "high"        // Top 50 skills
              WHEN idx < 100 THEN "medium"     // Top 100 skills
              ELSE "low"
            END,
          item.skill.last_analyzed = datetime()
      
      RETURN count(*) AS skillsAnalyzed
    `);
    
    const count = result.records[0].get('skillsAnalyzed').toNumber();
    console.log(`      ✅ Analyzed ${count} skills`);
    
    return count;
    
  } catch (err) {
    console.error('      ❌ Failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

// Close driver when done
export async function closeDriver() {
  await driver.close();
}
