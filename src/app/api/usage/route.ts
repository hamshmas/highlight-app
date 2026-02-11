import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRemainingUsage } from "@/lib/usage";

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userEmail = session.user.email || "";
        const provider = (session as any).provider || "unknown";
        const userId = (session as any).providerAccountId || session.user.email || session.user.name || "anonymous";
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
