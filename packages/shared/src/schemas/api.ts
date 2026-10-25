import { z } from "zod";

export const apiMetaSchema = z.object({
  requestId: z.string().min(1),
});

export function createApiSuccessSchema<TData extends z.ZodTypeAny>(dataSchema: TData) {
  return z.object({
    data: dataSchema,
    meta: apiMetaSchema,
  });
}
