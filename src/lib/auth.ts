import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import KakaoProvider from "next-auth/providers/kakao";

const ALLOWED_DOMAIN = "sjinlaw.com";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    KakaoProvider({
      clientId: process.env.KAKAO_CLIENT_ID!,
      clientSecret: process.env.KAKAO_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // 카카오 로그인은 도메인 제한 없이 허용
      if (account?.provider === "kakao") {
        return true;
      }

      // 구글 로그인은 sjinlaw.com 도메인만 허용
      const email = user.email;
      if (email && email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return true;
      }
      return false; // 그 외에는 로그인 거부
    },
    async jwt({ token, account }) {
      // 최초 로그인 시 provider 정보 저장
      if (account) {
        console.log("JWT callback - account:", {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        });
        token.provider = account.provider;
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      // 세션에 provider 정보 추가
      (session as any).provider = token.provider;
      (session as any).providerAccountId = token.providerAccountId;
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/auth/error",
  },
};
