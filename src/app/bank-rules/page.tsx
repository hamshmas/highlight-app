"use client";

import { useState } from "react";
import {
  ALL_BANK_RULES,
  BankParsingRule,
  getRuleValidationStatus,
  ValidationStatus,
} from "@/lib/bank-rules";

function ValidationBadge({ status }: { status: ValidationStatus }) {
  const styles = {
    verified: "bg-green-100 text-green-800 border-green-200",
    "needs-verification": "bg-yellow-100 text-yellow-800 border-yellow-200",
    unverified: "bg-gray-100 text-gray-600 border-gray-200",
  };

  const labels = {
    verified: "검증됨",
    "needs-verification": "검증 필요",
    unverified: "미검증",
  };

  return (
    <span className={`px-2 py-1 text-xs rounded border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function StructureBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    "line-separated": "bg-blue-100 text-blue-800",
    "space-separated": "bg-purple-100 text-purple-800",
    table: "bg-indigo-100 text-indigo-800",
  };

  const labels: Record<string, string> = {
    "line-separated": "줄 구분",
    "space-separated": "공백 구분",
    table: "표 형식",
  };

  return (
    <span className={`px-2 py-1 text-xs rounded ${styles[type] || "bg-gray-100"}`}>
      {labels[type] || type}
    </span>
  );
}

function ColumnTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    date: "bg-orange-100 text-orange-700",
    time: "bg-orange-100 text-orange-700",
    datetime: "bg-orange-100 text-orange-700",
    text: "bg-gray-100 text-gray-700",
    amount: "bg-green-100 text-green-700",
    balance: "bg-blue-100 text-blue-700",
    number: "bg-purple-100 text-purple-700",
  };

  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${styles[type] || "bg-gray-100"}`}>
      {type}
    </span>
  );
}

function BankRuleCard({
  rule,
  isExpanded,
  onToggle,
}: {
  rule: BankParsingRule;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const validationStatus = getRuleValidationStatus(rule);

  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      {/* 헤더 */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{rule.bankName}</h3>
          <ValidationBadge status={validationStatus} />
          <StructureBadge type={rule.structure.type} />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>{rule.header.columns.length}개 컬럼</span>
          <span className="text-gray-300">|</span>
          <span>v{rule.version}</span>
          <svg
            className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 상세 정보 */}
      {isExpanded && (
        <div className="border-t px-4 py-4 space-y-4">
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">은행 ID:</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-xs">{rule.bankId}</code>
            </div>
            <div>
              <span className="text-gray-500">최종 업데이트:</span>
              <span className="ml-2">{rule.lastUpdated}</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">별칭:</span>
              <span className="ml-2">{rule.bankNameAliases.join(", ")}</span>
            </div>
          </div>

          {/* 구조 정보 */}
          <div>
            <h4 className="font-medium text-sm text-gray-700 mb-2">문서 구조</h4>
            <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
              {rule.structure.description}
            </p>
          </div>

          {/* 컬럼 정보 */}
          <div>
            <h4 className="font-medium text-sm text-gray-700 mb-2">컬럼 정보</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-600">#</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">컬럼명</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">타입</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">설명</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">입출금</th>
                  </tr>
                </thead>
                <tbody>
                  {rule.header.columns.map((col, idx) => (
                    <tr key={col.name} className="border-t">
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono text-sm">{col.name}</td>
                      <td className="px-3 py-2">
                        <ColumnTypeBadge type={col.type} />
                      </td>
                      <td className="px-3 py-2 text-gray-600">{col.description || "-"}</td>
                      <td className="px-3 py-2">
                        {col.isDeposit && (
                          <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                            입금
                          </span>
                        )}
                        {col.isWithdrawal && (
                          <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">
                            출금
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 파싱 패턴 */}
          <div>
            <h4 className="font-medium text-sm text-gray-700 mb-2">파싱 패턴</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">날짜 형식:</span>
                <code className="ml-2 text-xs">{rule.patterns.dateFormat}</code>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">금액 형식:</span>
                <span className="ml-2 text-xs">{rule.patterns.amountFormat}</span>
              </div>
              <div className="col-span-2 bg-gray-50 p-2 rounded">
                <span className="text-gray-500">날짜 정규식:</span>
                <code className="ml-2 text-xs font-mono">{rule.patterns.dateRegex}</code>
              </div>
              <div className="col-span-2 bg-gray-50 p-2 rounded">
                <span className="text-gray-500">거래 시작:</span>
                <span className="ml-2 text-xs">{rule.patterns.transactionStartPattern}</span>
              </div>
            </div>
          </div>

          {/* 특이사항 */}
          {rule.notes.length > 0 && (
            <div>
              <h4 className="font-medium text-sm text-gray-700 mb-2">특이사항</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {rule.notes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 샘플 데이터 */}
          {rule.sampleData && (
            <div>
              <h4 className="font-medium text-sm text-gray-700 mb-2">샘플 데이터</h4>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                {rule.sampleData}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BankRulesPage() {
  const [expandedBanks, setExpandedBanks] = useState<Set<string>>(new Set(["woori"]));
  const [searchTerm, setSearchTerm] = useState("");

  const toggleBank = (bankId: string) => {
    setExpandedBanks((prev) => {
      const next = new Set(prev);
      if (next.has(bankId)) {
        next.delete(bankId);
      } else {
        next.add(bankId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedBanks(new Set(ALL_BANK_RULES.map((r) => r.bankId)));
  };

  const collapseAll = () => {
    setExpandedBanks(new Set());
  };

  const filteredRules = ALL_BANK_RULES.filter((rule) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      rule.bankName.toLowerCase().includes(term) ||
      rule.bankId.toLowerCase().includes(term) ||
      rule.bankNameAliases.some((alias) => alias.toLowerCase().includes(term))
    );
  });

  const verifiedCount = ALL_BANK_RULES.filter(
    (r) => getRuleValidationStatus(r) === "verified"
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* 헤더 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">은행별 파싱 규칙</h1>
          <p className="text-gray-600 mt-1">
            각 은행의 거래내역서 PDF 파싱 규칙을 관리합니다.
          </p>
        </div>

        {/* 통계 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-gray-900">{ALL_BANK_RULES.length}</div>
            <div className="text-sm text-gray-500">총 은행 수</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-green-600">{verifiedCount}</div>
            <div className="text-sm text-gray-500">검증 완료</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="text-2xl font-bold text-yellow-600">
              {ALL_BANK_RULES.length - verifiedCount}
            </div>
            <div className="text-sm text-gray-500">검증 필요</div>
          </div>
        </div>

        {/* 검색 및 컨트롤 */}
        <div className="flex gap-4 mb-4">
          <input
            type="text"
            placeholder="은행명 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={expandAll}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            모두 펼치기
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            모두 접기
          </button>
        </div>

        {/* 은행 규칙 목록 */}
        <div className="space-y-3">
          {filteredRules.map((rule) => (
            <BankRuleCard
              key={rule.bankId}
              rule={rule}
              isExpanded={expandedBanks.has(rule.bankId)}
              onToggle={() => toggleBank(rule.bankId)}
            />
          ))}
        </div>

        {filteredRules.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            검색 결과가 없습니다.
          </div>
        )}

        {/* 푸터 */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>새로운 은행 규칙을 추가하려면 샘플 PDF를 제공해주세요.</p>
        </div>
      </div>
    </div>
  );
}
