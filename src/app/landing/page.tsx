"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState, useEffect } from "react";

// 플랜 데이터
const PLANS = [
    {
        plan: "free",
        label: "Free",
        price: 0,
        description: "무료 체험",
        features: ["월 3건 변환", "기본 PDF 지원"],
    },
    {
        plan: "basic",
        label: "Basic",
        price: 29000,
        description: "소규모 업무용",
        features: ["월 50건 변환", "모든 파일 형식 지원", "이메일 지원"],
    },
    {
        plan: "pro",
        label: "Pro",
        price: 59000,
        description: "전문가용",
        features: ["월 200건 변환", "모든 파일 형식 지원", "우선 지원"],
        isPopular: true,
    },
    {
        plan: "enterprise",
        label: "Enterprise",
        price: 99000,
        description: "대규모 업무용",
        features: ["무제한 변환", "API 접근", "모든 파일 형식 지원", "전담 지원"],
    },
];

// 스크린샷 데이터
const SCREENSHOTS = [
    { src: "/screenshot-1.png", alt: "OCR 결과 확인 화면" },
    { src: "/screenshot-2.png", alt: "기준 금액 설정 화면" },
    { src: "/screenshot-3.png", alt: "하이라이트된 거래내역" },
];

export default function LandingPage() {
    const router = useRouter();
    const [currentSlide, setCurrentSlide] = useState(0);

    // 자동 슬라이드
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % SCREENSHOTS.length);
        }, 4000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="min-h-screen bg-white">
            {/* Navigation - Toss Style */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-[#0064FF] rounded-lg flex items-center justify-center">
                                <span className="text-white font-bold text-sm">H</span>
                            </div>
                            <span className="text-gray-900 font-bold text-lg">Highlight</span>
                        </div>
                        <div className="flex items-center gap-6">
                            <Link href="#features" className="text-gray-600 hover:text-gray-900 transition text-sm font-medium">
                                기능
                            </Link>
                            <Link href="#pricing" className="text-gray-600 hover:text-gray-900 transition text-sm font-medium">
                                요금제
                            </Link>
                            <Link
                                href="/"
                                className="px-5 py-2.5 bg-[#0064FF] text-white text-sm font-semibold rounded-xl hover:bg-[#0052D4] transition"
                            >
                                시작하기
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section - Toss Style */}
            <section className="pt-32 pb-20 px-4">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-12">
                        {/* Badge */}
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#E8F3FF] rounded-full mb-8">
                            <span className="w-2 h-2 bg-[#0064FF] rounded-full animate-pulse" />
                            <span className="text-sm text-[#0064FF] font-medium">변호사 · 법무사 · 세무사 · 회계사를 위한 AI 솔루션</span>
                        </div>

                        {/* Headline */}
                        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight tracking-tight">
                            은행 거래내역,
                            <br />
                            <span className="text-[#0064FF]">AI가 자동으로 정리해요</span>
                        </h1>

                        {/* Subheadline */}
                        <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
                            PDF, 이미지, 엑셀 파일을 업로드하면
                            <br className="hidden sm:block" />
                            기준 금액 이상 거래만 <span className="text-gray-900 font-medium">하이라이트된 Excel</span>을 다운로드하세요
                        </p>

                        {/* CTA Buttons */}
                        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
                            <button
                                onClick={() => router.push("/")}
                                className="px-8 py-4 bg-[#0064FF] text-white font-semibold rounded-2xl hover:bg-[#0052D4] transition shadow-lg shadow-[#0064FF]/25 text-lg"
                            >
                                무료로 시작하기
                            </button>
                            <button
                                onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
                                className="px-8 py-4 bg-gray-100 text-gray-700 font-semibold rounded-2xl hover:bg-gray-200 transition text-lg"
                            >
                                더 알아보기
                            </button>
                        </div>
                    </div>

                    {/* App Screenshot Carousel */}
                    <div className="relative max-w-5xl mx-auto">
                        <div className="bg-gradient-to-b from-gray-100 to-gray-50 rounded-3xl p-2 sm:p-4 shadow-2xl">
                            <div className="relative overflow-hidden rounded-2xl bg-white">
                                {SCREENSHOTS.map((shot, index) => (
                                    <div
                                        key={index}
                                        className={`transition-opacity duration-500 ${index === currentSlide ? "opacity-100" : "opacity-0 absolute inset-0"
                                            }`}
                                    >
                                        <Image
                                            src={shot.src}
                                            alt={shot.alt}
                                            width={1400}
                                            height={800}
                                            className="w-full h-auto rounded-2xl"
                                            priority={index === 0}
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* Slide Indicators */}
                            <div className="flex justify-center gap-2 mt-4">
                                {SCREENSHOTS.map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setCurrentSlide(index)}
                                        className={`w-2 h-2 rounded-full transition-all ${index === currentSlide
                                            ? "bg-[#0064FF] w-6"
                                            : "bg-gray-300 hover:bg-gray-400"
                                            }`}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto mt-20">
                        <div className="text-center">
                            <div className="text-4xl font-bold text-gray-900">90%</div>
                            <div className="text-sm text-gray-500 mt-1">시간 절약</div>
                        </div>
                        <div className="text-center">
                            <div className="text-4xl font-bold text-gray-900">10+</div>
                            <div className="text-sm text-gray-500 mt-1">은행 지원</div>
                        </div>
                        <div className="text-center">
                            <div className="text-4xl font-bold text-gray-900">99%</div>
                            <div className="text-sm text-gray-500 mt-1">정확도</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section - Toss Style */}
            <section id="features" className="py-24 px-4 bg-[#F7F8FA]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
                            왜 Highlight인가요?
                        </h2>
                        <p className="text-gray-500 text-lg">
                            수작업 대비 90% 이상 시간을 절약하세요
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Feature 1 */}
                        <div className="group p-8 bg-white rounded-3xl border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
                            <div className="w-14 h-14 bg-[#E8F3FF] rounded-2xl flex items-center justify-center mb-6">
                                <svg className="w-7 h-7 text-[#0064FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">PDF/이미지 OCR</h3>
                            <p className="text-gray-500 leading-relaxed">
                                스캔 문서도 정확하게 텍스트를 추출합니다.
                            </p>
                        </div>

                        {/* Feature 2 */}
                        <div className="group p-8 bg-white rounded-3xl border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
                            <div className="w-14 h-14 bg-[#E8F3FF] rounded-2xl flex items-center justify-center mb-6">
                                <svg className="w-7 h-7 text-[#0064FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">AI 자동 파싱</h3>
                            <p className="text-gray-500 leading-relaxed">
                                AI가 거래내역을 자동으로 분석하고 정리합니다.
                            </p>
                        </div>

                        {/* Feature 3 */}
                        <div className="group p-8 bg-white rounded-3xl border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
                            <div className="w-14 h-14 bg-[#E8F3FF] rounded-2xl flex items-center justify-center mb-6">
                                <svg className="w-7 h-7 text-[#0064FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">스마트 하이라이트</h3>
                            <p className="text-gray-500 leading-relaxed">
                                기준 금액 이상 거래만 자동으로 색상 표시합니다.
                            </p>
                        </div>

                        {/* Feature 4 */}
                        <div className="group p-8 bg-white rounded-3xl border border-gray-100 hover:shadow-xl transition-all hover:-translate-y-1">
                            <div className="w-14 h-14 bg-[#E8F3FF] rounded-2xl flex items-center justify-center mb-6">
                                <svg className="w-7 h-7 text-[#0064FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-3">Excel 자동 생성</h3>
                            <p className="text-gray-500 leading-relaxed">
                                하이라이트된 결과를 Excel로 바로 다운로드하세요.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* How It Works Section - Toss Style */}
            <section className="py-24 px-4 bg-white">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
                            간단한 3단계
                        </h2>
                        <p className="text-gray-500 text-lg">
                            복잡한 설정 없이 바로 시작하세요
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-12">
                        {/* Step 1 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto bg-[#0064FF] rounded-3xl flex items-center justify-center mb-8 shadow-lg shadow-[#0064FF]/25">
                                <span className="text-white font-bold text-3xl">1</span>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-4">파일 업로드</h3>
                            <p className="text-gray-500 leading-relaxed">
                                PDF, 이미지, 엑셀 파일을<br />드래그 앤 드롭으로 업로드하세요.
                            </p>
                        </div>

                        {/* Step 2 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto bg-[#0064FF] rounded-3xl flex items-center justify-center mb-8 shadow-lg shadow-[#0064FF]/25">
                                <span className="text-white font-bold text-3xl">2</span>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-4">AI 자동 추출</h3>
                            <p className="text-gray-500 leading-relaxed">
                                AI가 거래내역을 자동으로<br />인식하고 테이블로 정리합니다.
                            </p>
                        </div>

                        {/* Step 3 */}
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto bg-[#0064FF] rounded-3xl flex items-center justify-center mb-8 shadow-lg shadow-[#0064FF]/25">
                                <span className="text-white font-bold text-3xl">3</span>
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-4">Excel 다운로드</h3>
                            <p className="text-gray-500 leading-relaxed">
                                기준 금액을 설정하고<br />하이라이트된 Excel을 다운로드하세요.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pricing Section - Toss Style */}
            <section id="pricing" className="py-24 px-4 bg-[#F7F8FA]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
                            합리적인 요금제
                        </h2>
                        <p className="text-gray-500 text-lg">
                            업무 규모에 맞는 플랜을 선택하세요
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {PLANS.map((plan) => (
                            <div
                                key={plan.plan}
                                className={`relative p-8 rounded-3xl border transition-all hover:-translate-y-1 hover:shadow-xl ${plan.isPopular
                                    ? "bg-[#0064FF] text-white border-[#0064FF]"
                                    : "bg-white border-gray-100"
                                    }`}
                            >
                                {plan.isPopular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#FFD700] text-gray-900 text-xs font-bold rounded-full">
                                        인기
                                    </div>
                                )}

                                <div className="mb-6">
                                    <h3 className={`text-xl font-bold ${plan.isPopular ? "text-white" : "text-gray-900"}`}>{plan.label}</h3>
                                    <p className={`text-sm mt-1 ${plan.isPopular ? "text-blue-100" : "text-gray-500"}`}>{plan.description}</p>
                                </div>

                                <div className="mb-8">
                                    <span className={`text-4xl font-bold ${plan.isPopular ? "text-white" : "text-gray-900"}`}>
                                        {plan.price === 0 ? "무료" : `₩${plan.price.toLocaleString()}`}
                                    </span>
                                    {plan.price > 0 && <span className={`text-sm ${plan.isPopular ? "text-blue-100" : "text-gray-500"}`}>/월</span>}
                                </div>

                                <ul className="space-y-4 mb-8">
                                    {plan.features.map((feature, idx) => (
                                        <li key={idx} className={`flex items-center gap-3 text-sm ${plan.isPopular ? "text-blue-100" : "text-gray-600"}`}>
                                            <svg className={`w-5 h-5 flex-shrink-0 ${plan.isPopular ? "text-white" : "text-[#0064FF]"}`} fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => router.push(plan.plan === "free" ? "/" : "/pricing")}
                                    className={`w-full py-4 rounded-2xl font-semibold transition ${plan.isPopular
                                        ? "bg-white text-[#0064FF] hover:bg-blue-50"
                                        : "bg-[#0064FF] text-white hover:bg-[#0052D4]"
                                        }`}
                                >
                                    {plan.plan === "free" ? "무료로 시작" : "선택하기"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section - Toss Style */}
            <section className="py-24 px-4 bg-white">
                <div className="max-w-3xl mx-auto text-center">
                    <div className="p-12 bg-gradient-to-r from-[#0064FF] to-[#0052D4] rounded-[2rem] shadow-2xl shadow-[#0064FF]/25">
                        <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                            지금 바로 시작하세요
                        </h2>
                        <p className="text-blue-100 mb-10 text-lg">
                            무료 체험으로 시작하고, 필요할 때 업그레이드하세요.
                        </p>
                        <button
                            onClick={() => router.push("/")}
                            className="px-10 py-5 bg-white text-[#0064FF] font-bold rounded-2xl hover:bg-blue-50 transition shadow-lg text-lg"
                        >
                            무료로 시작하기 →
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer - Toss Style */}
            <footer className="py-12 px-4 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-[#0064FF] rounded-lg flex items-center justify-center">
                                <span className="text-white font-bold text-sm">H</span>
                            </div>
                            <span className="text-gray-900 font-bold">Highlight</span>
                        </div>

                        <div className="flex items-center gap-8 text-sm text-gray-500">
                            <Link href="/" className="hover:text-gray-900 transition">앱 시작</Link>
                            <Link href="/pricing" className="hover:text-gray-900 transition">요금제</Link>
                            <a href="mailto:support@example.com" className="hover:text-gray-900 transition">문의하기</a>
                        </div>

                        <div className="text-sm text-gray-400">
                            © 2026 Highlight. All rights reserved.
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
