import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getRemainingUsage } from "@/lib/usage";

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const provider = (session as any).provider;
        const userId = (session as any).providerAccountId || session.user.email;

        if (!provider || !userId) {
            return NextResponse.json({ error: "세션 정보가 유효하지 않습니다. 다시 로그인해주세요." }, { status: 401 });
        }

        const userEmail = session.user.email || "";
        const { remaining, maxLimit, isUnlimited, plan, periodEnd, cardLast4 } = await getRemainingUsage(userId, provider, userEmail);

        return NextResponse.json({
            provider,
            remaining,
            maxLimit,
            isUnlimited,
            used: isUnlimited ? 0 : maxLimit - remaining,
            plan,
            periodEnd,
            cardLast4,
        });
    } catch (error) {
        console.error("Error fetching usage:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
