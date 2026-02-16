import { z } from "zod";

export const SkillSchema = z.object({
  items: z.array(
    z.object({
      skill: z.string(),
      category: z.enum(["technical", "tools", "soft"]),
    })
  ),
});

export const RoleMappingSchema = z.object({
  items: z.array(
    z.object({
      skill: z.string(),
      roles: z.array(z.string()),
    })
  ),
});
