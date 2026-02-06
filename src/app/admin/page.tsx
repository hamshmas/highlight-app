"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import Link from "next/link";

type TableName = "feedback" | "user_usage" | "activity_logs";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const [activeTable, setActiveTable] = useState<TableName>("feedback");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [newLimit, setNewLimit] = useState<number>(3);

  const isAdmin = session?.user?.email?.endsWith("@sjinlaw.com");

  const fetchData = async (table: TableName) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin?table=${table}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchData(activeTable);
    }
  }, [activeTable, isAdmin]);

  const handleUpdateLimit = async (userId: string, provider: string) => {
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, provider, maxLimit: newLimit }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditingUser(null);
      fetchData("user_usage");
    } catch (err) {
      alert("업데이트 실패");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">접근 권한 없음</h1>
          <p className="text-gray-600 mb-4">관리자 권한이 필요합니다.</p>
          <Link href="/" className="text-blue-600 hover:underline">
            메인으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const tables: { name: TableName; label: string }[] = [
    { name: "feedback", label: "피드백" },
    { name: "user_usage", label: "사용량" },
    { name: "activity_logs", label: "활동 로그" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">관리자 대시보드</h1>
            <Link href="/" className="text-blue-600 hover:underline text-sm">
              메인으로
            </Link>
          </div>
        </div>

        {/* 테이블 탭 */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex gap-2">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => setActiveTable(t.name)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  activeTable === t.name
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => fetchData(activeTable)}
              className="ml-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
            >
              새로고침
            </button>
          </div>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div className="bg-red-100 text-red-800 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* 데이터 테이블 */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">로딩 중...</div>
          ) : data.length === 0 ? (
            <div className="p-8 text-center text-gray-500">데이터가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    {Object.keys(data[0]).map((key) => (
                      <th key={key} className="px-4 py-3 text-left font-semibold text-gray-700">
                        {key}
                      </th>
                    ))}
                    {activeTable === "user_usage" && (
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">작업</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      {Object.entries(row).map(([key, value], j) => (
                        <td key={j} className="px-4 py-3 text-gray-800 max-w-xs truncate">
                          {typeof value === "object"
                            ? JSON.stringify(value).substring(0, 50) + "..."
                            : String(value ?? "-")}
                        </td>
                      ))}
                      {activeTable === "user_usage" && (
                        <td className="px-4 py-3">
                          {editingUser === row.user_id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={newLimit}
                                onChange={(e) => setNewLimit(parseInt(e.target.value) || 0)}
                                className="w-16 px-2 py-1 border rounded"
                              />
                              <button
                                onClick={() => handleUpdateLimit(row.user_id, row.provider)}
                                className="px-2 py-1 bg-blue-600 text-white text-xs rounded"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => setEditingUser(null)}
                                className="px-2 py-1 bg-gray-300 text-xs rounded"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingUser(row.user_id);
                                setNewLimit(row.max_limit);
                              }}
                              className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded hover:bg-orange-200"
                            >
                              한도 수정
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 데이터 개수 */}
        <div className="mt-4 text-sm text-gray-500">
          총 {data.length}개 항목 (최대 100개 표시)
        </div>
      </div>
    </div>
  );
}
