import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const ALLOWED_DOMAIN = "sjinlaw.com";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // sjinlaw.com 도메인만 허용
      const email = user.email;
      if (email && email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return true;
      }
      return false; // 다른 도메인은 로그인 거부
    },
    async session({ session, token }) {
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/auth/error",
  },
});

export { handler as GET, handler as POST };
