import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { GoogleAuth } from "google-auth-library";

const ALLOWED_DOMAIN = "sjinlaw.com";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;

  const envStatus = {
    hasProjectId: !!projectId,
    projectId: projectId || "(not set)",
    hasClientEmail: !!clientEmail,
    clientEmail: clientEmail ? clientEmail.substring(0, 20) + "..." : "(not set)",
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey?.length || 0,
    privateKeyHasRealNewline: privateKey?.includes('\n') || false,
    privateKeyNewlineCount: (privateKey?.match(/\n/g) || []).length,
  };

  // Vision API 테스트
  let visionTest: {
    success: boolean;
    error: string;
    message?: string;
    hasAnnotations?: boolean;
    stage?: string;
  } = { success: false, error: "" };

  if (projectId && clientEmail && privateKey) {
    try {
      const auth = new GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        projectId,
        scopes: ['https://www.googleapis.com/auth/cloud-vision'],
      });

      const client = new ImageAnnotatorClient({ auth });

      // 간단한 텍스트 감지 테스트 (빈 이미지)
      // 실제 API를 호출하지 않고 클라이언트 생성만 테스트
      visionTest = {
        success: true,
        error: "",
        message: "Client created successfully"
      };

      // 실제 API 호출 테스트 (작은 테스트 이미지로)
      try {
        // 1x1 투명 PNG
        const testImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        const [result] = await client.textDetection({ image: { content: testImage.toString('base64') } });
        visionTest = {
          success: true,
          error: "",
          message: "API call successful",
          hasAnnotations: !!result.textAnnotations,
        };
      } catch (apiError) {
        visionTest = {
          success: false,
          error: apiError instanceof Error ? apiError.message : String(apiError),
          stage: "API call",
        };
      }
    } catch (error) {
      visionTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stage: "Client creation",
      };
    }
  }

  return NextResponse.json({
    envStatus,
    visionTest,
  });
}
