import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createUploadUrl } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  if (!userEmail) {
    return NextResponse.json(
      { error: "세션 정보가 유효하지 않습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  // Rate limit: 분당 20회
  const { allowed } = rateLimit(`upload:${userEmail}`, 20, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const { fileName, fileSize } = await request.json();

    if (!fileName) {
      return NextResponse.json({ error: "파일명이 없습니다" }, { status: 400 });
    }

    // 파일 크기 제한 (50MB)
    const maxSize = 50 * 1024 * 1024;
    if (fileSize && fileSize > maxSize) {
      return NextResponse.json(
        { error: "파일 크기는 50MB를 초과할 수 없습니다" },
        { status: 400 }
      );
    }

    const result = await createUploadUrl(fileName, userEmail);

    if (result.error) {
      console.error("Failed to create upload URL:", result.error);
      return NextResponse.json(
        { error: "업로드 URL 생성 실패: " + result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      path: result.path,
    });
  } catch (error) {
    console.error("Upload URL error:", error);
    return NextResponse.json(
      { error: "업로드 URL 생성 중 오류 발생" },
      { status: 500 }
    );
  }
}
