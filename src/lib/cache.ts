import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getKSTTimestamp } from "./supabase";

let supabaseCache: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseCache) return supabaseCache;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase credentials not configured for caching");
    return null;
  }

  supabaseCache = createClient(supabaseUrl, supabaseKey);
  return supabaseCache;
}

// 파일 해시 생성 (MD5)
export function generateFileHash(buffer: ArrayBuffer): string {
  return crypto.createHash("md5").update(Buffer.from(buffer)).digest("hex");
}

// 캐시 조회
export async function getCachedParsing(fileHash: string): Promise<{
  parsing_result: Record<string, unknown>[];
  columns: string[];
  token_usage?: Record<string, unknown>;
  ai_cost?: Record<string, unknown>;
  hit_count: number;
  id: string;
} | null> {
  const client = getSupabase();
  if (!client) {
    console.log("Supabase not configured, skipping cache lookup");
    return null;
  }

  try {
    const { data, error } = await client
      .from("parsing_cache")
      .select("*")
      .eq("file_hash", fileHash)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) {
      return null;
    }

    // 히트 카운트 증가 (비동기, 에러 무시)
    void client
      .from("parsing_cache")
      .update({ hit_count: data.hit_count + 1 })
      .eq("id", data.id)
      .then(() => {});

    return data;
  } catch (err) {
    console.error("Cache lookup error:", err);
    return null;
  }
}

// 캐시 저장
export async function saveParsing(params: {
  fileHash: string;
  fileName: string;
  fileSize: number;
  parsingResult: Record<string, unknown>[];
  columns: string[];
  tokenUsage?: Record<string, unknown>;
  aiCost?: Record<string, unknown>;
  userEmail?: string;
}): Promise<void> {
  const client = getSupabase();
  if (!client) {
    console.log("Supabase not configured, skipping cache save");
    return;
  }

  const ttlDays = parseInt(process.env.CACHE_TTL_DAYS || "30");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  try {
    const { error } = await client.from("parsing_cache").upsert(
      {
        file_hash: params.fileHash,
        file_name: params.fileName,
        file_size: params.fileSize,
        parsing_result: params.parsingResult,
        columns: params.columns,
        token_usage: params.tokenUsage || null,
        ai_cost: params.aiCost || null,
        expires_at: expiresAt.toISOString(),
        user_email: params.userEmail || null,
        hit_count: 0,
        created_at_kst: getKSTTimestamp(),
      },
      {
        onConflict: "file_hash",
      }
    );

    if (error) {
      console.error("Cache save error:", error);
    } else {
      console.log(`Cached parsing result for ${params.fileName}`);
    }
  } catch (err) {
    console.error("Failed to save cache:", err);
  }
}

// 캐시 활성화 여부 확인
export function isCacheEnabled(): boolean {
  return process.env.ENABLE_PARSING_CACHE !== "false";
}

// 캐시 삭제 (파일 해시로)
export async function deleteCachedParsing(fileHash: string): Promise<boolean> {
  const client = getSupabase();
  if (!client) {
    console.log("Supabase not configured, skipping cache delete");
    return false;
  }

  try {
    const { error } = await client
      .from("parsing_cache")
      .delete()
      .eq("file_hash", fileHash);

    if (error) {
      console.error("Cache delete error:", error);
      return false;
    }

    console.log(`Deleted cache for hash: ${fileHash}`);
    return true;
  } catch (err) {
    console.error("Failed to delete cache:", err);
    return false;
  }
}
