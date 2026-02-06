'use client';

import { useState, useRef } from 'react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

type Category = 'bug' | 'feature' | 'improvement' | 'other';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'bug', label: '버그/오류 신고' },
  { value: 'feature', label: '기능 요청' },
  { value: 'improvement', label: '개선 제안' },
  { value: 'other', label: '기타' },
];

export function FeedbackModal({ isOpen, onClose, userEmail }: FeedbackModalProps) {
  const [category, setCategory] = useState<Category>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setResult({ type: 'error', message: '이미지 파일만 업로드 가능합니다.' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setResult({ type: 'error', message: '파일 크기는 5MB 이하여야 합니다.' });
        return;
      }
      setScreenshot(file);
      setPreviewUrl(URL.createObjectURL(file));
      setResult(null);
    }
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !description.trim()) {
      setResult({ type: 'error', message: '제목과 내용을 입력해주세요.' });
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('pageUrl', window.location.href);
      formData.append('browserInfo', JSON.stringify({
        userAgent: navigator.userAgent,
        language: navigator.language,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      }));

      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      const res = await fetch('/api/feedback', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '피드백 제출 중 오류가 발생했습니다.');
      }

      setResult({ type: 'success', message: '피드백이 성공적으로 제출되었습니다. 감사합니다!' });

      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err) {
      setResult({
        type: 'error',
        message: err instanceof Error ? err.message : '피드백 제출 중 오류가 발생했습니다.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setCategory('bug');
    setTitle('');
    setDescription('');
    removeScreenshot();
    setResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 오버레이 */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      />

      {/* 모달 */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">피드백 보내기</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="p-4">
          {/* 카테고리 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              유형
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-2 text-sm rounded-lg border transition ${
                    category === cat.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 제목 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              제목 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="문제 또는 요청 사항을 간략히 입력해주세요"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
              maxLength={100}
            />
          </div>

          {/* 설명 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              상세 내용 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="문제가 발생한 상황, 재현 방법, 기대 결과 등을 자세히 설명해주세요"
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black resize-none"
              maxLength={2000}
            />
            <p className="text-xs text-gray-500 mt-1">{description.length}/2000</p>
          </div>

          {/* 스크린샷 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              스크린샷 (선택)
            </label>

            {!screenshot ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition"
              >
                <UploadIcon />
                <p className="text-sm text-gray-600 mt-2">클릭하여 이미지 업로드</p>
                <p className="text-xs text-gray-400 mt-1">PNG, JPG, GIF (최대 5MB)</p>
              </div>
            ) : (
              <div className="relative border rounded-lg overflow-hidden">
                <img
                  src={previewUrl || ''}
                  alt="스크린샷 미리보기"
                  className="w-full h-40 object-contain bg-gray-100"
                />
                <button
                  type="button"
                  onClick={removeScreenshot}
                  className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
                >
                  <CloseIcon size={16} />
                </button>
                <p className="p-2 text-xs text-gray-600 truncate">{screenshot.name}</p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleScreenshotChange}
              className="hidden"
            />
          </div>

          {/* 결과 메시지 */}
          {result && (
            <div
              className={`mb-4 p-3 rounded-lg ${
                result.type === 'success'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {result.message}
            </div>
          )}

          {/* 버튼 */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition ${
                isSubmitting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? '제출 중...' : '피드백 보내기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
