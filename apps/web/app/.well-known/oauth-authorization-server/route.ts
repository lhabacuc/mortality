import { asMetadata } from "@/lib/as-metadata";
import { preflight } from "@/lib/cors";

export const GET = asMetadata;
export const OPTIONS = preflight;
