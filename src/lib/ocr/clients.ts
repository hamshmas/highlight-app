// Google Cloud Vision 및 Gemini 클라이언트 초기화

import { ImageAnnotatorClient } from "@google-cloud/vision";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenerativeAI } from "@google/generative-ai";

let visionClient: ImageAnnotatorClient | null = null;
let geminiClient: GoogleGenerativeAI | null = null;

/**
 * Google Cloud Vision 클라이언트 초기화
 * 개별 환경변수 또는 JSON 환경변수 사용
 */
export function getVisionClient(): ImageAnnotatorClient | null {
    if (visionClient) return visionClient;

    // 방법 1: 개별 환경변수 사용 (Vercel에서 가장 안정적)
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        console.log("Using individual environment variables for Vision client");

        // Vercel에서 줄바꿈이 리터럴 \\n으로 저장될 수 있음
        if (privateKey.includes('\\n')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
        }

        console.log("Creating Vision client with project:", projectId);

        const auth = new GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            projectId,
            scopes: ['https://www.googleapis.com/auth/cloud-vision'],
        });

        visionClient = new ImageAnnotatorClient({ auth });
        return visionClient;
    }

    // 방법 2: JSON 환경변수 (fallback)
    let credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64
        ? Buffer.from(process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64, 'base64').toString('utf-8')
        : process.env.GOOGLE_CLOUD_CREDENTIALS;

    if (!credentialsJson) {
        console.warn("Google Cloud credentials not configured");
        return null;
    }

    try {
        let credentials;
        try {
            credentials = JSON.parse(credentialsJson);
        } catch {
            console.log("First JSON parse failed, trying to unescape...");
            const unescaped = credentialsJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            credentials = JSON.parse(unescaped);
        }

        if (!credentials.private_key) {
            console.error("Google Cloud credentials missing private_key");
            return null;
        }

        let pk = credentials.private_key;
        while (pk.includes('\\n')) {
            pk = pk.replace(/\\n/g, '\n');
        }
        if (!pk.endsWith('\n')) {
            pk = pk + '\n';
        }

        console.log("Creating Vision client with project:", credentials.project_id);

        const auth = new GoogleAuth({
            credentials: {
                client_email: credentials.client_email,
                private_key: pk,
            },
            projectId: credentials.project_id,
            scopes: ['https://www.googleapis.com/auth/cloud-vision'],
        });

        visionClient = new ImageAnnotatorClient({ auth });
        return visionClient;
    } catch (error) {
        console.error("Failed to parse Google Cloud credentials:", error);
        return null;
    }
}

/**
 * Gemini API 클라이언트 초기화
 */
export function getGeminiClient(): GoogleGenerativeAI | null {
    if (geminiClient) return geminiClient;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your-gemini-api-key") {
        return null;
    }

    geminiClient = new GoogleGenerativeAI(apiKey);
    return geminiClient;
}

/**
 * 클라이언트 캐시 리셋 (테스트용)
 */
export function resetClients(): void {
    visionClient = null;
    geminiClient = null;
}
