import type { NormalizedErrorCode } from "./errors.js";

export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccessResponse<TData> {
  data: TData;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: NormalizedErrorCode;
    message: string;
    requestId: string;
  };
}
