import { NextResponse } from "next/server";

export async function GET() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;

  return NextResponse.json({
    hasProjectId: !!projectId,
    projectId: projectId || "(not set)",
    hasClientEmail: !!clientEmail,
    clientEmail: clientEmail ? clientEmail.substring(0, 20) + "..." : "(not set)",
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey?.length || 0,
    privateKeyStartsWith: privateKey?.substring(0, 30) || "(not set)",
    privateKeyHasLiteralBackslashN: privateKey?.includes('\\n') || false,
    privateKeyHasRealNewline: privateKey?.includes('\n') || false,
    privateKeyNewlineCount: (privateKey?.match(/\n/g) || []).length,
    hasCredentialsJson: !!credentialsJson,
    credentialsJsonLength: credentialsJson?.length || 0,
  });
}
