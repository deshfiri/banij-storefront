"use client";

import { useParams } from "next/navigation";
import { EmptyState } from "@/components/states";
import { dictionary, isLocale } from "@/lib/i18n";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang } = useParams<{ lang: string }>();
  const t = dictionary(isLocale(lang) ? lang : "en");
  return (
    <div className="py-6">
      <EmptyState
        role="alert"
        tone="error"
        headingLevel={1}
        title={t.states.error}
        text={t.states.errorText}
        action={{ onClick: reset, label: t.states.retry }}
      />
    </div>
  );
}
