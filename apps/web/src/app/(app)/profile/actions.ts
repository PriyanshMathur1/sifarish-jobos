"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb, schema } from "@jobos/db";

const csv = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const profileInput = z.object({
  fullName: z.string().trim().max(200),
  currentTitle: z.string().trim().max(200),
  yearsExperience: z.union([z.coerce.number().int().min(0).max(60), z.literal("")]),
  skills: z.array(z.string().max(100)).max(50),
  locations: z.array(z.string().max(100)).max(20),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const parsed = profileInput.parse({
    fullName: formData.get("fullName"),
    currentTitle: formData.get("currentTitle"),
    yearsExperience: formData.get("yearsExperience") || "",
    skills: csv(formData.get("skills")),
    locations: csv(formData.get("locations")),
  });

  const db = getDb();
  await db
    .insert(schema.profiles)
    .values({
      userId,
      fullName: parsed.fullName || null,
      currentTitle: parsed.currentTitle || null,
      yearsExperience: parsed.yearsExperience === "" ? null : parsed.yearsExperience,
      skills: parsed.skills,
      locations: parsed.locations,
      summarySource: "manual",
    })
    .onConflictDoUpdate({
      target: schema.profiles.userId,
      set: {
        fullName: parsed.fullName || null,
        currentTitle: parsed.currentTitle || null,
        yearsExperience: parsed.yearsExperience === "" ? null : parsed.yearsExperience,
        skills: parsed.skills,
        locations: parsed.locations,
      },
    });

  revalidatePath("/profile");
}
