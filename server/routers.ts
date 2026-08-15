import { parse } from "cookie";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  completeChildTask,
  configureChildPin,
  createChildSession,
  createTask,
  getChildDashboard,
  getChildFromSession,
  getParentOverview,
  recordGrade,
  reviewTask,
  verifyChildPin,
} from "./db";

const childKeySchema = z.enum(["sandy", "celia"]);
const taskCategorySchema = z.enum(["academic", "household", "hygiene", "organization"]);
const CHILD_SESSION_COOKIE = "family_child_session";

function childSessionCookie(req: { headers: { cookie?: string } }) {
  return parse(req.headers.cookie ?? "")[CHILD_SESSION_COOKIE];
}

async function requireChildSession(req: { headers: { cookie?: string } }) {
  const child = await getChildFromSession(childSessionCookie(req));
  if (!child) throw new Error("Child session is required");
  return child;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  family: router({
    parent: router({
      overview: adminProcedure.query(() => getParentOverview()),
      setPin: adminProcedure.input(z.object({ childKey: childKeySchema, pin: z.string().regex(/^\d{4,8}$/) }))
        .mutation(({ input }) => configureChildPin(input.childKey, input.pin)),
      createTask: adminProcedure.input(z.object({
        childKey: childKeySchema,
        title: z.string().trim().min(2).max(160),
        description: z.string().trim().max(600).optional(),
        category: taskCategorySchema,
        dueDate: z.string().datetime().optional(),
        points: z.number().int().min(1).max(100),
      })).mutation(({ ctx, input }) => createTask({ ...input, createdBy: ctx.user.id, dueDate: input.dueDate ? new Date(input.dueDate) : undefined })),
      reviewTask: adminProcedure.input(z.object({ taskId: z.number().int().positive(), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(600).optional() }))
        .mutation(({ ctx, input }) => reviewTask({ ...input, reviewerId: ctx.user.id })),
      recordGrade: adminProcedure.input(z.object({
        childKey: childKeySchema,
        subject: z.string().trim().min(2).max(80),
        assessment: z.string().trim().min(2).max(120),
        score: z.number().int().min(0).max(1000),
        outOf: z.number().int().min(1).max(1000),
      }).refine(data => data.score <= data.outOf, { message: "Score cannot exceed total" }))
        .mutation(({ ctx, input }) => recordGrade({ ...input, recordedBy: ctx.user.id })),
    }),
    child: router({
      me: publicProcedure.query(async ({ ctx }) => {
        const child = await getChildFromSession(childSessionCookie(ctx.req));
        return child ? getChildDashboard(child.id) : null;
      }),
      login: publicProcedure.input(z.object({ childKey: childKeySchema, pin: z.string().regex(/^\d{4,8}$/) }))
        .mutation(async ({ ctx, input }) => {
          const child = await verifyChildPin(input.childKey, input.pin);
          if (!child) throw new Error("Invalid child PIN");
          const session = await createChildSession(child.id);
          ctx.res.cookie(CHILD_SESSION_COOKIE, session.token, {
            httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
            expires: session.expiresAt,
          });
          return { success: true };
        }),
      logout: publicProcedure.mutation(({ ctx }) => {
        ctx.res.clearCookie(CHILD_SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
        return { success: true };
      }),
      completeTask: publicProcedure.input(z.object({ taskId: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          const child = await requireChildSession(ctx.req);
          await completeChildTask(child.id, input.taskId);
          return { success: true };
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;

