import { NextResponse } from "next/server";
import { ALL_BANK_RULES, getBankRuleById, getRuleValidationStatus } from "@/lib/bank-rules";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bankId = searchParams.get("bankId");

  if (bankId) {
    const rule = getBankRuleById(bankId);
    if (!rule) {
      return NextResponse.json({ error: "Bank rule not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...rule,
      validationStatus: getRuleValidationStatus(rule),
    });
  }

  // 모든 규칙 반환 (요약 정보)
  const summaries = ALL_BANK_RULES.map(rule => ({
    bankId: rule.bankId,
    bankName: rule.bankName,
    columnCount: rule.header.columns.length,
    structureType: rule.structure.type,
    validationStatus: getRuleValidationStatus(rule),
    version: rule.version,
    lastUpdated: rule.lastUpdated,
  }));

  return NextResponse.json({ rules: summaries });
}
