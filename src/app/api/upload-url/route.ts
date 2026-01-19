import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createUploadUrl } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email || "unknown";

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
