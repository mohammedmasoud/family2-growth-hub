import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  badgeCodes,
  childBadges,
  children,
  childSessions,
  familyTasks,
  InsertUser,
  subjectGrades,
  taskReviews,
  users,
  type ChildKey,
  type TaskCategory,
} from "../drizzle/schema";
import { CHILDREN, calculateProgress, isFirstTenEligible, isPerfectWeekEligible, startOfCurrentWeek, weekKey } from "../shared/family";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function ensureFamilyChildren() {
  const db = await requireDb();
  await Promise.all(Object.values(CHILDREN).map(child =>
    db.insert(children).values({ childKey: child.key, displayName: child.name, age: child.age })
      .onDuplicateKeyUpdate({ set: { displayName: child.name, age: child.age } }),
  ));
  return db.select().from(children).orderBy(children.id);
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function configureChildPin(childKey: ChildKey, pin: string) {
  const db = await requireDb();
  await ensureFamilyChildren();
  await db.update(children).set({ pinHash: hashValue(pin) }).where(eq(children.childKey, childKey));
}

export async function getChildByKey(childKey: ChildKey) {
  const db = await requireDb();
  await ensureFamilyChildren();
  const result = await db.select().from(children).where(eq(children.childKey, childKey)).limit(1);
  return result[0];
}

export async function verifyChildPin(childKey: ChildKey, pin: string) {
  const child = await getChildByKey(childKey);
  if (!child?.pinHash) return undefined;
  const expected = Buffer.from(child.pinHash, "utf8");
  const actual = Buffer.from(hashValue(pin), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? child : undefined;
}

export async function createChildSession(childId: number) {
  const db = await requireDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  await db.insert(childSessions).values({ childId, tokenHash: hashValue(token), expiresAt });
  return { token, expiresAt };
}

export async function getChildFromSession(token?: string) {
  if (!token) return undefined;
  const db = await requireDb();
  const result = await db.select({ child: children, session: childSessions })
    .from(childSessions)
    .innerJoin(children, eq(childSessions.childId, children.id))
    .where(and(eq(childSessions.tokenHash, hashValue(token)), gte(childSessions.expiresAt, new Date())))
    .limit(1);
  return result[0]?.child;
}

export async function createTask(input: {
  childKey: ChildKey; createdBy: number; title: string; description?: string; category: TaskCategory; dueDate?: Date; points: number;
}) {
  const db = await requireDb();
  const child = await getChildByKey(input.childKey);
  if (!child) throw new Error("Child profile not found");
  await db.insert(familyTasks).values({
    childId: child.id, createdBy: input.createdBy, title: input.title, description: input.description || null,
    category: input.category, dueDate: input.dueDate ?? null, points: input.points,
  });
}

async function getTasksForChild(childId: number) {
  const db = await requireDb();
  return db.select({ task: familyTasks, review: taskReviews })
    .from(familyTasks)
    .leftJoin(taskReviews, eq(taskReviews.taskId, familyTasks.id))
    .where(eq(familyTasks.childId, childId))
    .orderBy(desc(familyTasks.dueDate), desc(familyTasks.createdAt));
}

export async function getChildDashboard(childId: number) {
  const db = await requireDb();
  const child = (await db.select().from(children).where(eq(children.id, childId)).limit(1))[0];
  if (!child) throw new Error("Child profile not found");
  const [tasks, grades, badges] = await Promise.all([
    getTasksForChild(childId),
    db.select().from(subjectGrades).where(eq(subjectGrades.childId, childId)).orderBy(desc(subjectGrades.recordedAt)),
    db.select().from(childBadges).where(eq(childBadges.childId, childId)).orderBy(desc(childBadges.awardedAt)),
  ]);
  const completed = tasks.filter(({ task }) => task.status !== "open").length;
  return {
    child: { id: child.id, childKey: child.childKey, displayName: child.displayName, age: child.age, points: child.points, hasPin: Boolean(child.pinHash) },
    tasks: tasks.map(({ task, review }) => ({ ...task, review })),
    grades,
    badges,
    progress: calculateProgress(completed, tasks.length),
    completedCount: completed,
  };
}

export async function getParentOverview() {
  const profiles = await ensureFamilyChildren();
  const dashboards = await Promise.all(profiles.map(profile => getChildDashboard(profile.id)));
  return { children: dashboards };
}

async function awardBadgesForChild(childId: number) {
  const db = await requireDb();
  const rows = await db.select().from(familyTasks).where(eq(familyTasks.childId, childId));
  const completed = rows.filter(task => task.status !== "open");
  if (isFirstTenEligible(completed.length)) {
    await db.insert(childBadges).values({ childId, code: badgeCodes[0], periodKey: "lifetime" }).onDuplicateKeyUpdate({ set: { childId } });
  }
  const start = startOfCurrentWeek();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const scheduledThisWeek = rows.filter(task => task.dueDate && task.dueDate >= start && task.dueDate < end);
  const completedOnTime = scheduledThisWeek.filter(task => task.status !== "open" && task.completedAt && task.completedAt <= task.dueDate!).length;
  if (isPerfectWeekEligible({ scheduledTasks: scheduledThisWeek.length, completedOnTime })) {
    await db.insert(childBadges).values({ childId, code: badgeCodes[1], periodKey: weekKey() }).onDuplicateKeyUpdate({ set: { childId } });
  }
}

export async function completeChildTask(childId: number, taskId: number) {
  const db = await requireDb();
  const task = (await db.select().from(familyTasks).where(and(eq(familyTasks.id, taskId), eq(familyTasks.childId, childId))).limit(1))[0];
  if (!task) throw new Error("Task not found");
  if (task.status !== "open") throw new Error("This task has already been completed");
  await db.transaction(async tx => {
    await tx.update(familyTasks).set({ status: "completed", completedAt: new Date() }).where(and(eq(familyTasks.id, taskId), eq(familyTasks.status, "open")));
    await tx.update(children).set({ points: sql`${children.points} + ${task.points}` }).where(eq(children.id, childId));
  });
  await awardBadgesForChild(childId);
}

export async function reviewTask(input: { taskId: number; reviewerId: number; rating: number; comment?: string }) {
  const db = await requireDb();
  const task = (await db.select().from(familyTasks).where(eq(familyTasks.id, input.taskId)).limit(1))[0];
  if (!task || task.status === "open") throw new Error("Only completed tasks can be reviewed");
  const existing = await db.select().from(taskReviews).where(eq(taskReviews.taskId, input.taskId)).limit(1);
  if (existing[0]) throw new Error("This task has already been reviewed");
  await db.transaction(async tx => {
    await tx.insert(taskReviews).values({ taskId: input.taskId, reviewedBy: input.reviewerId, rating: input.rating, comment: input.comment || null });
    await tx.update(familyTasks).set({ status: "reviewed" }).where(eq(familyTasks.id, input.taskId));
  });
}

export async function recordGrade(input: { childKey: ChildKey; recordedBy: number; subject: string; assessment: string; score: number; outOf: number }) {
  const db = await requireDb();
  const child = await getChildByKey(input.childKey);
  if (!child) throw new Error("Child profile not found");
  await db.insert(subjectGrades).values({ childId: child.id, recordedBy: input.recordedBy, subject: input.subject, assessment: input.assessment, score: input.score, outOf: input.outOf });
}
