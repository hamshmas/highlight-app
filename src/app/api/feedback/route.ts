import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createClient } from "@supabase/supabase-js";
import { logAction, getKSTTimestamp } from "@/lib/supabase";
import { Resend } from "resend";

// Supabase 클라이언트
function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Resend 클라이언트
function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FEEDBACK_BUCKET = "feedback-screenshots";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@sjinlaw.com";

export async function POST(request: NextRequest) {
  try {
    // 1. 인증 확인
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = session.user.email;
    const provider = (session as any).provider;
    const userId = (session as any).providerAccountId || userEmail;

    // 2. FormData 파싱
    const formData = await request.formData();
    const category = formData.get("category") as string;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const pageUrl = formData.get("pageUrl") as string;
    const browserInfo = formData.get("browserInfo") as string;
    const screenshot = formData.get("screenshot") as File | null;

    // 3. 유효성 검사
    if (!category || !title || !description) {
      return NextResponse.json(
        { error: "필수 필드가 누락되었습니다." },
        { status: 400 }
      );
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 }
      );
    }

    // 4. 스크린샷 업로드 (있는 경우)
    let screenshotPath: string | null = null;

    if (screenshot && screenshot.size > 0) {
      const timestamp = Date.now();
      const safeEmail = userEmail.replace(/[^a-zA-Z0-9]/g, "_");
      const ext = screenshot.name.split(".").pop() || "png";
      const path = `${safeEmail}/${timestamp}.${ext}`;

      const arrayBuffer = await screenshot.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .upload(path, buffer, {
          contentType: screenshot.type,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Screenshot upload error:", uploadError);
        // 스크린샷 업로드 실패해도 피드백은 저장
      } else {
        screenshotPath = path;
      }
    }

    // 5. 피드백 저장
    const { data: feedback, error: insertError } = await supabase
      .from("feedback")
      .insert({
        user_email: userEmail,
        category,
        title,
        description,
        screenshot_path: screenshotPath,
        browser_info: browserInfo ? JSON.parse(browserInfo) : null,
        page_url: pageUrl,
        status: "pending",
        created_at_kst: getKSTTimestamp(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Feedback insert error:", insertError);
      return NextResponse.json(
        { error: "피드백 저장 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 6. 이메일 발송
    const resend = getResend();
    if (resend) {
      try {
        // 스크린샷 URL 생성 (있는 경우)
        let screenshotUrl = "";
        if (screenshotPath) {
          const { data: urlData } = await supabase.storage
            .from(FEEDBACK_BUCKET)
            .createSignedUrl(screenshotPath, 60 * 60 * 24 * 7); // 7일 유효
          screenshotUrl = urlData?.signedUrl || "";
        }

        const categoryLabels: Record<string, string> = {
          bug: "버그/오류 신고",
          feature: "기능 요청",
          improvement: "개선 제안",
          other: "기타",
        };

        await resend.emails.send({
          from: "Feedback <onboarding@resend.dev>",
          to: ADMIN_EMAIL,
          subject: `[피드백] ${categoryLabels[category] || category}: ${title}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">새로운 피드백이 접수되었습니다</h2>

              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 100px;">유형</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">${categoryLabels[category] || category}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">제목</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">제출자</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">${userEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">페이지 URL</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">${pageUrl || "-"}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">접수 시간</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">${getKSTTimestamp()}</td>
                </tr>
              </table>

              <h3 style="color: #333;">상세 내용</h3>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap;">
                ${description}
              </div>

              ${
                screenshotUrl
                  ? `
                <h3 style="color: #333; margin-top: 20px;">첨부된 스크린샷</h3>
                <a href="${screenshotUrl}" style="color: #0066cc;">스크린샷 보기 (7일간 유효)</a>
              `
                  : ""
              }

              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
              <p style="color: #666; font-size: 12px;">
                이 이메일은 거래내역 하이라이트 앱의 피드백 시스템에서 자동 발송되었습니다.
              </p>
            </div>
          `,
        });
        console.log("Feedback email sent to:", ADMIN_EMAIL);
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        // 이메일 발송 실패해도 피드백은 저장됨
      }
    } else {
      console.log("Resend not configured, skipping email notification");
    }

    // 7. 로그 기록
    await logAction(userEmail, "feedback_submitted", {
      feedbackId: feedback.id,
      category,
      title,
      hasScreenshot: !!screenshotPath,
    }, userId, provider);

    return NextResponse.json({
      success: true,
      feedbackId: feedback.id,
    });
  } catch (error) {
    console.error("Feedback API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
