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

        const provider = (session as any).provider || "google";
        const userId = (session as any).providerAccountId || session.user.email || "unknown";

        const { remaining, maxLimit, isUnlimited, plan, periodEnd, cardLast4 } = await getRemainingUsage(userId, provider);

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
