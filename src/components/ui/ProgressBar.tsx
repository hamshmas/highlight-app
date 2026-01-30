'use client';

interface ProgressBarProps {
    /** 진행률 (0-100) */
    value: number;
    /** 최대값 (기본: 100) */
    max?: number;
    /** 표시 텍스트 */
    label?: string;
    /** 크기 */
    size?: 'sm' | 'md' | 'lg';
    /** 색상 */
    color?: 'primary' | 'success' | 'warning' | 'error';
    /** 애니메이션 (indeterminate) */
    indeterminate?: boolean;
    /** 퍼센트 표시 */
    showPercent?: boolean;
    /** 접근성 레이블 */
    ariaLabel?: string;
}

const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
};

const colorClasses = {
    primary: 'bg-blue-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-500',
    error: 'bg-red-600',
};

/**
 * 프로그레스 바 컴포넌트
 */
export function ProgressBar({
    value,
    max = 100,
    label,
    size = 'md',
    color = 'primary',
    indeterminate = false,
    showPercent = false,
    ariaLabel,
}: ProgressBarProps) {
    const percent = Math.min(100, Math.max(0, (value / max) * 100));

    return (
        <div className="w-full">
            {(label || showPercent) && (
                <div className="flex justify-between items-center mb-1">
                    {label && <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>}
                    {showPercent && !indeterminate && (
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{Math.round(percent)}%</span>
                    )}
                </div>
            )}
            <div
                className={`w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ${sizeClasses[size]}`}
                role="progressbar"
                aria-valuenow={indeterminate ? undefined : percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={ariaLabel || label || '진행률'}
            >
                {indeterminate ? (
                    <div
                        className={`h-full ${colorClasses[color]} rounded-full animate-indeterminate`}
                        style={{ width: '30%' }}
                    />
                ) : (
                    <div
                        className={`h-full ${colorClasses[color]} rounded-full transition-all duration-300 ease-out`}
                        style={{ width: `${percent}%` }}
                    />
                )}
            </div>
        </div>
    );
}

/**
 * 처리 단계 프로그레스
 */
interface StepProgressProps {
    steps: string[];
    currentStep: number;
    isComplete?: boolean;
}

export function StepProgress({ steps, currentStep, isComplete = false }: StepProgressProps) {
    return (
        <div className="w-full" role="group" aria-label="처리 단계">
            <div className="flex justify-between mb-2">
                {steps.map((step, index) => (
                    <div
                        key={step}
                        className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}
                    >
                        <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${index < currentStep || isComplete
                                    ? 'bg-green-600 text-white'
                                    : index === currentStep
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-300 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                                }`}
                            aria-current={index === currentStep ? 'step' : undefined}
                        >
                            {index < currentStep || isComplete ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path
                                        fillRule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clipRule="evenodd"
                                    />
                                </svg>
                            ) : (
                                index + 1
                            )}
                        </div>
                        {index < steps.length - 1 && (
                            <div
                                className={`flex-1 h-1 mx-2 rounded transition-colors ${index < currentStep || isComplete ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
                                    }`}
                            />
                        )}
                    </div>
                ))}
            </div>
            <div className="flex justify-between">
                {steps.map((step, index) => (
                    <span
                        key={step}
                        className={`text-xs font-medium ${index === currentStep
                                ? 'text-blue-600 dark:text-blue-400'
                                : index < currentStep || isComplete
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-gray-500 dark:text-gray-400'
                            }`}
                    >
                        {step}
                    </span>
                ))}
            </div>
        </div>
    );
}
