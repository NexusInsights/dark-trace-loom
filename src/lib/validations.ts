import { z } from "zod";

// ─── Auth ───
export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255, "Email too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number"),
});

export const magicLinkSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255, "Email too long"),
});

// ─── Cases ───
export const createCaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().trim().max(2000, "Description too long").optional(),
});

// ─── Subjects ───
export const createSubjectSchema = z.object({
  case_id: z.string().uuid("Invalid case ID"),
  name: z.string().trim().min(1, "Name is required").max(200, "Name too long"),
  type: z.string().trim().min(1, "Type is required").max(50, "Type too long"),
  notes: z.string().trim().max(2000, "Notes too long").optional(),
});

// ─── Entities ───
export const createEntitySchema = z.object({
  case_id: z.string().uuid("Invalid case ID"),
  entity_type: z.string().trim().min(1, "Type is required").max(50),
  label: z.string().trim().min(1, "Label is required").max(200, "Label too long"),
});

export const createRelationshipSchema = z.object({
  case_id: z.string().uuid("Invalid case ID"),
  source_id: z.string().uuid("Invalid source"),
  target_id: z.string().uuid("Invalid target"),
  relationship_type: z.string().trim().min(1, "Type is required").max(100),
  notes: z.string().trim().max(2000).optional(),
});

// ─── Events ───
export const createEventSchema = z.object({
  case_id: z.string().uuid("Invalid case ID"),
  event_type: z.string().trim().max(100).optional(),
  timestamp: z.string().max(100).optional(),
  description: z.string().trim().max(5000, "Description too long").optional(),
});

// ─── Articles ───
export const createArticleSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Title too long"),
  content: z.string().trim().min(1, "Content is required").max(100000, "Content too long"),
  summary: z.string().trim().max(500, "Summary too long").optional().default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20, "Too many tags").default([]),
});

// ─── Courses ───
export const createCourseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().max(2000).optional().default(""),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
});

export const lessonSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  content: z.string().max(100000, "Content too long").default(""),
});

export const moduleSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  lessons: z.array(lessonSchema).min(1, "At least one lesson required").max(50),
});

// ─── Tool Inputs ───
export const toolInputSchema = z.record(
  z.string().max(50000, "Input value too long")
).refine((obj) => Object.keys(obj).length <= 20, "Too many input fields");

// ─── Admin ───
export const setRoleSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  role: z.enum(["admin", "moderator", "user"]),
  remove: z.boolean(),
});

// ─── Persona Discovery ───
export const personaDiscoverySchema = z.object({
  name: z.string().trim().max(200, "Name too long").optional().default(""),
  username: z.string().trim().max(100, "Username too long")
    .refine((v) => !v || /^[a-zA-Z0-9._\-@]*$/.test(v), "Username contains invalid characters")
    .optional().default(""),
  email: z.string().trim().max(255, "Email too long")
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email format")
    .optional().default(""),
  domain: z.string().trim().max(253, "Domain too long")
    .refine((v) => !v || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v), "Invalid domain format")
    .optional().default(""),
  phone: z.string().trim().max(30, "Phone number too long")
    .refine((v) => !v || /^[+\d\s()-]*$/.test(v), "Phone contains invalid characters")
    .optional().default(""),
}).refine(
  (data) => Object.values(data).some((v) => v && v.trim().length > 0),
  "Provide at least one identifier"
);

export const usernamePermutationSchema = z.object({
  personaId: z.string().uuid("Invalid persona ID"),
  firstName: z.string().trim().max(100, "First name too long").optional().default(""),
  lastName: z.string().trim().max(100, "Last name too long").optional().default(""),
  knownUsername: z.string().trim().max(100, "Username too long")
    .refine((v) => !v || /^[a-zA-Z0-9._\-]*$/.test(v), "Invalid characters")
    .optional().default(""),
}).refine(
  (data) => [data.firstName, data.lastName, data.knownUsername].some((v) => v && v.trim().length > 0),
  "Provide at least one input"
);

export const emailPermutationSchema = z.object({
  personaId: z.string().uuid("Invalid persona ID"),
  firstName: z.string().trim().max(100, "First name too long").optional().default(""),
  lastName: z.string().trim().max(100, "Last name too long").optional().default(""),
  knownDomains: z.array(z.string().trim().max(253)).max(10, "Too many domains").default([]),
  companyDomains: z.array(z.string().trim().max(253)).max(10, "Too many domains").default([]),
}).refine(
  (data) => data.firstName?.trim() || data.lastName?.trim(),
  "Provide at least a first or last name"
);
