import { createClient } from "@supabase/supabase-js";

// 클라이언트용 Supabase (anon key)
function getClientSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

// 서버용 Supabase (service role key)
function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

const BUCKET_NAME = "pdf-uploads";

// 파일 업로드 (클라이언트에서 사용)
export async function uploadFileToStorage(
  file: File,
  userEmail: string
): Promise<{ path: string; error: string | null }> {
  const client = getClientSupabase();
  if (!client) {
    return { path: "", error: "Storage not configured" };
  }

  // 고유 파일 경로 생성: user-email/timestamp-filename
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}/${timestamp}-${safeName}`;

  try {
    const { error } = await client.storage
      .from(BUCKET_NAME)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return { path: "", error: error.message };
    }

    return { path, error: null };
  } catch (err) {
    console.error("Storage upload exception:", err);
    return { path: "", error: err instanceof Error ? err.message : "Upload failed" };
  }
}

// Signed URL 생성 (서버에서 사용 - 다운로드용)
export async function getSignedUrl(
  path: string,
  expiresIn: number = 3600
): Promise<{ url: string; error: string | null }> {
  const client = getServerSupabase();
  if (!client) {
    return { url: "", error: "Storage not configured" };
  }

  try {
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .createSignedUrl(path, expiresIn);

    if (error) {
      return { url: "", error: error.message };
    }

    return { url: data.signedUrl, error: null };
  } catch (err) {
    return { url: "", error: err instanceof Error ? err.message : "Failed to get URL" };
  }
}

// 파일 다운로드 (서버에서 사용)
export async function downloadFileFromStorage(
  path: string
): Promise<{ data: ArrayBuffer | null; error: string | null }> {
  const client = getServerSupabase();
  if (!client) {
    return { data: null, error: "Storage not configured" };
  }

  try {
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .download(path);

    if (error) {
      return { data: null, error: error.message };
    }

    const arrayBuffer = await data.arrayBuffer();
    return { data: arrayBuffer, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Download failed" };
  }
}

// 파일 삭제 (서버에서 사용)
export async function deleteFileFromStorage(
  path: string
): Promise<{ success: boolean; error: string | null }> {
  const client = getServerSupabase();
  if (!client) {
    return { success: false, error: "Storage not configured" };
  }

  try {
    const { error } = await client.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
}

// 업로드 URL 생성 (서버에서 생성, 클라이언트에서 직접 업로드)
export async function createUploadUrl(
  fileName: string,
  userEmail: string
): Promise<{ uploadUrl: string; path: string; error: string | null }> {
  const client = getServerSupabase();
  if (!client) {
    return { uploadUrl: "", path: "", error: "Storage not configured" };
  }

  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}/${timestamp}-${safeName}`;

  try {
    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path);

    if (error) {
      return { uploadUrl: "", path: "", error: error.message };
    }

    return { uploadUrl: data.signedUrl, path, error: null };
  } catch (err) {
    return { uploadUrl: "", path: "", error: err instanceof Error ? err.message : "Failed to create upload URL" };
  }
}
