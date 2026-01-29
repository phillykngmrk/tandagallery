'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import type { ReportReason } from '@aggragif/shared';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'media' | 'comment' | 'user';
  targetId: string;
}

const REPORT_REASONS: { value: ReportReason; label: string; description: string }[] = [
  { value: 'spam', label: 'Spam', description: 'Promotional content or repetitive posts' },
  { value: 'harassment', label: 'Harassment', description: 'Bullying or targeted attacks' },
  { value: 'hate_speech', label: 'Hate Speech', description: 'Content promoting hate or discrimination' },
  { value: 'violence', label: 'Violence', description: 'Graphic violence or threats' },
  { value: 'nudity', label: 'Nudity/Sexual Content', description: 'Inappropriate sexual content' },
  { value: 'copyright', label: 'Copyright', description: 'Unauthorized use of copyrighted material' },
  { value: 'misinformation', label: 'Misinformation', description: 'False or misleading information' },
  { value: 'other', label: 'Other', description: 'Other violations not listed above' },
];

async function submitReport(data: {
  targetType: string;
  targetId: string;
  reason: ReportReason;
  details?: string;
}) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to submit report' }));
    throw new Error(error.message);
  }

  return response.json();
}

export function ReportModal({ isOpen, onClose, targetType, targetId }: ReportModalProps) {
  const { isAuthenticated } = useAuth();
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [step, setStep] = useState<'reason' | 'details' | 'success'>('reason');

  const reportMutation = useMutation({
    mutationFn: submitReport,
    onSuccess: () => {
      setStep('success');
    },
  });

  const handleSubmit = () => {
    if (!selectedReason) return;

    reportMutation.mutate({
      targetType,
      targetId,
      reason: selectedReason,
      details: details.trim() || undefined,
    });
  };

  const handleClose = () => {
    setSelectedReason(null);
    setDetails('');
    setStep('reason');
    reportMutation.reset();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[300] transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[301] flex items-center justify-center p-4">
        <div
          className="bg-[var(--bg)] border border-[var(--border)] w-full max-w-md max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
            <h2 className="text-title">Report {targetType}</h2>
            <button
              onClick={handleClose}
              className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {!isAuthenticated ? (
              <div className="text-center py-8">
                <p className="text-caption mb-4">Sign in to submit a report</p>
                <a href="/auth/login" className="btn">
                  Sign in
                </a>
              </div>
            ) : step === 'success' ? (
              <div className="text-center py-8 space-y-4">
                <div className="w-12 h-12 mx-auto bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <p className="text-[var(--fg)] font-medium mb-1">Report submitted</p>
                  <p className="text-caption">Thank you for helping keep our community safe.</p>
                </div>
                <button onClick={handleClose} className="btn">
                  Close
                </button>
              </div>
            ) : step === 'reason' ? (
              <div className="space-y-4">
                <p className="text-caption">Why are you reporting this {targetType}?</p>
                <div className="space-y-2">
                  {REPORT_REASONS.map((reason) => (
                    <button
                      key={reason.value}
                      onClick={() => setSelectedReason(reason.value)}
                      className={`w-full text-left p-4 border transition-colors ${
                        selectedReason === reason.value
                          ? 'border-[var(--fg)] bg-[var(--fg)]/5'
                          : 'border-[var(--border)] hover:border-[var(--muted)]'
                      }`}
                    >
                      <span className="block text-sm font-medium">{reason.label}</span>
                      <span className="block text-xs text-[var(--muted)] mt-0.5">
                        {reason.description}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 pt-4">
                  <button onClick={handleClose} className="btn flex-1">
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep('details')}
                    disabled={!selectedReason}
                    className="btn btn-primary flex-1"
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-1">
                    Reporting for: {REPORT_REASONS.find((r) => r.value === selectedReason)?.label}
                  </p>
                  <button
                    onClick={() => setStep('reason')}
                    className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
                  >
                    Change reason
                  </button>
                </div>
                <div className="space-y-2">
                  <label htmlFor="details" className="block text-caption">
                    Additional details <span className="text-[var(--muted)]">(optional)</span>
                  </label>
                  <textarea
                    id="details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Provide any additional context..."
                    className="auth-input resize-none"
                    rows={4}
                    maxLength={500}
                  />
                  <p className="text-xs text-[var(--muted)] text-right">
                    {details.length}/500
                  </p>
                </div>
                {reportMutation.isError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {reportMutation.error instanceof Error
                      ? reportMutation.error.message
                      : 'Failed to submit report'}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setStep('reason')} className="btn flex-1">
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={reportMutation.isPending}
                    className="btn btn-primary flex-1"
                  >
                    {reportMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting
                      </span>
                    ) : (
                      'Submit Report'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
